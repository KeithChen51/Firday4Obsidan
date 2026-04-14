import type { InvocationResolution } from "./InvocationResolver";
import type { RuntimeEvent } from "./RuntimeEvent";

export type RuntimeEventRoute =
	| {
			kind: "runtime";
			resolution: Extract<InvocationResolution, { type: "runtime" }>;
	  }
	| {
			kind: "capability";
			capabilityId: "memory.persist";
			payload: Record<string, unknown>;
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
			case "memory.extraction_requested":
				return {
					kind: "capability",
					capabilityId: "memory.persist",
					payload: {
						userPrompt: event.prompt ?? "",
						turnId: String(event.payload?.["turnId"] ?? ""),
					},
				};
			default: {
				throw new Error("Unsupported runtime event.");
			}
		}
	}

	routeToRuntime(event: RuntimeEvent): Extract<InvocationResolution, { type: "runtime" }> {
		const route = this.route(event);
		if (route.kind !== "runtime") {
			throw new Error(`Runtime event ${event.type} does not route to agent runtime.`);
		}
		return route.resolution;
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
					projectSlug: event.projectSlug,
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
