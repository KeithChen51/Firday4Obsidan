/* eslint-env node */

export function normalizePath(value = "") {
	const text = String(value).replace(/\\/g, "/").replace(/\/+/g, "/");
	if (text === "/") {
		return "/";
	}
	return text.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

export class TAbstractFile {
	constructor(filePath) {
		this.path = normalizePath(filePath);
		this.name = this.path.split("/").pop() ?? "";
		this.parent = null;
	}
}

export class TFile extends TAbstractFile {
	constructor(filePath) {
		super(filePath);
		const dotIndex = this.name.lastIndexOf(".");
		this.extension = dotIndex >= 0 ? this.name.slice(dotIndex + 1) : "";
		this.basename = dotIndex >= 0 ? this.name.slice(0, dotIndex) : this.name;
	}
}

export class TFolder extends TAbstractFile {
	constructor(folderPath) {
		super(folderPath);
		this.children = [];
	}
}

export class Vault {}

export async function requestUrl() {
	throw new Error("fakeVault requestUrl should not be called by Agent Runtime Harness tests.");
}

export class FakeVault extends Vault {
	constructor(files = {}) {
		super();
		this.files = new Map();
		this.folders = new Map();
		for (const [filePath, content] of Object.entries(files)) {
			this.writeFile(filePath, String(content));
		}
	}

	snapshot() {
		return Object.fromEntries([...this.files.entries()].sort(([left], [right]) => left.localeCompare(right)));
	}

	getAbstractFileByPath(filePath) {
		const normalized = normalizePath(filePath);
		if (!normalized) {
			return null;
		}
		if (this.files.has(normalized)) {
			return new TFile(normalized);
		}
		if (this.folders.has(normalized)) {
			return new TFolder(normalized);
		}
		return null;
	}

	getFiles() {
		return [...this.files.keys()].sort().map((filePath) => new TFile(filePath));
	}

	getAllLoadedFiles() {
		const folders = [...this.folders.keys()].sort().map((folderPath) => new TFolder(folderPath));
		return [...folders, ...this.getFiles()];
	}

	async cachedRead(file) {
		const normalized = normalizePath(file.path);
		if (!this.files.has(normalized)) {
			throw new Error(`Vault file does not exist: ${normalized}`);
		}
		return this.files.get(normalized);
	}

	async create(filePath, content) {
		const normalized = normalizePath(filePath);
		this.writeFile(normalized, String(content ?? ""));
		return new TFile(normalized);
	}

	async modify(file, content) {
		const normalized = normalizePath(file.path);
		if (!this.files.has(normalized)) {
			throw new Error(`Vault file does not exist: ${normalized}`);
		}
		this.writeFile(normalized, String(content ?? ""));
	}

	async delete(file) {
		const normalized = normalizePath(file.path);
		if (this.files.has(normalized)) {
			this.files.delete(normalized);
			return;
		}
		if (this.folders.has(normalized)) {
			for (const filePath of [...this.files.keys()]) {
				if (filePath === normalized || filePath.startsWith(`${normalized}/`)) {
					this.files.delete(filePath);
				}
			}
			for (const folderPath of [...this.folders.keys()]) {
				if (folderPath === normalized || folderPath.startsWith(`${normalized}/`)) {
					this.folders.delete(folderPath);
				}
			}
			return;
		}
		throw new Error(`Vault path does not exist: ${normalized}`);
	}

	async createFolder(folderPath) {
		this.ensureFolder(folderPath);
		return new TFolder(normalizePath(folderPath));
	}

	async rename(file, nextPath) {
		const current = normalizePath(file.path);
		const next = normalizePath(nextPath);
		if (this.files.has(current)) {
			const content = this.files.get(current);
			this.files.delete(current);
			this.writeFile(next, content);
			return;
		}
		if (this.folders.has(current)) {
			this.folders.delete(current);
			this.ensureFolder(next);
		}
	}

	writeFile(filePath, content) {
		const normalized = normalizePath(filePath);
		const parent = normalized.split("/").slice(0, -1).join("/");
		if (parent) {
			this.ensureFolder(parent);
		}
		this.files.set(normalized, content);
	}

	ensureFolder(folderPath) {
		const normalized = normalizePath(folderPath);
		if (!normalized) {
			return;
		}
		const segments = normalized.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			this.folders.set(current, true);
		}
	}
}

export function createFakeVault(files = {}) {
	return new FakeVault(files);
}
