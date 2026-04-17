/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const mainPath = path.join(projectRoot, "src/main.ts");
const viewPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const runtimeStorePath = path.join(projectRoot, "src/features/sync/SyncRuntimeStore.ts");
const statusBarPath = path.join(projectRoot, "src/features/sync/SyncStatusBar.ts");
const orchestratorPath = path.join(projectRoot, "src/features/sync/SyncOrchestrator.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("main wires sync event bus, runtime store, and status bar together", async () => {
	const source = read(mainPath);
	assert.match(source, /new SyncEventBus\(/);
	assert.match(source, /new SyncRuntimeStore\(/);
	assert.match(source, /new SyncStatusBar\(/);
});

test("main broadcasts project state change events after project registration and active-project changes", async () => {
	const source = read(mainPath);
	assert.match(source, /window\.dispatchEvent\(new CustomEvent\(PROJECT_STATE_CHANGED_EVENT\)\)/);
	assert.match(source, /async upsertProject\(project: ProjectEntry\): Promise<void> \{[\s\S]*dispatchEvent/);
	assert.match(source, /async setActiveProject\(projectId: string\): Promise<void> \{[\s\S]*dispatchEvent/);
});

test("sync orchestrator emits runtime stage and completion events", async () => {
	const source = read(orchestratorPath);
	assert.match(source, /sync_stage_changed/);
	assert.match(source, /sync_pull_completed/);
	assert.match(source, /sync_completed/);
	assert.match(source, /sync_conflict_detected/);
	assert.match(source, /sync_recovery_failed/);
});

test("sync runtime store classifies failures and tracks per-project stage", async () => {
	const source = read(runtimeStorePath);
	assert.match(source, /classifyGitError/);
	assert.match(source, /getProjectState/);
	assert.match(source, /setProjectState/);
	assert.match(source, /offline|blocked|failed/);
	assert.match(source, /sync_conflict_resolved_written_back/);
	assert.match(source, /sync_recovery_failed/);
});

test("daily board view reads sync runtime store for the active project", async () => {
	const source = read(viewPath);
	assert.match(source, /syncRuntimeStore\.getProjectState/);
	assert.match(source, /projects\.sync\.runtime/);
	assert.match(source, /projects\.sync\.offline/);
	assert.match(source, /projects\.sync\.blocked/);
});

test("sync status bar subscribes to sync runtime store updates", async () => {
	const source = read(statusBarPath);
	assert.match(source, /subscribe/);
	assert.match(source, /setText/);
	assert.match(source, /getProjectState/);
});

test("sync status bar exposes stage-aware summary text and click-through affordance", async () => {
	const source = read(statusBarPath);
	assert.match(source, /getStageLabel/);
	assert.match(source, /data-sync-stage/);
	assert.match(source, /onclick/);
});
