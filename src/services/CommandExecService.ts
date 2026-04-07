import { spawn } from "child_process";
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
			throw new Error("命令执行功能未启用，请在设置中开启。");
		}

		const fullCommand = [command, ...args].join(" ");
		this.checkBlocklist(fullCommand, settings.agentRuntime.blockedCommands);

		const timeout = options?.timeout ?? settings.agentRuntime.execTimeout;
		const cwd = this.resolveCwd(options?.cwd);

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
			return customCwd;
		}
		const settings = this.getSettings();
		if (settings.agentRuntime.execWorkingDir === "custom" && settings.agentRuntime.execCustomCwd) {
			return settings.agentRuntime.execCustomCwd;
		}
		return this.getVaultBasePath();
	}

	private checkBlocklist(fullCommand: string, patterns: string[]): void {
		for (const pattern of patterns) {
			try {
				const regex = new RegExp(pattern, "i");
				if (regex.test(fullCommand)) {
					throw new Error(
						`命令被安全黑名单拦截：${fullCommand}\n匹配规则：${pattern}\n如需执行此命令，请在设置中修改命令黑名单。`,
					);
				}
			} catch (error) {
				if (error instanceof Error && error.message.startsWith("命令被安全黑名单拦截")) {
					throw error;
				}
				// Ignore invalid regex patterns silently
			}
		}
	}
}
