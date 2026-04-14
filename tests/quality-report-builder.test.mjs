/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/platform/quality/QualityReportBuilder.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("quality report builder summarizes gate and audit counts", async () => {
	const mod = await loadModule();
	const report = mod.buildQualityReport({
		lintPassed: true,
		buildPassed: true,
		testPassed: true,
		toolRunCount: 3,
		stepTraceCount: 8,
		reviewedWarnings: ["T1 reviewed"],
	});

	assert.equal(report.includes("Lint: PASS"), true);
	assert.equal(report.includes("Tool runs: 3"), true);
	assert.equal(report.includes("T1 reviewed"), true);
});
