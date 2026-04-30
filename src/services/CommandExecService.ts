import { spawn } from "child_process";
import path from "path";
import { CapabilityPolicy } from "../core/policy/CapabilityPolicy";
import { FridaySettings } from "../types/settings";

const MAX_EXEC_OUTPUT_CHARS = 8000;

export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	truncated: boolean;
	timedOut: boolean;
	command: string;
	args: string[];
}

export class CommandExecService {
	constructor(
		private readonly getVaultBasePath: () => string,
		private readonly getSettings: () => FridaySettings,
	) {}

	async exec(
		command: string,
		args: string[] = [],
		options?: { cwd?: string; timeout?: number; stdin?: string },
	): Promise<ExecResult> {
		const settings = this.getSettings();

		if (!settings.agentRuntime.enableExecTool) {
			throw new Error("Exec command execution is disabled. Enable it in settings first.");
		}

		const timeout = options?.timeout ?? settings.agentRuntime.execTimeout;
		const cwd = this.resolveCwd(options?.cwd);
		const policyDecision = new CapabilityPolicy().evaluateExecRequest({
			agentMode: "debug",
			enableExecTool: settings.agentRuntime.enableExecTool,
			command,
			args,
			cwd,
			workspaceRoot: this.getVaultBasePath(),
		});
		if (!policyDecision.allow) {
			throw new Error(this.formatPolicyDenyReason(policyDecision.code, policyDecision.reason));
		}

		const fullCommand = [command, ...args].join(" ");
		this.checkBlocklist(fullCommand, settings.agentRuntime.blockedCommands);

		return new Promise<ExecResult>((resolve) => {
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			let killed = false;

			const child = spawn(command, args, {
				cwd,
				shell: false,
				timeout: 0,
				windowsHide: true,
				env: { ...process.env },
			});

			const timer = setTimeout(() => {
				timedOut = true;
				killed = true;
				child.kill("SIGTERM");
				setTimeout(() => {
					if (!child.killed) {
						child.kill("SIGKILL");
					}
				}, 2000);
			}, timeout);

			if (options?.stdin) {
				child.stdin.write(options.stdin);
				child.stdin.end();
			}

			child.stdout.on("data", (data: Buffer) => {
				stdout += data.toString("utf8");
				if (stdout.length > MAX_EXEC_OUTPUT_CHARS * 2) {
					stdout = stdout.slice(0, MAX_EXEC_OUTPUT_CHARS * 2);
				}
			});

			child.stderr.on("data", (data: Buffer) => {
				stderr += data.toString("utf8");
				if (stderr.length > MAX_EXEC_OUTPUT_CHARS) {
					stderr = stderr.slice(0, MAX_EXEC_OUTPUT_CHARS);
				}
			});

			child.on("close", (code: number | null) => {
				clearTimeout(timer);
				const truncatedStdout = stdout.length > MAX_EXEC_OUTPUT_CHARS;
				const truncatedStderr = stderr.length > MAX_EXEC_OUTPUT_CHARS;
				resolve({
					exitCode: code ?? (killed ? 137 : 1),
					stdout: stdout.slice(0, MAX_EXEC_OUTPUT_CHARS),
					stderr: stderr.slice(0, MAX_EXEC_OUTPUT_CHARS),
					truncated: truncatedStdout || truncatedStderr,
					timedOut,
					command,
					args,
				});
			});

			child.on("error", (err: Error) => {
				clearTimeout(timer);
				resolve({
					exitCode: 1,
					stdout: "",
					stderr: err.message,
					truncated: false,
					timedOut: false,
					command,
					args,
				});
			});
		});
	}

	private resolveCwd(customCwd?: string): string {
		if (customCwd) {
			return path.resolve(customCwd);
		}
		const settings = this.getSettings();
		if (settings.agentRuntime.execWorkingDir === "custom" && settings.agentRuntime.execCustomCwd) {
			return path.resolve(settings.agentRuntime.execCustomCwd);
		}
		return path.resolve(this.getVaultBasePath());
	}

	private formatPolicyDenyReason(code: string, reason: string): string {
		if (code === "exec_cwd_outside_workspace") {
			return `Exec denied: cwd is outside workspace. ${reason}`;
		}
		if (code === "exec_not_allowlisted") {
			return `Exec denied by debug-profile allowlist. ${reason}`;
		}
		return `Exec denied: ${reason}`;
	}

	private checkBlocklist(fullCommand: string, patterns: string[]): void {
		for (const pattern of patterns) {
			try {
				const regex = new RegExp(pattern, "i");
				if (regex.test(fullCommand)) {
					throw new Error(
						`Exec command was blocked by the configured command blocklist: ${fullCommand}\nMatched rule: ${pattern}`,
					);
				}
			} catch (error) {
				if (error instanceof Error && error.message.startsWith("Exec command was blocked")) {
					throw error;
				}
				// Ignore invalid regex patterns silently.
			}
		}
	}
}
