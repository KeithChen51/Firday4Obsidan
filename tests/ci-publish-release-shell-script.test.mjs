/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const scriptPath = path.join(projectRoot, "scripts", "ci-publish-release.sh");
const gitattributesPath = path.join(projectRoot, ".gitattributes");
const normalizerPath = path.join(projectRoot, "scripts", "normalize-shell-line-endings.mjs");

function read(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("ci publish helper hides tokenized remote setup behind a shell script", () => {
	assert.ok(fs.existsSync(scriptPath), "ci publish helper script should exist");
	const source = read(scriptPath);
	assert.match(source, /PUBLISH_TOKEN/);
	assert.match(source, /set \+x/);
	assert.match(source, /Missing PUBLISH_TOKEN/);
	assert.match(source, /resolve-publish-remote\.mjs/);
	assert.match(source, /git remote set-url origin/);
	assert.match(source, /git config user\.name/);
	assert.match(source, /git config user\.email/);
	assert.doesNotMatch(source, /Friday-test\.git/);
	assert.match(source, /node scripts\/generate-official-content-release\.mjs/);
	assert.match(source, /node scripts\/publish-release-branch\.mjs --branch release plugin \.workflow\/publish\/official=official/);
	assert.doesNotMatch(source, /publish-release-branch\.mjs --branch release plugin official/);
});

test("ci publish shell script stays LF-only for bash runners", () => {
	const scriptBytes = fs.readFileSync(scriptPath);
	assert.equal(scriptBytes.includes(0x0d), false, "bash scripts must not contain CR bytes");

	assert.ok(fs.existsSync(gitattributesPath), ".gitattributes should pin shell script line endings");
	const attributes = read(gitattributesPath);
	assert.match(attributes, /^\*\.sh\s+text\s+eol=lf$/m);
});

test("ci shell normalizer repairs CRLF workspace copies before npm test", async () => {
	const { normalizeShellLineEndings } = await import(pathToFileURL(normalizerPath).href);
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "friday-shell-lf-"));
	const tempScriptsRoot = path.join(tempRoot, "scripts");
	fs.mkdirSync(tempScriptsRoot, { recursive: true });
	const tempScriptPath = path.join(tempScriptsRoot, "ci-publish-release.sh");
	fs.writeFileSync(tempScriptPath, "#!/usr/bin/env bash\r\nset -euo pipefail\r\n", "utf8");

	const changed = normalizeShellLineEndings({ projectRoot: tempRoot });

	assert.deepEqual(changed, ["scripts/ci-publish-release.sh"]);
	assert.equal(fs.readFileSync(tempScriptPath).includes(0x0d), false);
	assert.equal(fs.readFileSync(tempScriptPath, "utf8"), "#!/usr/bin/env bash\nset -euo pipefail\n");
});
