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
const gitOperatorModulePath = path.join(projectRoot, "src/platform/git/SimpleGitOperator.ts");
const gitErrorModulePath = path.join(projectRoot, "src/platform/git/classifyGitError.ts");

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

function readGitOperatorSource() {
	return fs.readFileSync(gitOperatorModulePath, "utf8");
}

test("sync orchestrator runs pull, conflict detection, commit, then push in order", async () => {
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

	assert.deepEqual(calls, ["prepare", "pull", "detect", "commit", "push"]);
	assert.equal(result.success, true);
	assert.deepEqual(result.pulledFiles, ["b.md"]);
	assert.deepEqual(result.pushedFiles, ["a.md"]);
	assert.deepEqual(result.conflicts, []);
});

test("sync orchestrator pulls and retries once when push is rejected because remote changed", async () => {
	const { orchestratorModule, queueModule, eventBusModule } = await loadModules();
	const calls = [];
	const stageEvents = [];
	const bus = new eventBusModule.SyncEventBus();
	bus.subscribe((event) => {
		if (event.type === "sync_stage_changed") {
			stageEvents.push(event.stage);
		}
	});
	let pullCount = 0;
	let pushCount = 0;
	const operator = {
		async prepareRepository() {
			calls.push("prepare");
		},
		async commitWorkingTree() {
			calls.push("commit");
			return ["local.md"];
		},
		async pull() {
			calls.push("pull");
			pullCount += 1;
			return { success: true, pulledFiles: pullCount === 2 ? ["remote.md"] : [] };
		},
		async detectConflicts() {
			calls.push("detect");
			return { conflicts: [], conflictSnapshots: {} };
		},
		async push() {
			calls.push("push");
			pushCount += 1;
			return pushCount === 1
				? {
					success: false,
					pushedFiles: [],
					error: "! [rejected] master -> master (fetch first)\nUpdates were rejected because the remote contains work that you do not have locally.",
				}
				: { success: true, pushedFiles: ["local.md"] };
		},
		makeErrorResult(projectSlug, error) {
			return { success: false, projectSlug, pulledFiles: [], pushedFiles: [], conflicts: [], error: String(error) };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue(), bus);

	const result = await orchestrator.sync(createProject());

	assert.deepEqual(calls, ["prepare", "pull", "detect", "commit", "push", "pull", "detect", "push"]);
	assert.deepEqual(stageEvents, ["checking", "pulling", "committing", "pushing", "pulling", "pushing"]);
	assert.equal(result.success, true);
	assert.deepEqual(result.pulledFiles, ["remote.md"]);
	assert.deepEqual(result.pushedFiles, ["local.md"]);
});

test("sync orchestrator preserves both versions and continues when retry pull finds conflicts after push rejection", async () => {
	const { orchestratorModule, queueModule } = await loadModules();
	const calls = [];
	let detectCount = 0;
	let pushCount = 0;
	const operator = {
		async prepareRepository() {
			calls.push("prepare");
		},
		async commitWorkingTree() {
			calls.push("commit");
			return ["local.md"];
		},
		async pull() {
			calls.push("pull");
			return { success: true, pulledFiles: [] };
		},
		async detectConflicts() {
			calls.push("detect");
			detectCount += 1;
			return detectCount === 1 || detectCount === 3
				? { conflicts: [], conflictSnapshots: {} }
				: { conflicts: ["conflict.md"], conflictSnapshots: { "conflict.md": "snapshot.md" } };
		},
		async preserveConflicts() {
			calls.push("preserve");
			return ["conflict.friday-ours.md", "conflict.friday-theirs.md"];
		},
		async finalizeConflictResolution() {
			calls.push("finalize");
		},
		async push() {
			calls.push("push");
			pushCount += 1;
			return pushCount === 1
				? {
					success: false,
					pushedFiles: [],
					error: "error: failed to push some refs\nhint: Updates were rejected because the remote contains work that you do not have locally.",
				}
				: { success: true, pushedFiles: ["local.md"] };
		},
		makeErrorResult(projectSlug, error) {
			return { success: false, projectSlug, pulledFiles: [], pushedFiles: [], conflicts: [], error: String(error) };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue());

	const result = await orchestrator.sync(createProject());

	assert.deepEqual(calls, ["prepare", "pull", "detect", "commit", "push", "pull", "detect", "preserve", "finalize", "detect", "commit", "push"]);
	assert.equal(result.success, true);
	assert.deepEqual(result.conflicts, []);
	assert.deepEqual(result.pushedFiles, ["local.md"]);
});

test("sync orchestrator preserves retry pull conflicts when pull itself fails after push rejection", async () => {
	const { orchestratorModule, queueModule } = await loadModules();
	const calls = [];
	let pullCount = 0;
	let detectCount = 0;
	let pushCount = 0;
	const operator = {
		async prepareRepository() {
			calls.push("prepare");
		},
		async commitWorkingTree() {
			calls.push("commit");
			return ["local.md"];
		},
		async pull() {
			calls.push("pull");
			pullCount += 1;
			return pullCount === 1
				? { success: true, pulledFiles: [] }
				: { success: false, pulledFiles: [], error: "CONFLICT (content): Merge conflict in conflict.md" };
		},
		async detectConflicts() {
			calls.push("detect");
			detectCount += 1;
			return detectCount === 2
				? { conflicts: ["conflict.md"], conflictSnapshots: { "conflict.md": "snapshot.md" } }
				: { conflicts: [], conflictSnapshots: {} };
		},
		async preserveConflicts() {
			calls.push("preserve");
			return ["conflict.friday-ours.md", "conflict.friday-theirs.md"];
		},
		async finalizeConflictResolution() {
			calls.push("finalize");
		},
		async push() {
			calls.push("push");
			pushCount += 1;
			return pushCount === 1
				? {
					success: false,
					pushedFiles: [],
					error: "error: failed to push some refs\nhint: Updates were rejected because the remote contains work that you do not have locally.",
				}
				: { success: true, pushedFiles: ["local.md"] };
		},
		makeErrorResult(projectSlug, error) {
			return { success: false, projectSlug, pulledFiles: [], pushedFiles: [], conflicts: [], error: String(error) };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue());

	const result = await orchestrator.sync(createProject());

	assert.deepEqual(calls, ["prepare", "pull", "detect", "commit", "push", "pull", "detect", "preserve", "finalize", "detect", "commit", "push"]);
	assert.equal(result.success, true);
	assert.deepEqual(result.conflicts, []);
	assert.deepEqual(result.pushedFiles, ["local.md"]);
});

test("sync orchestrator preserves both versions and continues when conflicts are detected after pull", async () => {
	const { orchestratorModule, queueModule } = await loadModules();
	const calls = [];
	let detectCount = 0;
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
			detectCount += 1;
			return detectCount === 1
				? { conflicts: ["conflict.md"], conflictSnapshots: { "conflict.md": "snapshot.md" } }
				: { conflicts: [], conflictSnapshots: {} };
		},
		async preserveConflicts() {
			calls.push("preserve");
			return ["conflict.friday-ours.md", "conflict.friday-theirs.md"];
		},
		async finalizeConflictResolution() {
			calls.push("finalize");
		},
		async push() {
			calls.push("push");
			return { success: true, pushedFiles: ["conflict.friday-theirs.md"] };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue());

	const result = await orchestrator.sync(createProject());

	assert.deepEqual(calls, ["prepare", "pull", "detect", "preserve", "finalize", "detect", "commit", "push"]);
	assert.equal(result.success, true);
	assert.deepEqual(result.conflicts, []);
	assert.deepEqual(result.pushedFiles, ["conflict.friday-theirs.md"]);
});

test("sync orchestrator preserves conflicts discovered after pull failure before surfacing an error", async () => {
	const { orchestratorModule, queueModule } = await loadModules();
	const calls = [];
	let detectCount = 0;
	const operator = {
		async prepareRepository() {
			calls.push("prepare");
		},
		async commitWorkingTree() {
			calls.push("commit");
			return ["local.md"];
		},
		async pull() {
			calls.push("pull");
			return {
				success: false,
				pulledFiles: [],
				error: "CONFLICT (content): Merge conflict in workspace/a.md\nAutomatic merge failed; fix conflicts and then commit the result.",
			};
		},
		async detectConflicts() {
			calls.push("detect");
			detectCount += 1;
			return detectCount === 1
				? { conflicts: ["workspace/a.md"], conflictSnapshots: { "workspace/a.md": "snapshot.md" } }
				: { conflicts: [], conflictSnapshots: {} };
		},
		async preserveConflicts() {
			calls.push("preserve");
			return ["workspace/a.friday-ours.md", "workspace/a.friday-theirs.md"];
		},
		async finalizeConflictResolution() {
			calls.push("finalize");
		},
		async push() {
			calls.push("push");
			return { success: true, pushedFiles: ["local.md"] };
		},
		makeErrorResult(projectSlug, error) {
			return { success: false, projectSlug, pulledFiles: [], pushedFiles: [], conflicts: [], error: String(error) };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue());

	const result = await orchestrator.sync(createProject());

	assert.deepEqual(calls, ["prepare", "pull", "detect", "preserve", "finalize", "detect", "commit", "push"]);
	assert.equal(result.success, true);
	assert.deepEqual(result.conflicts, []);
});

test("git error classifier marks fetch-first push rejection as blocked", async () => {
	const gitErrorModule = await jiti.import(gitErrorModulePath);
	const error =
		"! [rejected] master -> master (fetch first)\nUpdates were rejected because the remote contains work that you do not have locally.";

	assert.equal(gitErrorModule.isNonFastForwardGitError(error), true);
	const classified = gitErrorModule.classifyGitError(error);
	assert.equal(classified.kind, "blocked");
	assert.equal(classified.condition, "remote_updated");
	assert.equal(classified.messageKey, gitErrorModule.REMOTE_UPDATED_BEFORE_PUSH_MESSAGE_KEY);
	assert.equal(classified.shouldAutoRetry, true);
});

test("sync orchestrator stops before commit and push when pull fails", async () => {
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
			return { success: false, pulledFiles: [], error: "pull failed" };
		},
		async detectConflicts() {
			calls.push("detect");
			return { conflicts: [], conflictSnapshots: {} };
		},
		async push() {
			calls.push("push");
			return { success: true, pushedFiles: [] };
		},
		makeErrorResult(projectSlug, error) {
			return { success: false, projectSlug, pulledFiles: [], pushedFiles: [], conflicts: [], error: String(error) };
		},
	};
	const orchestrator = new orchestratorModule.SyncOrchestrator(operator, new queueModule.PromiseQueue());

	const result = await orchestrator.sync(createProject());

	assert.deepEqual(calls, ["prepare", "pull", "detect"]);
	assert.equal(result.success, false);
	assert.match(result.error ?? "", /pull failed/i);
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

test("simple git operator attempts to attach upstream tracking before skipping pull", async () => {
	const source = readGitOperatorSource();
	assert.match(source, /const hasTracking = await this\.ensureTrackingBranchForPull\(project, git\);/);
	assert.match(source, /"ls-remote", "--heads", "origin", branchName/);
	assert.match(
		source,
		/await this\.fetchRemoteTrackingBranch\(project, git, branchName\);[\s\S]*?await git\.raw\(\["branch", "--set-upstream-to", `origin\/\$\{branchName\}`, branchName\]\);/,
	);
	assert.match(source, /`\$\{branchName\}:refs\/remotes\/origin\/\$\{branchName\}`/);
});

test("simple git operator preserves both sides of content conflicts before resolving", async () => {
	const source = readGitOperatorSource();
	assert.match(source, /async preserveConflicts\(project: ProjectEntry, conflicts: string\[\]\): Promise<string\[]>/);
	assert.match(source, /`:2:\$\{normalizedPath\}`/);
	assert.match(source, /`:3:\$\{normalizedPath\}`/);
	assert.match(source, /friday-\$\{side\}-\$\{timestamp\}/);
	assert.match(source, /"version-a"/);
	assert.match(source, /"version-b"/);
	assert.match(source, /await git\.add\(\[normalizedPath, versionACopy, versionBCopy\]\)/);
	assert.match(source, /continueInProgressOperation\(project, git\)/);
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
