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
const orchestratorModulePath = path.join(projectRoot, "src/features/sync/SyncOrchestrator.ts");
const queueModulePath = path.join(projectRoot, "src/platform/git/PromiseQueue.ts");
const eventBusModulePath = path.join(projectRoot, "src/features/sync/SyncEventBus.ts");

async function loadModules() {
	const [orchestratorModule, queueModule, eventBusModule] = await Promise.all([
		jiti.import(orchestratorModulePath),
		jiti.import(queueModulePath),
		jiti.import(eventBusModulePath),
	]);
	return { orchestratorModule, queueModule, eventBusModule };
}

function createProject() {
	return {
		projectId: "alpha",
		projectName: "Alpha",
		boundaryPath: "Projects/alpha",
		gitState: "git_remote_bound",
		slug: "alpha",
		groupId: "default-group",
		projectRootPath: "Projects/alpha",
		localPath: "",
		gitRemote: "https://example.com/demo.git",
		autoSync: true,
		lastSyncAt: "",
	};
}

function readSyncServiceSource() {
	return fs.readFileSync(path.join(projectRoot, "src/services/SyncService.ts"), "utf8");
}

test("sync orchestrator runs commit, pull, conflict detection, then push in order", async () => {
	const { orchestratorModule, queueModule } = await loadModules();
	const calls = [];
	const operator = {
		async prepareRepository() {
			calls.push("prepare");
		},
		async commitWorkingTree() {
			calls.push("commit");
			return ["a.md"];
		},
		async pull() {
			calls.push("pull");
			return { success: true, pulledFiles: ["b.md"] };
		},
		async detectConflicts() {
			calls.push("detect");
			return { conflicts: [], conflictSnapshots: {} };
		},
		async push() {
			calls.push("push");
			return { success: true, pushedFiles: ["a.md"] };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue());

	const result = await orchestrator.sync(createProject());

	assert.deepEqual(calls, ["prepare", "commit", "pull", "detect", "push"]);
	assert.equal(result.success, true);
	assert.deepEqual(result.pulledFiles, ["b.md"]);
	assert.deepEqual(result.pushedFiles, ["a.md"]);
	assert.deepEqual(result.conflicts, []);
});

test("sync orchestrator stops before push when conflicts are detected", async () => {
	const { orchestratorModule, queueModule } = await loadModules();
	const calls = [];
	const operator = {
		async prepareRepository() {
			calls.push("prepare");
		},
		async commitWorkingTree() {
			calls.push("commit");
			return [];
		},
		async pull() {
			calls.push("pull");
			return { success: true, pulledFiles: ["remote.md"] };
		},
		async detectConflicts() {
			calls.push("detect");
			return { conflicts: ["conflict.md"], conflictSnapshots: { "conflict.md": "snapshot.md" } };
		},
		async push() {
			calls.push("push");
			return { success: true, pushedFiles: [] };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue());

	const result = await orchestrator.sync(createProject());

	assert.deepEqual(calls, ["prepare", "commit", "pull", "detect"]);
	assert.equal(result.success, false);
	assert.deepEqual(result.conflicts, ["conflict.md"]);
	assert.equal(result.conflictSnapshots["conflict.md"], "snapshot.md");
});

test("sync orchestrator syncAll includes manual-only projects instead of filtering by autoSync", async () => {
	const { orchestratorModule, queueModule } = await loadModules();
	const calls = [];
	const operator = {
		async prepareRepository() {},
		async commitWorkingTree() {
			return [];
		},
		async pull() {
			return { success: true, pulledFiles: [] };
		},
		async detectConflicts() {
			return { conflicts: [], conflictSnapshots: {} };
		},
		async push() {
			return { success: true, pushedFiles: [] };
		},
		makeErrorResult(projectSlug, error) {
			return { success: false, projectSlug, pulledFiles: [], pushedFiles: [], conflicts: [], error: String(error) };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue());
	const alpha = createProject();
	const beta = { ...createProject(), projectId: "beta", slug: "beta", autoSync: false };
	const originalSync = orchestrator.sync.bind(orchestrator);
	orchestrator.sync = async (project) => {
		calls.push(project.projectId);
		return originalSync(project);
	};

	const results = await orchestrator.syncAll([alpha, beta]);

	assert.deepEqual(calls, ["alpha", "beta"]);
	assert.equal(results.has("alpha"), true);
	assert.equal(results.has("beta"), true);
});

test("sync service syncAll source no longer filters projects by autoSync", async () => {
	const source = readSyncServiceSource();
	assert.doesNotMatch(source, /projects\.filter\(\(item\) => item\.autoSync\)/);
	assert.match(source, /for \(const project of projects\)/);
});

test("sync service queues conflict resolution actions instead of bypassing the global sync queue", async () => {
	const source = readSyncServiceSource();
	assert.match(
		source,
		/async resolveConflict\(project: ProjectEntry, filePath: string, strategy: "ours" \| "theirs"\): Promise<void> \{[\s\S]*?this\.queue\.enqueue\(async \(\) => \{/,
	);
});

test("sync orchestrator emits recovery-failed event when stash pop restoration fails", async () => {
	const { orchestratorModule, queueModule, eventBusModule } = await loadModules();
	const bus = new eventBusModule.SyncEventBus();
	const events = [];
	bus.subscribe((event) => events.push(event.type));
	const operator = {
		async prepareRepository() {},
		async commitWorkingTree() {
			return [];
		},
		async pull() {
			return { success: false, pulledFiles: [], error: "Stash pop recovery failed: conflict after restore." };
		},
		async detectConflicts() {
			return { conflicts: [], conflictSnapshots: {} };
		},
		async push() {
			return { success: true, pushedFiles: [] };
		},
		makeErrorResult(projectSlug, error) {
			return { success: false, projectSlug, pulledFiles: [], pushedFiles: [], conflicts: [], error: String(error) };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue(), bus);

	const result = await orchestrator.sync(createProject());

	assert.equal(result.success, false);
	assert.ok(events.includes("sync_recovery_failed"));
});
