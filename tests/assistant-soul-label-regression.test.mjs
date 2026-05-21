/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const aiServicePath = path.join(projectRoot, "src/services/AIService.ts");
const dailyBoardPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const rendererPath = path.join(projectRoot, "src/views/agentTrajectoryRenderer.ts");
const stylesPath = path.join(projectRoot, "styles.css");

function read(filePath) {
	assert.ok(fs.existsSync(filePath), `${path.basename(filePath)} should exist`);
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("assistant message UI meta stores the active Soul label snapshot", () => {
	const source = read(aiServicePath);

	for (const expected of [
		"soulStyleCode?: string;",
		"soulStyleLabel?: string;",
		"soulStyleFullLabel?: string;",
	]) {
		assert.ok(source.includes(expected), `Expected ChatMessageUiMeta field: ${expected}`);
	}
});

test("assistant messages persist Soul labels from the turn, not the currently active Soul", () => {
	const source = read(dailyBoardPath);

	for (const expected of [
		"resolveAssistantSoulStyleSnapshot",
		"resolveMessageSoulStyleSnapshot",
		"buildAssistantMessageUiMeta(runtimeResult, runtimeTask, turnTarget.sessionId, activeSoulDefinition)",
		"soulStyleCode",
		"soulStyleLabel",
		"soulStyleFullLabel",
	]) {
		assert.ok(source.includes(expected), `Expected DailyBoardView Soul snapshot handling: ${expected}`);
	}
	assert.match(source, /message\.uiMeta\?\.soulStyleCode/);
	assert.match(source, /message\.uiMeta\?\.soulStyleFullLabel/);
});

test("assistant trajectory renderer can display FRIDAY dot Soul code", () => {
	const source = read(rendererPath);
	const styles = read(stylesPath);

	for (const expected of [
		"assistantSoulStyleCode?: string;",
		"assistantSoulStyleFullLabel?: string;",
		"assistant-soul-label-v1",
		"assistant-meta-separator-v1",
	]) {
		assert.ok(source.includes(expected) || styles.includes(expected), `Expected renderer Soul label support: ${expected}`);
	}
	assert.match(source, /text:\s*"FRIDAY"/);
	assert.match(source, /text:\s*"·"/);
	assert.match(source, /title:\s*assistantSoulStyleFullLabel/);
	assert.ok(styles.includes(".assistant-soul-label-v1"), "Soul label should have a compact style");
	assert.match(styles, /\.assistant-soul-label-v1\s*\{[^}]*display:\s*inline-flex/);
	assert.match(styles, /\.assistant-soul-label-v1\s*\{[^}]*font-size:\s*0\.76rem/);
	assert.match(styles, /\.assistant-soul-label-v1\s*\{[^}]*border:\s*1px solid/);
	assert.doesNotMatch(styles, /\.assistant-soul-label-v1\s*\{[^}]*font-size:\s*0\.78em/);
});
