import { TOOL_MANIFESTS, findToolManifest, type ToolManifest } from "../../platform/tools/ToolManifestCatalog";
import type { CapabilityDefinition, InternalCapabilityDefinition, ToolCapabilityDefinition } from "./CapabilityDefinition";

const INTERNAL_CAPABILITIES: InternalCapabilityDefinition[] = [
	{ id: "knowledge.lookup", kind: "internal", userVisible: false },
	{ id: "git.conflict.inspect", kind: "internal", userVisible: false },
	{ id: "git.conflict.propose", kind: "internal", userVisible: false },
	{ id: "project.compileWiki", kind: "internal", userVisible: false },
];

export class CapabilityRegistry {
	private static instance: CapabilityRegistry | null = null;
	private readonly toolCapabilities: ToolCapabilityDefinition[];

	private constructor() {
		this.toolCapabilities = TOOL_MANIFESTS.map((tool) => ({
			...tool,
			id: tool.capability,
			kind: "tool" as const,
			userVisible: true as const,
		}));
	}

	static getInstance(): CapabilityRegistry {
		if (!CapabilityRegistry.instance) {
			CapabilityRegistry.instance = new CapabilityRegistry();
		}
		return CapabilityRegistry.instance;
	}

	listAll(): CapabilityDefinition[] {
		return [...this.toolCapabilities, ...INTERNAL_CAPABILITIES];
	}

	listUserVisibleTools(): ToolManifest[] {
		return this.toolCapabilities.map((tool) => ({
			name: tool.name,
			capability: tool.capability,
			readOnly: tool.readOnly,
			primary: tool.primary,
			relatedSkillCommand: tool.relatedSkillCommand,
		}));
	}

	listInternalCapabilities(): InternalCapabilityDefinition[] {
		return [...INTERNAL_CAPABILITIES];
	}

	findTool(name: string): ToolManifest | null {
		return findToolManifest(name);
	}
}
