export interface ToolManifest {
	name: string;
	capability: string;
	readOnly: boolean;
	primary: boolean;
	relatedSkillCommand?: string;
}

export const TOOL_MANIFESTS: ToolManifest[] = [
	{ name: "ls", capability: "filesystem.list", readOnly: true, primary: true },
	{ name: "read", capability: "filesystem.read", readOnly: true, primary: true },
	{ name: "grep", capability: "filesystem.search", readOnly: true, primary: true },
	{ name: "search_text", capability: "filesystem.search_text", readOnly: true, primary: true },
	{ name: "glob", capability: "filesystem.glob", readOnly: true, primary: true },
	{ name: "compile_wiki", capability: "knowledge.compile", readOnly: false, primary: true, relatedSkillCommand: "compile-wiki" },
	{ name: "write", capability: "filesystem.write", readOnly: false, primary: true },
	{ name: "edit", capability: "filesystem.patch", readOnly: false, primary: true },
	{ name: "delete", capability: "filesystem.delete", readOnly: false, primary: false },
	{ name: "exec", capability: "system.exec", readOnly: false, primary: false },
	{ name: "subagent", capability: "orchestration.subagent", readOnly: false, primary: false },
];

export function findToolManifest(name: string): ToolManifest | null {
	const normalized = name.trim().toLowerCase();
	if (!normalized) {
		return null;
	}
	return TOOL_MANIFESTS.find((manifest) => manifest.name === normalized) ?? null;
}
