/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const constantsPath = path.join(projectRoot, "src/constants/communityChannel.ts");
const typesPath = path.join(projectRoot, "src/types/officialContent.ts");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("community channel protocol defaults to repoUrl-only subscription input", () => {
	assert.ok(fs.existsSync(constantsPath), "community channel constants should exist");
	const source = read(constantsPath);
	assert.match(source, /COMMUNITY_CHANNEL_RELEASE_BRANCH = "release"/);
	assert.match(source, /COMMUNITY_CHANNEL_MANIFEST_PATH = "channel\/latest\.json"/);
	assert.match(source, /ONE_REPOSITORY_ONE_CHANNEL = true/);
});

test("official content types include a minimal community source descriptor", () => {
	const source = read(typesPath);
	assert.match(source, /CommunityChannelSource/);
	assert.match(source, /repoUrl: string;/);
	assert.match(source, /branch\?: string;/);
	assert.match(source, /manifestPath\?: string;/);
});
