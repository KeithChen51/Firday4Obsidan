/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/platform/git/PromiseQueue.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("promise queue runs tasks serially even when scheduled together", async () => {
	const mod = await loadModule();
	const queue = new mod.PromiseQueue();
	const order = [];

	const slow = queue.enqueue(async () => {
		order.push("slow:start");
		await new Promise((resolve) => setTimeout(resolve, 20));
		order.push("slow:end");
		return "slow";
	});

	const fast = queue.enqueue(async () => {
		order.push("fast:start");
		order.push("fast:end");
		return "fast";
	});

	assert.equal(await slow, "slow");
	assert.equal(await fast, "fast");
	assert.deepEqual(order, ["slow:start", "slow:end", "fast:start", "fast:end"]);
});

test("promise queue continues after a rejected task", async () => {
	const mod = await loadModule();
	const queue = new mod.PromiseQueue();
	const order = [];

	await assert.rejects(
		queue.enqueue(async () => {
			order.push("first");
			throw new Error("boom");
		}),
		/boom/,
	);

	const result = await queue.enqueue(async () => {
		order.push("second");
		return "ok";
	});

	assert.equal(result, "ok");
	assert.deepEqual(order, ["first", "second"]);
});
