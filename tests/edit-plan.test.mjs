/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/editor/EditPlan.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("edit plan supports accept/reject/rollback for multi-file batches", async () => {
	const mod = await loadModule();
	const plan = new mod.EditPlan("batch-1", [
		{ path: "a.md", before: "a0", after: "a1" },
		{ path: "b.md", before: "b0", after: "b1" },
	]);

	assert.equal(plan.items()[0].status, "pending");
	plan.accept("a.md");
	assert.equal(plan.items()[0].status, "accepted");
	plan.reject("b.md");
	assert.equal(plan.items()[1].status, "rejected");
	plan.markApplied("a.md");
	const rolledBack = plan.rollbackLastApplied();
	assert.equal(rolledBack?.path, "a.md");
	assert.equal(plan.items()[0].status, "rolled_back");
});
