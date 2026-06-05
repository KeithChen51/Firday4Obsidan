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
const syncCommandsPath = path.join(projectRoot, "src/commands/syncCommands.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

test("main wires sync event bus, runtime store, and status bar together", async () => {
	const source = read(mainPath);
	assert.match(source, /new SyncEventBus\(/);
	assert.match(source, /new SyncRuntimeStore\(/);
	assert.match(source, /new SyncStatusBar\(/);
});

test("main stores safe sync completion messages in workbench snapshots", async () => {
	const source = read(mainPath);
	assert.match(source, /classifyGitError/);
	assert.match(source, /getSafeSyncEventMessage/);
	assert.doesNotMatch(source, /message: event\.type === "sync_completed" \? event\.error/);
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
	assert.match(source, /lastActiveStage/);
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

test("daily board view presents safe sync errors instead of raw git output", async () => {
	const source = read(viewPath);
	assert.match(source, /classifyGitError/);
	assert.match(source, /getSafeSyncErrorMessage/);
	assert.doesNotMatch(source, /text: item\.result\.error/);
	assert.doesNotMatch(source, /notice\.syncFailed", \{ error: result\.error/);
});

test("daily board status failure copy does not interpolate raw caught errors", async () => {
	const source = read(viewPath);
	assert.match(source, /const safeStatusError = this\.getSafeSyncErrorMessage\(error\)/);
	assert.doesNotMatch(source, /projects\.sync\.statusFailed[\s\S]{0,160}error: String\(error\)/);
});

test("sync command notices present safe sync errors instead of raw git output", async () => {
	const source = read(syncCommandsPath);
	assert.match(source, /classifyGitError/);
	assert.match(source, /getSafeSyncErrorMessage/);
	assert.doesNotMatch(source, /notice\.syncFailed", \{ error: result\.error/);
});

test("daily board view refreshes the visible sync progress from runtime events", async () => {
	const source = read(viewPath);
	assert.match(source, /syncEventBus\.subscribe\(this\.handleSyncRuntimeEvent\)/);
	assert.match(source, /event\.type === "sync_status_observed"/);
	assert.match(source, /this\.scheduleRefresh\(\)/);
	assert.match(source, /renderSyncProgressPanel/);
	assert.match(source, /project-sync-progress-v2/);
	assert.match(source, /isSyncRuntimeInFlight/);
	assert.match(source, /getSyncProgressErrorStage/);
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
