/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const viewPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const composerDocumentPath = path.join(projectRoot, "src/core/editor/mention/MentionComposerDocument.ts");
const mentionComposerPath = path.join(projectRoot, "src/views/components/MentionComposer.ts");

function readSource(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("chat toolbar persists model and permission choices instead of session follow overrides", async () => {
	const source = readSource(viewPath);
	assert.doesNotMatch(source, /aiSessionModelOverride/);
	assert.doesNotMatch(source, /aiSessionPermissionOverride/);
	assert.doesNotMatch(source, /ai\.model\.follow/);
	assert.doesNotMatch(source, /ai\.permission\.follow/);
	assert.match(source, /await this\.plugin\.soulStore\.updateSoul\(/);
	assert.doesNotMatch(source, /await this\.plugin\.agentService\.writeAgentProfile\(activeAgent\)/);
	assert.match(source, /this\.plugin\.settings\.agentRuntime\.toolPermissionMode = value as ToolPermissionMode/);
});

test("chat composer stays editable during work and queues the next prompt", async () => {
	const source = readSource(viewPath);
	assert.match(source, /private aiQueuedPrompts: MentionComposerSnapshot\[\] = \[\];/);
	assert.match(source, /disabled:\s*false/);
	assert.match(source, /enqueueAiPrompt\(/);
	assert.match(source, /flushQueuedAiPrompt\(/);
	assert.match(source, /ai\.queue\./);
	assert.doesNotMatch(source, /sendButton\.disabled = this\.aiBusy/);
});

test("streaming and runtime progress update the live chat shell without rebuilding the composer", async () => {
	const source = readSource(viewPath);
	assert.match(source, /private syncAiLiveChatShell\(\): void/);
	assert.match(source, /onDelta:\s*\(delta\)\s*=>\s*\{[\s\S]*this\.syncAiLiveChatShell\(\);/);
	assert.match(source, /private handleRuntimeProgress[\s\S]*this\.syncAiLiveChatShell\(\);/);
	assert.match(source, /private async streamAssistantText[\s\S]*this\.syncAiLiveChatShell\(\);/);
});

test("busy send affordance can either queue or interrupt the current turn", async () => {
	const source = readSource(viewPath);
	assert.match(source, /new Menu\(\)/);
	assert.match(source, /private interruptAndSubmitAiPrompt\(/);
	assert.match(source, /this\.interruptAndSubmitAiPrompt\(\)/);
});

test("chat messages render skill and context badges from persisted ui metadata", async () => {
	const source = readSource(viewPath);
	const metaBlock = source.match(/private buildUserMessageUiMeta\([\s\S]*?\n\t}\n\n\tprivate /)?.[0] ?? "";
	assert.match(source, /message\.uiMeta/);
	assert.match(source, /renderStructuredUserMessageBody/);
	assert.match(source, /friday-ai-inline-body/);
	assert.match(source, /friday-ai-inline-token/);
	assert.match(source, /private formatMentionBadgeLabel\(/);
	assert.match(metaBlock, /const segments = this\.buildUserMessageSegments/);
	assert.match(metaBlock, /return \{\s*segments,/);
	assert.match(source, /type:\s*"token"/);
	assert.match(source, /kind:\s*"context"/);
	assert.match(source, /kind:\s*"skill"/);
	assert.doesNotMatch(source, /friday-ai-message-badges/);
});

test("mention composer snapshots preserve cursor selection across busy rerenders", async () => {
	const documentSource = readSource(composerDocumentPath);
	const composerSource = readSource(mentionComposerPath);
	assert.match(documentSource, /selectionAnchor\?: number;/);
	assert.match(documentSource, /selectionHead\?: number;/);
	assert.match(composerSource, /hasFocus\(\): boolean/);
	assert.match(composerSource, /selection:/);
	assert.match(composerSource, /replaceSnapshot\(/);
});
