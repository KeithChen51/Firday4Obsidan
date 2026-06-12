/* eslint-env node */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const conversationStorePath = path.join(projectRoot, "src/desktop/state/ConversationStore.ts");
const turnStorePath = path.join(projectRoot, "src/desktop/state/TurnStore.ts");
const referenceStorePath = path.join(projectRoot, "src/desktop/state/ReferenceStore.ts");
const answerReferenceBuilderPath = path.join(projectRoot, "src/desktop/state/AnswerReferenceBuilder.ts");
const runtimeStateStorePath = path.join(projectRoot, "src/desktop/state/DesktopRuntimeStateStore.ts");

async function loadModules() {
	return {
		conversation: await jiti.import(conversationStorePath),
		turn: await jiti.import(turnStorePath),
		reference: await jiti.import(referenceStorePath),
		answerReference: await jiti.import(answerReferenceBuilderPath),
		runtimeState: await jiti.import(runtimeStateStorePath),
	};
}

async function withTempProject(prefix, callback) {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	try {
		return await callback(tempRoot);
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
}

function createContext(projectRootPath, overrides = {}) {
	return {
		projectId: "desktop-project",
		conversationId: "conversation-1",
		turnId: "turn-1",
		permissionMode: "standard",
		projectRoot: projectRootPath,
		...overrides,
	};
}

function createComposerSnapshot() {
	return {
		text: "请阅读资料并生成提纲",
		tokens: [
			{
				id: "mention-brief",
				type: "note",
				path: "docs/brief.md",
			},
		],
		doc: {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "请阅读资料" },
					],
				},
			],
		},
		selectionAnchor: 1,
		selectionHead: 6,
	};
}

test("conversation store creates, reads, lists, and archives conversation directories", async () => {
	const { conversation } = await loadModules();

	await withTempProject("friday-desktop-conversation-store-", async (projectRootPath) => {
		const store = new conversation.ConversationStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:00.000Z"),
		});
		const record = await store.createConversation({
			id: "conversation-alpha",
			projectId: "desktop-project",
			title: "Alpha conversation",
		});

		assert.equal(record.id, "conversation-alpha");
		assert.equal(record.projectId, "desktop-project");
		assert.equal(record.title, "Alpha conversation");
		assert.equal(record.createdAt, "2026-06-12T00:00:00.000Z");
		assert.equal(record.updatedAt, "2026-06-12T00:00:00.000Z");

		const conversationPath = path.join(projectRootPath, "FRIDAY", "conversations", "conversation-alpha", "conversation.json");
		assert.deepEqual(JSON.parse(await fs.readFile(conversationPath, "utf8")), record);
		assert.deepEqual(await store.readConversation("conversation-alpha"), record);
		assert.deepEqual((await store.listConversations()).map((item) => item.id), ["conversation-alpha"]);

		const importRoot = path.join(projectRootPath, "FRIDAY", "imports", "conversation-alpha", "import-1");
		await fs.mkdir(importRoot, { recursive: true });
		await fs.writeFile(path.join(importRoot, "source.md"), "# Imported\n", "utf8");
		await fs.mkdir(path.join(projectRootPath, "FRIDAY", "conversations", "conversation-alpha", "turns"), { recursive: true });
		await fs.writeFile(
			path.join(projectRootPath, "FRIDAY", "conversations", "conversation-alpha", "turns", "turn-1.json"),
			"{\"id\":\"turn-1\"}\n",
			"utf8",
		);

		const archived = await store.archiveConversation("conversation-alpha");
		const archiveRoot = path.join(projectRootPath, "FRIDAY", "archive", "conversations", "conversation-alpha");

		assert.equal(archived.archivePath, archiveRoot);
		await assert.rejects(() => fs.stat(path.join(projectRootPath, "FRIDAY", "conversations", "conversation-alpha")), /ENOENT/);
		await assert.rejects(() => fs.stat(path.join(projectRootPath, "FRIDAY", "imports", "conversation-alpha")), /ENOENT/);
		assert.equal(JSON.parse(await fs.readFile(path.join(archiveRoot, "conversation.json"), "utf8")).title, "Alpha conversation");
		assert.equal(
			await fs.readFile(path.join(archiveRoot, "turns", "turn-1.json"), "utf8"),
			"{\"id\":\"turn-1\"}\n",
		);
		assert.equal(
			await fs.readFile(path.join(archiveRoot, "imports", "import-1", "source.md"), "utf8"),
			"# Imported\n",
		);
		assert.deepEqual(await store.listConversations(), []);
	});
});

test("turn store writes one JSON file per turn and freezes submitted composer snapshots", async () => {
	const { turn } = await loadModules();

	await withTempProject("friday-desktop-turn-store-", async (projectRootPath) => {
		const store = new turn.TurnStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:01.000Z"),
		});
		const context = createContext(projectRootPath, {
			conversationId: "conversation-turns",
			turnId: "turn-user-1",
		});
		const submittedSnapshot = createComposerSnapshot();

		await store.saveTurn(context, {
			id: "turn-user-1",
			conversationId: "conversation-turns",
			role: "user",
			content: "请阅读资料并生成提纲",
			createdAt: "2026-06-12T00:00:01.000Z",
			composerSnapshot: submittedSnapshot,
		});

		submittedSnapshot.text = "mutated after submit";
		submittedSnapshot.tokens[0].path = "docs/mutated.md";
		submittedSnapshot.doc.content[0].content[0].text = "mutated doc";

		const persistedPath = path.join(projectRootPath, "FRIDAY", "conversations", "conversation-turns", "turns", "turn-user-1.json");
		const restored = JSON.parse(await fs.readFile(persistedPath, "utf8"));
		assert.equal(restored.id, "turn-user-1");
		assert.equal(restored.role, "user");
		assert.equal(restored.composerSnapshot.text, "请阅读资料并生成提纲");
		assert.equal(restored.composerSnapshot.tokens[0].path, "docs/brief.md");
		assert.equal(restored.composerSnapshot.doc.content[0].content[0].text, "请阅读资料");
		assert.deepEqual(await store.readTurn("conversation-turns", "turn-user-1"), restored);
		assert.deepEqual((await store.listTurns("conversation-turns")).map((item) => item.id), ["turn-user-1"]);

		const nextSnapshot = turn.createEmptyNextComposerSnapshot();
		assert.equal(turn.isComposerSnapshotEmpty(nextSnapshot), true);
		assert.equal(turn.isComposerSnapshotEmpty(restored.composerSnapshot), false);
	});
});

test("desktop runtime state store remains jsonl-compatible while writing per-turn JSON files", async () => {
	const { runtimeState } = await loadModules();

	await withTempProject("friday-desktop-runtime-turn-store-", async (projectRootPath) => {
		const store = new runtimeState.DesktopRuntimeStateStore(projectRootPath);
		const context = createContext(projectRootPath, {
			conversationId: "conversation-runtime-turns",
			turnId: "turn-runtime-1",
		});

		await store.saveTurn(context, {
			id: "turn-runtime-1",
			conversationId: "conversation-runtime-turns",
			role: "assistant",
			content: "Runtime compatibility turn",
			createdAt: "2026-06-12T00:00:02.000Z",
		});

		const jsonRecord = JSON.parse(
			await fs.readFile(path.join(projectRootPath, "FRIDAY", "conversations", "conversation-runtime-turns", "turns", "turn-runtime-1.json"), "utf8"),
		);
		const jsonlRecord = JSON.parse(
			(await fs.readFile(path.join(projectRootPath, "FRIDAY", "conversations", "conversation-runtime-turns", "turns.jsonl"), "utf8")).trim(),
		);

		assert.equal(jsonRecord.id, "turn-runtime-1");
		assert.deepEqual(jsonlRecord, {
			id: "turn-runtime-1",
			conversationId: "conversation-runtime-turns",
			role: "assistant",
			content: "Runtime compatibility turn",
			createdAt: "2026-06-12T00:00:02.000Z",
		});
	});
});

test("reference store persists explicit, resolved, trace, and answer references separately", async () => {
	const { reference } = await loadModules();

	await withTempProject("friday-desktop-reference-store-", async (projectRootPath) => {
		const store = new reference.ReferenceStore(projectRootPath, {
			clock: () => new Date("2026-06-12T00:00:03.000Z"),
		});
		const context = createContext(projectRootPath, {
			conversationId: "conversation-references",
			turnId: "turn-reference-1",
		});

		await store.saveTurnReferences(context, {
			explicitReferences: [
				{
					id: "explicit-1",
					tokenId: "mention-brief",
					tokenType: "note",
					target: {
						targetType: "project_file",
						targetUri: "project://docs/brief.md",
						fileName: "brief.md",
						fileType: "Markdown",
					},
				},
			],
			resolvedReferences: [
				{
					id: "resolved-1",
					explicitReferenceId: "explicit-1",
					resolver: "MentionResolver",
					target: {
						targetType: "project_file",
						targetUri: "project://docs/brief.md",
						fileName: "brief.md",
						fileType: "Markdown",
					},
					summary: "Brief loaded from project file.",
				},
			],
			traceSources: [
				{
					id: "trace-source-1",
					traceEventId: "trace-read-1",
					operation: "read_project_file",
					target: {
						targetType: "project_file",
						targetUri: "project://docs/research.md",
						fileName: "research.md",
						fileType: "Markdown",
					},
				},
			],
			answerReferences: [
				{
					targetType: "project_file",
					targetUri: "project://docs/brief.md",
					display: {
						fileType: "Markdown",
						fileName: "brief.md",
						sourceType: "@引用",
					},
					metadata: {
						fullPath: path.join(projectRootPath, "docs", "brief.md"),
					},
				},
			],
		});

		const persisted = JSON.parse(
			await fs.readFile(path.join(projectRootPath, "FRIDAY", "conversations", "conversation-references", "references", "turn-reference-1.json"), "utf8"),
		);
		assert.deepEqual(Object.keys(persisted).sort(), [
			"answerReferences",
			"conversationId",
			"createdAt",
			"explicitReferences",
			"resolvedReferences",
			"schemaVersion",
			"traceSources",
			"turnId",
			"updatedAt",
		]);
		assert.equal(persisted.explicitReferences[0].tokenId, "mention-brief");
		assert.equal(persisted.resolvedReferences[0].resolver, "MentionResolver");
		assert.equal(persisted.traceSources[0].traceEventId, "trace-read-1");
		assert.equal(persisted.answerReferences[0].display.sourceType, "@引用");
		assert.equal("source" in persisted.explicitReferences[0], false);
		assert.equal("source" in persisted.resolvedReferences[0], false);
		assert.equal("source" in persisted.traceSources[0], false);
		assert.deepEqual(await store.readTurnReferences("conversation-references", "turn-reference-1"), persisted);
	});
});

test("answer reference builder filters candidates, dedupes targets, and hides paths from display fields", async () => {
	const { answerReference } = await loadModules();
	const candidates = [
		{
			targetType: "project_file",
			targetUri: "project://docs/brief.md",
			sourceType: "@引用",
			fileName: "brief.md",
			fileType: "Markdown",
			metadata: {
				fullPath: "C:/secret/project/docs/brief.md",
			},
		},
		{
			targetType: "project_file",
			targetUri: "project://docs/brief.md",
			sourceType: "FRIDAY 读取",
			fileName: "brief.md",
			fileType: "Markdown",
			metadata: {
				fullPath: "C:/secret/project/docs/brief.md",
			},
		},
		{
			targetType: "artifact",
			targetUri: "artifact://artifact-1/index.html",
			sourceType: "当前产物",
			fileName: "index.html",
			fileType: "HTML",
		},
		{
			targetType: "selection",
			targetUri: "selection://turn-1/selection-1",
			sourceType: "选区",
			fileName: "selected-text.md",
			fileType: "Markdown",
		},
		{
			targetType: "web",
			targetUri: "https://example.com",
			sourceType: "网页",
			fileName: "example.com",
			fileType: "Web",
		},
	];

	const references = answerReference.buildAnswerReferences(candidates);

	assert.equal(references.length, 3);
	assert.deepEqual(references.map((item) => item.display.sourceType), ["@引用", "当前产物", "选区"]);
	assert.deepEqual(references.map((item) => `${item.targetType}:${item.targetUri}`), [
		"project_file:project://docs/brief.md",
		"artifact:artifact://artifact-1/index.html",
		"selection:selection://turn-1/selection-1",
	]);
	for (const referenceItem of references) {
		assert.deepEqual(Object.keys(referenceItem.display).sort(), ["fileName", "fileType", "sourceType"]);
		assert.doesNotMatch(JSON.stringify(referenceItem.display), /C:\/secret|docs\/brief\.md|artifact-1/u);
	}
	assert.equal(references[0].metadata.fullPath, "C:/secret/project/docs/brief.md");
});

test("answer references are frozen with the assistant turn and later candidate changes do not rewrite history", async () => {
	const { answerReference, reference, turn } = await loadModules();

	await withTempProject("friday-desktop-answer-reference-freeze-", async (projectRootPath) => {
		const context = createContext(projectRootPath, {
			conversationId: "conversation-answer-freeze",
			turnId: "turn-assistant-1",
		});
		const candidates = [
			{
				targetType: "project_file",
				targetUri: "project://docs/brief.md",
				sourceType: "FRIDAY 读取",
				fileName: "brief.md",
				fileType: "Markdown",
				metadata: {
					fullPath: "C:/secret/project/docs/brief.md",
				},
			},
		];
		const answerReferences = answerReference.buildAnswerReferences(candidates);
		const referenceStore = new reference.ReferenceStore(projectRootPath);
		const turnStore = new turn.TurnStore(projectRootPath);

		await referenceStore.saveTurnReferences(context, {
			answerReferences,
		});
		await turnStore.saveTurn(context, {
			id: "turn-assistant-1",
			conversationId: "conversation-answer-freeze",
			role: "assistant",
			content: "这里是回答。",
			createdAt: "2026-06-12T00:00:04.000Z",
			answerReferences,
		});

		candidates[0].fileName = "mutated.md";
		answerReferences[0].display.fileName = "mutated.md";
		answerReferences[0].metadata.fullPath = "C:/mutated/path.md";

		const restoredReferences = await referenceStore.readTurnReferences("conversation-answer-freeze", "turn-assistant-1");
		const restoredTurn = await turnStore.readTurn("conversation-answer-freeze", "turn-assistant-1");

		assert.equal(restoredReferences.answerReferences[0].display.fileName, "brief.md");
		assert.equal(restoredReferences.answerReferences[0].metadata.fullPath, "C:/secret/project/docs/brief.md");
		assert.equal(restoredTurn.answerReferences[0].display.fileName, "brief.md");
		assert.equal(restoredTurn.answerReferences[0].metadata.fullPath, "C:/secret/project/docs/brief.md");
	});
});

test("state stores do not let sanitized ids collide across conversations, turns, or references", async () => {
	const { conversation, reference, turn } = await loadModules();

	await withTempProject("friday-desktop-state-id-collision-", async (projectRootPath) => {
		const conversationStore = new conversation.ConversationStore(projectRootPath);
		const turnStore = new turn.TurnStore(projectRootPath);
		const referenceStore = new reference.ReferenceStore(projectRootPath);
		const slashContext = createContext(projectRootPath, {
			conversationId: "a/b",
			turnId: "t/1",
		});
		const underscoreContext = createContext(projectRootPath, {
			conversationId: "a_b",
			turnId: "t_1",
		});

		await conversationStore.createConversation({
			id: "a/b",
			projectId: "desktop-project",
			title: "Slash conversation",
		});
		await conversationStore.createConversation({
			id: "a_b",
			projectId: "desktop-project",
			title: "Underscore conversation",
		});
		await turnStore.saveTurn(slashContext, {
			id: "t/1",
			conversationId: "a/b",
			role: "user",
			content: "slash turn",
			createdAt: "2026-06-12T00:00:05.000Z",
		});
		await turnStore.saveTurn(underscoreContext, {
			id: "t_1",
			conversationId: "a_b",
			role: "user",
			content: "underscore turn",
			createdAt: "2026-06-12T00:00:06.000Z",
		});
		await referenceStore.saveTurnReferences(slashContext, {
			traceSources: [
				{
					id: "trace-slash",
					target: {
						targetType: "project_file",
						targetUri: "project://slash.md",
					},
				},
			],
		});
		await referenceStore.saveTurnReferences(underscoreContext, {
			traceSources: [
				{
					id: "trace-underscore",
					target: {
						targetType: "project_file",
						targetUri: "project://underscore.md",
					},
				},
			],
		});

		assert.deepEqual((await conversationStore.listConversations()).map((item) => item.id).sort(), ["a/b", "a_b"]);
		assert.equal((await conversationStore.readConversation("a/b")).title, "Slash conversation");
		assert.equal((await conversationStore.readConversation("a_b")).title, "Underscore conversation");
		assert.equal((await turnStore.readTurn("a/b", "t/1")).content, "slash turn");
		assert.equal((await turnStore.readTurn("a_b", "t_1")).content, "underscore turn");
		assert.equal((await referenceStore.readTurnReferences("a/b", "t/1")).traceSources[0].id, "trace-slash");
		assert.equal((await referenceStore.readTurnReferences("a_b", "t_1")).traceSources[0].id, "trace-underscore");

		const conversationDirectories = await fs.readdir(path.join(projectRootPath, "FRIDAY", "conversations"));
		assert.equal(new Set(conversationDirectories).size, 2);
	});
});

test("archiveConversation rolls back the conversation directory when import archiving fails", async () => {
	const { conversation } = await loadModules();

	await withTempProject("friday-desktop-archive-rollback-", async (projectRootPath) => {
		const store = new conversation.ConversationStore(projectRootPath);
		await store.createConversation({
			id: "conversation-rollback",
			projectId: "desktop-project",
			title: "Rollback conversation",
		});

		const activeConversationRoot = path.join(projectRootPath, "FRIDAY", "conversations", "conversation-rollback");
		const activeImportsRoot = path.join(projectRootPath, "FRIDAY", "imports", "conversation-rollback", "import-1");
		const archiveImportsBlocker = path.join(activeConversationRoot, "imports");
		await fs.mkdir(activeImportsRoot, { recursive: true });
		await fs.writeFile(path.join(activeImportsRoot, "source.md"), "# Import\n", "utf8");
		await fs.mkdir(archiveImportsBlocker, { recursive: true });
		await fs.writeFile(path.join(archiveImportsBlocker, "blocker.md"), "block import archive target\n", "utf8");

		await assert.rejects(() => store.archiveConversation("conversation-rollback"), /EEXIST|ENOTDIR|EPERM|not a directory|file already exists/i);

		assert.equal(JSON.parse(await fs.readFile(path.join(activeConversationRoot, "conversation.json"), "utf8")).title, "Rollback conversation");
		assert.equal(await fs.readFile(path.join(activeImportsRoot, "source.md"), "utf8"), "# Import\n");
		await assert.rejects(
			() => fs.stat(path.join(projectRootPath, "FRIDAY", "archive", "conversations", "conversation-rollback")),
			/ENOENT/,
		);
	});
});

test("list methods skip corrupt JSON records while preserving valid records", async () => {
	const { conversation, reference, turn } = await loadModules();

	await withTempProject("friday-desktop-corrupt-json-skip-", async (projectRootPath) => {
		const conversationStore = new conversation.ConversationStore(projectRootPath);
		const turnStore = new turn.TurnStore(projectRootPath);
		const referenceStore = new reference.ReferenceStore(projectRootPath);
		const context = createContext(projectRootPath, {
			conversationId: "conversation-corrupt",
			turnId: "turn-valid",
		});

		await conversationStore.createConversation({
			id: "conversation-corrupt",
			projectId: "desktop-project",
			title: "Valid conversation",
		});
		await fs.mkdir(path.join(projectRootPath, "FRIDAY", "conversations", "bad-record"), { recursive: true });
		await fs.writeFile(
			path.join(projectRootPath, "FRIDAY", "conversations", "bad-record", "conversation.json"),
			"{not valid json",
			"utf8",
		);

		await turnStore.saveTurn(context, {
			id: "turn-valid",
			conversationId: "conversation-corrupt",
			role: "user",
			content: "valid turn",
			createdAt: "2026-06-12T00:00:07.000Z",
		});
		await fs.writeFile(
			path.join(projectRootPath, "FRIDAY", "conversations", "conversation-corrupt", "turns", "bad-turn.json"),
			"{not valid json",
			"utf8",
		);

		await referenceStore.saveTurnReferences(context, {
			traceSources: [
				{
					id: "valid-trace-source",
					target: {
						targetType: "project_file",
						targetUri: "project://valid.md",
					},
				},
			],
		});
		await fs.writeFile(
			path.join(projectRootPath, "FRIDAY", "conversations", "conversation-corrupt", "references", "bad-reference.json"),
			"{not valid json",
			"utf8",
		);

		assert.deepEqual((await conversationStore.listConversations()).map((item) => item.id), ["conversation-corrupt"]);
		assert.deepEqual((await turnStore.listTurns("conversation-corrupt")).map((item) => item.id), ["turn-valid"]);
		assert.deepEqual((await referenceStore.listTurnReferences("conversation-corrupt")).map((item) => item.turnId), ["turn-valid"]);
	});
});
