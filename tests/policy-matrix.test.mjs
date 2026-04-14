/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/security/policy-resolver/PolicyMatrix.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("policy matrix explains session > project > global precedence", async () => {
	const mod = await loadModule();
	const rows = mod.buildPolicyMatrix({
		tools: ["read", "write", "exec"],
		globalRules: [
			{ action: "tool:read", effect: "allow", source: "global" },
			{ action: "tool:write", effect: "ask", source: "global" },
			{ action: "tool:exec", effect: "deny", source: "global" },
		],
		projectRules: [{ action: "tool:write", effect: "deny", source: "project" }],
		sessionOverrides: { "tool:write": "allow" },
	});
	assert.equal(rows.find((item) => item.tool === "read")?.effectiveEffect, "allow");
	assert.equal(rows.find((item) => item.tool === "write")?.effectiveEffect, "allow");
	assert.equal(rows.find((item) => item.tool === "write")?.effectiveSource, "session");
	assert.equal(rows.find((item) => item.tool === "exec")?.effectiveEffect, "deny");
});

test("policy matrix keeps project override when session override is absent", async () => {
	const mod = await loadModule();
	const rows = mod.buildPolicyMatrix({
		tools: ["write"],
		globalRules: [{ action: "tool:write", effect: "ask", source: "global" }],
		projectRules: [{ action: "tool:write", effect: "deny", source: "project" }],
		sessionOverrides: {},
	});
	assert.equal(rows[0]?.projectEffect, "deny");
	assert.equal(rows[0]?.effectiveEffect, "deny");
	assert.equal(rows[0]?.effectiveSource, "project");
});
