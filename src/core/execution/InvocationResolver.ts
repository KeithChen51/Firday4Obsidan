import type { ParsedSkillSlashCommand } from "../../services/SkillCommandService";
import type { SlashCommandExpandResult } from "../../services/SlashCommandService";
import type { InvocationRequest } from "./InvocationRequest";
import type { ResolvedInvocation } from "./ResolvedInvocation";

interface InvocationResolverDeps {
	parseSkillSlashCommand: (rawPrompt: string) => ParsedSkillSlashCommand;
	expandSlashCommand: (rawPrompt: string) => SlashCommandExpandResult;
	isCompileIntent: (rawPrompt: string) => boolean;
}

export type InvocationResolution =
	| { type: "invalid"; error: string }
	| { type: "catalog" }
	| {
			type: "runtime";
			invocation: ResolvedInvocation;
			runtimePrompt: string;
			requestedSkillName?: string;
			allowedTools?: string[];
			allowedModels?: string[];
	  };

export class InvocationResolver {
	constructor(private readonly deps: InvocationResolverDeps) {}

	resolveChatPrompt(rawPrompt: string): InvocationResolution {
		const skillCommand = this.deps.parseSkillSlashCommand(rawPrompt);
		if (skillCommand.type === "invalid") {
			return { type: "invalid", error: skillCommand.error };
		}
		if (skillCommand.type === "list") {
			return { type: "catalog" };
		}
		if (skillCommand.type === "use") {
			return this.buildRuntimeResolution("slash_skill", skillCommand.taskPrompt, skillCommand.skillName);
		}

		const slashExpansion = this.deps.expandSlashCommand(rawPrompt);
		if (slashExpansion.type === "invalid") {
			return { type: "invalid", error: slashExpansion.error };
		}
		if (slashExpansion.type === "expanded") {
			return {
				type: "runtime",
				invocation: this.buildInvocationRequest("slash_command", "runtime", slashExpansion.prompt),
				runtimePrompt: slashExpansion.prompt,
				allowedTools: slashExpansion.allowedTools,
				allowedModels: slashExpansion.allowedModels,
			};
		}

		if (this.deps.isCompileIntent(rawPrompt)) {
			return this.buildRuntimeResolution("auto_skill_match", rawPrompt, "compile-wiki");
		}

		return {
			type: "runtime",
			invocation: this.buildInvocationRequest("chat_prompt", "runtime", rawPrompt),
			runtimePrompt: rawPrompt.trim(),
		};
	}

	resolveProjectConflictProposal(projectSlug: string, filePath: string): InvocationResolution {
		return {
			type: "runtime",
			invocation: {
				request: {
					source: "project_action",
					intentType: "skill",
					targetId: "resolve-conflict",
					projectSlug,
					prompt: filePath,
				},
				resolvedType: "runtime",
				resolvedId: "agent-runtime-turn",
				requiresRuntime: true,
				requiredCapabilities: [],
			},
			runtimePrompt: filePath,
			requestedSkillName: "resolve-conflict",
		};
	}

	resolveProjectCompile(projectSlug?: string): InvocationResolution {
		const prompt = "Compile the active project wiki now.";
		return {
			type: "runtime",
			invocation: {
				request: {
					source: "project_action",
					intentType: "skill",
					targetId: "compile-wiki",
					projectSlug,
					prompt,
				},
				resolvedType: "runtime",
				resolvedId: "agent-runtime-turn",
				requiresRuntime: true,
				requiredCapabilities: [],
			},
			runtimePrompt: prompt,
			requestedSkillName: "compile-wiki",
		};
	}

	private buildRuntimeResolution(
		source: InvocationRequest["source"],
		runtimePrompt: string,
		skillName: string,
	): InvocationResolution {
		return {
			type: "runtime",
			invocation: {
				request: {
					source,
					intentType: "skill",
					targetId: skillName,
					prompt: runtimePrompt,
				},
				resolvedType: "runtime",
				resolvedId: "agent-runtime-turn",
				requiresRuntime: true,
				requiredCapabilities: [],
			},
			runtimePrompt,
			requestedSkillName: skillName,
		};
	}

	private buildInvocationRequest(
		source: InvocationRequest["source"],
		intentType: InvocationRequest["intentType"],
		prompt: string,
	): ResolvedInvocation {
		return {
			request: {
				source,
				intentType,
				prompt: prompt.trim(),
			},
			resolvedType: "runtime",
			resolvedId: "agent-runtime-turn",
			requiresRuntime: true,
			requiredCapabilities: [],
		};
	}
}
