/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const normalizerPath = path.join(projectRoot, "src/core/tools/ToolInvocationNormalizer.ts");

test("normalizeToolInvocation creates the same identity for reordered JSON object keys", async () => {
	const { normalizeToolInvocation } = await jiti.import(normalizerPath);

	const first = normalizeToolInvocation({
		name: "read",
		args: {
			path: "workspace/missing.md",
			options: { beta: true, alpha: 1 },
		},
	});
	const second = normalizeToolInvocation({
		name: "read",
		args: {
			options: { alpha: 1, beta: true },
			path: "workspace/missing.md",
		},
	});

	assert.equal(first.identity, second.identity);
	assert.equal(first.canonicalArgs, '{"options":{"alpha":1,"beta":true},"path":"workspace/missing.md"}');
	assert.deepEqual(first.normalizedArgs, {
		options: { alpha: 1, beta: true },
		path: "workspace/missing.md",
	});
});

test("normalizeToolInvocation keeps array order because argument order can be semantic", async () => {
	const { normalizeToolInvocation } = await jiti.import(normalizerPath);

	const first = normalizeToolInvocation({ name: "edit", args: { replacements: ["a", "b"] } });
	const second = normalizeToolInvocation({ name: "edit", args: { replacements: ["b", "a"] } });

	assert.notEqual(first.identity, second.identity);
});
