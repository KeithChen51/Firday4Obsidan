import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import simpleGit from "simple-git";
import type { GitRuntimeStatus } from "../platform/git/GitRuntimeProbe";
import type { ProjectGitCredential } from "../types/project";
import type { FridaySettings } from "../types/settings";
import type {
	GroupModelCatalogCapabilities,
	GroupModelCatalogDefaults,
	GroupModelCatalogFeed,
	GroupModelCatalogModel,
	GroupModelCatalogSyncResult,
} from "../types/groupModelCatalog";

export interface GroupModelCatalogGitClient {
	ensureWorkspace(): Promise<void>;
	lsRemote(): Promise<string>;
	fetch(branch: string): Promise<void>;
	readText(ref: string, path: string): Promise<string>;
	cleanup(): Promise<void>;
}

export interface GroupModelCatalogServiceDeps {
	getSettings: () => Pick<FridaySettings, "groupModelCatalog">;
	saveSettings: () => Promise<void>;
	getGitRuntimeStatus: () => Promise<GitRuntimeStatus>;
	getUserCredential: () => Promise<ProjectGitCredential | null>;
	getUserGitEmail: () => string;
	gitClientFactory?: (
		credential: ProjectGitCredential,
		repoUrl: string,
	) => Promise<GroupModelCatalogGitClient> | GroupModelCatalogGitClient;
	now?: () => Date;
}

export class GroupModelCatalogService {
	private readonly gitClientFactory: (
		credential: ProjectGitCredential,
		repoUrl: string,
	) => Promise<GroupModelCatalogGitClient>;
	private readonly now: () => Date;

	constructor(private readonly deps: GroupModelCatalogServiceDeps) {
		this.gitClientFactory = async (credential, repoUrl) =>
			deps.gitClientFactory
				? await deps.gitClientFactory(credential, repoUrl)
				: await createGroupModelCatalogGitClient(credential, repoUrl);
		this.now = deps.now ?? (() => new Date());
	}

	async runStartupCheck(): Promise<void> {
		const settings = this.deps.getSettings().groupModelCatalog;
		if (!settings.enabled || !settings.checkOnStartup) {
			return;
		}
		await this.refreshCatalog();
	}

	async refreshCatalog(): Promise<GroupModelCatalogSyncResult> {
		const settings = this.deps.getSettings().groupModelCatalog;
		const checkedAt = this.now().toISOString();
		try {
			if (!settings.enabled) {
				throw new Error("集团模型目录同步已关闭。");
			}
			const repoUrl = settings.repoUrl.trim();
			const branch = settings.branch.trim();
			const filePath = normalizeCatalogPath(settings.filePath);
			if (!repoUrl || !branch || !filePath) {
				throw new Error("集团模型目录仓库、分支或文件路径未配置。");
			}

			const gitRuntime = await this.deps.getGitRuntimeStatus();
			if (!gitRuntime.available) {
				throw new Error(gitRuntime.error || "本机 Git 不可用。");
			}
			const credential = await this.deps.getUserCredential();
			if (!credential?.username?.trim() || !credential.token?.trim()) {
				throw new Error("缺少 Git 认证信息。");
			}

			const gitClient = await this.gitClientFactory(credential, repoUrl);
			try {
				await gitClient.ensureWorkspace();
				await gitClient.lsRemote();
				await gitClient.fetch(branch);
				const raw = await gitClient.readText("FETCH_HEAD", filePath);
				const catalog = parseGroupModelCatalog(raw);
				const previousVersion = settings.lastCatalogVersion;
				settings.lastCheckedAt = checkedAt;
				settings.lastCatalogVersion = catalog.catalogVersion;
				settings.lastResult = previousVersion === catalog.catalogVersion ? "up-to-date" : "updated";
				settings.lastError = "";
				settings.providerId = catalog.providerId?.trim() ?? "";
				settings.providerName = catalog.providerName?.trim() ?? "";
				settings.models = catalog.models;
				settings.defaults = normalizeDefaults(catalog.defaults, catalog.models);
				await this.deps.saveSettings();
				return {
					success: true,
					updated: settings.lastResult === "updated",
					catalogVersion: catalog.catalogVersion,
					modelCount: catalog.models.length,
				};
			} finally {
				await gitClient.cleanup();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			settings.lastCheckedAt = checkedAt;
			settings.lastResult = "error";
			settings.lastError = message;
			await this.deps.saveSettings();
			return {
				success: false,
				updated: false,
				catalogVersion: settings.lastCatalogVersion,
				modelCount: settings.models.length,
				error: message,
			};
		}
	}
}

export function parseGroupModelCatalog(raw: string): GroupModelCatalogFeed {
	const parsed = JSON.parse(raw) as Partial<GroupModelCatalogFeed>;
	if (parsed.schemaVersion !== 1) {
		throw new Error("集团模型目录 schemaVersion 非法。");
	}
	const catalogVersion = typeof parsed.catalogVersion === "string" ? parsed.catalogVersion.trim() : "";
	if (!catalogVersion) {
		throw new Error("集团模型目录缺少 catalogVersion。");
	}
	if (!Array.isArray(parsed.models)) {
		throw new Error("集团模型目录缺少 models 数组。");
	}
	const models = parsed.models
		.map(normalizeModel)
		.filter((model): model is GroupModelCatalogModel => Boolean(model && model.enabled));
	if (models.length === 0) {
		throw new Error("集团模型目录未包含可用模型。");
	}
	return {
		schemaVersion: 1,
		catalogVersion,
		updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt.trim() : undefined,
		recommendedBranch: typeof parsed.recommendedBranch === "string" ? parsed.recommendedBranch.trim() : undefined,
		providerId: typeof parsed.providerId === "string" ? parsed.providerId.trim() : undefined,
		providerName: typeof parsed.providerName === "string" ? parsed.providerName.trim() : undefined,
		models,
		defaults: normalizeDefaults(parsed.defaults, models),
	};
}

function normalizeModel(raw: unknown): GroupModelCatalogModel | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return null;
	}
	const candidate = raw as Partial<GroupModelCatalogModel>;
	const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
	if (!id) {
		return null;
	}
	const label = typeof candidate.label === "string" && candidate.label.trim()
		? candidate.label.trim()
		: id;
	return {
		id,
		label,
		enabled: candidate.enabled !== false,
		capabilities: normalizeCapabilities(candidate.capabilities),
	};
}

function normalizeCapabilities(raw: unknown): GroupModelCatalogCapabilities {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return {};
	}
	const candidate = raw as GroupModelCatalogCapabilities;
	return {
		...(typeof candidate.text === "boolean" ? { text: candidate.text } : {}),
		...(typeof candidate.image === "boolean" ? { image: candidate.image } : {}),
		...(typeof candidate.toolCall === "boolean" ? { toolCall: candidate.toolCall } : {}),
		...(typeof candidate.reasoning === "boolean" ? { reasoning: candidate.reasoning } : {}),
	};
}

function normalizeDefaults(raw: unknown, models: GroupModelCatalogModel[]): GroupModelCatalogDefaults {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return {};
	}
	const modelIds = new Set(models.map((model) => model.id));
	const candidate = raw as GroupModelCatalogDefaults;
	const defaults: GroupModelCatalogDefaults = {};
	for (const key of ["chat", "agent", "vision", "fallback"] as const) {
		const value = candidate[key];
		if (typeof value === "string" && modelIds.has(value.trim())) {
			defaults[key] = value.trim();
		}
	}
	return defaults;
}

function normalizeCatalogPath(value: string): string {
	return value
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/{2,}/g, "/");
}

async function createGroupModelCatalogGitClient(
	credential: ProjectGitCredential,
	repoUrl: string,
): Promise<GroupModelCatalogGitClient> {
	const workspace = await mkdtemp(path.join(os.tmpdir(), "friday-model-catalog-"));
	const git = simpleGit({ baseDir: workspace, maxConcurrentProcesses: 1 });
	const authArgs = buildAuthArgs(credential);
	let initialized = false;

	return {
		async ensureWorkspace() {
			if (initialized) {
				return;
			}
			await git.init();
			await git.addRemote("origin", repoUrl);
			initialized = true;
		},
		async lsRemote() {
			return git.raw([...authArgs, "ls-remote", repoUrl]);
		},
		async fetch(branch: string) {
			await git.raw([...authArgs, "fetch", "--depth", "1", "origin", branch]);
		},
		async readText(ref: string, targetPath: string) {
			return git.raw(["show", `${ref}:${targetPath}`]);
		},
		async cleanup() {
			await rm(workspace, { recursive: true, force: true });
		},
	};
}

function buildAuthArgs(credential: ProjectGitCredential): string[] {
	const basic = Buffer.from(`${credential.username}:${credential.token}`).toString("base64");
	return ["-c", `http.extraheader=Authorization: Basic ${basic}`];
}
