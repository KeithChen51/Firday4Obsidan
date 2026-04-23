/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const servicePath = path.join(projectRoot, "src", "services", "OfficialContentService.ts");

async function loadModule() {
	return jiti.import(servicePath);
}

function createService(initialChannels = {}) {
	const settings = {
		officialContent: {
			checkOnStartup: true,
			startupDelayMs: 5000,
			lastCheckedAt: "",
			lastCatalogVersion: "",
			catalog: [],
			channels: { ...initialChannels },
		},
	};
	const latestFeed = {
		schemaVersion: 1,
		generatedAt: "2026-04-23T18:00:00.000Z",
		providers: [
			{
				id: "official",
				title: "Official channel",
				rootPath: "F.R.I.D.A.Y",
				manifestPath: "official/channels/official.json",
				columns: [
					{
						id: "study-with-friday",
						title: "Study with F.R.I.D.A.Y",
						kind: "directory",
						path: "Study with F.R.I.D.A.Y",
						version: "2026.04.23",
						manifestPath: "official/channels/official.json",
					},
				],
			},
		],
	};
	const serviceDeps = {
		adapter: {
			exists: async () => false,
			mkdir: async () => {},
			read: async () => "",
			write: async () => {},
			remove: async () => {},
			rmdir: async () => {},
			list: async () => ({ files: [], folders: [] }),
		},
		getSettings: () => settings,
		saveSettings: async () => {},
		getGitRuntimeStatus: async () => ({ available: true, version: "2.0.0", error: "" }),
		getUserCredential: async () => ({ username: "demo", token: "secret" }),
		getUserGitEmail: () => "demo@example.com",
		gitClientFactory: async () => ({
			ensureWorkspace: async () => {},
			lsRemote: async () => "",
			fetch: async () => {},
			readText: async (_ref, targetPath) => {
				if (targetPath === "official/latest.json") {
					return JSON.stringify(latestFeed);
				}
				throw new Error(`Unexpected read target: ${targetPath}`);
			},
			cleanup: async () => {},
		}),
	};
	return { settings, serviceDeps };
}

test("refreshCatalog does not require git email for read-only official-content fetches", async () => {
	const mod = await loadModule();
	const { settings, serviceDeps } = createService();
	serviceDeps.getUserGitEmail = () => "";
	const service = new mod.OfficialContentService(serviceDeps);

	await service.refreshCatalog();

	assert.equal(settings.officialContent.catalog.length, 1);
});

test("refreshCatalog subscribes newly discovered official columns by default", async () => {
	const mod = await loadModule();
	const { settings, serviceDeps } = createService();
	const service = new mod.OfficialContentService(serviceDeps);

	await service.refreshCatalog();

	assert.equal(settings.officialContent.channels["study-with-friday"]?.subscribed, true);
});

test("refreshCatalog preserves an explicit unsubscribe choice for official columns", async () => {
	const mod = await loadModule();
	const { settings, serviceDeps } = createService({
		"study-with-friday": {
			subscribed: false,
			lastAppliedVersion: "2026.04.22",
		},
	});
	const service = new mod.OfficialContentService(serviceDeps);

	await service.refreshCatalog();

	assert.equal(settings.officialContent.channels["study-with-friday"]?.subscribed, false);
});

test("removed official columns are still cleaned instead of being mistaken for legacy blockers", async () => {
	const mod = await loadModule();
	const removed = [];
	const settings = {
		officialContent: {
			checkOnStartup: true,
			startupDelayMs: 5000,
			lastCheckedAt: "",
			lastCatalogVersion: "",
			catalog: [
				{
					id: "old-column",
					title: "Old Column",
					kind: "directory",
					path: "旧栏目",
					version: "2026.04.22",
					manifestPath: "official/channels/official.json",
				},
			],
			channels: {
				"old-column": {
					subscribed: true,
					lastAppliedVersion: "2026.04.22",
					path: "旧栏目",
				},
			},
		},
	};
	const latestFeed = {
		schemaVersion: 1,
		generatedAt: "2026-04-23T18:00:00.000Z",
		providers: [
			{
				id: "official",
				title: "Official channel",
				rootPath: "F.R.I.D.A.Y",
				manifestPath: "official/channels/official.json",
				columns: [],
			},
		],
	};
	const service = new mod.OfficialContentService({
		adapter: {
			exists: async (targetPath) => targetPath === "F.R.I.D.A.Y/旧栏目",
			mkdir: async () => {},
			read: async () => "",
			write: async () => {},
			remove: async (targetPath) => {
				removed.push(targetPath);
			},
			rmdir: async (targetPath) => {
				removed.push(`${targetPath}/`);
			},
			list: async (targetPath) => {
				if (targetPath === "F.R.I.D.A.Y/旧栏目") {
					return { files: ["F.R.I.D.A.Y/旧栏目/Guide.md"], folders: [] };
				}
				return { files: [], folders: [] };
			},
		},
		getSettings: () => settings,
		saveSettings: async () => {},
		getGitRuntimeStatus: async () => ({ available: true, version: "2.0.0", error: "" }),
		getUserCredential: async () => ({ username: "demo", token: "secret" }),
		getUserGitEmail: () => "",
		gitClientFactory: async () => ({
			ensureWorkspace: async () => {},
			lsRemote: async () => "",
			fetch: async () => {},
			readText: async (_ref, targetPath) => {
				if (targetPath === "official/latest.json") {
					return JSON.stringify(latestFeed);
				}
				if (targetPath === "official/channels/official.json") {
					return JSON.stringify({
						schemaVersion: 1,
						generatedAt: "2026-04-23T18:00:00.000Z",
						id: "official",
						title: "Official channel",
						rootPath: "F.R.I.D.A.Y",
						columns: [],
					});
				}
				throw new Error(`Unexpected read target: ${targetPath}`);
			},
			cleanup: async () => {},
		}),
		inspectDestructiveApplySafety: async ({ ownedTopLevelPaths }) => ({
			blocked: !ownedTopLevelPaths.includes("旧栏目"),
			blockingPaths: !ownedTopLevelPaths.includes("旧栏目") ? ["旧栏目"] : [],
			canRefreshCatalog: true,
			takeoverConfirmed: false,
		}),
	});

	await service.refreshCatalog();
	const result = await service.applySubscriptions();

	assert.equal(result.blocked, false);
	assert.deepEqual(removed, ["F.R.I.D.A.Y/旧栏目/Guide.md", "F.R.I.D.A.Y/旧栏目/"]);
	assert.equal(settings.officialContent.channels["old-column"], undefined);
});
