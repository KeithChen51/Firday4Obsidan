/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

function readRepoFile(relativePath) {
	return fs.readFileSync(path.join(projectRoot, relativePath), "utf8").replace(/\r\n?/g, "\n");
}

test("DailyBoardView keeps mention classification and chat segment construction delegated", () => {
	const source = readRepoFile("src/views/DailyBoardView.ts");

	assert.match(source, /from "\.\/mentionSuggestions"/);
	assert.match(source, /from "\.\/chatMessageSegments"/);
	assert.doesNotMatch(source, /CODE_MENTION_FILE_EXTENSIONS\s*=/);
	assert.doesNotMatch(source, /NOTE_MENTION_FILE_EXTENSIONS\s*=/);
	assert.doesNotMatch(source, /normalizeUserMessageSegments\s*\(/);
});

test("DailyBoardView does not rebuild process UI from RuntimeProgressEvent phase", () => {
	const source = readRepoFile("src/views/DailyBoardView.ts");
	const handlerStart = source.indexOf("private handleRuntimeProgress(event: RuntimeProgressEvent): void {");
	const handlerEnd = source.indexOf("\n\tprivate updateLocalIntakePreviewForRuntimeProgress", handlerStart);

	assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "runtime progress handler should exist");
	const handlerBlock = source.slice(handlerStart, handlerEnd);
	assert.match(handlerBlock, /aiRuntimeTrajectoryStore\.appendProgress\(event\)/);
	assert.match(handlerBlock, /buildAgentProcessPanelViewModel\(nextSnapshot\)/);
	assert.doesNotMatch(handlerBlock, /switch\s*\(\s*event\.phase\s*\)/);
	assert.doesNotMatch(handlerBlock, /createEl\(/);
	assert.doesNotMatch(handlerBlock, /setText\(/);
});

test("FridaySettingTab delegates extracted settings sections to section renderers", () => {
	const source = readRepoFile("src/settings/FridaySettingTab.ts");

	assert.match(source, /from "\.\/sections\/LlmSettingsSection"/);
	assert.match(source, /from "\.\/sections\/SoulSettingsSection"/);
	assert.match(source, /from "\.\/sections\/ProjectSettingsSection"/);
	assert.match(source, /renderLlmSettingsSection\(this, containerEl\)/);
	assert.match(source, /renderSoulSettingsSection\(this, containerEl\)/);
	assert.match(source, /renderProjectSettingsSection\(this, containerEl\)/);
});

test("source-shape regression tests point to extracted module owners", () => {
	const dailyBoardRegression = readRepoFile("tests/daily-board-ui-regression.test.mjs");
	const chatComposerQueueRegression = readRepoFile("tests/chat-composer-queue-regression.test.mjs");
	const settingsProjectRegression = readRepoFile("tests/settings-project-ui-regression.test.mjs");
	const settingsNativeRegression = readRepoFile("tests/settings-native-groups-regression.test.mjs");
	const agentModelRegression = readRepoFile("tests/agent-model-mode-regression.test.mjs");
	const mentionSuggestionsTest = readRepoFile("tests/mention-suggestions.test.mjs");
	const chatMessageSegmentsTest = readRepoFile("tests/chat-message-segments.test.mjs");

	assert.match(dailyBoardRegression, /chatMessageSegmentsPath/);
	assert.match(chatComposerQueueRegression, /chatMessageSegmentsPath/);
	assert.match(settingsProjectRegression, /projectSettingsSectionPath/);
	assert.match(settingsNativeRegression, /llmSettingsSectionPath/);
	assert.match(settingsNativeRegression, /soulSettingsSectionPath/);
	assert.match(agentModelRegression, /soulSettingsSectionPath/);
	assert.match(mentionSuggestionsTest, /src\/views\/mentionSuggestions\.ts/);
	assert.match(chatMessageSegmentsTest, /src\/views\/chatMessageSegments\.ts/);
});
