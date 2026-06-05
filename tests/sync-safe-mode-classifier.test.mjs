/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const gitErrorModulePath = path.join(projectRoot, "src/platform/git/classifyGitError.ts");
const i18nModulePath = path.join(projectRoot, "src/i18n/index.ts");
const runtimeStoreModulePath = path.join(projectRoot, "src/features/sync/SyncRuntimeStore.ts");
const eventBusModulePath = path.join(projectRoot, "src/features/sync/SyncEventBus.ts");

async function loadGitErrorModule() {
	return jiti.import(gitErrorModulePath);
}

async function loadI18nModule() {
	return jiti.import(i18nModulePath);
}

test("safe sync classifier maps network errors to a non-retrying network condition", async () => {
	const { classifyGitError, formatClassifiedGitError } = await loadGitErrorModule();
	const { translate } = await loadI18nModule();

	const classified = classifyGitError("fatal: unable to access 'https://example.com/repo.git/': Could not resolve host: example.com");

	assert.equal(classified.kind, "offline");
	assert.equal(classified.condition, "network_unavailable");
	assert.equal(classified.shouldAutoRetry, false);
	assert.equal(classified.messageKey, "projects.sync.safeMessage.networkUnavailable");
	assert.equal(classified.recoveryActionKey, "projects.sync.safeRecovery.networkUnavailable");
	assert.equal(
		formatClassifiedGitError(classified, (key) => translate("zh-CN", key)),
		"网络连接有问题，本地修改已保留。检查网络连接后重新检查同步状态。",
	);
	assert.equal(
		formatClassifiedGitError(classified, (key) => translate("en-US", key)),
		"Network connection issue. Local changes were kept. Check your network connection, then check sync status again.",
	);
	assert.match(classified.technicalMessage, /could not resolve host/i);
});

test("safe sync classifier maps unreachable remotes separately from network failures", async () => {
	const { classifyGitError, formatClassifiedGitError } = await loadGitErrorModule();
	const { translate } = await loadI18nModule();

	const classified = classifyGitError("remote: Repository not found.\nfatal: repository 'https://example.com/missing.git/' not found");

	assert.equal(classified.kind, "blocked");
	assert.equal(classified.condition, "remote_unreachable");
	assert.equal(classified.messageKey, "projects.sync.safeMessage.remoteUnreachable");
	assert.equal(classified.recoveryActionKey, "projects.sync.safeRecovery.remoteUnreachable");
	assert.equal(
		formatClassifiedGitError(classified, (key) => translate("en-US", key)),
		"Remote repository is unreachable. Local changes were kept. Confirm the remote URL, or update it in project settings.",
	);
});

test("safe sync classifier covers all external sync conditions with localized user-safe messages", async () => {
	const { classifyGitError, formatClassifiedGitError } = await loadGitErrorModule();
	const { translate } = await loadI18nModule();
	const cases = [
		{
			error: "fatal: Authentication failed for 'https://example.com/repo.git/'",
			condition: "auth_required",
			message: "需要重新授权，本地修改已保留。",
			enMessage: "Authorization is required. Local changes were kept.",
		},
		{
			error: "remote: Permission to owner/repo.git denied to user.\nfatal: unable to access: The requested URL returned error: 403",
			condition: "permission_denied",
			message: "当前账号没有访问这个仓库的权限，本地修改已保留。",
			enMessage: "The current account cannot access this repository. Local changes were kept.",
		},
		{
			error: "! [rejected] master -> master (fetch first)\nUpdates were rejected because the remote contains work that you do not have locally.",
			condition: "remote_updated",
			message: "远端有新内容，正在合并后继续。",
			enMessage: "Remote updates were found. FRIDAY is merging them before continuing.",
		},
		{
			error: "There is no tracking information for the current branch.",
			condition: "branch_untracked",
			message: "正在连接远端分支。",
			enMessage: "Connecting the remote branch.",
		},
		{
			error: "fatal: the requested upstream branch 'origin/master' does not exist",
			condition: "branch_missing",
			message: "当前分支还没有远端副本，正在创建。",
			enMessage: "This branch does not have a remote copy yet. FRIDAY is creating one.",
		},
		{
			error: "remote: error: GH006: Protected branch update failed for refs/heads/main.\nremote: error: Changes must be made through a pull request.",
			condition: "remote_policy_blocked",
			message: "远端规则不允许直接同步，本地修改已保留。",
			enMessage: "Remote rules block direct sync. Local changes were kept.",
		},
		{
			error: "remote: error: File data.zip is 152.00 MB; this exceeds GitHub's file size limit of 100.00 MB",
			condition: "remote_file_rejected",
			message: "有文件不符合远端规则，本地修改已保留。",
			enMessage: "A file does not meet remote rules. Local changes were kept.",
		},
		{
			error: "CONFLICT (content): Merge conflict in workspace/a.md\nAutomatic merge failed; fix conflicts and then commit the result.",
			condition: "content_conflict",
			message: "已保留双方版本。",
			enMessage: "Both versions were kept.",
		},
		{
			error: "Stash pop recovery failed: conflict after restore.",
			condition: "stash_restore_conflict",
			message: "已保留本地修改，正在生成安全副本。",
			enMessage: "Local changes were kept. FRIDAY is creating a safe copy.",
		},
		{
			error: "git: command not found",
			condition: "git_runtime_unavailable",
			message: "当前电脑无法执行同步，本地修改未丢失。",
			enMessage: "This computer cannot run sync right now. Local changes were not lost.",
		},
		{
			error: "Error: ENOSPC: no space left on device, write 'workspace/a.md'",
			condition: "local_filesystem_blocked",
			message: "本地文件暂时无法写入，请检查权限或磁盘空间。",
			enMessage: "Local files cannot be written right now. Check permissions or disk space.",
		},
		{
			error: "fatal: Unable to create '.git/index.lock': File exists.",
			condition: "repository_state_blocked",
			message: "当前仓库状态需要修复，本地修改已保留。",
			enMessage: "The repository state needs repair. Local changes were kept.",
		},
		{
			error: "fatal: unable to access 'https://example.com/repo.git/': The requested URL returned error: 503",
			condition: "remote_service_unavailable",
			message: "远端服务暂时不可用，本地修改已保留。",
			enMessage: "The remote service is temporarily unavailable. Local changes were kept.",
		},
		{
			error: "fatal: an unknown git failure happened",
			condition: "unknown_external",
			message: "同步没有完成，本地修改已保留。",
			enMessage: "Sync did not complete. Local changes were kept.",
		},
	];

	for (const item of cases) {
		const classified = classifyGitError(item.error);
		assert.equal(classified.condition, item.condition, item.condition);
		assert.match(classified.messageKey, /^projects\.sync\.safeMessage\./, item.condition);
		assert.match(classified.recoveryActionKey, /^projects\.sync\.safeRecovery\./, item.condition);
		assert.equal(formatClassifiedGitError(classified, (key) => translate("zh-CN", key)).startsWith(item.message), true, item.condition);
		assert.equal(formatClassifiedGitError(classified, (key) => translate("en-US", key)).startsWith(item.enMessage), true, item.condition);
		assert.equal(classified.technicalMessage, item.error, item.condition);
		assert.doesNotMatch(formatClassifiedGitError(classified, (key) => translate("en-US", key)), /fatal|error:|rejected|CONFLICT/i, item.condition);
	}
});

test("safe sync classifier does not own user-facing localized copy", async () => {
	const source = fs.readFileSync(gitErrorModulePath, "utf8");
	assert.doesNotMatch(source, /网络连接有问题|本地修改已保留|远端仓库不可访问|Authorization is required|Local changes were kept/);
	assert.match(source, /messageKey/);
	assert.match(source, /recoveryActionKey/);
});

test("sync runtime store keeps the safe condition and user-facing message after failed sync", async () => {
	const [{ SyncRuntimeStore }, { SyncEventBus }] = await Promise.all([
		jiti.import(runtimeStoreModulePath),
		jiti.import(eventBusModulePath),
	]);
	const bus = new SyncEventBus();
	const store = new SyncRuntimeStore(bus);

	bus.emit({
		type: "sync_started",
		projectId: "alpha",
		recordedAt: "2026-06-02T00:00:00.000Z",
	});
	bus.emit({
		type: "sync_completed",
		projectId: "alpha",
		success: false,
		error: "remote: Repository not found.",
		recordedAt: "2026-06-02T00:00:01.000Z",
	});

	const state = store.getProjectState("alpha");
	assert.equal(state.stage, "blocked");
	assert.equal(state.condition, "remote_unreachable");
	assert.equal(state.message, "");
	assert.equal(state.messageKey, "projects.sync.safeMessage.remoteUnreachable");
	assert.equal(state.recoveryAction, "");
	assert.equal(state.recoveryActionKey, "projects.sync.safeRecovery.remoteUnreachable");
	assert.equal(state.technicalMessage, "remote: Repository not found.");
});
