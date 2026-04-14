import type { RuntimeProfile } from "../../platform/runtime/RuntimeProfile";
import type { RuntimeExecutionGateCode } from "../../types/agent";
import type { FridaySettings } from "../../types/settings";
import type { ResolvedInvocation } from "./ResolvedInvocation";

export interface ExecutionGateDecision {
	allow: boolean;
	code: RuntimeExecutionGateCode;
	reason: string;
}

export class ExecutionGate {
	constructor(private readonly getSettings: () => FridaySettings) {}

	evaluate(invocation: ResolvedInvocation, runtimeProfile: RuntimeProfile): ExecutionGateDecision {
		const settings = this.getSettings().agentRuntime;
		if (invocation.requiresRuntime && !settings.toolRuntimeEnabled) {
			return this.deny(
				"runtime_disabled",
				`Runtime execution is disabled for source=${invocation.request.source}.`,
			);
		}

		const normalizedId = this.normalize(invocation.resolvedId);
		const disabledSkills = new Set((settings.disabledSkills ?? []).map((item) => this.normalize(item)).filter(Boolean));
		const disabledTools = new Set((settings.disabledTools ?? []).map((item) => this.normalize(item)).filter(Boolean));

		if (invocation.resolvedType === "skill" && disabledSkills.has(normalizedId)) {
			return this.deny("skill_disabled", `Skill ${invocation.resolvedId} is disabled.`);
		}

		if (invocation.resolvedType === "tool" && disabledTools.has(normalizedId)) {
			return this.deny("tool_disabled", `Tool ${invocation.resolvedId} is disabled.`);
		}

		for (const capability of invocation.requiredCapabilities ?? []) {
			const normalizedCapability = this.normalize(capability);
			if (disabledTools.has(normalizedCapability)) {
				return this.deny(
					"capability_disabled",
					`Capability ${capability} is disabled by tool policy.`,
				);
			}
			if (normalizedCapability === "exec") {
				if (!settings.enableExecTool) {
					return this.deny("exec_disabled", "Exec capability is disabled in settings.");
				}
				if (!runtimeProfile.capabilities.supportsExecTool) {
					return this.deny(
						"exec_unsupported",
						`Exec capability is unsupported on runtime profile ${runtimeProfile.id}.`,
					);
				}
			}
			if (normalizedCapability === "subagent") {
				if (!settings.enableSubagent) {
					return this.deny("subagent_disabled", "Subagent capability is disabled in settings.");
				}
				if (!runtimeProfile.capabilities.supportsSubagent) {
					return this.deny(
						"subagent_unsupported",
						`Subagent capability is unsupported on runtime profile ${runtimeProfile.id}.`,
					);
				}
			}
		}

		return {
			allow: true,
			code: "allowed",
			reason: "Invocation passed service-level execution gate.",
		};
	}

	private deny(code: RuntimeExecutionGateCode, reason: string): ExecutionGateDecision {
		return {
			allow: false,
			code,
			reason,
		};
	}

	private normalize(value: string): string {
		return value.trim().toLowerCase();
	}
}
