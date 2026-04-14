export interface ConflictProposalInput {
	filePath: string;
	localSnippet: string;
	remoteSnippet: string;
}

export interface ConflictProposal {
	recommendedStrategy: "ours" | "theirs" | "manual";
	markdown: string;
}

export function buildConflictProposal(input: ConflictProposalInput): ConflictProposal {
	let recommendedStrategy: ConflictProposal["recommendedStrategy"] = "manual";
	if (input.localSnippet.trim() === input.remoteSnippet.trim()) {
		recommendedStrategy = "ours";
	} else if (!input.localSnippet.trim() && input.remoteSnippet.trim()) {
		recommendedStrategy = "theirs";
	} else if (input.localSnippet.trim() && !input.remoteSnippet.trim()) {
		recommendedStrategy = "ours";
	}

	const markdown = [
		"# Fix Proposal",
		"",
		"## 冲突摘要",
		`- **文件**: ${input.filePath}`,
		"- **冲突类型**: 逻辑冲突",
		"",
		"## 意图分析",
		"",
		"### 本地修改意图",
		input.localSnippet.trim() || "(empty)",
		"",
		"### 远端修改意图",
		input.remoteSnippet.trim() || "(empty)",
		"",
		"## 合并策略",
		`推荐策略：${recommendedStrategy}`,
	].join("\n");

	return {
		recommendedStrategy,
		markdown,
	};
}
