/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const modulePath = path.join(projectRoot, "src/core/llm/LlmTransportPolicy.ts");

async function loadPolicy() {
	return jiti.import(modulePath);
}

test("llm transport policy merges custom headers and authorization token", async () => {
	const mod = await loadPolicy();
	const headers = mod.buildLlmHeaders("secret-token", {
		"X-Custom-Header": "tenant-001",
	});
	assert.equal(headers["Content-Type"], "application/json");
	assert.equal(headers.Authorization, "Bearer secret-token");
	assert.equal(headers["X-Custom-Header"], "tenant-001");
});

test("llm transport policy keeps explicit authorization header", async () => {
	const mod = await loadPolicy();
	const headers = mod.buildLlmHeaders("secret-token", {
		Authorization: "Basic abc123",
	});
	assert.equal(headers.Authorization, "Basic abc123");
});

test("llm transport policy retries transient gateway failures", async () => {
	const mod = await loadPolicy();
	assert.equal(mod.shouldRetryLlmRequest("504 Gateway Timeout", 0, 3), true);
	assert.equal(mod.shouldRetryLlmRequest("ERR_CONNECTION_RESET", 1, 3), true);
	assert.equal(mod.shouldRetryLlmRequest("Error: net::ERR_CONNECTION_CLOSED", 1, 3), true);
	assert.equal(mod.shouldRetryLlmRequest("timed out while waiting for response", 2, 3), true);
	assert.equal(mod.shouldRetryLlmRequest("400 unsupported tool schema", 0, 3), false);
	assert.equal(mod.isRetryableLlmFailure("504 Gateway Timeout"), true);
	assert.equal(mod.isRetryableLlmFailure("net::ERR_CONNECTION_CLOSED"), true);
	assert.equal(mod.isRetryableLlmFailure("400 unsupported tool schema"), false);
});
