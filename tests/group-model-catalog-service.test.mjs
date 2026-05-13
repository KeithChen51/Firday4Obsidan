/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/services/GroupModelCatalogService.ts");

async function loadService() {
	return jiti.import(modulePath);
}

function createSettings() {
	return {
		groupModelCatalog: {
			enabled: true,
			checkOnStartup: true,
			startupDelayMs: 7000,
			repoUrl: "https://gitee.example.com/friday/model-catalog.git",
			branch: "friday-model-catalog",
			filePath: "model-catalog.json",
			lastCheckedAt: "",
			lastCatalogVersion: "",
			lastResult: "idle",
			lastError: "",
			providerId: "",
			providerName: "",
			models: [],
			defaults: {},
		},
	};
}

test("group model catalog service reads the configured branch file and caches public model metadata", async () => {
	const mod = await loadService();
	const settings = createSettings();
	const gitCalls = [];
	const catalog = {
		schemaVersion: 1,
		catalogVersion: "2026-05-13.1",
		updatedAt: "2026-05-13T00:00:00+08:00",
		providerId: "aliyun",
		providerName: "汽车售后服务事业部",
		models: [
			{
				id: " qwen3.6-plus ",
				label: "Qwen3.6 Plus",
				enabled: true,
				capabilities: {
					text: true,
					image: true,
					toolCall: true,
					reasoning: true,
				},
			},
			{
				id: "deprecated-model",
				label: "Deprecated",
				enabled: false,
			},
		],
		defaults: {
			chat: "qwen3.6-plus",
			vision: "qwen3-vl-235b-a22b-instruct",
		},
	};

	const service = new mod.GroupModelCatalogService({
		getSettings: () => settings,
		saveSettings: async () => {
			gitCalls.push("save");
		},
		getGitRuntimeStatus: async () => ({ available: true, version: "git version 2.45.0" }),
		getUserCredential: async () => ({ username: "u", token: "t" }),
		getUserGitEmail: () => "user@example.com",
		gitClientFactory: (credential, repoUrl) => {
			gitCalls.push(`factory:${credential.username}:${repoUrl}`);
			return {
				async ensureWorkspace() {
					gitCalls.push("ensure");
				},
				async lsRemote() {
					gitCalls.push("lsRemote");
					return "ok";
				},
				async fetch(branch) {
					gitCalls.push(`fetch:${branch}`);
				},
				async readText(ref, targetPath) {
					gitCalls.push(`read:${ref}:${targetPath}`);
					return JSON.stringify(catalog);
				},
				async cleanup() {
					gitCalls.push("cleanup");
				},
			};
		},
		now: () => new Date("2026-05-13T01:02:03.000Z"),
	});

	const result = await service.refreshCatalog();

	assert.equal(result.success, true);
	assert.equal(result.updated, true);
	assert.deepEqual(gitCalls, [
		"factory:u:https://gitee.example.com/friday/model-catalog.git",
		"ensure",
		"lsRemote",
		"fetch:friday-model-catalog",
		"read:FETCH_HEAD:model-catalog.json",
		"save",
		"cleanup",
	]);
	assert.deepEqual(settings.groupModelCatalog.models, [
		{
			id: "qwen3.6-plus",
			label: "Qwen3.6 Plus",
			enabled: true,
			capabilities: {
				text: true,
				image: true,
				toolCall: true,
				reasoning: true,
			},
		},
	]);
	assert.deepEqual(settings.groupModelCatalog.defaults, { chat: "qwen3.6-plus" });
	assert.equal(settings.groupModelCatalog.providerId, "aliyun");
	assert.equal(settings.groupModelCatalog.providerName, "汽车售后服务事业部");
	assert.equal(settings.groupModelCatalog.lastCatalogVersion, "2026-05-13.1");
	assert.equal(settings.groupModelCatalog.lastCheckedAt, "2026-05-13T01:02:03.000Z");
	assert.equal(settings.groupModelCatalog.lastResult, "updated");
	assert.equal(settings.groupModelCatalog.lastError, "");
});

test("group model catalog service records failures without clearing cached models", async () => {
	const mod = await loadService();
	const settings = createSettings();
	settings.groupModelCatalog.models = [{ id: "cached", label: "Cached", enabled: true, capabilities: { text: true } }];

	const service = new mod.GroupModelCatalogService({
		getSettings: () => settings,
		saveSettings: async () => {},
		getGitRuntimeStatus: async () => ({ available: false, error: "git missing" }),
		getUserCredential: async () => null,
		getUserGitEmail: () => "",
		now: () => new Date("2026-05-13T01:02:03.000Z"),
	});

	const result = await service.refreshCatalog();

	assert.equal(result.success, false);
	assert.match(result.error, /git missing/);
	assert.deepEqual(settings.groupModelCatalog.models, [
		{ id: "cached", label: "Cached", enabled: true, capabilities: { text: true } },
	]);
	assert.equal(settings.groupModelCatalog.lastResult, "error");
	assert.match(settings.groupModelCatalog.lastError, /git missing/);
});
