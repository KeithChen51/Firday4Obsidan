/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

function readRuntimeSource() {
	return fs.readFileSync(runtimePath, "utf8");
}

test("agent runtime does not fallback to prompt mode for retryable transport failures", () => {
	const source = readRuntimeSource();
	assert.match(source, /isRetryableTransportFailure\(message\)/);
	assert.match(source, /已停止自动切换兼容模式/);
});
