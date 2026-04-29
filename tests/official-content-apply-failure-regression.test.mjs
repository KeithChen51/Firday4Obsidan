/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const servicePath = path.join(projectRoot, "src/services/OfficialContentService.ts");

async function loadModule() {
	return jiti.import(servicePath);
}

test("applySubscriptions does not mark subscribed official content applied when manifests cannot be loaded", async () => {
	const mod = await loadModule();
	const settings = {
		officialContent: {
			checkOnStartup: true,
			startupDelayMs: 5000,
			lastCheckedAt: "",
			lastCatalogVersion: "",
			catalog: [
				{
					id: "study-with-friday",
					title: "Study with FRIDAY",
					kind: "directory",
					path: "Study with FRIDAY",
					version: "2026.04.24",
					manifestPath: "official/channels/official.json",
				},
			],
			channels: {
				"study-with-friday": {
					subscribed: true,
					lastAppliedVersion: "2026.04.23",
					path: "Study with FRIDAY",
				},
			},
		},
	};
	let saved = false;
	const service = new mod.OfficialContentService({
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
		saveSettings: async () => {
			saved = true;
		},
		getGitRuntimeStatus: async () => ({ available: true, version: "2.0.0", error: "" }),
		getUserCredential: async () => null,
		getUserGitEmail: () => "",
	});

	await assert.rejects(() => service.applySubscriptions(), /official content|credential|manifest/i);

	assert.equal(settings.officialContent.channels["study-with-friday"].lastAppliedVersion, "2026.04.23");
	assert.equal(saved, false);
});
