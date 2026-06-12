/* eslint-env node */
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai";

const execFile = promisify(execFileCallback);
const MIN_NODE_MAJOR = 22;

function textFromMessage(message) {
	return (message?.content ?? [])
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("");
}

async function runPiSdkSessionSmoke() {
	const faux = registerFauxProvider({
		tokensPerSecond: 0,
		tokenSize: { min: 1000, max: 1000 },
	});
	let unsubscribe;

	try {
		faux.setResponses([fauxAssistantMessage("FRIDAY desktop PI session ok.")]);
		const events = [];
		const agent = new Agent({
			initialState: {
				model: faux.models[0],
				systemPrompt: "FRIDAY desktop shell smoke.",
			},
		});
		unsubscribe = agent.subscribe((event) => {
			events.push(event);
		});

		await agent.prompt("Run the minimal FRIDAY desktop shell PI session.");

		const finalTurn = events
			.filter((event) => event.type === "turn_end")
			.at(-1);
		const finalText = textFromMessage(finalTurn?.message);

		assert.equal(finalText, "FRIDAY desktop PI session ok.");
		assert.equal(faux.getPendingResponseCount(), 0);
		assert.equal(events.some((event) => event.type === "agent_start"), true);
		assert.equal(events.some((event) => event.type === "agent_end"), true);

		return {
			modelId: faux.models[0].id,
			eventTypes: events.map((event) => event.type),
			finalText,
		};
	} finally {
		unsubscribe?.();
		faux.unregister();
	}
}

async function runShellSmoke() {
	const { stdout } = await execFile(process.execPath, [
		"-e",
		"process.stdout.write('friday-shell-ok')",
	]);
	assert.equal(stdout, "friday-shell-ok");
	return stdout;
}

async function runFileAndLogSmoke() {
	const root = await mkdtemp(path.join(os.tmpdir(), "friday-desktop-shell-smoke-"));
	const dataPath = path.join(root, "project-file.txt");
	const logsDir = path.join(root, "logs");
	const logPath = path.join(logsDir, "friday-desktop.log");

	try {
		await mkdir(logsDir, { recursive: true });
		await writeFile(dataPath, "desktop-shell-file-ok", "utf8");
		const fileContents = await readFile(dataPath, "utf8");
		assert.equal(fileContents, "desktop-shell-file-ok");

		await appendFile(logPath, `${new Date().toISOString()} desktop shell smoke\n`, "utf8");
		const logContents = await readFile(logPath, "utf8");
		assert.match(logContents, /desktop shell smoke/);

		return {
			root,
			dataPath,
			logPath,
		};
	} finally {
		if (process.env.FRIDAY_DESKTOP_SMOKE_KEEP_TEMP !== "1") {
			await rm(root, { force: true, recursive: true });
		}
	}
}

async function main() {
	const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
	assert.ok(
		nodeMajor >= MIN_NODE_MAJOR,
		`Node ${MIN_NODE_MAJOR}+ is required; current runtime is ${process.versions.node}`,
	);

	const pi = await runPiSdkSessionSmoke();
	const shell = await runShellSmoke();
	const files = await runFileAndLogSmoke();
	const summary = {
		node: process.versions.node,
		pi,
		shell,
		files,
	};

	console.log("FRIDAY desktop shell smoke passed");
	console.log(JSON.stringify(summary, null, 2));
}

await main();
