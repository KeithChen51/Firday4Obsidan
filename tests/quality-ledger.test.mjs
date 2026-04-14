/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/platform/quality/QualityLedger.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("quality ledger appends timestamped gate entries", async () => {
	const mod = await loadModule();
	const first = mod.appendQualityLedger("", {
		generatedAt: "2026-04-13T02:00:00.000Z",
		status: "pass",
		lintPassed: true,
		buildPassed: true,
		testPassed: true,
		toolRunCount: 12,
		stepTraceCount: 40,
		reviewedWarnings: ["none"],
	});
	const second = mod.appendQualityLedger(first, {
		generatedAt: "2026-04-13T03:00:00.000Z",
		status: "pass",
		lintPassed: true,
		buildPassed: true,
		testPassed: true,
		toolRunCount: 13,
		stepTraceCount: 44,
		reviewedWarnings: ["t1 reviewed"],
	});
	assert.match(second, /2026-04-13T02:00:00.000Z/);
	assert.match(second, /2026-04-13T03:00:00.000Z/);
	assert.match(second, /toolRuns=13/);
	assert.match(second, /status=pass/);
});
