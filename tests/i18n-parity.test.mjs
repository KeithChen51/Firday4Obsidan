/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const zhPath = path.join(projectRoot, "src/i18n/locales/zh-CN.ts");
const enPath = path.join(projectRoot, "src/i18n/locales/en-US.ts");

async function loadLocales() {
	const zh = await jiti.import(zhPath);
	const en = await jiti.import(enPath);
	return {
		zh: zh.zhCNMessages ?? zh.default ?? zh,
		en: en.enUSMessages ?? en.default ?? en,
	};
}

const requiredAgentUxCopy = {
	"ai.intake.preview.local": {
		zh: "FRIDAY 正在响应……",
		en: "FRIDAY is responding...",
	},
	"ai.intake.preview.modelStarted": {
		zh: "FRIDAY 正在理解你的请求……",
		en: "FRIDAY is understanding your request...",
	},
	"ai.intake.preview.retry": {
		zh: "模型连接不稳定，FRIDAY 正在重试。",
		en: "The model connection is unstable. FRIDAY is retrying.",
	},
	"ai.intake.preview.modelExhaustedBeforeIntake": {
		zh: "暂时没能连接到模型。你的消息已保留，但 FRIDAY 还没有开始处理。",
		en: "The model could not be reached for now. Your message was kept, but FRIDAY has not started processing it.",
	},
	"approval.allowExecute": {
		zh: "允许执行",
		en: "Allow execution",
	},
	"approval.reject": {
		zh: "拒绝",
		en: "Reject",
	},
	"approval.chatSummary": {
		zh: "FRIDAY 需要你确认后再继续。",
		en: "FRIDAY needs your confirmation before continuing.",
	},
	"approval.description.exec": {
		zh: "FRIDAY 需要运行一个本地命令来检查结果。",
		en: "FRIDAY needs to run a local command to check the result.",
	},
	"approval.description.external": {
		zh: "FRIDAY 需要访问当前 Obsidian 范围之外的位置。",
		en: "FRIDAY needs to access a location outside the current Obsidian scope.",
	},
	"approval.description.compile": {
		zh: "FRIDAY 需要执行一次会更新资料的整理操作。",
		en: "FRIDAY needs to run an organizing action that will update content.",
	},
	"approval.description.generic": {
		zh: "FRIDAY 需要先确认这个操作，确认后才会继续。",
		en: "FRIDAY needs your confirmation before continuing this action.",
	},
	"approval.composerTitle": {
		zh: "需要你确认后继续",
		en: "Confirm to continue",
	},
	"approval.composerDesc": {
		zh: "FRIDAY 暂停在一个需要你决定的动作上。",
		en: "FRIDAY is paused on an action that needs your decision.",
	},
	"mutation.review.pendingComposer": {
		zh: "已准备好 {count} 个待应用的文件修改，确认后才会写入 Obsidian。",
		en: "FRIDAY has prepared {count} file change(s). They will be written to Obsidian only after you confirm.",
	},
	"mutation.review.applyChanges": {
		zh: "应用修改",
		en: "Apply changes",
	},
	"mutation.review.doNotApply": {
		zh: "不应用",
		en: "Do not apply",
	},
	"mutation.review.applied": {
		zh: "已应用修改。",
		en: "Changes applied.",
	},
	"mutation.review.rejected": {
		zh: "已取消，未写入任何文件。",
		en: "Canceled. No files were written.",
	},
	"mutation.review.noLongerPending": {
		zh: "这次文件修改已经不在待确认状态。",
		en: "This file change is no longer waiting for confirmation.",
	},
	"mutation.review.itemTitle": {
		zh: "准备应用 {count} 个文件修改",
		en: "Ready to apply {count} file change(s)",
	},
	"mutation.review.itemConflictedTitle": {
		zh: "文件修改需要重新确认",
		en: "File changes need review again",
	},
	"mutation.review.itemEmptyTitle": {
		zh: "文件修改",
		en: "File changes",
	},
	"mutation.review.viewFullChanges": {
		zh: "查看完整改动",
		en: "View full changes",
	},
	"mutation.review.hideFullChanges": {
		zh: "收起完整改动",
		en: "Hide full changes",
	},
	"mutation.review.summary": {
		zh: "{count} 个修改待确认，确认后才会写入 Obsidian。",
		en: "{count} change(s) waiting for confirmation. They will be written to Obsidian only after you confirm.",
	},
	"ai.waitingDecision": {
		zh: "等待确认",
		en: "Waiting for confirmation",
	},
};

const forbiddenOrdinaryLocalePhrases = [
	"Allow once",
	"Allow session",
	"Allow always",
	"Tool approval required",
	"model_request",
	"checkpoint",
	"raw reasoning",
	"debug replay",
];

test("zh-CN and en-US locale keys stay in parity", async () => {
	const { zh, en } = await loadLocales();
	const zhKeys = Object.keys(zh).sort();
	const enKeys = Object.keys(en).sort();
	assert.deepEqual(zhKeys, enKeys);
	assert.equal("settings.agent.enableSubagent.name" in zh, false);
	assert.equal("settings.agent.maxSubagentDepth.name" in zh, false);
	assert.equal("ai.runtime.execution.subagentLabel" in zh, false);
});

test("agent UX reset copy has stable zh-CN primary strings and accurate en-US fallbacks", async () => {
	const { zh, en } = await loadLocales();

	for (const [key, expected] of Object.entries(requiredAgentUxCopy)) {
		assert.equal(zh[key], expected.zh, `${key} zh-CN copy`);
		assert.equal(en[key], expected.en, `${key} en-US copy`);
	}
});

test("ordinary locale values do not expose internal approval or runtime labels", async () => {
	const { zh, en } = await loadLocales();
	const values = [
		...Object.entries(zh).map(([key, value]) => ["zh-CN", key, value]),
		...Object.entries(en).map(([key, value]) => ["en-US", key, value]),
	].filter(([, , value]) => typeof value === "string");

	for (const [locale, key, value] of values) {
		for (const phrase of forbiddenOrdinaryLocalePhrases) {
			assert.equal(
				value.toLowerCase().includes(phrase.toLowerCase()),
				false,
				`${locale}.${key} exposes forbidden phrase: ${phrase}`,
			);
		}
	}
});
