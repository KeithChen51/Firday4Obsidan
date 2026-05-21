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
const modulePath = path.join(projectRoot, "src/core/chat/ConversationIngressService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function createMentionResolution(entries = []) {
	return {
		text: "Summarize this",
		entries,
		errors: [],
		summary: {
			resolvedCount: entries.length,
			errorCount: 0,
			tokenTypes: entries.map((entry) => entry.tokenType),
			sourceMap: entries.map((entry) => ({
				tokenId: entry.tokenId,
				tokenType: entry.tokenType,
				channel: entry.channel,
				target: entry.target,
				zone: entry.zone,
				dynamic: entry.dynamic,
			})),
		},
		channels: {
			mentioned_notes: entries.filter((entry) => entry.channel === "mentioned_notes"),
			folder_structures: entries.filter((entry) => entry.channel === "folder_structures"),
		},
	};
}

function createProject(overrides = {}) {
	return {
		projectId: "project-1",
		projectName: "Project",
		boundaryPath: "Project",
		gitState: "none",
		slug: "project",
		groupId: "",
		gitRemote: "",
		autoSync: false,
		lastSyncAt: "",
		...overrides,
	};
}

test("rejects an empty prompt before runtime payload construction", async () => {
	const mod = await loadModule();
	const result = mod.createConversationIngressPayload({
		sessionId: "session-1",
		history: [],
		snapshot: { text: "   ", tokens: [], doc: null },
		activeProject: createProject(),
		currentFilePath: "Project/current.md",
		mentionResolution: createMentionResolution(),
		selectedModel: "gpt-test",
		selectedPermissionMode: "standard",
	});

	assert.equal(result.ok, false);
	assert.equal(result.reason, "empty_prompt");
});

test("builds structured mention context for the runtime payload", async () => {
	const mod = await loadModule();
	const entry = {
		tokenId: "note-1",
		tokenType: "note",
		channel: "mentioned_notes",
		target: "Project/spec.md",
		title: "Spec",
		body: "# Spec",
		summary: "Spec summary",
		zone: "workspace_draft",
	};

	const result = mod.createConversationIngressPayload({
		sessionId: "session-1",
		history: [],
		snapshot: {
			text: "Summarize this",
			tokens: [{ id: "note-1", type: "note", path: "Project/spec.md" }],
			doc: null,
		},
		activeProject: createProject(),
		currentFilePath: "Project/current.md",
		mentionResolution: createMentionResolution([entry]),
		selectedModel: " gpt-test ",
		selectedPermissionMode: "strict",
	});

	assert.equal(result.ok, true);
	assert.equal(result.runtimePayload.modelOverride, "gpt-test");
	assert.deepEqual(result.runtimePayload.mentionContext.entries, [entry]);
	assert.equal(result.runtimePayload.mentionContext.resolvedCount, 1);
	assert.deepEqual(result.runtimePayload.mentionContext.tokenTypes, ["note"]);
	assert.deepEqual(result.runtimePayload.mentionContext.sourceMap.map((item) => item.target), ["Project/spec.md"]);
	assert.equal(result.metadata.selectedPermissionMode, "strict");
});

test("preserves session and active project identity while building the turn target", async () => {
	const mod = await loadModule();
	const history = [{ role: "assistant", content: "Earlier answer." }];

	const result = mod.createConversationIngressPayload({
		sessionId: "session-1",
		history,
		snapshot: { text: "Continue", tokens: [], doc: null },
		activeProject: createProject({ projectId: "project-2", boundaryPath: "Project/root" }),
		currentFilePath: "Project/root/current.md",
		mentionResolution: createMentionResolution(),
		selectedModel: "",
		selectedPermissionMode: "auto",
	});

	assert.equal(result.ok, true);
	assert.equal(result.turnTarget.sessionId, "session-1");
	assert.equal(result.turnTarget.projectId, "project-2");
	assert.deepEqual(result.turnTarget.conversation, history);
	assert.notEqual(result.turnTarget.conversation, history, "history should be copied before UI appends messages");
	assert.equal(result.activeProjectBoundaryPath, "Project/root");
});

test("uses explicit active note mentions to authorize current file context", async () => {
	const mod = await loadModule();

	const result = mod.createConversationIngressPayload({
		sessionId: "session-1",
		history: [],
		snapshot: {
			text: "Use this note",
			tokens: [{ id: "active-1", type: "active_note" }],
			doc: null,
		},
		activeProject: createProject(),
		currentFilePath: "Project/current.md",
		mentionResolution: createMentionResolution(),
		selectedModel: "",
		selectedPermissionMode: "standard",
	});

	assert.equal(result.ok, true);
	assert.equal(result.activeFileContext.mode, "explicit_mention");
	assert.equal(result.mentionResolutionCurrentFilePath, "Project/current.md");
	assert.equal(result.runtimePayload.activeFileContext.path, "Project/current.md");
});

test("conversation ingress service stays independent from DOM and Obsidian ItemView", async () => {
	const source = fs.readFileSync(modulePath, "utf8");

	assert.doesNotMatch(source, /from ["']obsidian["']/);
	assert.doesNotMatch(source, /\bItemView\b|\bHTMLElement\b|\bwindow\b/);
});
