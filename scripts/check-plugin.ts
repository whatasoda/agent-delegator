import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const json = async <T>(path: string): Promise<T> => JSON.parse(await read(path)) as T;

interface PluginManifest {
  name: string;
  version: string;
}

interface Marketplace {
  name: string;
  plugins: Array<PluginManifest & { source: string }>;
}

const packageJson = await json<{ version: string }>("package.json");
const manifest = await json<PluginManifest>("plugins/agent-delegator/.claude-plugin/plugin.json");
const marketplace = await json<Marketplace>(".claude-plugin/marketplace.json");
const entry = marketplace.plugins.find((plugin) => plugin.name === manifest.name);

if (packageJson.version !== "0.1.0-alpha.7") throw new Error("Update the plugin's verified core CLI version");
if (manifest.name !== "agent-delegator") throw new Error("Unexpected plugin name");
if (!entry) throw new Error("Plugin is missing from the marketplace");
if (entry.version !== manifest.version) throw new Error("Plugin and marketplace versions differ");
if (entry.source !== "./plugins/agent-delegator") throw new Error("Marketplace plugin source is not self-contained");

const personalSkill = await read("skills/agent-delegator/SKILL.md");
const pluginSkill = await read("plugins/agent-delegator/skills/delegate-codex/SKILL.md");
const normalizeName = (value: string) => value.replace(/^name: .+$/m, "name: <operator-skill>");

if (normalizeName(personalSkill) !== normalizeName(pluginSkill)) {
  throw new Error("Personal and plugin operator skills have drifted");
}
if (!pluginSkill.includes(`agent-delegator --version\` が \`${packageJson.version}\``)) {
  throw new Error("Plugin skill does not pin the verified core CLI version");
}

process.stdout.write(`plugin ${manifest.name}@${manifest.version} matches core CLI ${packageJson.version}\n`);
