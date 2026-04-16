/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const mainPath = path.join(projectRoot, "src/main.ts");
const settingTabPath = path.join(projectRoot, "src/settings/FridaySettingTab.ts");
const agentTypePath = path.join(projectRoot, "src/types/agent.ts");

test("agent profile stores model source and main resolves effective llm settings from it", () => {
	const mainSource = fs.readFileSync(mainPath, "utf8");
	const settingsSource = fs.readFileSync(settingTabPath, "utf8");
	const agentTypeSource = fs.readFileSync(agentTypePath, "utf8");

	assert.match(agentTypeSource, /modelMode\?: "openai" \| "group"/);
	assert.match(mainSource, /switchLlmMode/);
	assert.match(mainSource, /activeAgent\?\.modelMode/);
	assert.match(settingsSource, /buildAgentModelCatalogFromSettings/);
	assert.match(settingsSource, /parseAgentModelChoice/);
	assert.match(settingsSource, /addDropdown\(\(dropdown\) =>/);
});
