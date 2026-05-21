import { getRuntimeCapabilityMatrix, RuntimeCapabilityMatrix } from "./CapabilityMatrix";

export type RuntimeProfileId = "windows-desktop" | "mac-desktop" | "linux-desktop" | "unsupported";

export interface RuntimeProfile {
	id: RuntimeProfileId;
	platform: string;
	supported: boolean;
	shell: "powershell" | "zsh" | "bash" | "unknown";
	capabilities: RuntimeCapabilityMatrix;
}

export function detectRuntimeProfile(platformOverride?: string): RuntimeProfile {
	const runtimePlatform = (platformOverride ?? detectPlatform()).toLowerCase();
	if (runtimePlatform === "win32") {
		return {
			id: "windows-desktop",
			platform: runtimePlatform,
			supported: true,
			shell: "powershell",
			capabilities: getRuntimeCapabilityMatrix("windows-desktop"),
		};
	}
	if (runtimePlatform === "darwin") {
		return {
			id: "mac-desktop",
			platform: runtimePlatform,
			supported: true,
			shell: "zsh",
			capabilities: getRuntimeCapabilityMatrix("mac-desktop"),
		};
	}
	if (runtimePlatform === "linux") {
		return {
			id: "linux-desktop",
			platform: runtimePlatform,
			supported: true,
			shell: "bash",
			capabilities: getRuntimeCapabilityMatrix("linux-desktop"),
		};
	}
	return {
		id: "unsupported",
		platform: runtimePlatform,
		supported: false,
		shell: "unknown",
		capabilities: getRuntimeCapabilityMatrix("unsupported"),
	};
}

function detectPlatform(): string {
	const globalProcess = globalThis as { process?: { platform?: string } };
	return globalProcess.process?.platform ?? "unknown";
}
