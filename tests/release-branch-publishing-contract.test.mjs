/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const updateConstantsPath = path.join(projectRoot, "src/constants/update.ts");
const officialConstantsPath = path.join(projectRoot, "src/constants/officialContent.ts");
const communityConstantsPath = path.join(projectRoot, "src/constants/communityChannel.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("plugin and official publish trees live under namespaced release roots", () => {
	const updateSource = read(updateConstantsPath);
	const officialSource = read(officialConstantsPath);

	assert.match(updateSource, /PLUGIN_UPDATE_BRANCH = "release"/);
	assert.match(updateSource, /PLUGIN_UPDATE_MANIFEST_PATH = "plugin\/latest\.json"/);
	assert.match(updateSource, /PLUGIN_UPDATE_ARTIFACT_DIR = "plugin\/artifacts"/);
	assert.doesNotMatch(updateSource, /release\/latest\.json/);
	assert.doesNotMatch(updateSource, /release\/friday-obsidian-plugin/);

	assert.match(officialSource, /OFFICIAL_CONTENT_RELEASE_BRANCH = "release"/);
	assert.match(officialSource, /OFFICIAL_CONTENT_MANIFEST_PATH = "official\/latest\.json"/);
	assert.match(officialSource, /OFFICIAL_CONTENT_CHANNELS_DIR = "official\/channels"/);
	assert.match(officialSource, /OFFICIAL_CONTENT_FILES_DIR = "official\/files"/);
	assert.doesNotMatch(officialSource, /official-content/);
});

test("community publish tree convention is fixed to a single-channel repository", () => {
	assert.ok(fs.existsSync(communityConstantsPath), "community channel constants should exist");
	const source = read(communityConstantsPath);
	assert.match(source, /COMMUNITY_CHANNEL_RELEASE_BRANCH = "release"/);
	assert.match(source, /COMMUNITY_CHANNEL_MANIFEST_PATH = "channel\/latest\.json"/);
	assert.match(source, /COMMUNITY_CHANNELS_DIR = "channel\/channels"/);
	assert.match(source, /COMMUNITY_CHANNEL_FILES_DIR = "channel\/files"/);
	assert.match(source, /ONE_REPOSITORY_ONE_CHANNEL = true/);
});
