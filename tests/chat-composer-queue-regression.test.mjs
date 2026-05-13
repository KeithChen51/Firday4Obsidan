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

test("chat toolbar execution mode derives file mutation behavior from the visible mode", async () => {
	const source = readSource(viewPath);
	const permissionChangeBlock = source.match(/permissionSelect\.onchange = async \(\) => \{[\s\S]*?\n\t\t\};/)?.[0] ?? "";

	assert.match(permissionChangeBlock, /deriveFileMutationModeFromToolPermissionMode\(value as ToolPermissionMode\)/);
	assert.match(permissionChangeBlock, /fileMutationMode = /);
	assert.doesNotMatch(permissionChangeBlock, /toolPermissionMode = value as ToolPermissionMode;\s*await this\.plugin\.saveSettings\(\);/);
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
	assert.match(source, /private handleRuntimeProgress[\s\S]*this\.syncAiLiveChatShell\(\);/);
	assert.match(source, /private async streamAssistantText[\s\S]*this\.syncAiLiveChatShell\(\);/);
	assert.doesNotMatch(source, /plugin\.aiService\.chatStream\(modelMessages/);
});

test("send affordance uses paper-plane and square states while preserving queue submit", async () => {
	const source = readSource(viewPath);
	assert.match(source, /private resolveSendButtonIcon\(\): string/);
	assert.match(source, /return this\.aiBusy && this\.isComposerDraftEmpty\(\)\s*\?\s*"square"\s*:\s*"send"/);
	assert.match(source, /setIcon\(this\.aiSendButtonEl,\s*this\.resolveSendButtonIcon\(\)\)/);
	assert.match(source, /this\.aiSendButtonEl\.setAttribute\("aria-label",\s*this\.getSendButtonLabel\(\)\)/);
	assert.match(source, /this\.aiSendButtonEl\.disabled = this\.hasPendingComposerDecision\(\) \|\| \(!this\.aiBusy && this\.isComposerDraftEmpty\(\)\)/);
	assert.match(source, /if \(this\.aiBusy && this\.isComposerDraftEmpty\(\)\) \{[\s\S]*?this\.stopCurrentAiRun\(\);[\s\S]*?return;/);
	assert.match(source, /void this\.submitAiPrompt\(\);/);
});

test("send affordance resyncs immediately after a submitted prompt enters the running state", async () => {
	const source = readSource(viewPath);
	const submitBlock = source.match(/private async submitAiPrompt\([^)]*\): Promise<void> \{[\s\S]*?\n\t\}\n\n\tprivate async compileWikiByButton/)?.[0] ?? "";
	assert.ok(submitBlock, "submitAiPrompt block should exist");

	const clearComposerIndex = submitBlock.indexOf("this.aiComposerSnapshot = createEmptyMentionComposerSnapshot();");
	const busyIndex = submitBlock.indexOf("this.aiBusy = true;", clearComposerIndex);
	const syncIndex = submitBlock.indexOf("this.syncAiSendButtonState();", busyIndex);
	const shellIndex = submitBlock.indexOf("this.syncAiLiveChatShell();", busyIndex);

	assert.ok(clearComposerIndex >= 0, "submit should clear the composer snapshot");
	assert.ok(busyIndex > clearComposerIndex, "submit should enter busy state after clearing the composer");
	assert.ok(syncIndex > busyIndex, "submit should resync the send/stop affordance immediately after entering busy state");
	assert.ok(shellIndex === -1 || syncIndex < shellIndex, "send button state should update before the broader chat shell refresh");
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
