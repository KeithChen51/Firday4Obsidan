/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const runtimeStateStorePath = path.join(projectRoot, "src/services/RuntimeStateStore.ts");
const piStateStorePath = path.join(projectRoot, "src/services/FridayPiRuntimeStateStore.ts");

function createLocalStateRootService(root) {
	return {
		async ensureBaseLayout() {
			await fs.mkdir(root, { recursive: true });
		},
		resolveVault(...segments) {
			return path.join(root, ...segments);
		},
	};
}

async function createStore() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-pi-runtime-state-"));
	const { RuntimeStateStore } = await jiti.import(runtimeStateStorePath);
	const { FridayPiRuntimeStateStore } = await jiti.import(piStateStorePath);
	const runtimeStateStore = new RuntimeStateStore(createLocalStateRootService(root));
	return {
		root,
		runtimeStateStore,
		store: new FridayPiRuntimeStateStore(runtimeStateStore),
	};
}

async function readJsonl(filePath) {
	const raw = await fs.readFile(filePath, "utf8");
	return raw.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test("FridayPiRuntimeStateStore appends PI session records and reads them back", async () => {
	const { store, runtimeStateStore } = await createStore();
	const sessionId = "conversation/with:special\\chars";
	const baseRecord = {
		sessionId,
		conversationId: sessionId,
		turnId: "turn-1",
		taskId: "task-1",
		traceId: "trace-1",
		status: "completed",
		startedAt: "2026-06-05T00:00:00.000Z",
		endedAt: "2026-06-05T00:00:01.000Z",
		assistantSummary: "Delegated answer.",
		assistantTextLength: 17,
		rawFinalReplyLength: 21,
		packageRef: { packageId: "friday-pi-local-bridge", manifestPath: "runtime/pi/packages/friday-pi-local-bridge/manifest.json" },
		workspacePolicy: {
			trustBoundary: "vault",
			vault: { root: "/" },
			externalAccess: "explicit",
			externalWrite: false,
		},
	};

	await store.appendSessionTurnRecord(baseRecord);
	await store.appendSessionTurnRecord({ ...baseRecord, turnId: "turn-2", traceId: "trace-2" });

	const sessionPath = runtimeStateStore.getPiSessionStatePath(sessionId);
	assert.equal(path.dirname(sessionPath), runtimeStateStore.getPiSessionsRoot());
	assert.equal(path.basename(sessionPath), "conversation_with_special_chars.jsonl");
	assert.deepEqual((await store.readSessionTurnRecords(sessionId)).map((record) => record.turnId), ["turn-1", "turn-2"]);
});

test("FridayPiRuntimeStateStore appends PI wrapper tool trace records", async () => {
	const { store, runtimeStateStore } = await createStore();

	await store.appendToolTraceRecords([
		{
			sessionId: "conversation-1",
			conversationId: "conversation-1",
			turnId: "turn-1",
			taskId: "task-1",
			traceId: "trace-1",
			runId: "run-1",
			step: 1,
			tool: "read",
			scope: "vault",
			targetPath: "Daily.md",
			status: "ok",
			ok: true,
			approved: true,
			summary: "Read Daily.md",
			workspacePolicy: {
				trustBoundary: "vault",
				vault: { root: "/" },
				externalAccess: "explicit",
				externalWrite: false,
			},
		},
	]);

	const records = await readJsonl(runtimeStateStore.getPiToolTracesPath());
	assert.equal(records.length, 1);
	assert.equal(records[0].kind, "pi_tool_trace");
	assert.equal(records[0].turnId, "turn-1");
	assert.equal(records[0].tool, "read");
	assert.equal(records[0].targetPath, "Daily.md");
	assert.equal(records[0].workspacePolicy.externalWrite, false);
});

test("FridayPiRuntimeStateStore writes v1 local bridge package metadata under PI packages", async () => {
	const { store, runtimeStateStore } = await createStore();

	const ref = await store.writePackageMetadata({
		packageId: "friday-pi-local-bridge",
		name: "FRIDAY PI local bridge",
		version: "0.1.0",
		kind: "local_bridge",
		marketplace: false,
	});

	assert.equal(ref.packageId, "friday-pi-local-bridge");
	assert.equal(ref.manifestPath, runtimeStateStore.getPiPackageManifestPath("friday-pi-local-bridge"));

	const manifest = JSON.parse(await fs.readFile(ref.manifestPath, "utf8"));
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.packageId, "friday-pi-local-bridge");
	assert.equal(manifest.kind, "local_bridge");
	assert.equal(manifest.marketplace, false);
	assert.equal(manifest.runtime, "friday-pi");
});
