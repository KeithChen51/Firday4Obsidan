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

test("zh-CN and en-US locale keys stay in parity", async () => {
	const { zh, en } = await loadLocales();
	const zhKeys = Object.keys(zh).sort();
	const enKeys = Object.keys(en).sort();
	assert.deepEqual(zhKeys, enKeys);
});
