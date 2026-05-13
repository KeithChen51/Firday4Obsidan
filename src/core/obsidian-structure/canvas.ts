export type CanvasNode = Record<string, unknown> & {
	id?: string;
	type?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	file?: string;
	text?: string;
	url?: string;
};

export type CanvasEdge = Record<string, unknown> & {
	id?: string;
	fromNode?: string;
	toNode?: string;
};

export interface CanvasDocument {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

export interface StructureValidationIssue {
	severity: "error" | "warning";
	code: string;
	message: string;
	path?: string;
	target?: string;
}

export interface CanvasValidationResult {
	ok: boolean;
	items: StructureValidationIssue[];
	summary: string;
}

export interface CanvasSummary {
	path: string;
	nodeCount: number;
	edgeCount: number;
	nodeTypes: Record<string, number>;
	fileReferences: Array<{ file: string; exists: boolean }>;
	issues: StructureValidationIssue[];
}

export interface CanvasApplyInput {
	mode?: "create" | "update" | "upsert";
	nodes?: CanvasNode[];
	edges?: CanvasEdge[];
	autoLayout?: boolean;
}

export interface CanvasApplyResult {
	content: string;
	document: CanvasDocument;
	validation: CanvasValidationResult;
}

const VALID_NODE_TYPES = new Set(["text", "file", "link", "group"]);
const VALID_SIDES = new Set(["top", "right", "bottom", "left"]);
const VALID_ENDS = new Set(["none", "arrow"]);

export function parseCanvasDocument(content: string): CanvasDocument {
	let parsed: unknown;
	try {
		parsed = content.trim() ? JSON.parse(content) : {};
	} catch (error) {
		throw new Error(`Invalid canvas JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Canvas document must be a JSON object.");
	}
	const raw = parsed as { nodes?: unknown; edges?: unknown };
	return {
		nodes: Array.isArray(raw.nodes) ? raw.nodes.filter(isRecord).map((node) => ({ ...node })) : [],
		edges: Array.isArray(raw.edges) ? raw.edges.filter(isRecord).map((edge) => ({ ...edge })) : [],
	};
}

export function stringifyCanvasDocument(document: CanvasDocument): string {
	return `${JSON.stringify({
		nodes: document.nodes,
		edges: document.edges,
	}, null, 2)}\n`;
}

export function validateCanvasDocument(content: string): CanvasValidationResult {
	const issues: StructureValidationIssue[] = [];
	let document: CanvasDocument;
	try {
		document = parseCanvasDocument(content);
	} catch (error) {
		return {
			ok: false,
			items: [{
				severity: "error",
				code: "invalid_json",
				message: error instanceof Error ? error.message : String(error),
			}],
			summary: "Canvas JSON is invalid.",
		};
	}

	const seenIds = new Set<string>();
	const nodeIds = new Set<string>();
	for (const [index, node] of document.nodes.entries()) {
		const id = typeof node.id === "string" ? node.id.trim() : "";
		const type = typeof node.type === "string" ? node.type.trim() : "";
		if (!id) {
			issues.push(issue("error", "missing_node_id", `Node ${index + 1} is missing an id.`, `nodes.${index}`));
		} else if (seenIds.has(id)) {
			issues.push(issue("error", "duplicate_id", `Duplicate canvas id: ${id}.`, `nodes.${index}`, id));
		} else {
			seenIds.add(id);
			nodeIds.add(id);
		}
		if (!VALID_NODE_TYPES.has(type)) {
			issues.push(issue("error", "invalid_node_type", `Node ${id || index + 1} has invalid type: ${type || "(missing)"}.`, `nodes.${index}`, id));
		}
		for (const field of ["x", "y", "width", "height"] as const) {
			if (typeof node[field] !== "number" || !Number.isFinite(node[field])) {
				issues.push(issue("error", "invalid_node_geometry", `Node ${id || index + 1} has invalid ${field}.`, `nodes.${index}.${field}`, id));
			}
		}
		if (type === "text" && typeof node.text !== "string") {
			issues.push(issue("error", "missing_text", `Text node ${id || index + 1} is missing text.`, `nodes.${index}.text`, id));
		}
		if (type === "file" && typeof node.file !== "string") {
			issues.push(issue("error", "missing_file", `File node ${id || index + 1} is missing file.`, `nodes.${index}.file`, id));
		}
		if (type === "link" && typeof node.url !== "string") {
			issues.push(issue("error", "missing_url", `Link node ${id || index + 1} is missing url.`, `nodes.${index}.url`, id));
		}
	}

	for (const [index, edge] of document.edges.entries()) {
		const id = typeof edge.id === "string" ? edge.id.trim() : "";
		if (!id) {
			issues.push(issue("error", "missing_edge_id", `Edge ${index + 1} is missing an id.`, `edges.${index}`));
		} else if (seenIds.has(id)) {
			issues.push(issue("error", "duplicate_id", `Duplicate canvas id: ${id}.`, `edges.${index}`, id));
		} else {
			seenIds.add(id);
		}
		const fromNode = typeof edge.fromNode === "string" ? edge.fromNode.trim() : "";
		const toNode = typeof edge.toNode === "string" ? edge.toNode.trim() : "";
		if (!fromNode || !nodeIds.has(fromNode)) {
			issues.push(issue("error", "missing_edge_source", `Edge ${id || index + 1} references missing source node: ${fromNode || "(missing)"}.`, `edges.${index}.fromNode`, fromNode));
		}
		if (!toNode || !nodeIds.has(toNode)) {
			issues.push(issue("error", "missing_edge_target", `Edge ${id || index + 1} references missing target node: ${toNode || "(missing)"}.`, `edges.${index}.toNode`, toNode));
		}
		for (const field of ["fromSide", "toSide"] as const) {
			const value = edge[field];
			if (value !== undefined && (!String(value).trim() || !VALID_SIDES.has(String(value)))) {
				issues.push(issue("error", "invalid_edge_side", `Edge ${id || index + 1} has invalid ${field}.`, `edges.${index}.${field}`, id));
			}
		}
		for (const field of ["fromEnd", "toEnd"] as const) {
			const value = edge[field];
			if (value !== undefined && (!String(value).trim() || !VALID_ENDS.has(String(value)))) {
				issues.push(issue("error", "invalid_edge_end", `Edge ${id || index + 1} has invalid ${field}.`, `edges.${index}.${field}`, id));
			}
		}
	}

	return {
		ok: !issues.some((item) => item.severity === "error"),
		items: issues,
		summary: issues.length === 0
			? `Canvas is valid (${document.nodes.length} node(s), ${document.edges.length} edge(s)).`
			: `Canvas has ${issues.length} issue(s).`,
	};
}

export function summarizeCanvasDocument(
	content: string,
	canvasPath = "",
	exists: (vaultPath: string) => boolean = () => false,
): CanvasSummary {
	const document = parseCanvasDocument(content);
	const nodeTypes: Record<string, number> = {};
	const fileReferences = [];
	for (const node of document.nodes) {
		const type = typeof node.type === "string" && node.type.trim() ? node.type.trim() : "unknown";
		nodeTypes[type] = (nodeTypes[type] ?? 0) + 1;
		if (type === "file" && typeof node.file === "string" && node.file.trim()) {
			const file = node.file.trim();
			fileReferences.push({ file, exists: exists(file) });
		}
	}
	return {
		path: canvasPath,
		nodeCount: document.nodes.length,
		edgeCount: document.edges.length,
		nodeTypes,
		fileReferences,
		issues: validateCanvasDocument(content).items,
	};
}

export function applyCanvasDocument(existingContent: string | null | undefined, input: CanvasApplyInput): CanvasApplyResult {
	const existing = input.mode === "create" ? { nodes: [], edges: [] } : parseCanvasDocument(existingContent ?? "");
	const usedIds = new Set<string>();
	for (const node of existing.nodes) {
		if (typeof node.id === "string" && node.id.trim()) usedIds.add(node.id);
	}
	for (const edge of existing.edges) {
		if (typeof edge.id === "string" && edge.id.trim()) usedIds.add(edge.id);
	}

	const mergedNodes = mergeCanvasItems(
		existing.nodes,
		input.nodes ?? [],
		(item, index) => normalizeNode(item, index, usedIds, input.autoLayout !== false),
	);
	const nodeIds = new Set(mergedNodes.map((node) => node.id).filter((id): id is string => typeof id === "string" && id.length > 0));
	const mergedEdges = mergeCanvasItems(
		existing.edges,
		input.edges ?? [],
		(item, index) => normalizeEdge(item, index, usedIds),
	);
	const document = {
		nodes: mergedNodes,
		edges: mergedEdges.filter((edge) => typeof edge.fromNode === "string" && typeof edge.toNode === "string" && nodeIds.has(edge.fromNode) && nodeIds.has(edge.toNode)),
	};
	const content = stringifyCanvasDocument(document);
	const validation = validateCanvasDocument(content);
	return { content, document, validation };
}

function mergeCanvasItems<T extends { id?: string }>(
	existing: T[],
	incoming: T[],
	normalize: (item: T, index: number) => T,
): T[] {
	const result = existing.map((item) => ({ ...item }));
	const indexById = new Map<string, number>();
	for (const [index, item] of result.entries()) {
		if (typeof item.id === "string" && item.id) {
			indexById.set(item.id, index);
		}
	}
	for (const [index, raw] of incoming.entries()) {
		const item = normalize({ ...raw }, result.length + index);
		if (typeof item.id === "string" && indexById.has(item.id)) {
			const existingIndex = indexById.get(item.id)!;
			result[existingIndex] = { ...result[existingIndex], ...item };
		} else {
			if (typeof item.id === "string" && item.id) indexById.set(item.id, result.length);
			result.push(item);
		}
	}
	return result;
}

function normalizeNode(node: CanvasNode, index: number, usedIds: Set<string>, autoLayout: boolean): CanvasNode {
	const id = typeof node.id === "string" && node.id.trim()
		? node.id.trim()
		: ensureUniqueId(stableId("node", node), usedIds);
	const normalized: CanvasNode = {
		...node,
		id,
		type: typeof node.type === "string" ? node.type : "text",
	};
	if (typeof normalized.width !== "number") normalized.width = 320;
	if (typeof normalized.height !== "number") normalized.height = normalized.type === "file" ? 220 : 140;
	if (autoLayout && typeof normalized.x !== "number") normalized.x = (index % 4) * 380;
	if (autoLayout && typeof normalized.y !== "number") normalized.y = Math.floor(index / 4) * 240;
	if (normalized.type === "text" && typeof normalized.text !== "string") normalized.text = "";
	return normalized;
}

function normalizeEdge(edge: CanvasEdge, index: number, usedIds: Set<string>): CanvasEdge {
	const id = typeof edge.id === "string" && edge.id.trim()
		? edge.id.trim()
		: ensureUniqueId(stableId("edge", { ...edge, index }), usedIds);
	return { ...edge, id };
}

function ensureUniqueId(candidate: string, usedIds: Set<string>): string {
	let base = candidate.trim() || "item";
	let id = base;
	let suffix = 2;
	while (usedIds.has(id)) {
		id = `${base}-${suffix}`;
		suffix += 1;
	}
	usedIds.add(id);
	return id;
}

function stableId(prefix: string, value: unknown): string {
	const raw = JSON.stringify(value) ?? prefix;
	let hash = 2166136261;
	for (let index = 0; index < raw.length; index += 1) {
		hash ^= raw.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${prefix}-${(hash >>> 0).toString(16)}`;
}

function issue(
	severity: "error" | "warning",
	code: string,
	message: string,
	path?: string,
	target?: string,
): StructureValidationIssue {
	return { severity, code, message, ...(path ? { path } : {}), ...(target ? { target } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
