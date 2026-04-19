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
	return fs.readFileSync(viewPath, "utf8").replace(/\r\n?/g, "\n");
}

function readRuntimeSource() {
	return fs.readFileSync(runtimePath, "utf8").replace(/\r\n?/g, "\n");
}

function readSkillServiceSource() {
	return fs.readFileSync(skillServicePath, "utf8").replace(/\r\n?/g, "\n");
}

function readBuiltinSkillSource() {
	return fs.readFileSync(builtinSkillPath, "utf8").replace(/\r\n?/g, "\n");
}

function readStylesSource() {
	return fs.readFileSync(stylesPath, "utf8").replace(/\r\n?/g, "\n");
}

function readLocaleSource(localePath) {
	return fs.readFileSync(localePath, "utf8").replace(/\r\n?/g, "\n");
}

test("tool approval prompt handler no longer forces tools page", async () => {
	const source = readViewSource();
	const match = source.match(/setPromptHandler\(async \(request\) => \{([\s\S]*?)return decision;/);
	assert.ok(match, "prompt handler block should exist");
	assert.ok(!/this\.activePage\s*=\s*"tools"/.test(match[1] ?? ""), "prompt handler should stay inline on chat page");
});

test("daily board view supports collapsible session nav", async () => {
	const source = readViewSource();
	assert.match(source, /aiSessionNavCollapsed/);
	assert.match(source, /toggleAiSessionNavCollapsed/);
});

test("session drawer supports search and date-grouped browsing", async () => {
	const source = readViewSource();
	assert.match(source, /aiSessionSearchQuery/);
	assert.match(source, /friday-ai-session-search/);
	assert.match(source, /buildSessionGroups\(/);
	assert.match(source, /friday-ai-session-group-label/);
	assert.match(source, /ai\.sessions\.search\.placeholder/);
});

test("session drawer search input reserves dedicated inline space for the search icon", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-ai-session-search-icon\s*\{[\s\S]*left:\s*10px;/);
	assert.match(styles, /\.friday-ai-session-search\s*\{[\s\S]*padding-left:\s*40px;/);
	assert.match(styles, /\.friday-ai-session-search\s*\{[\s\S]*padding-inline-start:\s*40px;/);
});

test("session drawer uses context-menu actions instead of always-visible text pills", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	assert.match(source, /new Menu\(\)/);
	assert.match(source, /showAtMouseEvent\(/);
	assert.match(source, /more-horizontal/);
	assert.doesNotMatch(source, /friday-ai-session-mini-action/);
	assert.match(styles, /\.friday-ai-session-item-menu\b/);
});

test("session drawer styles favor native list rows over floating cards", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-ai-session-group-label\b/);
	assert.match(styles, /\.friday-ai-session-item::before\b/);
	assert.match(styles, /\.friday-ai-session-item-actions\s*\{[\s\S]*opacity:\s*0/);
	assert.match(styles, /\.friday-ai-session-item:hover \.friday-ai-session-item-actions\s*\{[\s\S]*opacity:\s*1/);
});

test("session drawer uses the entire row as the interactive target", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	assert.match(source, /itemEl\.setAttribute\("role", "button"\)/);
	assert.match(source, /itemEl\.tabIndex = 0/);
	assert.match(source, /itemEl\.onclick = \(\) => \{/);
	assert.match(source, /itemEl\.onkeydown = \(event\) => \{/);
	assert.match(source, /const bodyButton = rowEl\.createDiv\(\{ cls: "friday-ai-session-item-body" \}\)/);
	assert.doesNotMatch(source, /createEl\("button", \{ cls: "friday-ai-session-item-body" \}\)/);
	assert.match(styles, /\.friday-ai-session-item\s*\{[\s\S]*cursor:\s*pointer;/);
	assert.match(styles, /\.friday-ai-session-item:focus-visible\b/);
});

test("explicit skill invocation stays on runtime path instead of builtin shortcut", async () => {
	const source = readViewSource();
	const match = source.match(/private async submitAiPrompt\([^)]*\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate async compileWikiByButton/);
	assert.ok(match, "submitAiPrompt block should exist");
	const block = match[1] ?? "";
	assert.match(block, /executionPlanner\.plan\(/);
	assert.match(block, /executionOrchestrator\.execute\(/);
	assert.doesNotMatch(block, /buildSkillSystemContext\(/);
	assert.doesNotMatch(block, /runBuiltinSkillCommand\(\{/);
});

test("compile intent stays on runtime path instead of calling compile helper directly from submitAiPrompt", async () => {
	const source = readViewSource();
	const match = source.match(/private async submitAiPrompt\([^)]*\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate async compileWikiByButton/);
	assert.ok(match, "submitAiPrompt block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /compileWikiWithStatus\(/);
});

test("runtime no longer performs its own auto-skill selection inside buildSystemPrompt", async () => {
	const source = readRuntimeSource();
	assert.doesNotMatch(source, /suggestSkillsForPrompt\(/);
	assert.match(source, /extraSystemContext\?\.includes\("\[SkillInvocation\]"\)/);
	assert.match(source, /toolUseSkill\(/);
	assert.match(source, /invocationMode:\s*"auto"/);
});

test("invocation resolver no longer relies on compile intent hardcoding", async () => {
	const source = readViewSource();
	const match = source.match(/private buildInvocationResolver\(\): InvocationResolver \{([\s\S]*?)\n\t\}/);
	assert.ok(match, "buildInvocationResolver block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /isCompileIntent/);
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
	assert.match(zh, /"nav\.checks": "工具\/技能"/);
	assert.match(zh, /"checks\.title": "Tools & Skills"/);
	assert.match(en, /"nav\.checks": "Tools"/);
	assert.match(en, /"checks\.title": "Tools & Skills"/);
});

test("project navigation and page copy now present sync-first wording", async () => {
	const zh = readLocaleSource(zhLocalePath);
	const en = readLocaleSource(enLocalePath);
	assert.match(zh, /"nav\.projects": "同步"/);
	assert.match(zh, /"projects\.header": "同步"/);
	assert.match(en, /"nav\.projects": "Sync"/);
	assert.match(en, /"projects\.header": "Sync"/);
});

test("tools page is dedicated to tool and skill management only", async () => {
	const source = readViewSource();
	const match = source.match(/private renderToolsPage\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderApprovalCard/);
	assert.ok(match, "renderToolsPage block should exist");
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

test("sync actions stay on sync page instead of jumping to tools page", async () => {
	const source = readViewSource();
	assert.match(source, /private async syncAllProjects\(\): Promise<void> \{[\s\S]*?this\.activePage = "sync"/);
	assert.match(source, /private async syncSingleProject\(project: ProjectEntry\): Promise<void> \{[\s\S]*?this\.activePage = "sync"/);
	assert.match(source, /private async generateConflictProposal\(projectId: string, filePath: string\): Promise<void> \{[\s\S]*?this\.activePage = "sync"/);
});

test("sync page no longer renders a duplicate project editor before empty-state handling", async () => {
	const source = readViewSource();
	const match = source.match(/private renderSyncPage\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSyncProjectCard/);
	assert.ok(match, "renderSyncPage block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /projectEditorDraft/);
	assert.doesNotMatch(block, /renderProjectEditorCard\(/);
});

test("sync page empty-state routes users to settings instead of inline project creation", async () => {
	const source = readViewSource();
	const match = source.match(/private renderSyncPage\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSyncProjectCard/);
	assert.ok(match, "renderSyncPage block should exist");
	const block = match[1] ?? "";
	const emptyMatch = block.match(/if \(projects.length === 0\) \{([\s\S]*?)return;/);
	assert.ok(emptyMatch, "empty-state branch should exist");
	const emptyBlock = emptyMatch[1] ?? "";
	assert.match(emptyBlock, /openSettingsTab\(/);
	assert.doesNotMatch(emptyBlock, /openProjectEditor\(/);
});

test("daily board view no longer owns project editor state or handoff consumption", async () => {
	const source = readViewSource();
	assert.doesNotMatch(source, /private projectEditorDraft:/);
	assert.doesNotMatch(source, /private projectEditorInitialSlug/);
	assert.doesNotMatch(source, /private projectEditorError/);
	assert.doesNotMatch(source, /private consumeProjectEditorRequest\(/);
	assert.doesNotMatch(source, /private renderProjectEditorCard\(/);
	assert.doesNotMatch(source, /private submitProjectEditor\(/);
	assert.doesNotMatch(source, /private openProjectEditor\(/);
});

test("sync page no longer renders member editor or member actions", async () => {
	const source = readViewSource();
	const syncPageMatch = source.match(/private renderSyncPage\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSyncProjectCard/);
	assert.ok(syncPageMatch, "renderSyncPage block should exist");
	const syncBlock = syncPageMatch[1] ?? "";
	assert.doesNotMatch(syncBlock, /memberEditorProjectSlug/);
	assert.doesNotMatch(syncBlock, /renderMemberEditorCard\(/);

	const cardMatch = source.match(/private renderSyncProjectCard\(containerEl: HTMLElement, project: ProjectEntry\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSyncAutomationControls/);
	assert.ok(cardMatch, "renderSyncProjectCard block should exist");
	const cardBlock = cardMatch[1] ?? "";
	assert.doesNotMatch(cardBlock, /projects\.button\.members/);
	assert.doesNotMatch(cardBlock, /openMemberEditor\(/);
	assert.doesNotMatch(cardBlock, /projects\.button\.manage/);
	assert.doesNotMatch(cardBlock, /projects\.button\.remove/);
});

test("sync page branches on none, git_local, and git_remote_bound project states", async () => {
	const source = readViewSource();
	const cardMatch = source.match(/private renderSyncProjectCard\(containerEl: HTMLElement, project: ProjectEntry\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSyncAutomationControls/);
	assert.ok(cardMatch, "renderSyncProjectCard block should exist");
	const cardBlock = cardMatch[1] ?? "";
	assert.match(cardBlock, /project\.gitState === "none"/);
	assert.match(cardBlock, /project\.gitState === "git_local"/);
	assert.match(cardBlock, /project\.gitState === "git_remote_bound"/);
	assert.match(cardBlock, /openSettingsTab\(/);
	assert.match(cardBlock, /projects\.sync\.none/);
	assert.match(cardBlock, /projects\.sync\.gitLocal/);
	assert.match(cardBlock, /projects\.button\.sync/);
});

test("sync page project-setting entry points jump directly to settings project section", async () => {
	const source = readViewSource();
	assert.match(source, /openSettingsTab\("project"\)/);
});

test("daily board view subscribes to project state change events and refreshes when they fire", async () => {
	const source = readViewSource();
	assert.match(source, /window\.addEventListener\(PROJECT_STATE_CHANGED_EVENT/);
	assert.match(source, /window\.removeEventListener\(PROJECT_STATE_CHANGED_EVENT/);
	assert.match(source, /handleProjectStateChanged = \(\) => \{/);
	assert.match(source, /void this\.safeRenderBoard\(\)/);
});

test("sync page renders only the active project context instead of a multi-project grid", async () => {
	const source = readViewSource();
	const match = source.match(/private renderSyncPage\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSyncProjectCard/);
	assert.ok(match, "renderSyncPage block should exist");
	const block = match[1] ?? "";
	assert.match(block, /const activeProject = this\.getActiveProjectEntry\(\)/);
	assert.doesNotMatch(block, /friday-project-grid/);
	assert.doesNotMatch(block, /for \(const project of projects\)/);
	assert.match(block, /this\.renderSyncProjectCard\(containerEl, activeProject\)/);
});

test("sync page exposes ignore management through dedicated integration points", async () => {
	const source = readViewSource();
	assert.match(source, /GitIgnoreService/);
	assert.match(source, /projects\.ignore\.title/);
	assert.match(source, /projects\.ignore\.apply/);
	assert.match(source, /applyIgnoreRule/);
});

test("project conflict proposal no longer calls builtin skill shortcut directly", async () => {
	const source = readViewSource();
	const match = source.match(/private async generateConflictProposal\(projectId: string, filePath: string\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate /);
	assert.ok(match, "generateConflictProposal block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /runBuiltinSkillCommand\(\{/);
	assert.match(block, /executionEventRouter\.routeToRuntime\(/);
	assert.match(block, /executionPlanner\.plan\(/);
	assert.match(block, /executionOrchestrator\.execute\(/);
});

test("sync page renders typed conflict records with accept-local accept-remote and defer actions", async () => {
	const source = readViewSource();
	assert.match(source, /getSyncConflicts\(/);
	assert.match(source, /replaceProjectSyncConflicts\(/);
	assert.match(source, /projects\.conflicts\.type/);
	assert.match(source, /projects\.conflicts\.useOurs/);
	assert.match(source, /projects\.conflicts\.useTheirs/);
	assert.match(source, /projects\.conflicts\.defer/);
	assert.match(source, /expandedConflictKey/);
	assert.doesNotMatch(source, /private async finalizeConflictAction/);
	assert.doesNotMatch(source, /checks\.sync\.finalize/);
});

test("daily board view uses sync and tools page identifiers internally", async () => {
	const source = readViewSource();
	assert.match(source, /private activePage: "chat" \| "sync" \| "tools" = "chat"/);
	assert.match(source, /private renderSyncPage\(containerEl: HTMLElement\): void/);
	assert.match(source, /private renderToolsPage\(containerEl: HTMLElement\): void/);
	assert.doesNotMatch(source, /private activePage: "chat" \| "projects" \| "checks"/);
});

test("sync page exposes inline auto-sync controls for the active project", async () => {
	const source = readViewSource();
	assert.match(source, /private renderSyncAutomationControls\(containerEl: HTMLElement, project: ProjectEntry\): void/);
	assert.match(source, /setSyncMode\(/);
	assert.match(source, /setProjectAutoSync\(/);
	assert.match(source, /projects\.sync\.autoMode/);
	assert.match(source, /projects\.sync\.autoProject/);
});

test("sync page renders working tree change groups and conflict diff comparison blocks", async () => {
	const source = readViewSource();
	assert.match(source, /workingTreeChanges/);
	assert.match(source, /projects\.sync\.changesTitle/);
	assert.match(source, /private renderConflictDiffComparison\(containerEl: HTMLElement, conflict: SyncConflictRecord\): void/);
	assert.match(source, /friday-sync-diff/);
});

test("sync page and sync commands key runtime records by projectId instead of slug", async () => {
	const source = readViewSource();
	assert.match(source, /getSyncConflicts\(project\.projectId\)/);
	assert.match(source, /item\.projectId === project\.projectId/);
	assert.doesNotMatch(source, /getSyncConflicts\(project\.slug\)/);
	assert.doesNotMatch(source, /item\.projectSlug === project\.slug/);
});

test("compile button routes through planner and orchestrator", async () => {
	const source = readViewSource();
	const match = source.match(/private async compileWikiByButton\(\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate /);
	assert.ok(match, "compileWikiByButton block should exist");
	const block = match[1] ?? "";
	assert.doesNotMatch(block, /compileWikiWithStatus\(/);
	assert.match(block, /executionEventRouter\.routeToRuntime\(/);
	assert.match(block, /executionPlanner\.plan\(/);
	assert.match(block, /executionOrchestrator\.execute\(/);
});

test("runtime memory extraction now routes through standardized runtime events", async () => {
	const source = readRuntimeSource();
	assert.match(source, /memory\.extraction_requested/);
	assert.match(source, /dispatchRuntimeEvent\(/);
	assert.match(source, /eventRouter\.route\(/);
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

test("skill cards render review note icons and popovers for builtin skills with change notes", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	assert.match(source, /resolveBuiltinSkillReviewNote\(/);
	assert.match(source, /friday-control-center-item-note-button/);
	assert.match(source, /friday-control-center-item-note-popover/);
	assert.match(source, /setIcon\(noteButton, "info"\)/);
	assert.match(styles, /\.friday-control-center-item-note-button\b/);
	assert.match(styles, /\.friday-control-center-item-note-popover\b/);
	assert.match(styles, /\.friday-control-center-item-note-popover\.is-open\b/);
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

test("chat composer routes mentions through structured composer and resolver instead of legacy path markup", async () => {
	const source = readViewSource();
	assert.match(source, /new MentionComposer\(/);
	assert.match(source, /mentionResolver\.resolve\(/);
	assert.doesNotMatch(source, /private extractMentionedFilePaths\(/);
	assert.doesNotMatch(source, /private stripMentionedFilePaths\(/);
	assert.doesNotMatch(source, /private buildMentionContext\(/);
	assert.doesNotMatch(source, /private attachCurrentFileToDraft\(/);
});

test("@ category labels are localized instead of hardcoded english", async () => {
	const source = readViewSource();
	assert.doesNotMatch(source, /label:\s*"Active Note"/);
	assert.doesNotMatch(source, /label:\s*"Notes"/);
	assert.doesNotMatch(source, /label:\s*"Folders"/);
	assert.match(source, /ai\.mention\.option\.activeNote/);
	assert.match(source, /ai\.mention\.option\.notes/);
	assert.match(source, /ai\.mention\.option\.folders/);
});

test("chat composer styles include visible keyboard focus and inline mention remove affordance", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-mention-composer-editor:focus-within\b/);
	assert.match(styles, /\.friday-mention-item-button:focus-visible\b/);
	assert.match(styles, /\.friday-ai-toolbar-button:focus-visible\b/);
	assert.match(styles, /\.friday-inline-mention-token-remove\b/);
});

test("chat composer layout keeps the editable surface full-width and placeholder bounded inside it", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-mention-composer-root\s*\{[\s\S]*width:\s*100%;/);
	assert.match(styles, /\.friday-mention-composer-editor\s*\{[\s\S]*width:\s*100%;/);
	assert.match(styles, /\.friday-mention-composer-editor \.ProseMirror\s*\{[\s\S]*width:\s*100%;/);
	assert.match(styles, /\.friday-mention-composer-editor\.is-empty::before\s*\{[\s\S]*right:\s*0;/);
});

test("top navigation removes duplicate title tooltips from nav and shell icon buttons", async () => {
	const source = readViewSource();
	const navMatch = source.match(/private addNavButton\([\s\S]*?\): void \{([\s\S]*?)\n\t\}/);
	assert.ok(navMatch, "addNavButton block should exist");
	assert.doesNotMatch(navMatch[1] ?? "", /button\.title\s*=/);

	const iconMatch = source.match(/private createIconButton\([\s\S]*?\): HTMLButtonElement \{([\s\S]*?)\n\t\}/);
	assert.ok(iconMatch, "createIconButton block should exist");
	assert.doesNotMatch(iconMatch[1] ?? "", /button\.title\s*=/);
});

test("top navigation uses icon plus short labels with sync and tools semantic icons", async () => {
	const source = readViewSource();
	assert.match(source, /this\.addNavButton\(containerEl, "chat", this\.t\("nav\.chat", "Chat"\), "message-square"\)/);
	assert.match(source, /this\.addNavButton\(containerEl, "sync", this\.t\("nav\.projects", "Sync"\), "refresh-cw"\)/);
	assert.match(source, /this\.addNavButton\(containerEl, "tools", this\.t\("nav\.checks", "Tools"\), "sliders-horizontal"\)/);

	const navMatch = source.match(/private addNavButton\([\s\S]*?\): void \{([\s\S]*?)\n\t\}/);
	assert.ok(navMatch, "addNavButton block should exist");
	assert.match(navMatch[1] ?? "", /createSpan\(\{ cls: "friday-nav-button-label", text: label \}\)/);

	const styles = readStylesSource();
	assert.match(styles, /\.friday-nav-button-label\b/);
});
