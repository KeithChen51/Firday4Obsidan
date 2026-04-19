/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

function read(relativePath) {
	return fs.readFileSync(path.join(projectRoot, relativePath), "utf8").replace(/\r\n?/g, "\n");
}

test("runtime sync state uses projectId instead of projectSlug", async () => {
	const eventBus = read("src/features/sync/SyncEventBus.ts");
	const runtimeStore = read("src/features/sync/SyncRuntimeStore.ts");
	const statusBar = read("src/features/sync/SyncStatusBar.ts");
	const workbenchStore = read("src/features/workbench/WorkbenchStateStore.ts");

	assert.doesNotMatch(eventBus, /projectSlug:/);
	assert.doesNotMatch(runtimeStore, /projectSlug:/);
	assert.match(statusBar, /state\.projectId/);
	assert.doesNotMatch(statusBar, /state\.projectSlug/);
	assert.doesNotMatch(workbenchStore, /projectSlug:/);
	assert.doesNotMatch(workbenchStore, /item\.projectSlug === record\.projectSlug/);
});

test("runtime invocation payloads no longer carry projectSlug", async () => {
	const invocationRequest = read("src/core/execution/InvocationRequest.ts");
	const runtimeEvent = read("src/core/execution/RuntimeEvent.ts");
	const eventRouter = read("src/core/execution/EventRouter.ts");
	const dailyBoard = read("src/views/DailyBoardView.ts");

	assert.doesNotMatch(invocationRequest, /projectSlug\?:/);
	assert.doesNotMatch(runtimeEvent, /projectSlug\?:/);
	assert.doesNotMatch(eventRouter, /projectSlug:/);
	assert.doesNotMatch(dailyBoard, /projectSlug:/);
});

test("main runtime project selection no longer falls back to slug", async () => {
	const main = read("src/main.ts");
	assert.doesNotMatch(main, /item\.projectId === projectId \|\| item\.slug === projectId/);
	assert.doesNotMatch(main, /item\.projectId === requestedId \|\| item\.slug === requestedId/);
	assert.doesNotMatch(main, /\(item\.projectId \|\| item\.slug\) === projectSlug/);
});
