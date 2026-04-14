export interface RelationGraphDocument {
	title: string;
	wikiPath: string;
	keywords: string[];
	content: string;
}

export interface RelationGraphNode {
	id: string;
	path: string;
	title: string;
}

export interface RelationGraphEdge {
	from: string;
	to: string;
	label: string;
}

export interface RelationGraph {
	nodes: RelationGraphNode[];
	edges: RelationGraphEdge[];
}

export function buildRelationGraph(documents: RelationGraphDocument[]): RelationGraph {
	const nodes: RelationGraphNode[] = documents.map((doc) => ({
		id: doc.wikiPath,
		path: doc.wikiPath,
		title: doc.title,
	}));
	const byTitle = new Map<string, RelationGraphNode>();
	for (const node of nodes) {
		byTitle.set(node.title.toLowerCase(), node);
	}

	const edges: RelationGraphEdge[] = [];
	for (const doc of documents) {
		const from = doc.wikiPath;
		const links = doc.content.match(/\[\[([^\]]+)\]\]/g) ?? [];
		for (const rawLink of links) {
			const label = rawLink.replace(/^\[\[|\]\]$/g, "").trim();
			const target = byTitle.get(label.toLowerCase());
			if (!target) {
				continue;
			}
			edges.push({
				from,
				to: target.id,
				label: "wikilink",
			});
		}
	}

	return { nodes, edges };
}
