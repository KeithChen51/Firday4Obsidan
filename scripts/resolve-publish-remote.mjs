import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

function getOriginRemoteUrl() {
	return execFileSync("git", ["remote", "get-url", "origin"], {
		encoding: "utf8",
	}).trim();
}

function toHttpsRemote(remoteUrl) {
	const trimmed = remoteUrl.trim();
	if (!trimmed) {
		throw new Error("Missing git remote url");
	}

	if (/^https?:\/\//i.test(trimmed)) {
		return trimmed;
	}

	const sshUrlMatch = trimmed.match(/^ssh:\/\/(?:.+@)?([^/]+)\/(.+)$/i);
	if (sshUrlMatch) {
		const [, host, repoPath] = sshUrlMatch;
		return `https://${host}/${repoPath}`;
	}

	const scpStyleMatch = trimmed.match(/^[^@]+@([^:]+):(.+)$/i);
	if (scpStyleMatch) {
		const [, host, repoPath] = scpStyleMatch;
		return `https://${host}/${repoPath}`;
	}

	const gitProtocolMatch = trimmed.match(/^git:\/\/([^/]+)\/(.+)$/i);
	if (gitProtocolMatch) {
		const [, host, repoPath] = gitProtocolMatch;
		return `https://${host}/${repoPath}`;
	}

	throw new Error(`Unsupported git remote url: ${trimmed}`);
}

export function resolvePublishRemote({
	remoteUrl,
	publishRemoteUrl,
	token = process.env.PUBLISH_TOKEN,
} = {}) {
	if (!token?.trim()) {
		throw new Error("Missing PUBLISH_TOKEN");
	}

	const baseRemoteUrl = publishRemoteUrl?.trim()
		|| remoteUrl?.trim()
		|| process.env.PUBLISH_REMOTE_URL?.trim()
		|| getOriginRemoteUrl();
	const tokenizedUrl = new URL(toHttpsRemote(baseRemoteUrl));
	tokenizedUrl.username = "oauth2";
	tokenizedUrl.password = token;
	return tokenizedUrl.toString();
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const scriptPath = fileURLToPath(import.meta.url);

if (entryPath === scriptPath) {
	try {
		console.log(resolvePublishRemote({ remoteUrl: process.argv[2] }));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error ?? "Unknown publish remote resolution failure"));
		process.exitCode = 1;
	}
}
