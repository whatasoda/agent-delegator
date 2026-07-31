import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import claudeUsageSchema from "../schemas/claude-usage.schema.json";
import type { EvidenceBundle } from "./evidence.js";
import { readJson, writeJsonAtomic } from "./files.js";

export type ClaudeUsagePhase = "design" | "orchestration" | "review";

export interface ClaudeTokenUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export interface ClaudeUsageMessage {
  id: string;
  transcript_id: string;
  source_line: number;
  timestamp: string | null;
  model: string | null;
  phase: ClaudeUsagePhase;
  usage: ClaudeTokenUsage;
}

export interface ClaudeUsageArtifact {
  schema_version: "1";
  updated_at: string;
  method: "transcript-message-usage";
  cursors: Array<{ transcript_id: string; through_source_line: number }>;
  captures: Array<{
    captured_at: string;
    command: string;
    phase: ClaudeUsagePhase;
    scope: "selected-evidence" | "since-prior-boundary";
    status: "captured" | "unavailable";
    added_messages: number;
    detail: string | null;
  }>;
  messages: ClaudeUsageMessage[];
}

export interface ClaudeUsageSummary {
  status: "observed" | "partial" | "unavailable";
  method: "transcript-message-usage" | null;
  messages: number;
  message_ids: string[];
  phases: Record<ClaudeUsagePhase, ClaudeTokenUsage>;
  usage: ClaudeTokenUsage;
  fresh_tokens: number;
  processed_tokens: number;
  capture_errors: number;
}

interface TranscriptEntry {
  type?: unknown;
  isMeta?: unknown;
  isSidechain?: unknown;
  uuid?: unknown;
  timestamp?: unknown;
  message?: {
    id?: unknown;
    model?: unknown;
    content?: unknown;
    usage?: Partial<Record<keyof ClaudeTokenUsage, unknown>>;
  };
}

const emptyUsage = (): ClaudeTokenUsage => ({
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
});

const validateArtifact = new Ajv2020({ allErrors: true, formats: { "date-time": true } })
  .compile<ClaudeUsageArtifact>(claudeUsageSchema);

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function usageFromEntry(entry: TranscriptEntry): ClaudeTokenUsage | null {
  const usage = entry.message?.usage;
  if (!usage) return null;
  const input = tokenCount(usage.input_tokens);
  const created = tokenCount(usage.cache_creation_input_tokens);
  const read = tokenCount(usage.cache_read_input_tokens);
  const output = tokenCount(usage.output_tokens);
  if (input === null || created === null || read === null || output === null) return null;
  return {
    input_tokens: input,
    cache_creation_input_tokens: created,
    cache_read_input_tokens: read,
    output_tokens: output,
  };
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const candidate = block as { type?: unknown; text?: unknown };
    return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
  }).join("\n\n");
}

function transcriptLines(content: string): Array<{ sourceLine: number; entry: TranscriptEntry }> {
  const result: Array<{ sourceLine: number; entry: TranscriptEntry }> = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      result.push({ sourceLine: index + 1, entry: JSON.parse(line) as TranscriptEntry });
    } catch {}
  }
  return result;
}

function selectedSourceBounds(content: string, revision: string | null): { lower: number; upper: number } | null {
  const match = revision?.match(/^turns:(\d+)-(\d+)$/);
  if (!match) return null;
  const fromTurn = Number(match[1]);
  const toTurn = Number(match[2]);
  const visibleLines = transcriptLines(content).flatMap(({ sourceLine, entry }) => {
    if (entry.isMeta || entry.isSidechain || (entry.type !== "user" && entry.type !== "assistant")) return [];
    return textContent(entry.message?.content).trim() ? [sourceLine] : [];
  });
  return {
    lower: visibleLines[fromTurn - 1] ?? Number.POSITIVE_INFINITY,
    upper: visibleLines[toTurn] ?? Number.POSITIVE_INFINITY,
  };
}

function messageKey(path: string, entry: TranscriptEntry): string | null {
  const raw = typeof entry.message?.id === "string" && entry.message.id
    ? `message:${entry.message.id}`
    : typeof entry.uuid === "string" && entry.uuid
      ? `uuid:${entry.uuid}`
      : null;
  return raw ? digest(`${path}\0${raw}`) : null;
}

function usageMessages(
  path: string,
  content: string,
  phase: ClaudeUsagePhase,
  lower: number,
  upper: number,
): ClaudeUsageMessage[] {
  const transcriptId = digest(path);
  const messages = new Map<string, ClaudeUsageMessage>();
  for (const { sourceLine, entry } of transcriptLines(content)) {
    if (sourceLine < lower || sourceLine >= upper) continue;
    if (entry.type !== "assistant" || entry.isMeta || entry.isSidechain) continue;
    const usage = usageFromEntry(entry);
    const id = messageKey(path, entry);
    if (!usage || !id || messages.has(id)) continue;
    messages.set(id, {
      id,
      transcript_id: transcriptId,
      source_line: sourceLine,
      timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null,
      model: typeof entry.message?.model === "string" ? entry.message.model : null,
      phase,
      usage,
    });
  }
  return [...messages.values()];
}

function emptyArtifact(): ClaudeUsageArtifact {
  return {
    schema_version: "1",
    updated_at: new Date().toISOString(),
    method: "transcript-message-usage",
    cursors: [],
    captures: [],
    messages: [],
  };
}

async function optionalArtifact(runDir: string): Promise<ClaudeUsageArtifact> {
  try {
    return await storedArtifact(runDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return emptyArtifact();
    throw error;
  }
}

async function storedArtifact(runDir: string): Promise<ClaudeUsageArtifact> {
  const value = await readJson<unknown>(join(runDir, "claude-usage.json"));
  if (!validateArtifact(value)) throw new Error("invalid claude-usage.json");
  return value;
}

async function writeArtifact(runDir: string, artifact: ClaudeUsageArtifact): Promise<void> {
  if (!validateArtifact(artifact)) throw new Error("generated invalid claude-usage.json");
  await writeJsonAtomic(join(runDir, "claude-usage.json"), artifact);
}

function sourceLineCount(content: string): number {
  if (!content) return 0;
  const lines = content.split(/\r?\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function mergeMessages(artifact: ClaudeUsageArtifact, additions: ClaudeUsageMessage[]): number {
  const known = new Set(artifact.messages.map((message) => message.id));
  const fresh = additions.filter((message) => !known.has(message.id));
  artifact.messages.push(...fresh);
  return fresh.length;
}

function setCursor(artifact: ClaudeUsageArtifact, transcriptId: string, line: number): void {
  const current = artifact.cursors.find((cursor) => cursor.transcript_id === transcriptId);
  if (current) current.through_source_line = Math.max(current.through_source_line, line);
  else artifact.cursors.push({ transcript_id: transcriptId, through_source_line: line });
}

export async function initializeClaudeUsage(runDir: string, bundle: EvidenceBundle, backfill = false): Promise<void> {
  const artifact = emptyArtifact();
  let added = 0;
  let unavailable = 0;
  for (const source of bundle.sources.filter((candidate) => candidate.kind === "transcript")) {
    try {
      const content = await readFile(source.locator, "utf8");
      const bounds = selectedSourceBounds(content, source.revision);
      if (bounds) added += mergeMessages(artifact, usageMessages(source.locator, content, "design", bounds.lower, bounds.upper));
      setCursor(artifact, digest(source.locator), sourceLineCount(content));
    } catch {
      unavailable += 1;
    }
  }
  artifact.updated_at = new Date().toISOString();
  artifact.captures.push({
    captured_at: artifact.updated_at,
    command: "collect",
    phase: "design",
    scope: "selected-evidence",
    status: unavailable ? "unavailable" : "captured",
    added_messages: added,
    detail: unavailable ? `${unavailable} selected transcript source(s) unavailable` : null,
  });
  if (backfill) {
    artifact.captures.push({
      captured_at: artifact.updated_at,
      command: "legacy-backfill",
      phase: "review",
      scope: "since-prior-boundary",
      status: "unavailable",
      added_messages: 0,
      detail: "usage between collection and the first telemetry-aware command cannot be attributed safely",
    });
  }
  await writeArtifact(runDir, artifact);
}

export function claudeUsagePhaseForCommand(command: string): ClaudeUsagePhase {
  if (["resume", "follow-up", "loop", "verify", "evaluate"].includes(command)) return "review";
  if (["implement", "research", "status"].includes(command)) return "orchestration";
  return "design";
}

export async function captureClaudeUsageBoundary(
  runDir: string,
  transcriptPath: string,
  command: string,
): Promise<void> {
  if (!transcriptPath) return;
  let artifact: ClaudeUsageArtifact;
  try {
    artifact = await storedArtifact(runDir);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const bundle = await readJson<EvidenceBundle>(join(runDir, "evidence-bundle.json"));
    await initializeClaudeUsage(runDir, bundle, true);
    artifact = await storedArtifact(runDir);
  }
  const phase = claudeUsagePhaseForCommand(command);
  const transcriptId = digest(transcriptPath);
  const cursor = artifact.cursors.find((candidate) => candidate.transcript_id === transcriptId)?.through_source_line ?? 0;
  try {
    const content = await readFile(transcriptPath, "utf8");
    const lineCount = sourceLineCount(content);
    const added = mergeMessages(artifact, usageMessages(transcriptPath, content, phase, cursor + 1, Number.POSITIVE_INFINITY));
    setCursor(artifact, transcriptId, lineCount);
    artifact.captures.push({
      captured_at: new Date().toISOString(), command, phase, scope: "since-prior-boundary",
      status: "captured", added_messages: added, detail: null,
    });
  } catch (error) {
    artifact.captures.push({
      captured_at: new Date().toISOString(), command, phase, scope: "since-prior-boundary",
      status: "unavailable", added_messages: 0, detail: error instanceof Error ? error.message : String(error),
    });
  }
  artifact.updated_at = new Date().toISOString();
  if (artifact.captures.length > 256) artifact.captures = artifact.captures.slice(-256);
  await writeArtifact(runDir, artifact);
}

function addUsage(target: ClaudeTokenUsage, usage: ClaudeTokenUsage): void {
  target.input_tokens += usage.input_tokens;
  target.cache_creation_input_tokens += usage.cache_creation_input_tokens;
  target.cache_read_input_tokens += usage.cache_read_input_tokens;
  target.output_tokens += usage.output_tokens;
}

export function summarizeClaudeUsageMessages(messages: ClaudeUsageMessage[], captureErrors = 0): ClaudeUsageSummary {
  const phases: ClaudeUsageSummary["phases"] = {
    design: emptyUsage(), orchestration: emptyUsage(), review: emptyUsage(),
  };
  const usage = emptyUsage();
  const unique = new Map(messages.map((message) => [message.id, message]));
  for (const message of unique.values()) {
    addUsage(usage, message.usage);
    addUsage(phases[message.phase], message.usage);
  }
  return {
    status: unique.size ? (captureErrors ? "partial" : "observed") : "unavailable",
    method: "transcript-message-usage",
    messages: unique.size,
    message_ids: [...unique.keys()],
    phases,
    usage,
    fresh_tokens: usage.input_tokens + usage.cache_creation_input_tokens + usage.output_tokens,
    processed_tokens: usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens + usage.output_tokens,
    capture_errors: captureErrors,
  };
}

export async function readClaudeUsageSummary(runDir: string): Promise<ClaudeUsageSummary> {
  try {
    const artifact = await storedArtifact(runDir);
    return summarizeClaudeUsageMessages(
      artifact.messages,
      artifact.captures.filter((capture) => capture.status === "unavailable").length,
    );
  } catch {
    const unavailable = summarizeClaudeUsageMessages([], 1);
    return { ...unavailable, status: "unavailable", method: null };
  }
}

export async function readClaudeUsageMessages(runDir: string): Promise<ClaudeUsageMessage[]> {
  try {
    return (await optionalArtifact(runDir)).messages;
  } catch {
    return [];
  }
}
