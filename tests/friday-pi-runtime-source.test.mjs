/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const agentTypesPath = path.join(projectRoot, "src/types/agent.ts");
const settingsPath = path.join(projectRoot, "src/types/settings.ts");
const runtimeServicePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");
const realPiSdkAdapterPath = path.join(projectRoot, "src/core/agent-kernel/pi/RealPiSdkSessionAdapter.ts");
const soulSettingsSectionPath = path.join(projectRoot, "src/settings/sections/SoulSettingsSection.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const packageJsonPath = path.join(projectRoot, "package.json");

test("Friday PI runtime source defaults to the existing Obsidian host bridge", async () => {
	const { DEFAULT_FRIDAY_PI_RUNTIME_SOURCE, normalizeFridayPiRuntimeSource } = await jiti.import(agentTypesPath);
	const { DEFAULT_SETTINGS } = await jiti.import(settingsPath);

	assert.equal(DEFAULT_FRIDAY_PI_RUNTIME_SOURCE, "obsidian-host");
	assert.equal(DEFAULT_SETTINGS.agentRuntime.piRuntimeSource, "obsidian-host");
	assert.equal(normalizeFridayPiRuntimeSource(undefined), "obsidian-host");
	assert.equal(normalizeFridayPiRuntimeSource("unexpected"), "obsidian-host");
});

test("Friday PI runtime source preserves an explicit real SDK opt-in", async () => {
	const { normalizeFridayPiRuntimeSource } = await jiti.import(agentTypesPath);

	assert.equal(normalizeFridayPiRuntimeSource("obsidian-host"), "obsidian-host");
	assert.equal(normalizeFridayPiRuntimeSource("real-pi-sdk"), "real-pi-sdk");
});

test("AgentRuntimeService factory can select the real PI SDK host without changing the default bridge", () => {
	const source = read(runtimeServicePath);

	assert.match(source, /RealPiSdkSessionHostAdapter/);
	assert.match(source, /buildFridayPiAgentOptions/);
	assert.match(
		source,
		/normalizeFridayPiRuntimeSource\(\s*this\.getSettings\(\)\.agentRuntime\.piRuntimeSource\s*\?\? DEFAULT_FRIDAY_PI_RUNTIME_SOURCE,\s*\)/,
	);
	assert.match(source, /source === "real-pi-sdk"[\s\S]*new RealPiSdkSessionHostAdapter\(\{[\s\S]*agentOptions:/);
	assert.match(source, /buildSystemPrompt\(input(?: as RuntimeTurnInput)?,\s*input\.depth \?\? 0\)/);
	assert.match(source, /new ObsidianFridayPiRuntimeHostAdapter\(/);
	assert.match(source, /DEFAULT_FRIDAY_PI_RUNTIME_SOURCE|obsidian-host/);
});

test("settings UI exposes a PI runtime source selector", () => {
	const section = read(soulSettingsSectionPath);
	const en = read(enLocalePath);
	const zh = read(zhLocalePath);

	assert.match(section, /settings\.agent\.piRuntimeSource\.name/);
	assert.match(section, /dropdown\.addOption\("obsidian-host"/);
	assert.match(section, /dropdown\.addOption\("real-pi-sdk"/);
	assert.match(section, /agentRuntime\.piRuntimeSource = normalizeFridayPiRuntimeSource\(value\)/);
	assert.match(en, /"settings\.agent\.piRuntimeSource\.name"/);
	assert.match(en, /"settings\.agent\.piRuntimeSource\.realPiSdk"/);
	assert.match(zh, /"settings\.agent\.piRuntimeSource\.name"/);
	assert.match(zh, /"settings\.agent\.piRuntimeSource\.realPiSdk"/);
});

test("real PI SDK host is backed by a bundled dependency instead of an external runtime module", () => {
	const adapter = read(realPiSdkAdapterPath);
	const packageJson = JSON.parse(read(packageJsonPath));

	assert.equal(packageJson.dependencies["@earendil-works/pi-agent-core"], "^0.78.1");
	assert.match(adapter, /import \{ Agent as BundledPiAgent \} from "@earendil-works\/pi-agent-core";/);
	assert.match(
		adapter,
		/resolveRealPiSdkAgentOptions\(options\.agentOptions,\s*input,\s*context\)/,
	);
});

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}
