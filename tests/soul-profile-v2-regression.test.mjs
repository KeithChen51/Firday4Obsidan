/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

function read(relativePath) {
	const filePath = path.join(projectRoot, relativePath);
	assert.ok(fs.existsSync(filePath), `${relativePath} should exist`);
	return fs.readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
}

test("soul v2 defines a strategy model instead of identity and disclosure scripts", () => {
	const source = read("src/features/soul/SoulProfile.ts");

	for (const expected of [
		"export interface SoulProfile",
		"export interface SoulIdentityPolicy",
		"export interface SoulStylePolicy",
		"export interface SoulSituationPolicy",
		"export type SoulSituationId",
		"detectSoulSituation",
		"compileSoulProfileForPrompt",
		"style_disclosure_question",
		"identity_question",
		"Use examples as variation references, not scripts to recite.",
	]) {
		assert.ok(source.includes(expected), `Expected Soul v2 strategy source to include: ${expected}`);
	}

	assert.ok(!source.includes("identityVoice"), "Soul v2 should not model identity as a single voice line");
	assert.ok(!source.includes("styleDisclosure"), "Soul v2 should not model style disclosure as a single script");
});

test("soul definitions store a profile and no longer expose script fields", () => {
	const source = read("src/types/soul.ts");

	assert.match(source, /import type \{ SoulProfile \} from "\.\.\/features\/soul\/SoulProfile";/);
	assert.match(source, /profile\?: SoulProfile;/);
	assert.ok(!source.includes("identityVoice?: string"), "SoulDefinition should not expose identityVoice");
	assert.ok(!source.includes("styleDisclosure?: string"), "SoulDefinition should not expose styleDisclosure");
});

test("soul lab templates emit profile strategies as the single source of MBTI behavior", () => {
	const source = read("src/features/soul/SoulExperimentTemplates.ts");

	for (const expected of [
		"type SoulProfile",
		"createMbtiSoulProfile",
		"profile: SoulProfile",
		"profile: createMbtiSoulProfile",
		"identityExamples",
		"disclosureExamples",
		"posture",
	]) {
		assert.ok(source.includes(expected), `Expected templates to emit v2 profile data: ${expected}`);
	}

	assert.ok(!source.includes("identityVoice: string"), "template interface should not expose identityVoice");
	assert.ok(!source.includes("styleDisclosure: string"), "template interface should not expose styleDisclosure");
	assert.ok(!source.includes("identityVoice: input.identityVoice"), "templates should not copy identity scripts");
	assert.ok(!source.includes("styleDisclosure: input.styleDisclosure"), "templates should not copy disclosure scripts");
});

test("settings copies soul profiles from templates instead of script fields", () => {
	const source = read("src/settings/FridaySettingTab.ts");

	assert.match(source, /profile:\s*template\.profile/);
	assert.ok(!source.includes("identityVoice: template.identityVoice"), "settings should not copy identityVoice scripts");
	assert.ok(!source.includes("styleDisclosure: template.styleDisclosure"), "settings should not copy styleDisclosure scripts");
});

test("runtime compiles the profile for the current situation instead of injecting fixed scripts", () => {
	const source = read("src/services/AgentRuntimeService.ts");

	for (const expected of [
		"compileSoulProfileForPrompt",
		"buildSoulProfilePrompt",
		"const soulProfilePrompt = this.buildSoulProfilePrompt(soulDefinition, userPrompt ?? \"\");",
	]) {
		assert.ok(source.includes(expected), `Expected runtime to compile Soul profile: ${expected}`);
	}

	for (const forbidden of [
		"buildSoulIdentityProfile",
		"identity answer voice:",
		"style disclosure when asked:",
		"resolveMbtiIdentityProfile",
		"isLegacyBareIdentityVoice",
	]) {
		assert.ok(!source.includes(forbidden), `Runtime should not keep v1 identity/disclosure path: ${forbidden}`);
	}
});
