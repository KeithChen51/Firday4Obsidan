/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);

const modulePath = path.join(projectRoot, "src/core/security/policy-resolver/PolicyResolverCore.ts");
const overrideModulePath = path.join(projectRoot, "src/core/session-control/SessionOverrideAdapter.ts");

async function loadModules() {
	const resolver = await jiti.import(modulePath);
	const overrides = await jiti.import(overrideModulePath);
	return { resolver, overrides };
}

test("policy resolver respects project > global precedence", async () => {
	const { resolver, overrides } = await loadModules();
	const adapter = new overrides.SessionOverrideAdapter();
	const core = new resolver.PolicyResolverCore({
		sessionOverrideAdapter: adapter,
		globalRules: [{ action: "tool:write", effect: "ask", source: "global" }],
		projectRules: [{ action: "tool:write", effect: "deny", source: "project" }],
	});

	const decision = core.resolve("tool:write");
	assert.equal(decision.effectiveEffect, "deny");
	assert.equal(decision.source, "project");
});

test("session override has highest precedence", async () => {
	const { resolver, overrides } = await loadModules();
	const adapter = new overrides.SessionOverrideAdapter();
	const core = new resolver.PolicyResolverCore({
		sessionOverrideAdapter: adapter,
		globalRules: [{ action: "tool:exec", effect: "deny", source: "global" }],
		projectRules: [{ action: "tool:exec", effect: "ask", source: "project" }],
	});

	adapter.setOverride("tool:exec", "allow");
	const decision = core.resolve("tool:exec");
	assert.equal(decision.effectiveEffect, "allow");
	assert.equal(decision.source, "session");
});
