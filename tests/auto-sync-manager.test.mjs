/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/features/sync/AutoSyncManager.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

function createProject(overrides = {}) {
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
		...overrides,
	};
}

test("auto sync manager runs idle mode only for eligible auto-sync projects", async () => {
	const mod = await loadModule();
	const calls = [];
	const project = createProject();
	const blocked = createProject({ projectId: "beta", slug: "beta", autoSync: false });
	const manager = new mod.AutoSyncManager({
		getSettings: () => ({
			sync: {
				mode: "idle_auto",
				idleMinutes: 5,
				syncOnStartup: true,
			},
			projects: [project, blocked],
		}),
		syncService: {
			async sync(target) {
				calls.push(target.projectId);
				return { success: true };
			},
			async getStatus() {
				return {
					branch: "main",
					connected: true,
					conflicts: 0,
				};
			},
		},
		hasBlockingConflicts: () => false,
		persistLastSyncAt: async () => {},
		debounceMs: 1,
		setTimeoutFn: (handler) => {
			handler();
			return 1;
		},
		clearTimeoutFn: () => {},
	});

	await manager.runIdleCycle();

	assert.deepEqual(calls, ["alpha"]);
});

test("auto sync manager debounces continuous mode per project and skips blocked states silently", async () => {
	const mod = await loadModule();
	const scheduled = [];
	const clears = [];
	const synced = [];
	const project = createProject();
	const manager = new mod.AutoSyncManager({
		getSettings: () => ({
			sync: {
				mode: "continuous_auto",
				idleMinutes: 5,
				syncOnStartup: true,
			},
			projects: [project],
		}),
		syncService: {
			async sync(target) {
				synced.push(target.projectId);
				return { success: true };
			},
			async getStatus() {
				return {
					branch: "main",
					connected: false,
					conflicts: 1,
				};
			},
		},
		hasBlockingConflicts: () => true,
		persistLastSyncAt: async () => {},
		debounceMs: 25,
		setTimeoutFn: (handler, delay) => {
			scheduled.push(delay);
			handler();
			return 7;
		},
		clearTimeoutFn: (value) => {
			clears.push(value);
		},
	});

	manager.notifyProjectMutation(project);
	manager.notifyProjectMutation(project);

	assert.deepEqual(scheduled, [25, 25]);
	assert.deepEqual(clears, [7]);
	assert.deepEqual(synced, []);
});
