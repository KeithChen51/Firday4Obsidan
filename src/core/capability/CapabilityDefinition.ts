import type { ToolManifest } from "../../platform/tools/ToolManifestCatalog";

export interface InternalCapabilityDefinition {
	id: string;
	kind: "internal";
	userVisible: false;
}

export interface ToolCapabilityDefinition extends ToolManifest {
	id: string;
	kind: "tool";
	userVisible: true;
}

export type CapabilityDefinition = InternalCapabilityDefinition | ToolCapabilityDefinition;
