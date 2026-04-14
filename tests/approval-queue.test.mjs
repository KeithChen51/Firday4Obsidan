/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/features/workbench/ApprovalQueue.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("approval queue stores pending request and resolves it", async () => {
	const mod = await loadModule();
	const queue = new mod.ApprovalQueue();
	const promise = queue.enqueue({
		agentId: "agent-1",
		tool: "write",
		scope: "vault",
		targetPath: "project/file.md",
		description: "write(project/file.md)",
	});

	assert.equal(queue.list().length, 1);
	const first = queue.list()[0];
	queue.resolve(first.id, "allow_once");
	const decision = await promise;
	assert.equal(decision, "allow_once");
	assert.equal(queue.list().length, 0);
});
