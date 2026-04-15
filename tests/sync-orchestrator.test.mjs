/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const orchestratorModulePath = path.join(projectRoot, "src/features/sync/SyncOrchestrator.ts");
const queueModulePath = path.join(projectRoot, "src/platform/git/PromiseQueue.ts");

async function loadModules() {
	const [orchestratorModule, queueModule] = await Promise.all([
		jiti.import(orchestratorModulePath),
		jiti.import(queueModulePath),
	]);
	return { orchestratorModule, queueModule };
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
