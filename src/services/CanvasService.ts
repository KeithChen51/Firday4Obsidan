export class CanvasService {
	validateCanvasJson(raw: string): { valid: true } | { valid: false; reason: string } {
		try {
			const parsed = JSON.parse(raw) as {
				nodes?: unknown;
				edges?: unknown;
			};
			if (!parsed || typeof parsed !== "object") {
				return { valid: false, reason: "Canvas 内容不是对象。" };
			}
			if (!Array.isArray(parsed.nodes)) {
				return { valid: false, reason: "Canvas 缺少 nodes 数组。" };
			}
			if (!Array.isArray(parsed.edges)) {
				return { valid: false, reason: "Canvas 缺少 edges 数组。" };
			}
			return { valid: true };
		} catch (error) {
			return {
				valid: false,
				reason: `Canvas JSON 无法解析：${String(error)}`,
			};
		}
	}
}

