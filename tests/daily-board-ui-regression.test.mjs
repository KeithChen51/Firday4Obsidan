/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const viewPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");
const skillServicePath = path.join(projectRoot, "src/services/SkillCommandService.ts");
const builtinSkillPath = path.join(projectRoot, "src/skills/packs/builtin/index.ts");
const stylesPath = path.join(projectRoot, "styles.css");
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");

function readViewSource() {
	return fs.readFileSync(viewPath, "utf8");
}

function readRuntimeSource() {
	return fs.readFileSync(runtimePath, "utf8");
}

function readSkillServiceSource() {
	return fs.readFileSync(skillServicePath, "utf8");
}

function readBuiltinSkillSource() {
	return fs.readFileSync(builtinSkillPath, "utf8");
}

function readStylesSource() {
	return fs.readFileSync(stylesPath, "utf8");
}

function readLocaleSource(localePath) {
	return fs.readFileSync(localePath, "utf8");
}

test("tool approval prompt handler no longer forces checks page", async () => {
	const source = readViewSource();
	const match = source.match(/setPromptHandler\(async \(request\) => \{([\s\S]*?)return decision;/);
	assert.ok(match, "prompt handler block should exist");
	assert.ok(!/this\.activePage\s*=\s*"checks"/.test(match[1] ?? ""), "prompt handler should stay inline on chat page");
});

test("daily board view supports collapsible session nav", async () => {
	const source = readViewSource();
	assert.match(source, /aiSessionNavCollapsed/);
	assert.match(source, /toggleAiSessionNavCollapsed/);
});

test("explicit skill invocation stays on runtime path instead of builtin shortcut", async () => {
	const source = readViewSource();
	const match = source.match(/private async submitAiPrompt\(\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate async compileWikiByButton/);
	assert.ok(match, "submitAiPrompt block should exist");
	const block = match[1] ?? "";
	assert.match(block, /extraSystemContext\s*=\s*skillContext\.systemContext/);
	assert.doesNotMatch(block, /runBuiltinSkillCommand\(\{/);
});

test("compile intent stays on runtime path instead of calling compile helper directly from submitAiPrompt", async () => {
	const source = readViewSource();
	const match = source.match(/private async submitAiPrompt\(\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate async compileWikiByButton/);
	assert.ok(match, "submitAiPrompt block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /compileWikiWithStatus\(/);
});

test("auto skill matching injects full skill context instead of summary list only", async () => {
	const source = readRuntimeSource();
	const match = source.match(/private async buildAutoSkillContext\([\s\S]*?\n\t\}\n\n\tprivate async loadMemoryContext/);
	assert.ok(match, "buildAutoSkillContext block should exist");
	assert.match(match[0], /buildSkillSystemContext\(/);
});

test("tools and skills page is no longer nested in a collapsible panel", async () => {
	const source = readViewSource();
	assert.doesNotMatch(source, /aiPolicyPanelCollapsed/);
	assert.doesNotMatch(source, /toggleAiPolicyPanelCollapsed/);
	assert.doesNotMatch(source, /renderPolicyMatrixPanel\(/);
});

test("checks page no longer exposes quality report generation", async () => {
	const source = readViewSource();
	assert.doesNotMatch(source, /checks\.button\.generateReport/);
	assert.doesNotMatch(source, /private async generateQualityReport\(/);
});

test("checks navigation and title are renamed to tools and skills", async () => {
	const zh = readLocaleSource(zhLocalePath);
	const en = readLocaleSource(enLocalePath);
	assert.match(zh, /"nav\.checks": "Tools & Skills"/);
	assert.match(zh, /"checks\.title": "Tools & Skills"/);
	assert.match(en, /"nav\.checks": "Tools & Skills"/);
	assert.match(en, /"checks\.title": "Tools & Skills"/);
});

test("checks page is dedicated to tool and skill management only", async () => {
	const source = readViewSource();
	const match = source.match(/private renderChecksPage\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderApprovalCard/);
	assert.ok(match, "renderChecksPage block should exist");
	const block = match[1] ?? "";
	assert.match(block, /populateControlCenter\(/);
	assert.doesNotMatch(block, /approvalQueue\.list\(/);
	assert.doesNotMatch(block, /getSyncReports\(/);
	assert.doesNotMatch(block, /getConflictProposals\(/);
	assert.doesNotMatch(block, /getEditPlans\(/);
	assert.doesNotMatch(block, /renderProjectRemovalCard\(/);
	assert.doesNotMatch(block, /renderMemberEditorCard\(/);
	assert.doesNotMatch(block, /friday-ai-chat-panel/);
});

test("project actions stay on projects page instead of jumping to checks", async () => {
	const source = readViewSource();
	assert.match(source, /private async openMemberEditor\(projectSlug: string\): Promise<void> \{[\s\S]*?this\.activePage = "projects"/);
	assert.match(source, /projects\.button\.remove[\s\S]*?this\.activePage = "projects"/);
	assert.match(source, /private async syncAllProjects\(\): Promise<void> \{[\s\S]*?this\.activePage = "projects"/);
	assert.match(source, /private async syncSingleProject\(project: ProjectEntry\): Promise<void> \{[\s\S]*?this\.activePage = "projects"/);
	assert.match(source, /private async generateConflictProposal\(projectSlug: string, filePath: string\): Promise<void> \{[\s\S]*?this\.activePage = "projects"/);
});

test("project conflict proposal no longer calls builtin skill shortcut directly", async () => {
	const source = readViewSource();
	const match = source.match(/private async generateConflictProposal\(projectSlug: string, filePath: string\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate /);
	assert.ok(match, "generateConflictProposal block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /runBuiltinSkillCommand\(\{/);
	assert.match(block, /buildSkillSystemContext\("resolve-conflict"\)/);
	assert.match(block, /agentRuntimeService\.runTurn\(/);
});

test("policy page groups builtin tools and separates builtin and personal skills", async () => {
	const source = readViewSource();
	assert.match(source, /policy\.tools\.builtin/);
	assert.match(source, /policy\.skills\.builtin/);
	assert.match(source, /policy\.skills\.personal/);
});

test("tool cards show purpose copy and tool-skill relationship hints", async () => {
	const source = readViewSource();
	assert.match(source, /resolveToolDescription\(/);
	assert.match(source, /resolveToolSkillRelationship\(/);
	assert.match(source, /friday-control-center-item-desc/);
	assert.match(source, /friday-control-center-item-relation/);
});

test("tool and skill cards no longer render tag chips", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	assert.doesNotMatch(source, /friday-control-chip/);
	assert.doesNotMatch(source, /friday-control-center-item-subline/);
	assert.doesNotMatch(styles, /\.friday-control-chip\b/);
	assert.doesNotMatch(styles, /\.friday-control-center-item-subline\b/);
});

test("tool and skill toggles use native Obsidian toggles instead of custom switch pills", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	assert.match(source, /new ToggleComponent\(/);
	assert.doesNotMatch(source, /friday-control-switch/);
	assert.doesNotMatch(styles, /\.friday-control-switch\b/);
	assert.doesNotMatch(styles, /\.friday-control-switch-thumb\b/);
	assert.match(source, /toggleToolAvailability\(tool\.name, disabledTools\.has\(tool\.name\)\)/);
	assert.match(source, /toggleSkillAvailability\(skill\.command, disabledSkills\.has\(normalized\)\)/);
	assert.doesNotMatch(source, /toggleToolAvailability\(tool\.name, !enabled\)/);
	assert.doesNotMatch(source, /toggleSkillAvailability\(skill\.command, !enabled\)/);
	assert.doesNotMatch(source, /policy\.toggle\.on/);
	assert.doesNotMatch(source, /policy\.toggle\.off/);
});

test("skill descriptions can prefer chinese localized metadata", async () => {
	const serviceSource = readSkillServiceSource();
	const builtinSource = readBuiltinSkillSource();
	assert.match(serviceSource, /descriptionzh|description_zh|description_cn/i);
	assert.match(serviceSource, /getLocale/);
	assert.match(builtinSource, /descriptionZh:/);
});

test("slash dropdown is rendered in normal flow above composer", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-ai-composer-wrap\s*\{[\s\S]*position:\s*relative;/);
	assert.match(styles, /\.friday-mention-dropdown\s*\{[\s\S]*position:\s*static;/);
});

test("tools and skills page keeps vertical scrolling enabled", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-page-content\s*\{[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;[^}]*\}/);
});
