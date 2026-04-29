import { TOOL_MANIFESTS, findToolManifest, type ToolManifest } from "../../platform/tools/ToolManifestCatalog";
import { WIKI_FEATURE_ENABLED, WIKI_INTERNAL_CAPABILITIES } from "../../constants/wikiFeature";
import type { CapabilityDefinition, InternalCapabilityDefinition, ToolCapabilityDefinition } from "./CapabilityDefinition";

const ALL_INTERNAL_CAPABILITIES: InternalCapabilityDefinition[] = [
	{ id: "knowledge.lookup", kind: "internal", userVisible: false },
	{ id: "git.conflict.inspect", kind: "internal", userVisible: false },
	{ id: "git.conflict.propose", kind: "internal", userVisible: false },
	{ id: "project.compileWiki", kind: "internal", userVisible: false },
];

const INTERNAL_CAPABILITIES: InternalCapabilityDefinition[] = ALL_INTERNAL_CAPABILITIES.filter(
	(capability) => WIKI_FEATURE_ENABLED || !WIKI_INTERNAL_CAPABILITIES.has(capability.id),
);

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
