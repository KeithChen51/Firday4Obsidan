/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const scriptPath = path.join(projectRoot, "scripts", "resolve-publish-remote.mjs");

async function loadModule() {
	return import(pathToFileURL(scriptPath).href);
}

test("publish remote resolver prefers explicit remote inputs over ambient environment variables", async () => {
	const mod = await loadModule();
	const previousPublishRemoteUrl = process.env.PUBLISH_REMOTE_URL;
	try {
		process.env.PUBLISH_REMOTE_URL = "https://devops.byd.com/QCSHFW/houshichangjiazhifazhanbu/F.R.I.D.A.Y.git";
		assert.equal(
			mod.resolvePublishRemote({
				remoteUrl: "https://devops.byd.com/QCSHFW/lin.zixuan/Friday.git",
				token: "token-123",
			}),
			"https://oauth2:token-123@devops.byd.com/QCSHFW/lin.zixuan/Friday.git",
		);
	} finally {
		if (previousPublishRemoteUrl === undefined) {
			delete process.env.PUBLISH_REMOTE_URL;
		} else {
			process.env.PUBLISH_REMOTE_URL = previousPublishRemoteUrl;
		}
	}
});

test("publish remote resolver injects token into https origin urls", async () => {
	const mod = await loadModule();
	assert.equal(
		mod.resolvePublishRemote({
			remoteUrl: "https://devops.byd.com/QCSHFW/lin.zixuan/Friday.git",
			token: "token-123",
		}),
		"https://oauth2:token-123@devops.byd.com/QCSHFW/lin.zixuan/Friday.git",
	);
});

test("publish remote resolver converts ssh origin urls into tokenized https urls", async () => {
	const mod = await loadModule();
	assert.equal(
		mod.resolvePublishRemote({
			remoteUrl: "git@devops.byd.com:QCSHFW/lin.zixuan/Friday.git",
			token: "token-123",
		}),
		"https://oauth2:token-123@devops.byd.com/QCSHFW/lin.zixuan/Friday.git",
	);
});

test("publish remote resolver lets an explicit publish remote override origin", async () => {
	const mod = await loadModule();
	assert.equal(
		mod.resolvePublishRemote({
			remoteUrl: "https://devops.byd.com/ignored/source.git",
			token: "token-123",
			publishRemoteUrl: "https://devops.byd.com/official/release-target.git",
		}),
		"https://oauth2:token-123@devops.byd.com/official/release-target.git",
	);
});
