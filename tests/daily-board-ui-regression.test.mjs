/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const viewPath = path.join(projectRoot, "src/views/DailyBoardView.ts");
const chatMessageSegmentsPath = path.join(projectRoot, "src/views/chatMessageSegments.ts");
const conversationIngressPath = path.join(projectRoot, "src/core/chat/ConversationIngressService.ts");
const activeFilePolicyPath = path.join(projectRoot, "src/core/context/ActiveFileContext.ts");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");
const toolHandlersPath = path.join(projectRoot, "src/services/tools/ObsidianToolHandlers.ts");
const skillServicePath = path.join(projectRoot, "src/services/SkillCommandService.ts");
const builtinSkillPath = path.join(projectRoot, "src/skills/packs/builtin/index.ts");
const stylesPath = path.join(projectRoot, "styles.css");
const zhLocalePath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en-US.ts");

function readViewSource() {
	return fs.readFileSync(viewPath, "utf8").replace(/\r\n?/g, "\n");
}

function readChatMessageSegmentsSource() {
	return fs.readFileSync(chatMessageSegmentsPath, "utf8").replace(/\r\n?/g, "\n");
}

function readConversationIngressSource() {
	return fs.readFileSync(conversationIngressPath, "utf8").replace(/\r\n?/g, "\n");
}

function readActiveFilePolicySource() {
	return fs.readFileSync(activeFilePolicyPath, "utf8").replace(/\r\n?/g, "\n");
}

function readRuntimeSource() {
	return fs.readFileSync(runtimePath, "utf8").replace(/\r\n?/g, "\n");
}

function readToolHandlersSource() {
	return fs.readFileSync(toolHandlersPath, "utf8").replace(/\r\n?/g, "\n");
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

test("daily board view switches souls instead of agent identities", async () => {
	const source = readViewSource();
	assert.match(source, /private async switchSoul\(soulId: string\): Promise<void>/);
	assert.doesNotMatch(source, /private async switchAgent\(agentId: string\): Promise<void>/);
	assert.match(source, /this\.plugin\.settings\.activeSoulId/);
	assert.doesNotMatch(source, /this\.plugin\.settings\.activeAgentId/);
	assert.doesNotMatch(source, /this\.plugin\.getActiveAgent\(/);
	assert.doesNotMatch(source, /this\.plugin\.settings\.agents/);
	assert.doesNotMatch(source, /"切换 Soul"/);
	assert.doesNotMatch(source, /switchSoulFailed/);
	assert.match(source, /switchAgentFailed/);
});

test("session drawer supports search and date-grouped browsing", async () => {
	const source = readViewSource();
	assert.match(source, /aiSessionSearchQuery/);
	assert.match(source, /friday-ai-session-search/);
	assert.match(source, /buildSessionGroups\(/);
	assert.match(source, /friday-ai-session-group-label/);
	assert.match(source, /ai\.sessions\.search\.placeholder/);
});

test("session drawer search input lays out the icon beside the text instead of overlaying it", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-ai-session-search-wrap\s*\{[^}]*grid-template-columns:\s*14px minmax\(0,\s*1fr\);/);
	assert.match(styles, /\.friday-ai-session-search-wrap\s*\{[^}]*column-gap:\s*8px;/);
	assert.doesNotMatch(styles, /\.friday-ai-session-search-icon\s*\{[^}]*position:\s*absolute;/);
	assert.doesNotMatch(styles, /\.friday-ai-session-search\s*\{[^}]*padding-left:\s*40px;/);
});

test("session drawer search input avoids native search chrome when rendering a custom icon", async () => {
	const source = readViewSource();
	const match = source.match(/const searchInput = searchWrap\.createEl\("input", \{[\s\S]*?attr:\s*\{([\s\S]*?)\}\s*,?[\s\S]*?\}\);/);
	assert.ok(match, "session search input definition should exist");
	assert.doesNotMatch(match[1] ?? "", /type:\s*"search"/);
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
	const handlersSource = readToolHandlersSource();
	assert.doesNotMatch(source, /suggestSkillsForPrompt\(/);
	assert.match(source, /extraSystemContext\?\.includes\("\[SkillInvocation\]"\)/);
	assert.match(source, /ObsidianToolAdapter/);
	assert.match(handlersSource, /async toolUseSkill\(/);
	assert.match(handlersSource, /invocationMode:\s*"auto"/);
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

test("tools page hides exec from user-visible tool controls", async () => {
	const source = readViewSource();
	const match = source.match(/private renderToolControlSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate createAvailabilityToggle/);
	assert.ok(match, "renderToolControlSection block should exist");
	const block = match[1] ?? "";

	assert.match(block, /isUserVisibleRuntimeTool/);
	assert.match(source, /private isUserVisibleRuntimeTool\(toolName: string\): boolean \{/);
	assert.match(source, /toolName !== "exec"/);
	assert.doesNotMatch(block, /tool\.name === "exec"/);
	assert.doesNotMatch(block, /exec: "Run shell commands/);
});

test("pending approvals occupy the composer body instead of only a transcript card", async () => {
	const source = readViewSource();
	const renderMatch = source.match(/private renderAiPage\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate getComposerTaskBarView/);
	assert.ok(renderMatch, "renderAiPage block should exist");
	const renderBlock = renderMatch[1] ?? "";
	const syncMatch = source.match(/private syncComposerDecisionPanel\(\): void \{([\s\S]*?)\n\t\}\n\n\tprivate syncAiComposerControls/);
	assert.ok(syncMatch, "syncComposerDecisionPanel block should exist");
	const syncBlock = syncMatch[1] ?? "";
	const inputMatch = source.match(/private renderComposerInput\(parent: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderComposerDecisionPanel/);
	assert.ok(inputMatch, "renderComposerInput block should exist");
	const inputBlock = inputMatch[1] ?? "";
	const composerIndex = renderBlock.indexOf('const composerEl = composerWrap.createDiv({ cls: "friday-ai-composer" });');
	const bodyHostIndex = renderBlock.indexOf("this.aiComposerBodyEl = composerEl;", composerIndex);
	const decisionSyncIndex = renderBlock.indexOf("this.syncComposerDecisionPanel();", bodyHostIndex);
	const toolbarIndex = renderBlock.indexOf('const toolbarEl = composerWrap.createDiv({ cls: "friday-ai-composer-toolbar" });');

	assert.ok(composerIndex >= 0, "composer body should still be created");
	assert.ok(bodyHostIndex > composerIndex, "composer body should be saved as the decision host");
	assert.ok(decisionSyncIndex > bodyHostIndex, "approval decision panel sync should run against the composer body");
	assert.ok(toolbarIndex > decisionSyncIndex, "composer chrome should remain after the body branch");
	assert.match(syncBlock, /this\.renderComposerDecisionPanel\(this\.aiComposerBodyEl/);
	assert.match(syncBlock, /this\.renderComposerInput\(this\.aiComposerBodyEl\)/);
	assert.match(inputBlock, /this\.composer = new MentionComposer/);
	assert.doesNotMatch(renderBlock, /this\.renderEditPlanReviewPanel\(chatShellEl\)/);
});

test("composer approval body keeps model permission skill and context chrome available", async () => {
	const source = readViewSource();
	const renderMatch = source.match(/private renderAiPage\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate getComposerTaskBarView/);
	assert.ok(renderMatch, "renderAiPage block should exist");
	const renderBlock = renderMatch[1] ?? "";
	const syncMatch = source.match(/private syncComposerDecisionPanel\(\): void \{([\s\S]*?)\n\t\}\n\n\tprivate syncAiComposerControls/);
	assert.ok(syncMatch, "syncComposerDecisionPanel block should exist");
	const syncBlock = syncMatch[1] ?? "";

	assert.match(renderBlock, /this\.syncComposerDecisionPanel\(\)/);
	assert.match(syncBlock, /this\.renderComposerDecisionPanel\(this\.aiComposerBodyEl/);
	assert.match(renderBlock, /const modelSelectHost = toolbarEl\.createSpan\(\{ cls: "friday-ai-toolbar-select-host is-model" \}\)/);
	assert.match(renderBlock, /cls: "friday-ai-toolbar-select-button kit-control-button-v1"/);
	assert.match(renderBlock, /setIcon\(modelSelectIcon, "settings-2"\)/);
	assert.match(renderBlock, /this\.openAiToolbarChoiceMenu\(/);
	assert.doesNotMatch(renderBlock, /const modelSelect = modelSelectHost\.createEl\("select"/);
	assert.match(renderBlock, /const permissionSelectHost = toolbarEl\.createSpan\(\{ cls: "friday-ai-toolbar-select-host is-permission" \}\)/);
	assert.match(renderBlock, /setIcon\(permissionSelectIcon, "shield"\)/);
	assert.doesNotMatch(renderBlock, /const permissionSelect = permissionSelectHost\.createEl\("select"/);
	assert.doesNotMatch(source, /🚀|🛡|🔒/);
	assert.match(renderBlock, /text: this\.t\("ai\.skill\.button", "\+Skill"\)/);
	assert.match(renderBlock, /text: "@"/);
});

test("pending approvals keep strong visual in composer while chat uses a low-emphasis record", async () => {
	const source = readViewSource();
	const renderListMatch = source.match(/private renderAiMessageList\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate shouldRenderAgentTaskPanel/);
	assert.ok(renderListMatch, "renderAiMessageList block should exist");
	const renderListBlock = renderListMatch[1] ?? "";
	const approvalMessageMatch = source.match(/private renderApprovalMessage\(containerEl: HTMLElement, item: PendingApproval\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderRuntimeExecutionPreview/);
	assert.ok(approvalMessageMatch, "renderApprovalMessage block should exist");
	const approvalMessageBlock = approvalMessageMatch[1] ?? "";

	assert.match(source, /friday-composer-decision-panel/);
	assert.match(renderListBlock, /renderApprovalMessage\(containerEl, item\)/);
	assert.doesNotMatch(renderListBlock, /renderApprovalCard\(/);
	assert.match(approvalMessageBlock, /friday-ai-approval-record kit-event-row-v1/);
	assert.match(approvalMessageBlock, /kit-event-row-v1/);
	assert.doesNotMatch(approvalMessageBlock, /friday-approval-card/);
	assert.doesNotMatch(approvalMessageBlock, /friday-ai-approval-message/);
	assert.doesNotMatch(approvalMessageBlock, /friday-ai-approval-title/);
	assert.doesNotMatch(approvalMessageBlock, /renderAssistantAvatar/);
});

test("retired approval transcript classes are removed from source and styles", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	const retiredApprovalClasses = [
		"friday-inline-approval-panel",
		"friday-ai-approval-message",
		"friday-ai-approval-content",
		"friday-ai-approval-title",
		"friday-ai-approval-summary",
		"friday-ai-approval-detail-text",
		"friday-ai-approval-actions",
	];

	for (const className of retiredApprovalClasses) {
		assert.doesNotMatch(source, new RegExp(className), `${className} should not appear in DailyBoard source`);
		assert.doesNotMatch(styles, new RegExp(`\\.${className}\\b`), `${className} should not have CSS`);
	}
	assert.match(source, /friday-ai-approval-record kit-event-row-v1/);
	assert.match(source, /friday-ai-approval-record-summary/);
	assert.match(source, /friday-ai-approval-record-detail/);
});

test("retired frontend component classes are removed from Daily Board source and CSS", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	const retiredSourceClasses = [
		"friday-agent-process-shell",
		"friday-agent-process-panel",
		"friday-agent-process-disclosure",
	];
	const retiredStyleClasses = [
		"friday-kanban-columns",
		"friday-kanban-column",
		"friday-task-card",
		"friday-card",
		"friday-plugin-update-prerequisites-list",
		"friday-plugin-update-prereq-line",
		"friday-project-settings-toolbar",
		"friday-ai-mention-pill-bar",
		"friday-ai-mention-pill",
		"friday-ai-mention-pill-remove",
		"friday-ai-message-badges",
		"friday-ai-message-detail",
		"friday-agent-artifact-body",
		"friday-agent-artifact-diff-summary",
		"friday-agent-artifact-diff-file",
	];

	for (const className of retiredSourceClasses) {
		assert.doesNotMatch(source, new RegExp(className), `${className} should not appear in DailyBoard source`);
	}
	for (const className of retiredStyleClasses) {
		assert.doesNotMatch(styles, new RegExp(`\\.${className}\\b`), `${className} should not keep CSS`);
	}
	assert.match(styles, /\.assistant-artifact-row-v4\b/);
	assert.match(styles, /\.friday-mention-composer-root\b/);
});

test("ordinary approval cards expose only user-level allow or reject decisions", async () => {
	const source = readViewSource();
	const cardMatch = source.match(/private renderApprovalCard\(containerEl: HTMLElement, item: PendingApproval\): void \{([\s\S]*?)\n\t\}\n\n\tprivate addApprovalDecisionButton/);
	assert.ok(cardMatch, "renderApprovalCard block should exist");
	const cardBlock = cardMatch[1] ?? "";

	assert.match(cardBlock, /approval\.allowExecute/);
	assert.match(cardBlock, /approval\.reject/);
	assert.doesNotMatch(cardBlock, /approval\.allowSession|approval\.allowAlways|approval\.allowOnce/);
	assert.doesNotMatch(cardBlock, /\$\{item\.request\.tool\}/);
});

test("ordinary approval cards explain the specific consequence and target", async () => {
	const source = readViewSource();
	const describeMatch = source.match(/private describeApprovalRequest\(item: PendingApproval\): string \{([\s\S]*?)\n\t\}\n\n\tprivate addApprovalDecisionButton/);
	assert.ok(describeMatch, "describeApprovalRequest block should exist");
	const describeBlock = describeMatch[1] ?? "";

	assert.match(describeBlock, /item\.request\.description/);
	assert.match(describeBlock, /item\.request\.targetPath/);
	assert.match(describeBlock, /approval\.description\.withTarget/);
	assert.doesNotMatch(describeBlock, /高风险操作/);
});

test("runtime elapsed timer does not keep refreshing while waiting for a user decision", async () => {
	const source = readViewSource();
	const timerBlock = source.match(/private scheduleRuntimeElapsedTimer\(\): void \{([\s\S]*?)\n\t\}\n\n\tprivate clearRuntimeElapsedTimer/);
	assert.ok(timerBlock, "scheduleRuntimeElapsedTimer block should exist");
	const helperBlock = source.match(/private shouldRefreshRuntimeElapsed\(snapshot: AgentTrajectorySnapshot \| null\): boolean \{([\s\S]*?)\n\t\}\n\n\tprivate scheduleRuntimeElapsedTimer/);
	assert.ok(helperBlock, "shouldRefreshRuntimeElapsed helper should exist");

	assert.match(timerBlock[1] ?? "", /shouldRefreshRuntimeElapsed/);
	assert.match(helperBlock[1] ?? "", /snapshot\.status === "running"/);
	assert.doesNotMatch(helperBlock[1] ?? "", /waiting_for_approval|waiting_for_user/);
});

test("mutation review uses pending-language buttons and notices", async () => {
	const source = readViewSource();
	const itemMatch = source.match(/private renderEditPlanReviewItem\(containerEl: HTMLElement, plan: EditPlanRecord\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderEditPlanDiffPreview/);
	assert.ok(itemMatch, "renderEditPlanReviewItem block should exist");
	const itemBlock = itemMatch[1] ?? "";

	assert.match(itemBlock, /mutation\.review\.applyChanges/);
	assert.match(itemBlock, /mutation\.review\.doNotApply/);
	assert.match(itemBlock, /mutation\.review\.applied/);
	assert.match(itemBlock, /mutation\.review\.conflictedNotice/);
	assert.match(itemBlock, /mutation\.review\.rejected/);
	assert.doesNotMatch(itemBlock, /"Apply"/);
	assert.doesNotMatch(itemBlock, /"Reject"/);
});

test("mutation review exposes an inline full-change review instead of only truncated preview", async () => {
	const source = readViewSource();
	const itemMatch = source.match(/private renderEditPlanReviewItem\(containerEl: HTMLElement, plan: EditPlanRecord\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderEditPlanDiffPreview/);
	assert.ok(itemMatch, "renderEditPlanReviewItem block should exist");
	const itemBlock = itemMatch[1] ?? "";
	const fullDiffMatch = source.match(/private renderEditPlanFullDiff\(containerEl: HTMLElement, before: string, after: string\): void \{([\s\S]*?)\n\t\}\n\n\tprivate addMutationReviewButton/);
	assert.ok(fullDiffMatch, "renderEditPlanFullDiff block should exist");
	const fullDiffBlock = fullDiffMatch[1] ?? "";

	assert.match(itemBlock, /mutation\.review\.viewFullChanges/);
	assert.match(itemBlock, /mutation\.review\.hideFullChanges/);
	assert.match(itemBlock, /renderEditPlanFullDiff\(fullReviewEl, firstItem\.before, firstItem\.after\)/);
	assert.match(fullDiffBlock, /maxLines:\s*Number\.MAX_SAFE_INTEGER/);
	assert.match(fullDiffBlock, /friday-mutation-review-full/);
	assert.doesNotMatch(itemBlock, /new\s+\w+Modal|window\.confirm|window\.prompt/);
});

test("mutation review actions stay clickable while the agent is waiting on that decision", async () => {
	const source = readViewSource();
	const itemMatch = source.match(/private renderEditPlanReviewItem\(containerEl: HTMLElement, plan: EditPlanRecord\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderEditPlanDiffPreview/);
	assert.ok(itemMatch, "renderEditPlanReviewItem block should exist");
	const itemBlock = itemMatch[1] ?? "";
	const actionGuardMatch = source.match(/private getActionablePendingEditPlan\(planId: string\): EditPlanRecord \| null \{([\s\S]*?)\n\t\}\n\n\tprivate getReviewableEditPlan/);
	assert.ok(actionGuardMatch, "mutation review actions should re-check the current session plan before applying or rejecting");
	const actionGuardBlock = actionGuardMatch[1] ?? "";
	const reviewGuardMatch = source.match(/private getReviewableEditPlan\(planId: string\): EditPlanRecord \| null \{([\s\S]*?)\n\t\}\n\n\tprivate renderEditPlanReviewItem/);
	assert.ok(reviewGuardMatch, "mutation review should allow conflicted plans to be dismissed");
	const reviewGuardBlock = reviewGuardMatch[1] ?? "";

	assert.match(itemBlock, /const canApply = plan\.items\.some\(\(item\) => item\.status === "pending"\)/);
	assert.match(itemBlock, /const canDismiss = plan\.items\.some\(\(item\) => item\.status === "pending" \|\| item\.status === "conflicted"\)/);
	assert.match(itemBlock, /getActionablePendingEditPlan\(plan\.id\)/);
	assert.match(itemBlock, /getReviewableEditPlan\(plan\.id\)/);
	assert.doesNotMatch(itemBlock, /this\.aiBusy/);
	assert.match(actionGuardBlock, /this\.getPendingEditPlans\(\)\.find/);
	assert.match(actionGuardBlock, /item\.status === "pending"/);
	assert.match(reviewGuardBlock, /item\.status === "pending" \|\| item\.status === "conflicted"/);
});

test("composer mutation review only blocks on current-session reviewable edit plans", async () => {
	const source = readViewSource();
	const pendingMatch = source.match(/private getPendingEditPlans\(\): EditPlanRecord\[] \{([\s\S]*?)\n\t\}\n\n\tprivate hasPendingComposerDecision/);
	assert.ok(pendingMatch, "getPendingEditPlans block should exist");
	const pendingBlock = pendingMatch[1] ?? "";
	const sessionMatch = source.match(/private isCurrentSessionEditPlan\(plan: EditPlanRecord\): boolean \{([\s\S]*?)\n\t\}\n\n\tprivate getPendingEditPlans/);
	assert.ok(sessionMatch, "isCurrentSessionEditPlan block should exist");
	const sessionBlock = sessionMatch[1] ?? "";

	assert.match(pendingBlock, /filter\(\(plan\) => this\.isCurrentSessionEditPlan\(plan\)\)/);
	assert.match(pendingBlock, /item\.status === "pending"/);
	assert.match(pendingBlock, /items: plan\.items\.filter\(\(item\) => item\.status === "pending" \|\| item\.status === "conflicted"\)/);
	assert.match(sessionBlock, /this\.aiSessionId\.trim\(\)/);
	assert.match(sessionBlock, /plan\.originConversationId\?\.trim\(\)/);
	assert.match(sessionBlock, /originConversationId === currentSessionId/);
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

test("runtime now loads memory directly from the memory v1 store", async () => {
	const source = readRuntimeSource();
	const handlersSource = readToolHandlersSource();
	assert.match(source, /memoryStore\.readPromptContext\(/);
	assert.match(source, /ObsidianToolAdapter/);
	assert.match(handlersSource, /async toolMemory\(/);
	assert.doesNotMatch(source, /memory\.extraction_requested/);
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

test("skill review note popovers float at viewport level and track dynamic placement", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	assert.match(source, /computeSkillReviewNotePopoverLayout/);
	assert.match(source, /ownerDocument\.body\.appendChild\(popover\)/);
	assert.match(source, /popover\.dataset\.placement/);
	assert.match(source, /const frozenAnchor = noteButton\.getBoundingClientRect\(\)/);
	assert.match(source, /const frozenViewport = \{/);
	assert.doesNotMatch(source, /ownerDocument\.addEventListener\("scroll", updatePopoverPosition, true\)/);
	assert.match(styles, /\.friday-control-center-item-note-popover\s*\{[\s\S]*position:\s*fixed;/);
	assert.match(styles, /\.friday-control-center-item-note-popover\s*\{[\s\S]*overflow-y:\s*auto;/);
	assert.match(styles, /\.friday-control-center-item-note-popover\[data-placement="top"\]\s*\{/);
	assert.match(styles, /\.friday-control-center-item-note-popover\[data-placement="right"\]\s*\{/);
	assert.match(styles, /\.friday-control-center-item-note-popover\[data-placement="left"\]\s*\{/);
});

test("skill descriptions can prefer chinese localized metadata", async () => {
	const serviceSource = readSkillServiceSource();
	const builtinSource = readBuiltinSkillSource();
	assert.match(serviceSource, /descriptionzh|description_zh|description_cn/i);
	assert.match(serviceSource, /getLocale/);
	assert.match(builtinSource, /descriptionZh:/);
});

test("skill names render without Skill slash prefixes across ordinary Daily Board surfaces", async () => {
	const source = readViewSource();
	const segmentSource = readChatMessageSegmentsSource();
	const messageMetaMatch = source.match(/private buildUserMessageUiMeta\([\s\S]*?\): ChatMessageUiMeta \| undefined \{([\s\S]*?)\n\t\}\n\n\tprivate formatMentionBadgeLabel/);
	assert.ok(messageMetaMatch, "buildUserMessageUiMeta block should exist");
	const messageMetaBlock = messageMetaMatch[1] ?? "";
	const skillItemMatch = source.match(/private renderSkillControlItem\([\s\S]*?\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSkillReviewNote/);
	assert.ok(skillItemMatch, "renderSkillControlItem block should exist");
	const skillItemBlock = skillItemMatch[1] ?? "";
	const catalogMatch = source.match(/private buildSkillCatalogReply\(skills: SkillDescriptor\[\]\): string \{([\s\S]*?)\n\t\}\n\n\tprivate getComposerSnapshot/);
	assert.ok(catalogMatch, "buildSkillCatalogReply block should exist");
	const catalogBlock = catalogMatch[1] ?? "";
	const relationMatch = source.match(/private resolveToolSkillRelationship\(tool: ToolManifest\): string \{([\s\S]*?)\n\t\}\n\n\tprivate formatSkillDisplayName/);
	assert.ok(relationMatch, "resolveToolSkillRelationship block should exist");
	const relationBlock = relationMatch[1] ?? "";

	assert.match(source, /private formatSkillDisplayName\(command: string\): string/);
	assert.match(source, /import \{ buildUserMessageSegments \} from "\.\/chatMessageSegments"/);
	assert.match(messageMetaBlock, /buildUserMessageSegments\(\{/);
	assert.match(messageMetaBlock, /formatSkillDisplayName:\s*\(command\) => this\.formatSkillDisplayName\(command\)/);
	assert.match(messageMetaBlock, /formatMentionBadgeLabel:\s*\(entry\) => this\.formatMentionBadgeLabel\(entry\)/);
	assert.doesNotMatch(source, /private buildUserMessageSegments\(/);
	assert.doesNotMatch(source, /private normalizeUserMessageSegments\(/);
	assert.match(segmentSource, /label:\s*input\.formatSkillDisplayName\(skillName\)/);
	assert.match(skillItemBlock, /text:\s*this\.formatSkillDisplayName\(skill\.command\)/);
	assert.match(catalogBlock, /this\.formatSkillDisplayName\(skill\.command\)/);
	assert.match(relationBlock, /policy\.tools\.relation\.sameNameSkillNative/);
	assert.doesNotMatch(segmentSource, /Skill \//);
	assert.doesNotMatch(skillItemBlock, /`\/\$\{skill\.command\}`/);
	assert.doesNotMatch(catalogBlock, /`- \/\$\{skill\.command\}/);
	assert.doesNotMatch(relationBlock, /policy\.tools\.relation\.sameNameSkill"/);
});

test("control center uses Native Kit tool and skill icons without per-capability icons", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	const toolMatch = source.match(/private renderToolControlSection\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate isUserVisibleRuntimeTool/);
	assert.ok(toolMatch, "renderToolControlSection block should exist");
	const toolBlock = toolMatch[1] ?? "";
	const skillItemMatch = source.match(/private renderSkillControlItem\([\s\S]*?\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderSkillReviewNote/);
	assert.ok(skillItemMatch, "renderSkillControlItem block should exist");
	const skillItemBlock = skillItemMatch[1] ?? "";

	assert.match(toolBlock, /const titleRow = meta\.createDiv\(\{ cls: "friday-control-center-item-title-row" \}\)/);
	assert.match(toolBlock, /kit-tool-icon-v1/);
	assert.match(skillItemBlock, /kit-skill-icon-v1/);
	assert.match(toolBlock, /setIcon\(iconEl, "arrow-right"\)/);
	assert.match(skillItemBlock, /setIcon\(iconEl, "layout-grid"\)/);
	assert.doesNotMatch(toolBlock, /setIcon\(iconEl, "wrench"\)/);
	assert.doesNotMatch(skillItemBlock, /setIcon\(iconEl, "blocks"\)/);
	assert.doesNotMatch(toolBlock, /setIcon\([^,]+,\s*tool\.name/);
	assert.doesNotMatch(skillItemBlock, /setIcon\([^,]+,\s*skill\.command/);
	assert.match(styles, /\.kit-tool-icon-v1,\s*\n\.kit-skill-icon-v1\s*\{/);
	assert.match(styles, /\.friday-shell \.friday-control-center-item-title-row \.kit-tool-icon-v1,\s*\n\.friday-shell \.friday-control-center-item-title-row \.kit-skill-icon-v1\s*\{/);
});

test("slash and mention dropdown floats above composer without resizing it", async () => {
	const styles = readStylesSource();
	const dropdownBlock = styles.match(/\.friday-mention-dropdown\s*\{([\s\S]*?)\}/)?.[1] ?? "";
	const composerRootBlock = styles.match(/\.friday-mention-composer-root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
	assert.match(composerRootBlock, /position:\s*relative;/);
	assert.match(composerRootBlock, /overflow:\s*visible;/);
	assert.match(dropdownBlock, /position:\s*absolute;/);
	assert.match(dropdownBlock, /bottom:\s*calc\(100%\s*\+\s*8px\);/);
	assert.match(dropdownBlock, /z-index:\s*30;/);
	assert.doesNotMatch(dropdownBlock, /position:\s*static;/);
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

test("chat submit uses explicit active-file context policy instead of naked active editor path", async () => {
	const source = readViewSource();
	const ingressSource = readConversationIngressSource();
	const match = source.match(/private async submitAiPrompt\([^)]*\): Promise<void> \{([\s\S]*?)\n\t\}\n\n\tprivate async compileWikiByButton/);
	assert.ok(match, "submitAiPrompt block should exist");
	const block = match[1] ?? "";
	assert.match(block, /createActiveFileContext\(draftDocument, rawPrompt, activeFilePath\)/);
	assert.match(block, /createConversationIngressPayload\(\{/);
	assert.match(ingressSource, /resolveActiveFileContextPolicy\(/);
	assert.match(block, /activeFileContext/);
	assert.doesNotMatch(block, /const currentFilePath = this\.app\.workspace\.getActiveFile\(\)\?\.path \?\? ""/);
	assert.doesNotMatch(block, /executionPlanner\.plan\(resolution, \{ currentFilePath \}\)/);
	assert.doesNotMatch(block, /currentFilePath,\s*\n\s*mentionContext/);
});

test("active-file process metadata can explain explicit mention, deictic reference, and command sources", async () => {
	const source = readViewSource();
	const policySource = readActiveFilePolicySource();
	assert.match(policySource, /"@ 当前笔记"/);
	assert.match(policySource, /"用户明确指代当前文档"/);
	assert.match(source, /"命令指定"/);
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

test("chat composer context button shows compact @ label while retaining accessible text", async () => {
	const source = readViewSource();
	const match = source.match(/const attachButton = toolbarEl\.createEl\("button", \{([\s\S]*?)\}\);/);
	assert.ok(match, "context attach button should exist");
	assert.match(match[1] ?? "", /text:\s*"@"/);
	assert.match(source, /attachButton\.setAttribute\("aria-label", this\.t\("ai\.attach\.contextButton", "@ Add context"\)\)/);
	assert.match(source, /attachButton\.title = this\.t\("ai\.attach\.contextButton", "@ Add context"\)/);
});

test("chat composer styles include visible keyboard focus and inline mention remove affordance", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-mention-composer-editor:focus-within\b/);
	assert.match(styles, /\.friday-mention-item-button:focus-visible\b/);
	assert.match(styles, /\.friday-ai-toolbar-button:focus-visible\b/);
	assert.match(styles, /\.friday-inline-mention-token-remove\b/);
	assert.match(styles, /\.friday-inline-mention-token\.is-skill\b/);
	assert.match(styles, /\.friday-inline-mention-token\.is-context\b/);
	assert.match(styles, /\.friday-ai-composer button\.friday-inline-mention-token-remove\s*\{[\s\S]*min-width:\s*12px;/);
});

test("slash skill suggestions are inserted as removable tokens instead of plain text", async () => {
	const source = readViewSource();
	const suggestionsMatch = source.match(/private async buildComposerSuggestions\(query: MentionComposerQuery\): Promise<MentionSuggestion\[\]> \{([\s\S]*?)\n\t\}\n\n\tprivate buildMentionSuggestionItems/);
	assert.ok(suggestionsMatch, "buildComposerSuggestions block should exist");
	const suggestionsBlock = suggestionsMatch[1] ?? "";
	const skillBranchMatch = suggestionsBlock.match(/if \(item\.kind === "skill" && item\.command\) \{([\s\S]*?)\n\t\t\t\t\}\n\t\t\t\treturn \{/);
	assert.ok(skillBranchMatch, "skill suggestion branch should exist");
	const skillBranchBlock = skillBranchMatch[1] ?? "";

	assert.match(source, /kind === "skill"/);
	assert.match(source, /this\.createMentionToken\("skill", item\.command\)/);
	assert.match(source, /trigger:\s*"\/"\s+as const,[\s\S]*token:\s*this\.createMentionToken\("skill", item\.command\)/);
	assert.match(skillBranchBlock, /label:\s*this\.formatSkillDisplayName\(item\.command\)/);
	assert.doesNotMatch(skillBranchBlock, /label:\s*`\/\$\{this\.formatSkillDisplayName\(item\.command\)\}`/);
	assert.doesNotMatch(skillBranchBlock, /label:\s*item\.label/);
});

test("chat model selector groups openai and group models under source headers instead of repeating long prefixes", async () => {
	const source = readViewSource();
	assert.match(source, /private buildGroupedModelOptions\(/);
	assert.match(source, /friday-ai-toolbar-choice-group/);
	assert.match(source, /openAiToolbarChoiceMenu/);
	assert.match(source, /OpenAI协议/);
	assert.match(source, /集团集采/);
	assert.doesNotMatch(source, /text:\s*optionValue\.label/);
});

test("chat composer layout keeps the editable surface full-width and placeholder bounded inside it", async () => {
	const styles = readStylesSource();
	assert.match(styles, /\.friday-mention-composer-root\s*\{[\s\S]*width:\s*100%;/);
	assert.match(styles, /\.friday-mention-composer-editor\s*\{[\s\S]*width:\s*100%;/);
	assert.match(styles, /\.friday-mention-composer-editor \.ProseMirror\s*\{[\s\S]*width:\s*100%;/);
	assert.match(styles, /\.friday-mention-composer-editor\.is-empty::before\s*\{[\s\S]*right:\s*0;/);
});

test("queue and temporary override bars use Native Kit low-emphasis event rows", async () => {
	const source = readViewSource();
	const syncQueueMatch = source.match(/private syncAiQueueHint\(\): void \{([\s\S]*?)\n\t\}\n\n\tprivate syncComposerDecisionPanel/);
	assert.ok(syncQueueMatch, "syncAiQueueHint block should exist");
	const syncQueueBlock = syncQueueMatch[1] ?? "";
	const queueMatch = source.match(/private renderAiQueueHint\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderAiOverrideBar/);
	assert.ok(queueMatch, "renderAiQueueHint block should exist");
	const queueBlock = queueMatch[1] ?? "";
	const overrideMatch = source.match(/private renderAiOverrideBar\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate resolveUserDisplayName/);
	assert.ok(overrideMatch, "renderAiOverrideBar block should exist");
	const overrideBlock = overrideMatch[1] ?? "";

	assert.match(syncQueueBlock, /friday-ai-queue-hint kit-event-row-v1/);
	assert.match(syncQueueBlock, /friday-ai-queue-pill kit-soft-chip-v1/);
	assert.match(queueBlock, /friday-ai-queue-hint kit-event-row-v1/);
	assert.match(queueBlock, /friday-ai-queue-pill kit-soft-chip-v1/);
	assert.match(overrideBlock, /friday-ai-override-bar kit-event-row-v1/);
	assert.match(overrideBlock, /friday-ai-override-clear kit-control-button-v1/);
});

test("workbench top bar keeps brand lockup project selector and compact native-kit action buttons", async () => {
	const source = readViewSource();
	const headerMatch = source.match(/private renderShellHeader\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate renderTopNav/);
	assert.ok(headerMatch, "renderShellHeader block should exist");
	const headerBlock = headerMatch[1] ?? "";
	const iconButtonMatch = source.match(/private createIconButton\([\s\S]*?\): HTMLButtonElement \{([\s\S]*?)\n\t\}\n\n\tprivate renderToolsPage/);
	assert.ok(iconButtonMatch, "createIconButton block should exist");
	const iconButtonBlock = iconButtonMatch[1] ?? "";

	assert.match(headerBlock, /friday-shell-project-mark/);
	assert.match(headerBlock, /friday-shell-project-brand friday-wordmark/);
	assert.match(headerBlock, /friday-shell-project-select/);
	assert.match(iconButtonBlock, /button\.addClass\("kit-control-button-v1"\)/);
	assert.doesNotMatch(headerBlock, /friday-shell-hero-icon|friday-shell-icon-container/);
});

test("workbench shell header keeps a stable height when page content scrolls", async () => {
	const styles = readStylesSource();
	const headerMatches = Array.from(styles.matchAll(/\.friday-shell > \.friday-shell-header\s*\{([\s\S]*?)\}/g));
	const headerMatch = headerMatches.at(-1);
	assert.ok(headerMatch, "live shell header correction block should exist");
	const headerBlock = headerMatch[1] ?? "";

	assert.match(headerBlock, /flex:\s*0\s+0\s+42px;/);
	assert.match(headerBlock, /box-sizing:\s*border-box;/);
	assert.match(headerBlock, /height:\s*42px;/);
	assert.match(headerBlock, /min-height:\s*42px;/);
});

test("chat message meta uses the configured display name for user messages and FRIDAY avatar for assistant messages", async () => {
	const source = readViewSource();
	assert.match(source, /private renderAssistantAvatar\(containerEl: HTMLElement\): void/);
	assert.match(source, /friday-ai-message-avatar/);
	assert.match(source, /setIcon\(avatarEl,\s*FRIDAY_ICON_ID\)/);
	assert.doesNotMatch(source, /resolveUserBadgeLabel/);
	assert.match(source, /private resolveUserDisplayName\(\): string/);
	assert.match(source, /this\.plugin\.settings\.user\.displayName/);
	assert.match(source, /text: this\.resolveUserDisplayName\(\)/);
	assert.match(source, /renderAgentAnswerFlow/);
	assert.match(source, /renderAssistantAvatar: \(metaEl\) => this\.renderAssistantAvatar\(metaEl\)/);
	assert.match(source, /this\.t\("ai\.role\.userFallback", "用户"\)/);
});

test("chat header omits redundant focus and capability summary copy", async () => {
	const source = readViewSource();
	const styles = readStylesSource();
	const match = source.match(/private renderAiPage\(containerEl: HTMLElement\): void \{([\s\S]*?)\n\t\}\n\n\tprivate async populateControlCenter/);
	assert.ok(match, "renderAiPage block should exist");
	const block = match[1] ?? "";
	assert.match(block, /this\.t\("ai\.session\.new", "\+ 新会话"\)/);
	assert.doesNotMatch(block, /ai\.focus\.label/);
	assert.doesNotMatch(block, /ai\.focus\.caption/);
	assert.doesNotMatch(block, /friday-ai-focus-eyebrow/);
	assert.doesNotMatch(block, /friday-ai-focus-caption/);
	assert.doesNotMatch(block, /getModelCapability\(effectiveModel \|\| undefined\)/);
	assert.doesNotMatch(styles, /\.friday-ai-focus-eyebrow\b/);
	assert.doesNotMatch(styles, /\.friday-ai-focus-caption\b/);
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
