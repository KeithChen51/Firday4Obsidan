/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const stylesPath = path.join(projectRoot, "styles.css");

function readStyles() {
	return fs.readFileSync(stylesPath, "utf8").replace(/\r\n?/g, "\n");
}

test("inline token remove button overrides the composer's generic minimum button width", () => {
	const styles = readStyles();
	assert.match(styles, /\.friday-ai-composer button\.friday-inline-mention-token-remove\s*\{/);
	assert.match(styles, /\.friday-ai-composer button\.friday-inline-mention-token-remove\s*\{[\s\S]*min-width:\s*12px;/);
	assert.match(styles, /\.friday-ai-composer button\.friday-inline-mention-token-remove\s*\{[\s\S]*width:\s*12px;/);
	assert.match(styles, /\.friday-inline-mention-token-remove\s*\{[\s\S]*flex:\s*0 0 12px;/);
});
