/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/services/WikiIngestService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("explicit compile rebuild bypasses unchanged+success skip", async () => {
	const mod = await loadModule();
	const prepared = {
		changed: false,
		meta: {
			lastIngestStatus: "success",
		},
	};
	assert.equal(mod.shouldSkipPreparedRawIngest(prepared, false), true);
	assert.equal(mod.shouldSkipPreparedRawIngest(prepared, true), false);
});
