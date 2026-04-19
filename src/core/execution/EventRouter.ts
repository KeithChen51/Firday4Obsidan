import type { InvocationResolution } from "./InvocationResolver";
import type { RuntimeEvent } from "./RuntimeEvent";

export type RuntimeEventRoute =
	{
		kind: "runtime";
		resolution: Extract<InvocationResolution, { type: "runtime" }>;
	};

export class EventRouter {
	route(event: RuntimeEvent): RuntimeEventRoute {
		switch (event.type) {
			case "knowledge.compile_requested":
				return {
					kind: "runtime",
					resolution: this.buildSkillRuntimeResolution(
						event,
						"Compile the active project wiki now.",
						"compile-wiki",
					),
				};
			case "sync.conflict_proposal_requested":
				return {
					kind: "runtime",
					resolution: this.buildSkillRuntimeResolution(
						event,
						event.prompt?.trim() || String(event.payload?.["filePath"] ?? "").trim(),
						"resolve-conflict",
					),
				};
			default: {
				throw new Error("Unsupported runtime event.");
			}
		}
	}

	routeToRuntime(event: RuntimeEvent): Extract<InvocationResolution, { type: "runtime" }> {
		return this.route(event).resolution;
	}

	private buildSkillRuntimeResolution(
		event: RuntimeEvent,
		runtimePrompt: string,
		skillName: string,
	): Extract<InvocationResolution, { type: "runtime" }> {
		return {
			type: "runtime",
			invocation: {
				request: {
					source: event.source,
					intentType: "event",
					targetId: event.type,
					prompt: runtimePrompt,
					payload: event.payload,
					projectId: event.projectId,
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
}
