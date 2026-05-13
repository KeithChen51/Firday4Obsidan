import { CapabilityResolver } from "../../core/tool-governor/CapabilityResolver";
import { WIKI_FEATURE_ENABLED } from "../../constants/wikiFeature";
import { findToolManifest } from "../../platform/tools/ToolManifestCatalog";
import type { ObsidianToolHandlers } from "./ObsidianToolHandlers";

export class ObsidianToolAdapter {
	constructor(private readonly handlers: Partial<ObsidianToolHandlers>) {}

	async runToolByName(
		name: string,
		args: Record<string, unknown>,
		agentId: string,
		toolCallId?: string,
	): Promise<unknown> {
		if (name === "use_skill") {
			return this.requireHandler("toolUseSkill")(args, agentId);
		}
		const manifest = findToolManifest(name);
		if (!manifest) {
			throw new Error(`Unsupported tool: ${name}`);
		}

		const resolver = new CapabilityResolver({
			ls: async (payload) => this.requireHandler("toolList")(payload, agentId),
			read: async (payload) => this.requireHandler("toolRead")(payload, agentId),
			read_many: async (payload) => this.requireHandler("toolReadMany")(payload, agentId),
			grep: async (payload) => this.requireHandler("toolGrep")(payload, agentId),
			search_text: async (payload) => this.requireHandler("toolSearchText")(payload, agentId),
			search_and_read: async (payload) => this.requireHandler("toolSearchAndRead")(payload, agentId),
			glob: async (payload) => this.requireHandler("toolGlob")(payload, agentId),
			project_tree: async (payload) => this.requireHandler("toolProjectTree")(payload, agentId),
			canvas_read: async (payload) => this.requireHandler("toolCanvasRead")(payload, agentId),
			canvas_apply: async (payload) => this.requireHandler("toolCanvasApply")(payload, agentId, toolCallId),
			markdown_outline: async (payload) => this.requireHandler("toolMarkdownOutline")(payload, agentId),
			frontmatter_update: async (payload) => this.requireHandler("toolFrontmatterUpdate")(payload, agentId, toolCallId),
			markdown_insert_reference: async (payload) => this.requireHandler("toolMarkdownInsertReference")(payload, agentId, toolCallId),
			validate_canvas: async (payload) => this.requireHandler("toolValidateCanvas")(payload, agentId),
			validate_markdown: async (payload) => this.requireHandler("toolValidateMarkdown")(payload, agentId),
			validate_outputs: async (payload) => this.requireHandler("toolValidateOutputs")(payload, agentId),
			...(WIKI_FEATURE_ENABLED ? { compile_wiki: async (payload) => this.requireHandler("toolCompileWiki")(payload, agentId) } : {}),
			memory: async (payload) => this.requireHandler("toolMemory")(payload, agentId),
			write: async (payload) => this.requireHandler("toolWrite")(payload, agentId, toolCallId),
			edit: async (payload) => this.requireHandler("toolEdit")(payload, agentId, toolCallId),
			delete: async (payload) => this.requireHandler("toolDelete")(payload, agentId, toolCallId),
			exec: async (payload) => this.requireHandler("toolExec")(payload, agentId),
		});

		const handler = resolver.resolve(manifest.name);
		if (!handler) {
			throw new Error(`No capability handler bound for tool: ${manifest.name}`);
		}
		return handler(args, agentId);
	}

	private requireHandler(name: keyof ObsidianToolHandlers): (
		args: Record<string, unknown>,
		agentId: string,
		toolCallId?: string,
	) => Promise<unknown> {
		const handler = this.handlers[name];
		if (typeof handler !== "function") {
			throw new Error(`No Obsidian tool handler bound: ${String(name)}`);
		}
		return handler.bind(this.handlers) as (
			args: Record<string, unknown>,
			agentId: string,
			toolCallId?: string,
		) => Promise<unknown>;
	}
}
