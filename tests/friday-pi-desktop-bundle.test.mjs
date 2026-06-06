/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const mainBundlePath = path.join(projectRoot, "main.js");

test("real PI SDK desktop bundle does not include pi-ai Node env probing", () => {
	const bundle = fs.readFileSync(mainBundlePath, "utf8");
	const forbiddenSignatures = [
		"GOOGLE_APPLICATION_CREDENTIALS",
		"/proc/self/environ",
		"getEnvApiKey",
		"findEnvKeys",
	];

	for (const signature of forbiddenSignatures) {
		assert.equal(
			bundle.includes(signature),
			false,
			`main.js should not bundle pi-ai env-api-keys signature: ${signature}`,
		);
	}
});
