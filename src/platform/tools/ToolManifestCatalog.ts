import { ToolRegistry, type ToolManifestContract } from "../../core/tools/ToolRegistry";

export type ToolManifest = ToolManifestContract;

export const TOOL_MANIFESTS: ToolManifest[] = ToolRegistry.getInstance().listManifests();

export function findToolManifest(name: string): ToolManifest | null {
	const normalized = name.trim().toLowerCase();
	if (!normalized) {
		return null;
	}
	return TOOL_MANIFESTS.find((manifest) => manifest.name === normalized) ?? null;
}
