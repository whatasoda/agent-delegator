import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import approvalSchema from "../schemas/approval.schema.json";
import { verifyEvidenceBundle } from "./evidence.js";
import { readJson, sha256File, writeJson } from "./files.js";

export interface LegacyApprovalRecord {
  schemaVersion: 1;
  approvedBy: string;
  approvedAt: string;
  briefSha256: string;
  briefMarkdownSha256: string;
  transcriptEvidenceSha256: string;
  allowUnresolved: boolean;
}

export interface ApprovalRecord {
  schemaVersion: 3;
  approvedBy: string;
  approvedAt: string;
  briefSha256: string;
  briefMarkdownSha256: string;
  evidenceBundleSha256: string;
  evidenceMarkdownSha256: string;
  allowUnresolved: boolean;
  repoRoot: string;
  baseCommit: string;
  worktreeSha256: string;
}

export interface ApprovalRecordV2 {
  schemaVersion: 2;
  approvedBy: string;
  approvedAt: string;
  briefSha256: string;
  briefMarkdownSha256: string;
  evidenceBundleSha256: string;
  evidenceMarkdownSha256: string;
  allowUnresolved: boolean;
}

const validateApprovalSchema = new Ajv2020({ allErrors: true, formats: { "date-time": true } })
  .compile<ApprovalRecord | ApprovalRecordV2>(approvalSchema);

export async function createApproval(
  runDir: string,
  options: {
    approvedBy: string;
    allowUnresolved: boolean;
    repoRoot: string;
    baseCommit: string;
    worktreeSha256: string;
  },
): Promise<ApprovalRecord> {
  await verifyEvidenceBundle(runDir, options.repoRoot);
  const approval: ApprovalRecord = {
    schemaVersion: 3,
    approvedBy: options.approvedBy,
    approvedAt: new Date().toISOString(),
    briefSha256: await sha256File(join(runDir, "brief.json")),
    briefMarkdownSha256: await sha256File(join(runDir, "brief.md")),
    evidenceBundleSha256: await sha256File(join(runDir, "evidence-bundle.json")),
    evidenceMarkdownSha256: await sha256File(join(runDir, "evidence.md")),
    allowUnresolved: options.allowUnresolved,
    repoRoot: options.repoRoot,
    baseCommit: options.baseCommit,
    worktreeSha256: options.worktreeSha256,
  };
  await writeJson(join(runDir, "approval.json"), approval);
  return approval;
}

export async function verifyApproval(
  runDir: string,
  expected?: { repoRoot: string; baseCommit: string },
): Promise<ApprovalRecord | ApprovalRecordV2> {
  const value = await readJson<unknown>(join(runDir, "approval.json"));
  if ((value as { schemaVersion?: number })?.schemaVersion === 1) {
    throw new Error("Approval schema v1 is no longer executable; recompile and create a current approval");
  }
  if (!validateApprovalSchema(value)) {
    const details = (validateApprovalSchema.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    throw new Error(`approval.json does not match a supported approval schema: ${details}`);
  }
  const approval = value;
  if (approval.briefSha256 !== (await sha256File(join(runDir, "brief.json")))) {
    throw new Error("brief.json changed after approval; review and approve it again");
  }
  if (approval.briefMarkdownSha256 !== (await sha256File(join(runDir, "brief.md")))) {
    throw new Error("brief.md changed after approval; review and approve it again");
  }
  if (approval.evidenceBundleSha256 !== (await sha256File(join(runDir, "evidence-bundle.json")))) {
    throw new Error("evidence-bundle.json changed after approval; review and approve it again");
  }
  if (approval.evidenceMarkdownSha256 !== (await sha256File(join(runDir, "evidence.md")))) {
    throw new Error("evidence.md changed after approval; review and approve it again");
  }
  await verifyEvidenceBundle(runDir, expected?.repoRoot);
  if (approval.schemaVersion === 3) {
    if (expected && (approval.repoRoot !== expected.repoRoot || approval.baseCommit !== expected.baseCommit)) {
      throw new Error("Approval repository identity does not match the run state; recompile and approve again");
    }
  }
  return approval;
}
