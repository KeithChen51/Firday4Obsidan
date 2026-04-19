import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { App, Notice, Plugin, PluginSettingTab, Setting, TFolder } from "obsidian";
import { normalizeProjectGroupIdCandidate } from "./projectGroupId";
import {
	buildDefaultProjectRootPath,
	buildRemoteBootstrapDefaults,
	detectProjectGitState,
	isFridayManagedProjectRoot,
	type ProjectEditorDraft,
	submitProjectDraft,
} from "../features/workbench/ProjectEditorService";
import { GitIgnoreService, type GitIgnoreCandidate } from "../features/sync/GitIgnoreService";
import {
	parseOpencodeConfig,
	selectOpencodeProvider,
	type OpencodeProviderOption,
} from "../core/llm/OpencodeConfigResolver";
import {
	buildAgentModelCatalogFromSettings,
	parseAgentModelChoice,
	resolveSelectedAgentModelValue,
} from "../core/llm/AgentModelCatalog";
import {
	patchActiveLlmConfig,
	patchLlmModeConfig,
	readModeConfig,
	switchLlmMode,
} from "../core/llm/LlmSettingsResolver";
import type { ModelCapabilityInfo } from "../services/AIService";
import { FridayPluginApi, type FridaySettingsSection } from "../types/plugin";
import { ProjectEntry, ProjectGroupEntry } from "../types/project";
import { SlashCommandTemplate } from "../types/settings";
import type { LocaleCode } from "../i18n/types";
import { CapabilityRegistry } from "../core/capability/CapabilityRegistry";
import type { GitRuntimeStatus } from "../platform/git/GitRuntimeProbe";

type SettingsHost = FridayPluginApi & Plugin;
type LlmMode = "openai" | "group";
type LlmStatus = "unconfigured" | "idle" | "checking" | "connected" | "failed";
type VisionProbeStatus = "idle" | "checking";
type ProjectEditorSelectOption = string | { value: string; label: string };
type RemoteBootstrapDirectoryState = "unknown" | "empty" | "non_empty";
type RemoteBootstrapResolution = "unset" | "direct" | "create_child";
const BUILTIN_GROUP_MODELS = [
	"glm-4.7",
	"kimi-k2.5",
	"MiniMax-M2.1",
	"glm-5",
	"MiniMax-M2.5",
	"qwen3-coder-plus",
	"Deepseek-V3.2-Exp",
	"qwen3.5-plus",
	"Qwen3-Max-Preview",
	"qwen3.5-flash",
	"Qwen3-Max",
];

interface ModelPresetResult {
	models: string[];
	modelLabels: Record<string, string>;
	source: string;
	editablePaths: string[];
	providers: OpencodeProviderOption[];
	activeProvider: OpencodeProviderOption | null;
}

export class FridaySettingTab extends PluginSettingTab {
	private readonly host: SettingsHost;
	private llmStatus: LlmStatus = "idle";
	private llmStatusDetail = "";
	private visionProbeStatus: VisionProbeStatus = "idle";
	private testedVisionCapability: ModelCapabilityInfo | null = null;
	private testedVisionModel = "";
	private modelPresetResult: ModelPresetResult | null = null;
	private activeSection: SettingsSection = "user";
	private newAgentDraft = "";
	private newProjectGroupDraft = "";
	private pendingDeleteGroupId = "";
	private policyEditorProjectSlug = "";
	private projectEditorDraft: ProjectEditorDraft | null = null;
	private projectEditorInitialProjectId = "";
	private projectEditorError = "";
	private projectGitDetection: Awaited<ReturnType<typeof detectProjectGitState>> | null = null;
	private projectEditorRemoteBootstrapBasePath = "";
	private projectEditorRemoteBootstrapDirectoryState: RemoteBootstrapDirectoryState = "unknown";
	private projectEditorRemoteBootstrapResolution: RemoteBootstrapResolution = "unset";
	private projectEditorRemoteBootstrapChoiceInitialized = false;
	private userGitCredentialLoaded = false;
	private userGitUsernameDraft = "";
	private userGitTokenDraft = "";
	private gitRuntimeStatus: GitRuntimeStatus | null = null;
	private gitRuntimeStatusLoading = false;
	private pluginUpdateActionPending = false;
	private ignoreManagerProjectId = "";
	private ignoreManagerCandidates: GitIgnoreCandidate[] = [];
	private ignoreManagerError = "";
	private ignoreManagerPendingRulePath = "";
	private readonly gitIgnoreService: GitIgnoreService;

	constructor(app: App, plugin: SettingsHost) {
		super(app, plugin);
		this.host = plugin;
		this.gitIgnoreService = new GitIgnoreService((project) =>
			this.host.projectBoundaryService.getProjectAbsolutePath(project),
		);
	}

	focusSection(section: SettingsSection): void {
		if (this.activeSection === section) {
			return;
		}
		this.activeSection = section;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: this.host.t("settings.title") });
		this.renderSectionTabs(containerEl);

		if (this.activeSection === "user") {
			this.renderUserSection(containerEl);
			return;
		}
		if (this.activeSection === "sync") {
			this.renderSyncSection(containerEl);
			return;
		}
		if (this.activeSection === "llm") {
			this.renderLlmSection(containerEl);
			return;
		}
		if (this.activeSection === "agent") {
			this.renderAgentSection(containerEl);
			return;
		}
		if (this.activeSection === "slash") {
			this.renderSlashCommandSection(containerEl);
			return;
		}
		this.renderProjectSection(containerEl);
	}

	private renderSectionTabs(containerEl: HTMLElement): void {
		const nav = containerEl.createDiv({ cls: "friday-top-nav" });
		const items: Array<{ id: SettingsSection; label: string }> = [
			{ id: "user", label: this.host.t("settings.section.user") },
			{ id: "project", label: this.host.t("settings.section.project") },
			{ id: "sync", label: this.host.t("settings.section.sync") },
			{ id: "llm", label: this.host.t("settings.section.llm") },
			{ id: "agent", label: this.host.t("settings.section.agent") },
			{ id: "slash", label: this.host.t("settings.section.slash") },
		];
		for (const item of items) {
			const button = nav.createEl("button", {
				cls: `friday-nav-button${this.activeSection === item.id ? " is-active" : ""}`,
				text: item.label,
			});
			button.onclick = () => {
				this.activeSection = item.id;
				this.display();
			};
		}
	}

	private createNativeSettingsGroup(
		containerEl: HTMLElement,
		options: { title?: string; description?: string; extraClass?: string } = {},
	): HTMLDivElement {
		const group = containerEl.createDiv({
			cls: ["friday-native-settings-group", options.extraClass].filter(Boolean).join(" "),
		});
		if (options.title || options.description) {
			const header = group.createDiv({ cls: "friday-native-settings-group-header" });
			if (options.title) {
				header.createDiv({
					cls: "friday-native-settings-group-title",
					text: options.title,
				});
			}
			if (options.description) {
				header.createDiv({
					cls: "friday-native-settings-group-description",
					text: options.description,
				});
			}
		}
		return group;
	}

	private renderUserSection(containerEl: HTMLElement): void {
		void this.ensureUserGitCredentialLoaded();
		void this.ensureGitRuntimeStatusLoaded();
		const profileGroup = this.createNativeSettingsGroup(containerEl);
		const gitGroup = this.createNativeSettingsGroup(containerEl);

		const localeSetting = new Setting(profileGroup)
			.setName(this.host.t("settings.locale.name"))
			.setDesc(this.host.t("settings.locale.desc"));
		localeSetting.addDropdown((dropdown) => {
			dropdown.addOption("zh-CN", this.host.t("settings.locale.zh"));
			dropdown.addOption("en-US", this.host.t("settings.locale.en"));
			dropdown.setValue(this.host.settings.locale ?? "zh-CN");
			dropdown.setDisabled(this.host.settings.localeFollowSystem);
			dropdown.onChange(async (value) => {
				this.host.settings.locale = (value === "en-US" ? "en-US" : "zh-CN") as LocaleCode;
				await this.host.saveSettings();
				this.display();
			});
		});
		localeSetting.addToggle((toggle) => {
			toggle
				.setValue(this.host.settings.localeFollowSystem)
				.setTooltip(this.t("settings.locale.followSystem", "跟随系统"))
				.onChange(async (value) => {
					this.host.settings.localeFollowSystem = value;
					await this.host.saveSettings();
					this.display();
				});
		});

		new Setting(profileGroup)
			.setName(this.t("settings.user.autoDetect.name", "自动识别用户 ID"))
			.setDesc(this.t("settings.user.autoDetect.desc", "若下方用户 ID 为空，则使用当前机器名推断。"))
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.user.autoDetect).onChange(async (value) => {
					this.host.settings.user.autoDetect = value;
					if (value && !this.host.settings.user.userId) {
						this.host.settings.user.userId = this.host.getDetectedUserId();
					}
					await this.host.saveSettings();
					this.display();
				}),
			);

			new Setting(profileGroup)
				.setName(this.t("settings.user.userId.name", "用户 ID"))
				.setDesc(this.t("settings.user.userId.desc", "用于标识当前用户。"))
				.addText((text) =>
				text
					.setPlaceholder("keith")
					.setValue(this.host.settings.user.userId)
					.onChange(async (value) => {
						this.host.settings.user.userId = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(profileGroup).setName(this.t("settings.user.displayName.name", "显示名称")).addText((text) =>
			text
				.setPlaceholder("Keith")
				.setValue(this.host.settings.user.displayName)
				.onChange(async (value) => {
					this.host.settings.user.displayName = value.trim();
					await this.host.saveSettings();
				}),
		);

		new Setting(gitGroup)
			.setName(this.t("settings.user.gitUsername.name", "Git 用户名"))
			.setDesc(this.t("settings.user.gitUsername.desc", "作为所有项目同步认证的统一用户名。"))
			.addText((text) => {
				text
					.setPlaceholder("alice")
					.setValue(this.userGitUsernameDraft)
					.onChange(async (value) => {
						this.userGitUsernameDraft = value.trim();
						await this.persistUserGitCredential();
					});
				text.inputEl.onblur = () => {
					if (this.activeSection === "user") {
						this.display();
					}
				};
			});

		new Setting(gitGroup)
			.setName(this.t("settings.user.gitUserEmail.name", "Git 邮箱"))
			.setDesc(this.t("settings.user.gitUserEmail.desc", "用于所有项目的 Git 提交身份。"))
			.addText((text) => {
				text
					.setPlaceholder("you@example.com")
					.setValue(this.host.settings.user.gitUserEmail)
					.onChange(async (value) => {
						this.host.settings.user.gitUserEmail = value.trim();
						await this.host.saveSettings();
					});
				text.inputEl.onblur = () => {
					if (this.activeSection === "user") {
						this.display();
					}
				};
			});

		new Setting(gitGroup)
			.setName(this.t("settings.user.gitToken.name", "Git 令牌"))
			.setDesc(this.t("settings.user.gitToken.desc", "作为所有项目同步认证的统一令牌。"))
			.addText((text) => {
				text
					.setPlaceholder("token")
					.setValue(this.userGitTokenDraft)
					.onChange(async (value) => {
						this.userGitTokenDraft = value.trim();
						await this.persistUserGitCredential();
					});
				text.inputEl.onblur = () => {
					if (this.activeSection === "user") {
						this.display();
					}
				};
			});

		new Setting(gitGroup)
			.setName(this.t("settings.user.update.gitRuntime.name", "Git 环境"))
			.setDesc(this.getGitRuntimeStatusDesc())
			.addButton((button) =>
				button
					.setButtonText(this.t("settings.user.update.gitRuntime.refresh", "重新检测"))
					.setDisabled(this.gitRuntimeStatusLoading)
					.onClick(async () => {
						this.gitRuntimeStatus = null;
						await this.ensureGitRuntimeStatusLoaded();
					}),
			);

		this.renderPluginUpdateCard(containerEl);
	}

	private renderPluginUpdateCard(containerEl: HTMLElement): void {
		containerEl.createEl("h3", {
			text: this.t("settings.user.update.title", "自动更新"),
		});
		const card = this.createNativeSettingsGroup(containerEl, { extraClass: "friday-plugin-update-group" });

		const gitStatus = this.gitRuntimeStatus;
		const gitAvailable = Boolean(gitStatus?.available);
		const gitProfileComplete = this.isGitProfileComplete();
		const prerequisitesReady = gitAvailable && gitProfileComplete;
		const prereqDetails = this.getPluginUpdatePrereqDetails(gitAvailable);
		const availableVersion = this.host.settings.update.availableVersion.trim();
		const hasAvailableUpdate = Boolean(availableVersion);

		new Setting(card)
			.setName(
				this.t("settings.user.update.currentVersion.name", "当前版本号：{version}", {
					version: this.host.manifest.version,
				}),
			)
			.setDesc(this.getPluginUpdateStatusDesc())
			.addButton((button) => {
				button
					.setButtonText(
						hasAvailableUpdate
							? this.t("settings.user.update.currentVersion.apply", "应用更新")
							: this.t("settings.user.update.currentVersion.check", "检查更新"),
					)
					.setDisabled(!prerequisitesReady || this.pluginUpdateActionPending);
				if (hasAvailableUpdate) {
					button.setCta();
				} else {
					button.removeCta();
				}
				button.onClick(async () => {
					if (hasAvailableUpdate) {
						await this.runPluginUpdateApply();
						return;
					}
					await this.runPluginUpdateCheck();
				});
			});

		this.renderPluginUpdatePrerequisitesSetting(card, prereqDetails);

		if (prerequisitesReady) {
			new Setting(card)
				.setName(this.t("settings.user.update.checkOnStartup.name", "启动时自动检查"))
				.setDesc(this.t("settings.user.update.checkOnStartup.desc", "启动后按设定延迟自动检查是否有新版本。"))
				.addToggle((toggle) =>
					toggle
						.setValue(this.host.settings.update.checkOnStartup)
						.onChange(async (value) => {
							this.host.settings.update.checkOnStartup = value;
							await this.host.saveSettings();
						}),
				);

			new Setting(card)
				.setName(this.t("settings.user.update.delay.name", "启动检查延迟（ms）"))
				.setDesc(this.t("settings.user.update.delay.desc", "避免在插件刚启动时立即拉取远程更新信息。"))
				.addText((text) =>
					text
						.setPlaceholder("5000")
						.setValue(String(this.host.settings.update.startupDelayMs))
						.onChange(async (value) => {
							const parsed = Number.parseInt(value, 10);
							this.host.settings.update.startupDelayMs = Number.isFinite(parsed) ? Math.max(parsed, 0) : 5000;
							await this.host.saveSettings();
						}),
				);

			new Setting(card)
				.setName(this.t("settings.user.update.status.name", "更新状态"))
				.setDesc(this.getPluginUpdateStatusDesc());
		}
	}

	private renderPluginUpdatePrerequisitesSetting(
		containerEl: HTMLElement,
		details: { readyLabels: string[]; pendingLabels: string[]; summary: string },
	): void {
		const setting = new Setting(containerEl)
			.setName(this.t("settings.user.update.prerequisites.name", "前置条件"))
			.setDesc(
				details.pendingLabels.length === 0
					? this.t("settings.user.update.prerequisites.complete", "已满足自动更新的全部前置条件。")
					: details.summary,
			);

		const lineWrap = setting.descEl.createDiv({ cls: "friday-plugin-update-prerequisites-list" });
		if (details.readyLabels.length > 0) {
			lineWrap.createDiv({
				cls: "friday-plugin-update-prereq-line is-ready",
				text: this.t("settings.user.update.prerequisites.ready", "已完成：{items}", {
					items: details.readyLabels.join("、"),
				}),
			});
		}
		if (details.pendingLabels.length > 0) {
			lineWrap.createDiv({
				cls: "friday-plugin-update-prereq-line",
				text: this.t("settings.user.update.prerequisites.pending", "待完成：{items}", {
					items: details.pendingLabels.join("、"),
				}),
			});
		}
	}

	private getPluginUpdatePrereqDetails(gitAvailable: boolean): { readyLabels: string[]; pendingLabels: string[]; summary: string } {
		const items = [
			{ done: this.userGitUsernameDraft.trim().length > 0, label: this.t("settings.user.gitUsername.name", "Git 用户名") },
			{ done: this.host.settings.user.gitUserEmail.trim().length > 0, label: this.t("settings.user.gitUserEmail.name", "Git 邮箱") },
			{ done: this.userGitTokenDraft.trim().length > 0, label: this.t("settings.user.gitToken.name", "Git 令牌") },
			{ done: gitAvailable, label: this.t("settings.user.update.gitRuntime.summary", "本地 Git 环境") },
		];
		const readyLabels = items.filter((item) => item.done).map((item) => item.label);
		const pendingLabels = items.filter((item) => !item.done).map((item) => item.label);
		let missingCount = 0;
		if (!this.userGitUsernameDraft.trim()) missingCount += 1;
		if (!this.host.settings.user.gitUserEmail.trim()) missingCount += 1;
		if (!this.userGitTokenDraft.trim()) missingCount += 1;
		if (!gitAvailable) missingCount += 1;
		return {
			readyLabels,
			pendingLabels,
			summary: this.t("settings.user.update.prereqSummary", "还缺 {count} 项前置条件。", {
				count: String(missingCount),
			}),
		};
	}

	private renderSyncSection(containerEl: HTMLElement): void {
		const group = this.createNativeSettingsGroup(containerEl);

		new Setting(group).setName(this.t("settings.sync.autoPush", "自动推送")).addToggle((toggle) =>
			toggle.setValue(this.host.settings.sync.mode === "continuous_auto").onChange(async (value) => {
				await this.host.setSyncMode(value ? "continuous_auto" : "manual");
				this.display();
			}),
		);

		new Setting(group).setName(this.t("settings.sync.onStartup", "启动时同步")).addToggle((toggle) =>
			toggle.setValue(this.host.settings.sync.syncOnStartup).onChange(async (value) => {
				this.host.settings.sync.syncOnStartup = value;
				await this.host.saveSettings();
			}),
		);

		new Setting(group)
			.setName(this.t("settings.sync.interval.name", "同步间隔（分钟）"))
			.setDesc(this.t("settings.sync.interval.desc", "0 表示关闭定时同步。"))
			.addText((text) =>
				text
					.setPlaceholder("0")
					.setValue(String(this.host.settings.sync.idleMinutes))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						const nextValue = Number.isFinite(parsed) ? parsed : 0;
						this.host.settings.sync.idleMinutes = nextValue;
						await this.host.saveSettings();
						if (this.host.settings.sync.mode !== "continuous_auto") {
							await this.host.setSyncMode(nextValue > 0 ? "idle_auto" : "manual");
						}
						this.display();
					}),
			);
	}

	private renderLlmSection(containerEl: HTMLElement): void {
		this.syncLlmStatusWithConfig();
		const mode = (this.host.settings.llm.mode ?? "openai") as LlmMode;
		if (this.host.settings.llm.mode !== mode) {
			this.host.settings.llm.mode = mode;
		}
		const statusGroup = this.createNativeSettingsGroup(containerEl);
		const connectionGroup = this.createNativeSettingsGroup(containerEl);
		const capabilityGroup = this.createNativeSettingsGroup(containerEl);

		new Setting(statusGroup)
			.setName(this.t("settings.llm.connection.name", "连通状态"))
			.setDesc(this.getLlmStatusDesc())
			.addButton((button) =>
				button
					.setButtonText(
						this.llmStatus === "checking"
							? this.t("settings.llm.connection.checking", "检测中...")
							: this.t("settings.llm.connection.test", "测试连通"),
					)
					.setDisabled(this.llmStatus === "checking")
					.onClick(async () => {
						await this.runLlmConnectionTest();
					}),
			);

		new Setting(statusGroup)
			.setName(this.t("settings.llm.mode.name", "接入模式"))
			.setDesc(this.t("settings.llm.mode.desc", "可选通用 OpenAI 协议，或集团集采网关模式。"))
			.addDropdown((dropdown) => {
				dropdown.addOption("openai", this.t("settings.llm.mode.openai", "OpenAI 协议模式"));
				dropdown.addOption("group", this.t("settings.llm.mode.group", "集团集采模式"));
				dropdown.setValue(mode);
				dropdown.onChange(async (value: LlmMode) => {
					this.host.settings.llm = switchLlmMode(this.host.settings.llm, value);
					if (value === "group") {
						const presets = this.getModelPresetResult();
						this.host.settings.llm = patchActiveLlmConfig(this.host.settings.llm, {
							opencodeProviderId: this.host.settings.llm.opencodeProviderId || presets.activeProvider?.id || "",
						});
						if (!this.host.settings.llm.model.trim()) {
							this.host.settings.llm = patchActiveLlmConfig(this.host.settings.llm, {
								model: presets.models[0] ?? "",
							});
						}
					}
					await this.host.saveSettings();
					this.markLlmStatusDirty();
					this.display();
				});
			});

		if (mode === "group") {
			const modelPresets = this.getModelPresetResult();
			const activeProvider = modelPresets.activeProvider;
			if (modelPresets.providers.length > 0) {
				new Setting(statusGroup)
					.setName(this.t("settings.llm.opencodeProvider.name", "OpenCode Provider"))
					.setDesc(
						activeProvider
							? this.t("settings.llm.opencodeProvider.desc", "来源: {source} | 当前: {provider}", {
									source: modelPresets.source,
									provider: activeProvider.name,
								})
							: this.t(
									"settings.llm.opencodeProvider.empty",
									"已读取 OpenCode 配置，但未发现可用 provider。",
								),
					)
					.addDropdown((dropdown) => {
						for (const provider of modelPresets.providers) {
							dropdown.addOption(provider.id, provider.name || provider.id);
						}
						dropdown.setValue(activeProvider?.id ?? modelPresets.providers[0]?.id ?? "");
						dropdown.onChange(async (value) => {
							this.host.settings.llm = patchLlmModeConfig(this.host.settings.llm, "group", {
								opencodeProviderId: value,
							});
							const selectedProvider = selectOpencodeProvider(this.readOpencodeSnapshot(), value);
							if (
								selectedProvider &&
								selectedProvider.models.length > 0 &&
								!selectedProvider.models.some((item) => item.id === this.host.settings.llm.model.trim())
							) {
								this.host.settings.llm = patchLlmModeConfig(this.host.settings.llm, "group", {
									model: selectedProvider.models[0]!.id,
								});
							}
							await this.host.saveSettings();
							this.markLlmStatusDirty();
							this.display();
						});
					})
					.addButton((button) =>
						button
							.setButtonText(this.t("settings.llm.opencodeProvider.sync", "一键同步 OpenCode 配置"))
							.setCta()
							.onClick(async () => {
								await this.syncSelectedOpencodeProvider();
							}),
					)
					.addExtraButton((button) =>
						button
							.setIcon("refresh-cw")
							.setTooltip(this.t("settings.llm.presetModel.reload", "重新读取模型预置"))
							.onClick(() => {
								this.modelPresetResult = null;
								this.display();
							}),
					);
			} else {
				new Setting(statusGroup)
					.setName(this.t("settings.llm.opencodeProvider.name", "OpenCode Provider"))
					.setDesc(
						this.t(
							"settings.llm.opencodeProvider.missing",
							"未在 OpenCode 配置中读取到 provider。请检查 opencode.json。",
						),
					);
			}
		}

		new Setting(connectionGroup)
			.setName(this.t("settings.llm.apiUrl.name", "API 地址（必填）"))
			.setDesc(this.t("settings.llm.apiUrl.desc", "可填网关基础地址或完整 chat/completions 地址。"))
			.addText((text) =>
				text
					.setPlaceholder(this.t("settings.llm.apiUrl.placeholder", "例如: https://api.openai.com/v1"))
					.setValue(this.host.settings.llm.apiUrl)
					.onChange(async (value) => {
						this.host.settings.llm = patchActiveLlmConfig(this.host.settings.llm, {
							apiUrl: value.trim(),
						});
						await this.host.saveSettings();
						this.markLlmStatusDirty();
					}),
			);

		new Setting(connectionGroup)
			.setName(this.t("settings.llm.apiKey.name", "API 密钥（选填）"))
			.setDesc(this.t("settings.llm.apiKey.desc", "如果网关不需要密钥，可留空。"))
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder(this.t("settings.llm.apiKey.placeholder", "可留空"))
					.setValue(this.host.settings.llm.apiKey)
					.onChange(async (value) => {
						this.host.settings.llm = patchActiveLlmConfig(this.host.settings.llm, {
							apiKey: value.trim(),
						});
						await this.host.saveSettings();
						this.markLlmStatusDirty();
					});
			});

		if (mode === "group") {
			const modelPresets = this.getModelPresetResult();
			const currentModel = this.host.settings.llm.model.trim();
			const selected = modelPresets.models.includes(currentModel)
				? currentModel
				: modelPresets.models[0] ?? "";
			new Setting(connectionGroup)
				.setName(this.t("settings.llm.defaultModel.name", "默认模型"))
				.setDesc(this.t("settings.llm.presetModel.source", "来源: {source}", { source: modelPresets.source }))
				.addDropdown((dropdown) => {
					for (const model of modelPresets.models) {
						dropdown.addOption(model, modelPresets.modelLabels[model] ?? model);
					}
					dropdown.setValue(selected);
					dropdown.onChange(async (value) => {
						this.host.settings.llm = patchLlmModeConfig(this.host.settings.llm, "group", {
							model: value,
						});
						await this.host.saveSettings();
						this.markLlmStatusDirty();
						this.display();
					});
				})
				.addExtraButton((button) =>
					button
						.setIcon("refresh-cw")
						.setTooltip(this.t("settings.llm.presetModel.reload", "重新读取模型预置"))
						.onClick(() => {
							this.modelPresetResult = null;
							this.display();
						}),
				);
		}

		if (mode !== "group") {
			new Setting(connectionGroup)
				.setName(this.t("settings.llm.defaultModel.name", "默认模型"))
				.setDesc(this.t("settings.llm.defaultModel.desc", "可被当前 Agent 的模型覆盖。"))
				.addText((text) =>
					text
						.setPlaceholder(this.t("settings.llm.defaultModel.placeholder", "例如: glm-5 或 gpt-4o-mini"))
						.setValue(this.host.settings.llm.model)
						.onChange(async (value) => {
							this.host.settings.llm = patchActiveLlmConfig(this.host.settings.llm, {
								model: value.trim(),
							});
							await this.host.saveSettings();
							this.markLlmStatusDirty();
						}),
				);
		}

		const currentVisionModelKey = this.getCurrentVisionModelKey();
		const capability =
			this.testedVisionCapability && this.testedVisionModel === currentVisionModelKey
				? this.testedVisionCapability
				: null;
		const confidenceLabel = capability
			? capability.confidence === "high"
				? this.t("settings.llm.vision.confidence.high", "高")
				: capability.confidence === "medium"
					? this.t("settings.llm.vision.confidence.medium", "中")
					: this.t("settings.llm.vision.confidence.low", "低")
			: this.t("settings.llm.vision.confidence.unknown", "未测试");
		new Setting(capabilityGroup)
			.setName(this.t("settings.llm.vision.name", "视觉能力"))
			.setDesc(
				this.t("settings.llm.vision.desc", "结果：{result} | 置信度：{confidence} | {reason}", {
					result: capability
						? this.formatVisionCapability(capability)
						: this.t("settings.llm.vision.notTested", "未测试"),
					confidence: confidenceLabel,
					reason: capability?.reason ?? this.t("settings.llm.vision.pending", "点击右侧“能力测试”后会更新结果。"),
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(
						this.visionProbeStatus === "checking"
							? this.t("settings.llm.vision.checking", "能力测试中...")
							: this.t("settings.llm.vision.test", "能力测试"),
					)
					.setDisabled(this.visionProbeStatus === "checking")
					.onClick(async () => {
						await this.runVisionCapabilityTest();
					}),
			);

		new Setting(capabilityGroup)
			.setName(this.t("settings.llm.temperature.name", "温度（选填）"))
			.setDesc(this.t("settings.llm.temperature.desc", "留空时不发送 temperature 参数。"))
			.addText((text) =>
				text
					.setPlaceholder(this.t("settings.llm.temperature.placeholder", "例如 0.7"))
					.setValue(this.host.settings.llm.temperature == null ? "" : String(this.host.settings.llm.temperature))
					.onChange(async (value) => {
						this.host.settings.llm = patchActiveLlmConfig(this.host.settings.llm, {
							temperature: this.parseOptionalFloat(value),
						});
						await this.host.saveSettings();
					}),
			);

		new Setting(capabilityGroup)
			.setName(this.t("settings.llm.maxTokens.name", "最大 Token（选填）"))
			.setDesc(this.t("settings.llm.maxTokens.desc", "留空时不发送 max_tokens 参数。"))
			.addText((text) =>
				text
					.setPlaceholder(this.t("settings.llm.maxTokens.placeholder", "例如 4096"))
					.setValue(this.host.settings.llm.maxTokens == null ? "" : String(this.host.settings.llm.maxTokens))
					.onChange(async (value) => {
						this.host.settings.llm = patchActiveLlmConfig(this.host.settings.llm, {
							maxTokens: this.parseOptionalPositiveInt(value),
						});
						await this.host.saveSettings();
					}),
			);

		new Setting(capabilityGroup)
			.setName(this.t("settings.llm.streaming.name", "流式输出"))
			.setDesc(this.t("settings.llm.streaming.desc", "开启后，聊天回复将实时逐字显示。"))
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.llm.enableStreaming ?? true).onChange(async (value) => {
					this.host.settings.llm = patchActiveLlmConfig(this.host.settings.llm, {
						enableStreaming: value,
					});
					await this.host.saveSettings();
				}),
			);

		if (this.llmStatus === "failed" && this.llmStatusDetail) {
			const wrap = this.createNativeSettingsGroup(containerEl, {
				title: this.t("settings.llm.errorDetail.title", "错误详情（点击文本可复制）"),
				extraClass: "friday-llm-error-detail-wrap",
			});
			const detail = wrap.createEl("pre", {
				cls: "friday-llm-error-detail",
				text: this.llmStatusDetail,
			});
			detail.onclick = async () => {
				try {
					await navigator.clipboard.writeText(this.llmStatusDetail);
					new Notice(this.t("settings.llm.errorDetail.copySuccess", "已复制错误详情"), 2500);
				} catch {
					new Notice(this.t("settings.llm.errorDetail.copyFailed", "复制失败，请手动复制"), 2500);
				}
			};
		}
	}

	private renderAgentSection(containerEl: HTMLElement): void {
		const agents = this.host.settings.agents;
		const activeAgent = this.host.getActiveAgent();
		const identityGroup = this.createNativeSettingsGroup(containerEl);
		const runtimeGroup = this.createNativeSettingsGroup(containerEl);
		const pathGroup = this.createNativeSettingsGroup(containerEl);

		new Setting(identityGroup)
			.setName(this.t("settings.agent.current.name", "当前 Agent"))
			.setDesc(this.t("settings.agent.current.desc", "切换后，模型、对话、记忆和知识都会隔离。"))
			.addDropdown((dropdown) => {
				for (const agent of agents) {
					dropdown.addOption(agent.id, `${agent.name} (${agent.id})`);
				}
				if (agents.length > 0) {
					dropdown.setValue(this.host.settings.activeAgentId || agents[0]!.id);
				}
				dropdown.onChange(async (value) => {
					await this.host.setActiveAgent(value);
					this.display();
				});
			})
			.addText((text) =>
				text
					.setPlaceholder(this.t("settings.agent.create.placeholder", "新 Agent 名称"))
					.setValue(this.newAgentDraft)
					.onChange((value) => {
						this.newAgentDraft = value.trim();
					}),
			)
			.addButton((button) =>
				button.setButtonText(this.t("settings.agent.create.button", "新建 Agent")).setCta().onClick(async () => {
					const suggestedName = `Agent-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
					const nextName = this.newAgentDraft || suggestedName;
					const created = await this.host.createAgent({
						name: nextName,
						description: this.t("settings.agent.create.manualDesc", "手动创建"),
						model: "",
					});
					this.newAgentDraft = "";
					new Notice(this.t("settings.agent.create.success", "已创建 Agent: {name}", { name: created.name }), 3000);
					this.display();
				}),
			);

		if (activeAgent) {
			const agentModelOptions = this.getAvailableAgentModelOptions();
			const selectedModelValue = resolveSelectedAgentModelValue(activeAgent, agentModelOptions);
			new Setting(identityGroup)
				.setName(this.t("settings.agent.model.name", "当前 Agent 模型"))
				.setDesc(this.t("settings.agent.model.desc", "优先级高于全局默认模型。留空则使用全局模型。"))
				.addDropdown((dropdown) => {
					dropdown.addOption("", this.t("settings.agent.model.followGlobal", "跟随全局默认"));
					for (const option of agentModelOptions) {
						dropdown.addOption(option.value, option.label);
					}
					dropdown.setValue(selectedModelValue);
					dropdown.onChange(async (value) => {
						const parsed = parseAgentModelChoice(value);
						activeAgent.model = parsed?.model ?? "";
						activeAgent.modelMode = parsed?.mode;
						activeAgent.updatedAt = new Date().toISOString();
						await this.host.agentService.writeAgentProfile(activeAgent);
						await this.host.saveSettings();
					});
				});
		}

		new Setting(runtimeGroup)
			.setName(this.t("settings.agent.runtime.name", "启用 Agent 工具运行时"))
			.setDesc(this.t("settings.agent.runtime.desc", "开启后，AI 将按需调用 read/grep/glob/ls/write/delete/subagent。"))
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.agentRuntime.toolRuntimeEnabled).onChange(async (value) => {
					this.host.settings.agentRuntime.toolRuntimeEnabled = value;
					await this.host.saveSettings();
				}),
			);

		new Setting(runtimeGroup)
			.setName(this.t("settings.agent.toolCalling.name", "Tool Calling 模式"))
			.setDesc(
				this.t(
					"settings.agent.toolCalling.desc",
					"auto：优先 native tools，失败后回退 prompt；native：仅 native；prompt：仅提示词 JSON 模式。",
				),
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("auto", this.t("settings.agent.toolCalling.auto", "auto（推荐）"));
				dropdown.addOption("native", this.t("settings.agent.toolCalling.native", "native only"));
				dropdown.addOption("prompt", this.t("settings.agent.toolCalling.prompt", "prompt only"));
				dropdown.setValue(this.host.settings.agentRuntime.toolCallingMode ?? "auto");
				dropdown.onChange(async (value) => {
					this.host.settings.agentRuntime.toolCallingMode = value as "auto" | "native" | "prompt";
					await this.host.saveSettings();
				});
			});

		new Setting(runtimeGroup)
			.setName(this.t("settings.agent.maxToolIterations.name", "单轮最大工具步数"))
			.setDesc(this.t("settings.agent.maxToolIterations.desc", "限制单次对话中的工具循环次数，防止无限调用。"))
			.addText((text) =>
				text
					.setPlaceholder("6")
					.setValue(String(this.host.settings.agentRuntime.maxToolIterations))
					.onChange(async (value) => {
						const parsed = this.parseOptionalPositiveInt(value);
						if (parsed != null) {
							this.host.settings.agentRuntime.maxToolIterations = parsed;
							await this.host.saveSettings();
						}
					}),
			);

		new Setting(runtimeGroup)
			.setName(this.t("settings.agent.permissionMode.name", "工具权限模式"))
			.setDesc(
				this.t(
					"settings.agent.permissionMode.desc",
					"全自动：所有工具自动通过 | 标准：读操作自动，写入/执行需审批 | 严格：全部需审批",
				),
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("auto", this.t("settings.agent.permissionMode.auto", "🚀 全自动"));
				dropdown.addOption("standard", this.t("settings.agent.permissionMode.standard", "🛡️ 标准"));
				dropdown.addOption("strict", this.t("settings.agent.permissionMode.strict", "🔒 严格"));
				dropdown.setValue(this.host.settings.agentRuntime.toolPermissionMode);
				dropdown.onChange(async (value) => {
					this.host.settings.agentRuntime.toolPermissionMode = value as "auto" | "standard" | "strict";
					await this.host.saveSettings();
				});
			});

		if (this.host.settings.projects.length > 0) {
			const policyGroup = this.createNativeSettingsGroup(containerEl, {
				title: this.t("settings.agent.policy.title", "项目工具策略"),
				description: this.t(
					"settings.agent.policy.desc",
					"持久化层按 project > global 合并；session 级临时覆写在工作台对话页设置，只影响当前会话。",
				),
			});
			this.renderProjectPolicyEditor(policyGroup);
		}

		new Setting(runtimeGroup)
			.setName(this.t("settings.agent.enableSubagent.name", "启用子代理"))
			.setDesc(this.t("settings.agent.enableSubagent.desc", "允许 Agent 将子任务委托给子代理执行。"))
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.agentRuntime.enableSubagent).onChange(async (value) => {
					this.host.settings.agentRuntime.enableSubagent = value;
					await this.host.saveSettings();
				}),
			);

		new Setting(runtimeGroup)
			.setName(this.t("settings.agent.enableExec.name", "启用命令执行 (exec)"))
			.setDesc(this.t("settings.agent.enableExec.desc", "⚠️ 允许 Agent 在系统中执行 shell 命令（spawn 模式）。"))
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.agentRuntime.enableExecTool).onChange(async (value) => {
					this.host.settings.agentRuntime.enableExecTool = value;
					await this.host.saveSettings();
					this.display();
				}),
			);

		if (this.host.settings.agentRuntime.enableExecTool) {
			new Setting(runtimeGroup)
				.setName(this.t("settings.agent.execTimeout.name", "命令超时（秒）"))
				.setDesc(this.t("settings.agent.execTimeout.desc", "单条命令执行的最大等待时间。"))
				.addText((text) =>
					text
						.setPlaceholder("30")
						.setValue(String(this.host.settings.agentRuntime.execTimeout))
						.onChange(async (value) => {
							const parsed = this.parseOptionalPositiveInt(value);
							if (parsed != null) {
								this.host.settings.agentRuntime.execTimeout = parsed;
								await this.host.saveSettings();
							}
						}),
				);
		}

		new Setting(runtimeGroup)
			.setName(this.t("settings.agent.maxSubagentDepth.name", "子代理最大深度"))
			.setDesc(this.t("settings.agent.maxSubagentDepth.desc", "避免无限递归。默认 1 表示仅允许一层子代理。"))
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(String(this.host.settings.agentRuntime.maxSubagentDepth))
					.onChange(async (value) => {
						const parsed = this.parseOptionalPositiveInt(value);
						if (parsed != null) {
							this.host.settings.agentRuntime.maxSubagentDepth = parsed;
							await this.host.saveSettings();
						}
					}),
			);

		this.renderPathListSetting(
			pathGroup,
			this.t("settings.agent.path.vaultFocus.name", "Vault 聚焦路径"),
			this.t("settings.agent.path.vaultFocus.desc", "每行一个相对 Vault 的目录；为空表示允许读取整个 Vault。"),
			this.host.settings.agentRuntime.vaultFocusPaths,
			async (paths) => {
				this.host.settings.agentRuntime.vaultFocusPaths = paths;
				await this.host.saveSettings();
			},
		);

		this.renderPathListSetting(
			pathGroup,
			this.t("settings.agent.path.externalReadonly.name", "外路径只读白名单"),
			this.t("settings.agent.path.externalReadonly.desc", "每行一个绝对路径，供 Agent 只读访问。"),
			this.host.settings.agentRuntime.externalReadOnlyPaths,
			async (paths) => {
				this.host.settings.agentRuntime.externalReadOnlyPaths = paths;
				await this.host.saveSettings();
			},
		);

		this.renderPathListSetting(
			pathGroup,
			this.t("settings.agent.path.skillExternal.name", "Skill 外路径"),
			this.t("settings.agent.path.skillExternal.desc", "每行一个绝对路径，用于加载外部 skill 元数据。"),
			this.host.settings.agentRuntime.externalSkillPaths,
			async (paths) => {
				this.host.settings.agentRuntime.externalSkillPaths = paths;
				await this.host.saveSettings();
			},
		);

	}

	private renderProjectPolicyEditor(containerEl: HTMLElement): void {
		const projects = this.host.settings.projects;
		if (projects.length === 0) {
			return;
		}
		if (!this.policyEditorProjectSlug || !projects.some((item) => this.getProjectKey(item) === this.policyEditorProjectSlug)) {
			this.policyEditorProjectSlug = this.host.settings.activeProjectId || this.getProjectKey(projects[0]!);
		}

		new Setting(containerEl)
			.setName(this.t("settings.agent.policy.project", "策略作用项目"))
			.setDesc(this.t("settings.agent.policy.projectDesc", "编辑当前项目的工具策略覆盖。"))
			.addDropdown((dropdown) => {
				for (const project of projects) {
				dropdown.addOption(this.getProjectKey(project), this.getProjectLabel(project));
				}
				dropdown.setValue(this.policyEditorProjectSlug);
				dropdown.onChange((value) => {
					this.policyEditorProjectSlug = value;
					this.display();
				});
			});

		for (const tool of CapabilityRegistry.getInstance().listUserVisibleTools()) {
			const action = `tool:${tool.name}`;
			const matched = (this.host.settings.agentRuntime.projectToolPolicyRules[this.policyEditorProjectSlug] ?? [])
				.find((item) => item.action === action);
			new Setting(containerEl)
				.setName(action)
				.setDesc(this.t("settings.agent.policy.itemDesc", "inherit 表示沿用全局权限模式。"))
				.addDropdown((dropdown) => {
					dropdown.addOption("", "inherit");
					dropdown.addOption("allow", "allow");
					dropdown.addOption("ask", "ask");
					dropdown.addOption("deny", "deny");
					dropdown.setValue(matched?.effect ?? "");
					dropdown.onChange(async (value) => {
						const currentRules = this.host.settings.agentRuntime.projectToolPolicyRules[this.policyEditorProjectSlug] ?? [];
						const nextRules = currentRules.filter((item) => item.action !== action);
						if (value === "allow" || value === "ask" || value === "deny") {
							nextRules.push({ action, effect: value });
						}
						this.host.settings.agentRuntime.projectToolPolicyRules[this.policyEditorProjectSlug] = nextRules;
						await this.host.saveSettings();
					});
				});
		}
	}

	private renderSlashCommandSection(containerEl: HTMLElement): void {
		const manageGroup = this.createNativeSettingsGroup(containerEl);

		new Setting(manageGroup)
			.setName(this.t("settings.slash.manage.name", "命令管理"))
			.setDesc(this.t("settings.slash.manage.desc", "支持 {arg}（必填）与 {arg?}（选填）占位符，并可限制可用工具与模型。"))
			.addButton((button) =>
				button.setButtonText(this.t("settings.slash.manage.new", "新建命令")).setCta().onClick(async () => {
					this.host.settings.slashCommands.push(this.createDefaultSlashCommand());
					await this.host.saveSettings();
					this.display();
				}),
			)
			.addButton((button) =>
				button.setButtonText(this.t("settings.slash.manage.import", "导入剪贴板")).onClick(async () => {
					try {
						if (!navigator?.clipboard?.readText) {
							throw new Error(this.t("settings.slash.error.clipboardReadUnsupported", "当前环境不支持读取剪贴板。"));
						}
						const raw = await navigator.clipboard.readText();
						const parsed = JSON.parse(raw);
						if (!Array.isArray(parsed)) {
							throw new Error(this.t("settings.slash.error.importNotArray", "导入内容必须是命令数组 JSON。"));
						}
						const normalized = parsed
							.map((item, index) => this.sanitizeSlashCommandTemplate(item, index))
							.filter((item): item is SlashCommandTemplate => item != null);
						if (normalized.length === 0) {
							throw new Error(this.t("settings.slash.error.importEmpty", "未发现有效命令。"));
						}
						this.host.settings.slashCommands = normalized;
						await this.host.saveSettings();
						new Notice(this.t("settings.slash.notice.imported", "已导入 {count} 条命令。", { count: normalized.length }), 4000);
						this.display();
					} catch (error) {
						new Notice(this.t("settings.slash.notice.importFailed", "导入失败：{error}", { error: String(error) }), 6000);
					}
				}),
			)
			.addButton((button) =>
				button.setButtonText(this.t("settings.slash.manage.export", "导出剪贴板")).onClick(async () => {
					try {
						if (!navigator?.clipboard?.writeText) {
							throw new Error(this.t("settings.slash.error.clipboardWriteUnsupported", "当前环境不支持写入剪贴板。"));
						}
						const payload = JSON.stringify(this.host.settings.slashCommands, null, 2);
						await navigator.clipboard.writeText(payload);
						new Notice(this.t("settings.slash.notice.exported", "斜杠命令 JSON 已复制到剪贴板。"), 3000);
					} catch (error) {
						new Notice(this.t("settings.slash.notice.exportFailed", "导出失败：{error}", { error: String(error) }), 6000);
					}
				}),
			);

		if (this.host.settings.slashCommands.length === 0) {
			const emptyGroup = this.createNativeSettingsGroup(containerEl);
			emptyGroup.createEl("p", {
				text: this.t("settings.slash.empty", "暂无自定义命令。示例：/draft {arg} -> 请起草{arg}的技术方案。"),
			});
			return;
		}

		const commands = [...this.host.settings.slashCommands].sort((a, b) =>
			a.name.localeCompare(b.name, "zh-CN"),
		);
		for (const command of commands) {
			const card = this.createNativeSettingsGroup(containerEl, { title: `/${command.name}` });

			new Setting(card)
				.setName(this.t("settings.slash.command.enabled.name", "启用"))
				.setDesc(this.t("settings.slash.command.enabled.desc", "关闭后该命令不会被识别。"))
				.addToggle((toggle) =>
					toggle.setValue(command.enabled).onChange(async (value) => {
						const target = this.host.settings.slashCommands.find((item) => item.id === command.id);
						if (!target) return;
						target.enabled = value;
						await this.host.saveSettings();
					}),
				);

			new Setting(card).setName(this.t("settings.slash.command.name", "命令名")).addText((text) =>
				text
					.setPlaceholder(this.t("settings.slash.command.namePlaceholder", "例如 draft"))
					.setValue(command.name)
					.onChange(async (value) => {
						const normalized = this.normalizeSlashCommandName(value);
						const target = this.host.settings.slashCommands.find((item) => item.id === command.id);
						if (!target) return;
						target.name = normalized || target.name;
						await this.host.saveSettings();
					}),
			);

			new Setting(card)
				.setName(this.t("settings.slash.command.template.name", "模板"))
				.setDesc(this.t("settings.slash.command.template.desc", "支持占位符：{arg}、{arg?}。"))
				.addTextArea((textArea) => {
				textArea
					.setPlaceholder(this.t("settings.slash.command.template.placeholder", "例如：请整理 {arg} 的任务拆解与风险清单。"))
					.setValue(command.template)
					.onChange(async (value) => {
						const target = this.host.settings.slashCommands.find((item) => item.id === command.id);
						if (!target) return;
						target.template = value.trim();
						await this.host.saveSettings();
					});
				textArea.inputEl.rows = 3;
				textArea.inputEl.style.width = "100%";
				});

			new Setting(card)
				.setName(this.t("settings.slash.command.allowedTools.name", "允许工具"))
				.setDesc(this.t("settings.slash.command.allowedTools.desc", "逗号分隔。留空表示不限制，例如：read,write,grep"))
				.addText((text) =>
					text
						.setPlaceholder("read,write")
						.setValue(command.allowedTools.join(","))
						.onChange(async (value) => {
							const target = this.host.settings.slashCommands.find((item) => item.id === command.id);
							if (!target) return;
							target.allowedTools = this.parseCsvList(value).map((item) => item.toLowerCase());
							await this.host.saveSettings();
						}),
				);

			new Setting(card)
				.setName(this.t("settings.slash.command.allowedModels.name", "允许模型"))
				.setDesc(
					this.t(
						"settings.slash.command.allowedModels.desc",
						"逗号分隔。留空表示不限制，例如：glm-5,qwen3-coder-plus",
					),
				)
				.addText((text) =>
					text
						.setPlaceholder("glm-5,qwen3-coder-plus")
						.setValue(command.allowedModels.join(","))
						.onChange(async (value) => {
							const target = this.host.settings.slashCommands.find((item) => item.id === command.id);
							if (!target) return;
							target.allowedModels = this.parseCsvList(value);
							await this.host.saveSettings();
						}),
				)
				.addButton((button) =>
					button.setButtonText(this.t("settings.slash.command.delete", "删除")).setWarning().onClick(async () => {
						this.host.settings.slashCommands = this.host.settings.slashCommands.filter(
							(item) => item.id !== command.id,
						);
						await this.host.saveSettings();
						this.display();
					}),
				);
		}
	}

	private renderProjectSection(containerEl: HTMLElement): void {
		const shell = containerEl.createDiv({ cls: "friday-project-settings-shell" });
		this.renderActiveProjectSelector(shell);

		if (this.projectEditorDraft) {
			this.renderProjectEditorCard(shell);
		}

		this.renderProjectGroupSection(shell);

		if (this.host.settings.projects.length === 0) {
			this.createNativeSettingsGroup(shell, {
				title: this.t("settings.project.empty", "尚未注册项目。"),
				description: this.t("settings.project.active.desc", "Agent 与工具读写将严格限制在该项目根目录下。"),
				extraClass: "friday-empty-state friday-project-settings-panel",
			});
			return;
		}

		for (const group of this.getProjectGroupsForDisplay()) {
			const projectsInGroup = this.host.settings.projects.filter(
				(item) => (item.groupId || "default-group") === group.id,
			);
			if (projectsInGroup.length === 0) {
				continue;
			}
			this.renderProjectListGroup(shell, group, projectsInGroup);
		}
	}

	private renderActiveProjectSelector(containerEl: HTMLElement): void {
		const panel = this.createNativeSettingsGroup(containerEl, {
			extraClass: "friday-project-register-panel",
		});
		const registerSetting = new Setting(panel)
			.setName(this.t("settings.project.register", "注册项目"))
			.setDesc(this.t("settings.project.register.desc", "创建一个新的项目配置。"))
			.addButton((button) =>
				button.setButtonText(this.t("settings.project.register", "注册项目")).setCta().onClick(() => {
					void this.openRegisterProjectModal();
				}),
			);
		registerSetting.settingEl.addClass("friday-project-register-row");
	}

	private renderProjectGroupSection(containerEl: HTMLElement): void {
		containerEl.createEl("h4", {
			cls: "friday-project-group-heading",
			text: this.t("settings.project.group.manage", "项目组管理"),
		});
		const panel = this.createNativeSettingsGroup(containerEl, {
			extraClass: "friday-project-settings-panel friday-project-group-manager-panel",
		});
		new Setting(panel)
			.setName(this.t("settings.project.group.create", "新建项目组"))
			.setDesc(this.t("settings.project.group.createPrompt", "输入项目组名称"))
			.addText((text) =>
				text
					.setPlaceholder(this.t("settings.project.group.createPrompt", "输入项目组名称"))
					.setValue(this.newProjectGroupDraft)
					.onChange((value) => {
						this.newProjectGroupDraft = value.trim();
					}),
			)
			.addButton((button) =>
				button.setButtonText(this.t("settings.project.group.create", "新建项目组")).onClick(() => {
					void this.createProjectGroup();
				}),
			);

		for (const group of this.getProjectGroupsForDisplay()) {
			const count = this.host.settings.projects.filter((item) => (item.groupId || "default-group") === group.id).length;
			new Setting(panel)
				.setName(`${this.getProjectGroupDisplayName(group)} (${count})`)
				.setDesc(group.id)
				.addText((text) =>
					text
						.setPlaceholder(this.t("settings.project.group.renamePrompt", "输入新名称"))
						.setValue(group.name)
						.onChange((value) => {
							void this.renameProjectGroup(group, value);
						}),
				)
				.addButton((button) => {
					button.setButtonText(
						this.pendingDeleteGroupId === group.id
							? this.t("settings.project.group.removeConfirmInline", "再次点击删除")
							: this.t("settings.project.group.remove", "删除"),
					);
					button.setDisabled(group.id === "default-group");
					button.onClick(() => {
						void this.handleProjectGroupDeletion(group.id);
					});
				});
		}
	}

	private createProjectSettingsPanel(
		containerEl: HTMLElement,
		title: string,
		description = "",
		extraClass = "",
	): HTMLDivElement {
		const panel = this.createNativeSettingsGroup(containerEl, {
			extraClass: ["friday-project-settings-panel", extraClass].filter(Boolean).join(" "),
		});
		const header = panel.createDiv({ cls: "friday-project-panel-header" });
		header.createDiv({ cls: "friday-project-panel-title", text: title });
		if (description) {
			header.createDiv({ cls: "friday-project-panel-description", text: description });
		}
		return panel;
	}

	private renderProjectListGroup(
		containerEl: HTMLElement,
		group: Pick<ProjectGroupEntry, "id" | "name">,
		projects: ProjectEntry[],
	): void {
		containerEl.createEl("h4", {
			cls: "friday-project-group-heading",
			text: `${this.getProjectGroupDisplayName(group)} (${projects.length})`,
		});
		const listGroup = this.createNativeSettingsGroup(containerEl, {
			extraClass: "friday-project-list-group",
		});
		let expandedIgnoreProject: ProjectEntry | null = null;
		for (const project of projects) {
			this.renderProjectRow(listGroup, project);
			if (this.ignoreManagerProjectId === this.getProjectKey(project)) {
				expandedIgnoreProject = project;
			}
		}
		if (expandedIgnoreProject) {
			this.renderProjectIgnoreManager(containerEl, expandedIgnoreProject);
		}
	}

	private renderProjectRow(listGroup: HTMLElement, project: ProjectEntry): void {
		const projectKey = this.getProjectKey(project);
		const active = projectKey === this.host.settings.activeProjectId;
		const setting = new Setting(listGroup)
			.setName(
				active
					? `${this.getProjectLabel(project)} · ${this.t("settings.project.active.badge", "当前")}`
					: this.getProjectLabel(project),
			)
			.setDesc("");

		setting.descEl.empty();
		[
			`${this.t("projects.editor.vaultDir", "Vault directory")}: ${project.boundaryPath?.trim() || "/"}`,
			project.gitRemote
				? this.t("settings.project.desc.remote", "远程：{value}", { value: project.gitRemote })
				: this.t("settings.project.desc.remoteNotSet", "未设置远程"),
			project.lastSyncAt
				? this.t("settings.project.desc.lastSync", "最近同步：{value}", { value: project.lastSyncAt })
				: this.t("settings.project.desc.lastSyncNever", "从未同步"),
			`${this.getProjectGroupName(project.groupId || "default-group")} · ${
				project.autoSync
					? this.t("settings.project.desc.autoSyncOn", "自动同步：开")
					: this.t("settings.project.desc.autoSyncOff", "自动同步：关")
			}`,
		].forEach((line) => {
			setting.descEl.createDiv({
				cls: "friday-project-setting-detail",
				text: line,
			});
		});

		const actionsSetting = setting;
		actionsSetting.addButton((button) => {
			button.setButtonText(
				active
					? this.t("settings.project.active.badge", "当前")
					: this.t("settings.project.setActive", "设为当前"),
			);
			button.setDisabled(active);
			button.onClick(() => {
				void (async () => {
					await this.host.setActiveProject(projectKey);
					this.display();
				})();
			});
		});
		actionsSetting.addButton((button) => {
			button.setButtonText(this.t("settings.project.edit", "编辑"));
			button.onClick(() => {
				void this.openRegisterProjectModal(project);
			});
		});
		actionsSetting.addButton((button) => {
			button.setButtonText(this.t("settings.project.ignore", "忽略规则"));
			button.onClick(() => {
				void (async () => {
					if (this.ignoreManagerProjectId === projectKey) {
						this.ignoreManagerProjectId = "";
						this.ignoreManagerCandidates = [];
						this.ignoreManagerError = "";
						this.ignoreManagerPendingRulePath = "";
						this.display();
						return;
					}
					await this.loadProjectIgnoreCandidates(project);
					this.display();
				})();
			});
		});
		actionsSetting.addButton((button) => {
			button.setButtonText(this.t("settings.project.remove", "移除"));
			button.setWarning();
			button.onClick(() => {
				void (async () => {
					await this.host.removeProject(projectKey);
					this.display();
				})();
			});
		});
	}

	private async createProjectGroup(): Promise<void> {
		const name = this.newProjectGroupDraft.trim();
		if (!name) {
			return;
		}
		const id = normalizeProjectGroupIdCandidate(name);
		if (!id) {
			new Notice(this.t("settings.project.group.invalidId", "项目组名称无法生成合法 ID。"), 3000);
			return;
		}
		if (this.host.settings.projectGroups.some((item) => item.id === id)) {
			new Notice(this.t("settings.project.group.idExists", "项目组 ID 已存在：{id}", { id }), 3000);
			return;
		}
		const now = new Date().toISOString();
		await this.host.upsertProjectGroup({
			id,
			name,
			description: "",
			projectIds: [],
			createdAt: now,
			updatedAt: now,
		});
		this.newProjectGroupDraft = "";
		this.display();
	}

	private async renameProjectGroup(group: ProjectGroupEntry, rawValue: string): Promise<void> {
		const name = rawValue.trim();
		if (!name || name === group.name) {
			return;
		}
		await this.host.upsertProjectGroup({
			...group,
			name,
			updatedAt: new Date().toISOString(),
		});
		this.display();
	}

	private async handleProjectGroupDeletion(groupId: string): Promise<void> {
		if (this.pendingDeleteGroupId !== groupId) {
			this.pendingDeleteGroupId = groupId;
			this.display();
			return;
		}
		await this.host.removeProjectGroup(groupId);
		this.pendingDeleteGroupId = "";
		this.display();
	}

	private getProjectGroupsForDisplay(): ProjectGroupEntry[] {
		const now = new Date().toISOString();
		const map = new Map<string, ProjectGroupEntry>();
		for (const group of this.host.settings.projectGroups) {
			map.set(group.id, group);
		}
		if (!map.has("default-group")) {
			map.set("default-group", {
				id: "default-group",
				name: this.t("settings.project.group.defaultName", "默认项目组"),
				description: "",
				projectIds: [],
				createdAt: now,
				updatedAt: now,
			});
		}
		for (const project of this.host.settings.projects) {
			const groupId = project.groupId || "default-group";
			if (!map.has(groupId)) {
				map.set(groupId, {
					id: groupId,
					name: groupId,
					description: "",
					projectIds: [],
					createdAt: now,
					updatedAt: now,
				});
			}
		}
		return [...map.values()].sort((a, b) => {
			if (a.id === "default-group") return -1;
			if (b.id === "default-group") return 1;
			return a.name.localeCompare(b.name, "zh-CN");
		});
	}

	private getProjectGroupName(groupId: string): string {
		if (groupId === "default-group") {
			return this.t("settings.project.group.defaultName", "默认项目组");
		}
		return this.host.settings.projectGroups.find((group) => group.id === groupId)?.name ?? groupId;
	}

	private getProjectGroupDisplayName(group: Pick<ProjectGroupEntry, "id" | "name">): string {
		return group.id === "default-group" ? this.t("settings.project.group.defaultName", "默认项目组") : group.name;
	}

	private getProjectRegistrationModeLabel(mode: ProjectEditorDraft["mode"]): string {
		return this.t(`projects.editor.mode.${mode}`, mode);
	}

	private getProjectRegistrationModeOptions(): ProjectEditorSelectOption[] {
		return (["local_only", "remote_bootstrap"] as const).map((mode) => ({
			value: mode,
			label: this.getProjectRegistrationModeLabel(mode),
		}));
	}

	private getProjectGroupOptions(): ProjectEditorSelectOption[] {
		return this.getProjectGroupsForDisplay().map((group) => ({
			value: group.id,
			label: this.getProjectGroupDisplayName(group),
		}));
	}

	private renderPathListSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		value: string[],
		onSave: (paths: string[]) => Promise<void>,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addTextArea((textArea) => {
				textArea
					.setPlaceholder(this.t("settings.pathList.placeholder", "每行一个路径"))
					.setValue(value.join("\n"))
					.onChange(async (raw) => {
						const paths = this.parsePathList(raw);
						await onSave(paths);
					});
				textArea.inputEl.rows = 4;
				textArea.inputEl.style.width = "100%";
			});
	}

	private t(
		key: string,
		fallback: string,
		params?: Record<string, string | number | boolean | null | undefined>,
	): string {
		const translated = this.host.t(key, params);
		if (translated !== key) {
			return translated;
		}
		if (!params) {
			return fallback;
		}
		return fallback.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_full, name: string) => {
			const value = params[name];
			return value == null ? "" : String(value);
		});
	}

	private parsePathList(raw: string): string[] {
		return raw
			.split(/\r?\n|,/)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}

	private parseCsvList(raw: string): string[] {
		return raw
			.split(/,|\r?\n/)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}

	private normalizeSlashCommandName(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/^\/+/, "")
			.replace(/[^a-z0-9_-]/g, "");
	}

	private createDefaultSlashCommand(): SlashCommandTemplate {
		const nextIndex = this.host.settings.slashCommands.length + 1;
		return {
			id: `slash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name: `cmd${nextIndex}`,
			template: this.t("settings.slash.defaultTemplate", "请根据 {arg} 生成结构化任务拆解与执行建议。"),
			allowedTools: [],
			allowedModels: [],
			enabled: true,
		};
	}

	private sanitizeSlashCommandTemplate(input: unknown, index: number): SlashCommandTemplate | null {
		if (!input || typeof input !== "object") {
			return null;
		}
		const source = input as Partial<SlashCommandTemplate>;
		const name = this.normalizeSlashCommandName(String(source.name ?? ""));
		const template = String(source.template ?? "").trim();
		if (!name || !template) {
			return null;
		}
		return {
			id: String(source.id ?? `slash-import-${Date.now()}-${index}`),
			name,
			template,
			allowedTools: Array.isArray(source.allowedTools)
				? source.allowedTools
						.map((item) => String(item).trim().toLowerCase())
						.filter((item) => item.length > 0)
				: [],
			allowedModels: Array.isArray(source.allowedModels)
				? source.allowedModels.map((item) => String(item).trim()).filter((item) => item.length > 0)
				: [],
			enabled: source.enabled !== false,
		};
	}

	private parseOptionalFloat(value: string): number | null {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number.parseFloat(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}

	private parseOptionalPositiveInt(value: string): number | null {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number.parseInt(trimmed, 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}

	private getOpencodeConfigPaths(): string[] {
		return [
			path.join(homedir(), ".config", "opencode", "opencode.json"),
			path.join(homedir(), ".config", "opencode", "config.json"),
			path.join(homedir(), ".config", "opencode", "config.local.json"),
		];
	}

	private getModelPresetResult(): ModelPresetResult {
		const loaded = this.loadModelPresetsFromOpencodeConfig();
		if (loaded) {
			this.modelPresetResult = loaded;
			return loaded;
		}

		this.modelPresetResult = {
			models: [...BUILTIN_GROUP_MODELS],
			modelLabels: Object.fromEntries(BUILTIN_GROUP_MODELS.map((item) => [item, item])),
			source: this.t("settings.llm.presetModel.builtinSource", "内置集团模型预设"),
			editablePaths: this.getOpencodeConfigPaths(),
			providers: [],
			activeProvider: null,
		};
		return this.modelPresetResult;
	}

	private getAvailableAgentModelOptions() {
		const snapshot = this.readOpencodeSnapshot();
		const groupConfig = readModeConfig(this.host.settings.llm, "group");
		const groupProvider = selectOpencodeProvider(snapshot, groupConfig.opencodeProviderId);
		return buildAgentModelCatalogFromSettings(this.host.settings.llm, groupProvider?.models ?? []);
	}

	private loadModelPresetsFromOpencodeConfig(): ModelPresetResult | null {
		const snapshot = this.readOpencodeSnapshot();
		if (!snapshot || snapshot.providers.length === 0) {
			return null;
		}
		const groupConfig = readModeConfig(this.host.settings.llm, "group");
		const activeProvider = selectOpencodeProvider(snapshot, groupConfig.opencodeProviderId);
		const models = activeProvider?.models ?? [];
		return {
			models: models.map((item) => item.id),
			modelLabels: Object.fromEntries(models.map((item) => [item.id, item.label])),
			source: snapshot.sourcePath,
			editablePaths: [snapshot.sourcePath],
			providers: snapshot.providers,
			activeProvider,
		};
	}

	private readOpencodeSnapshot() {
		for (const configPath of this.getOpencodeConfigPaths()) {
			try {
				if (!existsSync(configPath)) continue;
				const raw = readFileSync(configPath, "utf8");
				const snapshot = parseOpencodeConfig(raw, configPath);
				if (snapshot.providers.length > 0) {
					return snapshot;
				}
			} catch (error) {
				console.warn("[Friday] Failed to read opencode config:", configPath, error);
			}
		}
		return null;
	}

	private async syncSelectedOpencodeProvider(): Promise<void> {
		const snapshot = this.readOpencodeSnapshot();
		const groupConfig = readModeConfig(this.host.settings.llm, "group");
		const provider = selectOpencodeProvider(snapshot, groupConfig.opencodeProviderId);
		if (!provider) {
			new Notice(
				this.t("settings.llm.opencodeProvider.syncFailed", "未读取到可同步的 OpenCode provider 配置。"),
				4000,
			);
			return;
		}

		this.host.settings.llm = patchLlmModeConfig(this.host.settings.llm, "group", {
			opencodeProviderId: provider.id,
			apiUrl: provider.baseURL,
			apiKey: provider.apiKey,
			extraHeaders: { ...provider.headers },
		});
		if (
			provider.models.length > 0 &&
			!provider.models.some((item) => item.id === this.host.settings.llm.model.trim())
		) {
			this.host.settings.llm = patchLlmModeConfig(this.host.settings.llm, "group", {
				model: provider.models[0]!.id,
			});
		}
		await this.host.saveSettings();
		this.markLlmStatusDirty();
		new Notice(
			this.t("settings.llm.opencodeProvider.syncSuccess", "已同步 OpenCode 配置：{provider}", {
				provider: provider.name,
			}),
			3000,
		);
		this.display();
	}

	private markLlmStatusDirty(): void {
		this.visionProbeStatus = "idle";
		this.testedVisionCapability = null;
		this.testedVisionModel = "";
		if (!this.host.aiService.isConfigured()) {
			this.llmStatus = "unconfigured";
			this.llmStatusDetail = this.t("settings.llm.status.needApiUrl", "请先填写 API 地址。");
			return;
		}
		this.llmStatus = "idle";
		this.llmStatusDetail = "";
	}

	private syncLlmStatusWithConfig(): void {
		if (!this.host.aiService.isConfigured()) {
			this.llmStatus = "unconfigured";
			this.llmStatusDetail = this.t("settings.llm.status.needApiUrl", "请先填写 API 地址。");
			return;
		}
		if (this.llmStatus === "unconfigured") {
			this.llmStatus = "idle";
			this.llmStatusDetail = "";
		}
	}

	private getLlmStatusLabel(): string {
		const labelMap: Record<LlmStatus, string> = {
			unconfigured: this.t("settings.llm.status.unconfigured", "未配置"),
			idle: this.t("settings.llm.status.idle", "未检测"),
			checking: this.t("settings.llm.status.checking", "检测中"),
			connected: this.t("settings.llm.status.connected", "已连接"),
			failed: this.t("settings.llm.status.failed", "连接失败"),
		};
		return labelMap[this.llmStatus];
	}

	private getLlmStatusDesc(): string {
		if (this.llmStatus === "unconfigured") return this.t("settings.llm.status.needApiUrl", "请先填写 API 地址。");
		if (this.llmStatus === "checking") return this.t("settings.llm.status.checkingDesc", "正在检测 LLM 连通性。");
		if (this.llmStatus === "connected") return this.llmStatusDetail || this.t("settings.llm.status.passed", "检测通过。");
		if (this.llmStatus === "failed") return this.t("settings.llm.status.failedDesc", "连接失败，请查看下方错误详情。");
		return this.t("settings.llm.status.idleDesc", "点击右侧按钮进行连通测试。");
	}

	private formatVisionCapability(capability: ModelCapabilityInfo): string {
		if (capability.vision === "supported") {
			return this.host.t("vision.supported", { model: capability.model || "N/A" });
		}
		if (capability.vision === "unsupported") {
			return this.host.t("vision.unsupported", { model: capability.model || "N/A" });
		}
		return this.host.t("vision.unknown", { model: capability.model || "N/A" });
	}

	private formatErrorMessage(error: unknown): string {
		const raw = error instanceof Error ? error.message : String(error ?? "");
		return raw.replace(/\r\n/g, "\n").trim();
	}

	private firstLine(text: string): string {
		return (
			text
				.split("\n")
				.map((line) => line.trim())
				.find((line) => line.length > 0) ?? ""
		);
	}

	private async runLlmConnectionTest(): Promise<void> {
		if (!this.host.aiService.isConfigured()) {
			this.llmStatus = "unconfigured";
			this.llmStatusDetail = this.t("settings.llm.status.needApiUrl", "请先填写 API 地址。");
			this.display();
			return;
		}

		this.llmStatus = "checking";
		this.llmStatusDetail = "";
		this.display();

		try {
			const probe = await this.host.aiService.checkConnection();
			const preview = probe.replace(/\s+/g, " ").trim();
			this.llmStatus = "connected";
			this.llmStatusDetail = preview
				? this.t("settings.llm.status.modelReply", "模型返回：{preview}", { preview: preview.slice(0, 80) })
				: this.t("settings.llm.status.passed", "检测通过。");
			new Notice(this.t("settings.llm.notice.success", "LLM 连通成功"), 3000);
		} catch (error) {
			const message = this.formatErrorMessage(error);
			this.llmStatus = "failed";
			this.llmStatusDetail = message || this.t("settings.llm.status.failed", "连接失败");
			new Notice(
				this.t("settings.llm.notice.failed", "LLM 连通失败：{error}", {
					error: this.firstLine(this.llmStatusDetail) || this.t("settings.llm.status.failed", "连接失败"),
				}),
				6000,
			);
		}
		this.display();
	}

	private async runVisionCapabilityTest(): Promise<void> {
		if (!this.host.aiService.isConfigured()) {
			this.testedVisionCapability = null;
			this.testedVisionModel = "";
			this.display();
			return;
		}

		this.visionProbeStatus = "checking";
		this.testedVisionCapability = null;
		this.testedVisionModel = "";
		this.display();

		try {
			const capability = await this.host.aiService.probeVisionCapability();
			this.testedVisionCapability = capability;
			this.testedVisionModel = this.getCurrentVisionModelKey();
		} finally {
			this.visionProbeStatus = "idle";
			this.display();
		}
	}

	private getCurrentVisionModelKey(): string {
		const activeAgent = this.host.getActiveAgent();
		const mode = activeAgent?.modelMode || this.host.settings.llm.mode;
		const model = activeAgent?.model?.trim() || this.host.settings.llm.model.trim();
		return `${mode}::${model}`;
	}

	private async openRegisterProjectModal(initial?: ProjectEntry): Promise<void> {
		const draft = this.createProjectEditorDraft(initial);
		this.projectEditorDraft = draft;
		this.projectEditorInitialProjectId = initial ? this.getProjectKey(initial) : "";
		this.projectEditorError = "";
		this.projectGitDetection = null;
		this.resetRemoteBootstrapDirectoryChoice();
		this.activeSection = "project";
		this.display();
		void this.refreshProjectGitDetection(draft)
			.then(() => {
				if (this.projectEditorDraft === draft) {
					this.display();
				}
			})
			.catch((error: unknown) => {
				console.error("[Friday] Failed to refresh project git detection while opening editor:", error);
			});
	}

	private createProjectEditorDraft(initial?: ProjectEntry): ProjectEditorDraft {
		if (initial) {
			const projectId = this.getProjectKey(initial);
			const boundaryPath =
				initial.boundaryPath ||
				this.computeDraftDefaultBoundaryPath({
					mode: "local_only",
					projectId,
					projectName: this.getProjectLabel(initial),
					gitRemote: initial.gitRemote,
				});
			return {
				groupId: initial.groupId || "default-group",
				mode: "local_only",
				projectId,
				projectName: this.getProjectLabel(initial),
				boundaryPath,
				localPath: "",
				gitRemote: initial.gitRemote,
				autoSync: initial.autoSync,
				slug: projectId,
				projectRootPath: boundaryPath,
			};
		}
		const defaultBoundaryPath = "";
		return {
			groupId: this.host.settings.projectGroups[0]?.id ?? "default-group",
			mode: "local_only",
			projectId: "",
			projectName: "",
			boundaryPath: defaultBoundaryPath,
			localPath: "",
			gitRemote: "",
			autoSync: false,
			slug: "",
			projectRootPath: defaultBoundaryPath,
		};
	}

	private renderProjectEditorCard(containerEl: HTMLElement): void {
		if (!this.projectEditorDraft) {
			return;
		}
		const draft = this.projectEditorDraft;
		const card = this.createNativeSettingsGroup(containerEl, {
			extraClass: "friday-project-settings-panel friday-project-editor-card",
		});
		if (this.projectEditorError) {
			card.createDiv({ cls: "friday-ai-error", text: this.projectEditorError });
		}
		this.renderProjectEditorDropdownSetting(
			card,
			this.t("projects.editor.mode", "Registration mode"),
			this.t("settings.project.editor.mode.desc", "决定项目是本地新建，还是从远端拉取。"),
			draft.mode,
			(value) => {
				draft.mode = value as ProjectEditorDraft["mode"];
				if (draft.mode === "remote_bootstrap") {
					this.applyRemoteBootstrapDefaults(draft);
					this.resetRemoteBootstrapDirectoryChoice();
					draft.boundaryPath = "";
					draft.projectRootPath = "";
				} else {
					this.resetRemoteBootstrapDirectoryChoice();
					draft.boundaryPath = "";
					draft.projectRootPath = "";
					draft.autoSync = false;
				}
				void this.refreshProjectGitDetection(draft);
				this.display();
			},
			this.getProjectRegistrationModeOptions(),
		);
		this.renderProjectEditorDropdownSetting(
			card,
			this.t("projects.editor.group", "Group"),
			this.t("settings.project.editor.group.desc", "项目会显示在对应项目组中；未指定时归入默认项目组。"),
			draft.groupId,
			(value) => {
				draft.groupId = value;
			},
			this.getProjectGroupOptions(),
		);
		this.renderProjectEditorTextSetting(
			card,
			this.t("projects.editor.projectName", "Project name"),
			this.t("settings.project.editor.projectName.desc", "用于设置页和工作台显示的项目名称。"),
			draft.projectName,
			(value) => {
				draft.projectName = value.trim();
				if (draft.mode === "remote_bootstrap") {
					this.syncRemoteBootstrapBoundaryPath(draft);
				}
			},
			"text",
			() => {
				this.refreshProjectEditorAfterTextCommit(draft);
			},
		);
		this.renderProjectEditorTextSetting(
			card,
			this.t("projects.editor.remote", "Git remote"),
			draft.mode === "remote_bootstrap"
				? this.t("settings.project.editor.remote.requiredDesc", "远端拉取模式必填。")
				: this.t(
					"settings.project.editor.remote.localDesc",
					"本地新建模式可选；如果所选目录已经绑定远端，这里会自动填入。",
				),
			draft.gitRemote,
			(value) => {
				draft.gitRemote = value.trim();
				if (draft.mode === "remote_bootstrap") {
					this.applyRemoteBootstrapDefaults(draft);
					this.syncRemoteBootstrapBoundaryPath(draft);
				}
				if (!draft.gitRemote) {
					draft.autoSync = false;
				}
			},
			"text",
			() => {
				this.commitProjectEditorRemoteChange(draft);
			},
		);
		const fields = card;
		if (draft.mode === "remote_bootstrap") {
			this.renderRemoteBootstrapDirectoryPicker(fields, draft);
		} else {
			const directoryOptions = this.listVaultDirectoryOptions(false);
			if (draft.boundaryPath.trim() && !directoryOptions.includes(draft.boundaryPath.trim())) {
				directoryOptions.unshift(draft.boundaryPath.trim());
			}
			this.renderProjectEditorDropdownSetting(
				card,
				this.t("projects.editor.vaultDir", "Obsidian local path"),
				this.t(
					"settings.project.editor.vaultDir.localDesc",
					"从当前 Obsidian Vault 中选择一个目录；如果该目录已经是 Git 仓库，会自动识别远端。",
				),
				this.normalizeVaultDirectorySelectionValue(draft.boundaryPath),
				(value) => {
					draft.boundaryPath = this.parseVaultDirectorySelectionValue(value);
					draft.projectRootPath = draft.boundaryPath;
					void this.refreshProjectGitDetection(draft);
					this.display();
				},
				[
					{
						value: "",
						label: this.t("settings.project.editor.vaultDir.placeholder", "请选择 Obsidian 本地路径"),
					},
					...directoryOptions.map((option) => ({ value: option, label: option })),
				],
			);
		}
		if (draft.mode === "local_only" && this.projectGitDetection?.detectedParentRepository) {
			card.createDiv({
				cls: "friday-ai-error",
				text: this.t(
					"projects.editor.parentRepoDetected",
					"当前目录位于上层 Git 仓库内，因此不会被视为独立项目仓库。仓库根：{root}",
					{ root: this.projectGitDetection.repositoryRoot },
				),
			});
		}
		const autoSyncAvailability = this.getDraftAutoSyncAvailability(draft);
		this.renderProjectEditorToggleSetting(
			card,
			this.t("projects.editor.autoSync", "Auto sync"),
			autoSyncAvailability.description,
			autoSyncAvailability.enabled ? draft.autoSync : false,
			(value) => {
				draft.autoSync = autoSyncAvailability.enabled ? value : false;
			},
			!autoSyncAvailability.enabled,
		);

		const actions = card.createDiv({ cls: "friday-approval-actions friday-project-editor-actions" });
		const saveButton = actions.createEl("button", { text: this.t("projects.editor.save", "Save project") });
		saveButton.addClass("mod-cta");
		saveButton.onclick = () => {
			void this.submitProjectEditor();
		};
		const cancelButton = actions.createEl("button", { text: this.t("projects.editor.cancel", "Cancel") });
		cancelButton.onclick = () => {
			this.projectEditorDraft = null;
			this.projectEditorInitialProjectId = "";
			this.projectEditorError = "";
			this.projectGitDetection = null;
			this.resetRemoteBootstrapDirectoryChoice();
			this.display();
		};
	}

	private renderProjectEditorTextSetting(
		containerEl: HTMLElement,
		label: string,
		description: string,
		value: string,
		onChange: (value: string) => void,
		type = "text",
		onCommit?: () => void,
	): void {
		const setting = new Setting(containerEl).setName(label).setDesc(description);
		setting.settingEl.addClass("friday-project-editor-setting");
		setting.addText((text) => {
			text.setValue(value).onChange((nextValue) => {
				onChange(nextValue);
			});
			const input = text.inputEl;
			input.type = type;
			input.addClass("friday-project-editor-input");
			input.onblur = () => {
				onCommit?.();
			};
		});
	}

	private renderProjectEditorDropdownSetting(
		containerEl: HTMLElement,
		label: string,
		description: string,
		value: string,
		onChange: (value: string) => void,
		options: ProjectEditorSelectOption[],
	): void {
		const setting = new Setting(containerEl).setName(label).setDesc(description);
		setting.settingEl.addClass("friday-project-editor-setting");
		setting.addDropdown((dropdown) => {
			const normalizedOptions =
				options.length > 0 ? options : [{ value: "default-group", label: this.getProjectGroupName("default-group") }];
			for (const item of normalizedOptions) {
				const optionValue = typeof item === "string" ? item : item.value;
				const optionLabel = typeof item === "string" ? item : item.label;
				dropdown.addOption(optionValue, optionLabel);
			}
			dropdown.setValue(value);
			dropdown.selectEl.addClass("friday-project-editor-input");
			dropdown.onChange((nextValue) => {
				onChange(nextValue);
			});
		});
	}

	private renderProjectEditorToggleSetting(
		containerEl: HTMLElement,
		label: string,
		description: string,
		value: boolean,
		onChange: (value: boolean) => void,
		disabled = false,
	): void {
		const setting = new Setting(containerEl).setName(label).setDesc(description);
		setting.settingEl.addClass("friday-project-editor-setting");
		setting.addToggle((toggle) => {
			toggle.setDisabled(disabled);
			toggle.setValue(value).onChange((nextValue) => {
				onChange(nextValue);
			});
		});
	}

	private commitProjectEditorBoundaryPath(draft: ProjectEditorDraft): void {
		void (async () => {
			await this.refreshProjectGitDetection(draft);
			this.display();
		})();
	}

	private commitProjectEditorRemoteChange(draft: ProjectEditorDraft): void {
		if (!this.getDraftAutoSyncAvailability(draft).enabled) {
			draft.autoSync = false;
		}
		this.display();
	}

	private getDraftAutoSyncAvailability(draft: ProjectEditorDraft): { enabled: boolean; description: string } {
		const effectiveRemote = draft.gitRemote.trim() || this.projectGitDetection?.gitRemote?.trim() || "";
		if (!effectiveRemote) {
			return {
				enabled: false,
				description: this.t(
					"settings.project.editor.autoSync.needsRemote",
					"填写或检测到 Git 远程地址后，才能开启自动同步。",
				),
			};
		}
		return {
			enabled: true,
			description: this.t("settings.project.editor.autoSync.desc", "开启后会按同步设置自动处理这个项目。"),
		};
	}

	private renderRemoteBootstrapDirectoryPicker(containerEl: HTMLElement, draft: ProjectEditorDraft): void {
		if (!this.projectEditorRemoteBootstrapChoiceInitialized) {
			this.primeRemoteBootstrapDirectoryChoice(draft);
		}

		const setting = new Setting(containerEl)
			.setName(this.t("projects.editor.vaultDir", "Obsidian local path"))
			.setDesc(
				this.t(
					"settings.project.editor.vaultDir.remoteDesc",
					"先从当前 Obsidian Vault 中选择一个目录；若目录非空，可改为在该目录下新建子文件夹。",
				),
			);
		setting.settingEl.addClass("friday-project-editor-setting");
		setting.addDropdown((dropdown) => {
			dropdown.addOption("", this.t("settings.project.editor.vaultDir.placeholder", "请选择 Obsidian 本地路径"));
			const directoryOptions = this.listVaultDirectoryOptions(true);
			const currentSelection = this.normalizeVaultDirectorySelectionValue(this.projectEditorRemoteBootstrapBasePath);
			if (currentSelection && !directoryOptions.includes(currentSelection)) {
				directoryOptions.push(currentSelection);
			}
			for (const optionValue of directoryOptions) {
				dropdown.addOption(optionValue, optionValue);
			}
			dropdown.setValue(this.normalizeVaultDirectorySelectionValue(this.projectEditorRemoteBootstrapBasePath));
			dropdown.selectEl.addClass("friday-project-editor-input");
			dropdown.onChange((selectionValue) => {
				void this.handleRemoteBootstrapDirectorySelection(draft, selectionValue);
			});
		});

		if (this.projectEditorRemoteBootstrapDirectoryState === "non_empty") {
			const warning = containerEl.createDiv({ cls: "friday-empty-state friday-project-editor-choice-card" });
			warning.createDiv({
				cls: "friday-project-empty-title",
				text: this.t("settings.project.remoteBootstrap.nonEmpty.title", "所选目录不是空文件夹"),
			});
			warning.createEl("p", {
				text: this.t(
					"settings.project.remoteBootstrap.nonEmpty.desc",
					"直接拉取远程仓库可能失败。你可以在该目录下创建一个新文件夹，或重新选择路径。",
				),
			});
			const actions = warning.createDiv({ cls: "friday-project-editor-choice-actions" });
			const createChildButton = actions.createEl("button", {
				text: this.t(
					"settings.project.remoteBootstrap.nonEmpty.createChild",
					"在所选目录下创建新文件夹",
				),
			});
			createChildButton.addClass("mod-cta");
			createChildButton.onclick = () => {
				this.projectEditorRemoteBootstrapResolution = "create_child";
				this.syncRemoteBootstrapBoundaryPath(draft);
				this.display();
			};
			const reselectButton = actions.createEl("button", {
				text: this.t("settings.project.remoteBootstrap.nonEmpty.reselect", "重选路径"),
			});
			reselectButton.onclick = () => {
				this.clearRemoteBootstrapDirectoryChoice();
				this.syncRemoteBootstrapBoundaryPath(draft);
				this.display();
			};

			if (this.projectEditorRemoteBootstrapResolution === "create_child" && draft.boundaryPath.trim()) {
				warning.createEl("p", {
					cls: "friday-ai-muted",
					text: this.t("settings.project.remoteBootstrap.nonEmpty.preview", "将创建到：{path}", {
						path: draft.boundaryPath,
					}),
				});
			}
		}
	}

	private listVaultDirectoryOptions(includeVaultRoot = false): string[] {
		const folders = this.app.vault
			.getAllLoadedFiles()
			.filter((item): item is TFolder => item instanceof TFolder)
			.map((folder) => folder.path.trim())
			.filter(Boolean)
			.filter((folderPath) => !isFridayManagedProjectRoot(folderPath, this.host.dataService.getFridayRoot()))
			.sort((left, right) => left.localeCompare(right, "en"));
		const options = [...new Set(folders)];
		return includeVaultRoot ? ["/", ...options] : options;
	}

	private async handleRemoteBootstrapDirectorySelection(draft: ProjectEditorDraft, selectionValue: string): Promise<void> {
		if (!selectionValue) {
			this.clearRemoteBootstrapDirectoryChoice();
			this.syncRemoteBootstrapBoundaryPath(draft);
			this.display();
			return;
		}

		const basePath = this.parseVaultDirectorySelectionValue(selectionValue);
		this.projectEditorRemoteBootstrapChoiceInitialized = true;
		this.projectEditorRemoteBootstrapBasePath = basePath;
		this.projectEditorRemoteBootstrapDirectoryState = this.getRemoteBootstrapDirectoryState(basePath);
		this.projectEditorRemoteBootstrapResolution =
			this.projectEditorRemoteBootstrapDirectoryState === "empty" ? "direct" : "unset";
		this.syncRemoteBootstrapBoundaryPath(draft);
		this.display();
	}

	private primeRemoteBootstrapDirectoryChoice(draft: ProjectEditorDraft): void {
		this.projectEditorRemoteBootstrapChoiceInitialized = true;
		const fallbackPath = this.computeDraftDefaultBoundaryPath(draft);
		const basePath = this.getParentVaultDirectory(fallbackPath);
		const optionValue = this.normalizeVaultDirectorySelectionValue(basePath);
		if (!this.listVaultDirectoryOptions(true).includes(optionValue)) {
			return;
		}
		this.projectEditorRemoteBootstrapBasePath = basePath;
		this.projectEditorRemoteBootstrapDirectoryState = this.getRemoteBootstrapDirectoryState(basePath);
		this.projectEditorRemoteBootstrapResolution =
			this.projectEditorRemoteBootstrapDirectoryState === "empty" ? "direct" : "unset";
		this.syncRemoteBootstrapBoundaryPath(draft);
	}

	private resetRemoteBootstrapDirectoryChoice(): void {
		this.projectEditorRemoteBootstrapBasePath = "";
		this.projectEditorRemoteBootstrapDirectoryState = "unknown";
		this.projectEditorRemoteBootstrapResolution = "unset";
		this.projectEditorRemoteBootstrapChoiceInitialized = false;
	}

	private clearRemoteBootstrapDirectoryChoice(): void {
		this.projectEditorRemoteBootstrapBasePath = "";
		this.projectEditorRemoteBootstrapDirectoryState = "unknown";
		this.projectEditorRemoteBootstrapResolution = "unset";
		this.projectEditorRemoteBootstrapChoiceInitialized = true;
	}

	private syncRemoteBootstrapBoundaryPath(draft: ProjectEditorDraft): void {
		if (draft.mode !== "remote_bootstrap") {
			return;
		}
		if (!this.projectEditorRemoteBootstrapBasePath && this.projectEditorRemoteBootstrapResolution === "unset") {
			draft.boundaryPath = "";
			draft.projectRootPath = "";
			return;
		}
		if (this.projectEditorRemoteBootstrapResolution === "direct") {
			draft.boundaryPath = this.projectEditorRemoteBootstrapBasePath.trim();
			draft.projectRootPath = draft.boundaryPath;
			return;
		}
		if (this.projectEditorRemoteBootstrapResolution === "create_child") {
			const nestedPath = this.buildRemoteBootstrapNestedPath(draft, this.projectEditorRemoteBootstrapBasePath);
			draft.boundaryPath = nestedPath;
			draft.projectRootPath = nestedPath;
			return;
		}
		draft.boundaryPath = "";
		draft.projectRootPath = "";
	}

	private buildRemoteBootstrapNestedPath(
		draft: Pick<ProjectEditorDraft, "mode" | "projectId" | "projectName" | "gitRemote">,
		basePath: string,
	): string {
		const defaultPath = this.computeDraftDefaultBoundaryPath(draft);
		const segment = defaultPath.split("/").filter(Boolean).pop() ?? "new-project";
		return basePath.trim() ? `${basePath.trim()}/${segment}` : segment;
	}

	private getParentVaultDirectory(value: string): string {
		const segments = value
			.trim()
			.replace(/\\/g, "/")
			.split("/")
			.map((item) => item.trim())
			.filter(Boolean);
		segments.pop();
		return segments.join("/");
	}

	private getRemoteBootstrapDirectoryState(basePath: string): RemoteBootstrapDirectoryState {
		const folder = this.resolveVaultFolder(basePath);
		if (!folder) {
			return "unknown";
		}
		return folder.children.length === 0 ? "empty" : "non_empty";
	}

	private resolveVaultFolder(basePath: string): TFolder | null {
		if (!basePath.trim()) {
			return this.app.vault.getRoot();
		}
		const target = this.app.vault.getAbstractFileByPath(basePath.trim());
		return target instanceof TFolder ? target : null;
	}

	private applyRemoteBootstrapDefaults(draft: ProjectEditorDraft): void {
		if (!draft.gitRemote?.trim()) {
			return;
		}
		const defaults = buildRemoteBootstrapDefaults(this.host.dataService.getFridayRoot(), draft.gitRemote);
		if (!draft.projectId.trim()) {
			draft.projectId = defaults.projectId;
			draft.slug = defaults.projectId;
		}
		if (!draft.projectName.trim()) {
			draft.projectName = defaults.projectName;
		}
		const projectIdDefault = this.computeProjectIdBoundaryPath(draft.projectId);
		const currentDefault = this.computeDraftDefaultBoundaryPath(draft);
		if (!draft.boundaryPath.trim() || draft.boundaryPath === projectIdDefault || draft.boundaryPath === currentDefault) {
			const nextDefault = this.computeDraftDefaultBoundaryPath(draft);
			draft.boundaryPath = nextDefault;
			draft.projectRootPath = nextDefault;
		}
	}

	private computeDraftDefaultBoundaryPath(
		draft: Pick<ProjectEditorDraft, "mode" | "projectId" | "projectName" | "gitRemote">,
	): string {
		if (draft.mode === "local_only") {
			return "";
		}
		const preferredName = draft.projectName.trim() || draft.projectId.trim();
		if (!preferredName) {
			return buildDefaultProjectRootPath(this.host.dataService.getFridayRoot(), "");
		}
		return buildDefaultProjectRootPath(this.host.dataService.getFridayRoot(), preferredName);
	}

	private computeProjectIdBoundaryPath(projectId: string): string {
		return buildDefaultProjectRootPath(this.host.dataService.getFridayRoot(), projectId.trim());
	}

	private normalizeVaultDirectorySelectionValue(value: string): string {
		return value.trim() || "/";
	}

	private parseVaultDirectorySelectionValue(value: string): string {
		return value.trim() === "/" ? "" : value.trim();
	}

	private refreshProjectEditorAfterTextCommit(draft: ProjectEditorDraft): void {
		void (async () => {
			await this.refreshProjectGitDetection(draft);
			this.display();
		})();
	}

	private async loadProjectIgnoreCandidates(project: ProjectEntry): Promise<void> {
		this.ignoreManagerProjectId = this.getProjectKey(project);
		try {
			this.ignoreManagerCandidates = await this.gitIgnoreService.listCandidates(project);
			this.ignoreManagerError = "";
			this.ignoreManagerPendingRulePath = "";
		} catch (error) {
			this.ignoreManagerCandidates = [];
			this.ignoreManagerError = error instanceof Error ? error.message : String(error ?? "");
			this.ignoreManagerPendingRulePath = "";
		}
	}

	private renderProjectIgnoreManager(containerEl: HTMLElement, project: ProjectEntry): void {
		const wrap = this.createNativeSettingsGroup(containerEl, {
			title: this.t("settings.project.ignoreTitle", "忽略候选：{project}", {
				project: this.getProjectLabel(project),
			}),
			extraClass: "friday-project-ignore-panel",
		});
		if (this.ignoreManagerError) {
			wrap.createDiv({ cls: "friday-ai-error", text: this.ignoreManagerError });
			return;
		}
		if (this.ignoreManagerCandidates.length === 0) {
			wrap.createEl("p", {
				text: this.t("settings.project.ignoreEmpty", "当前没有可忽略的未跟踪候选。"),
			});
			return;
		}
		for (const candidate of this.ignoreManagerCandidates) {
			const row = wrap.createDiv({ cls: "friday-sync-conflict-row" });
			row.createDiv({
				text: this.t("projects.ignore.item", "{path} ({kind})", {
					path: candidate.path,
					kind: candidate.kind,
				}),
			});
			const actions = row.createDiv({ cls: "friday-approval-actions" });
			if (this.ignoreManagerPendingRulePath === candidate.path) {
				const confirmButton = actions.createEl("button", {
					text: this.t("projects.ignore.confirmAction", "确认写入"),
				});
				confirmButton.onclick = () => {
					void this.applyProjectIgnoreRule(project, candidate.path);
				};
				const cancelButton = actions.createEl("button", {
					text: this.t("projects.ignore.cancelAction", "取消"),
				});
				cancelButton.onclick = () => {
					this.ignoreManagerPendingRulePath = "";
					this.display();
				};
			} else {
				const button = actions.createEl("button", {
					text: this.t("projects.ignore.apply", "Ignore"),
				});
				button.onclick = () => {
					this.ignoreManagerPendingRulePath = candidate.path;
					this.display();
				};
			}
		}
	}

	private async applyProjectIgnoreRule(project: ProjectEntry, rulePath: string): Promise<void> {
		await this.gitIgnoreService.applyRule(project, rulePath);
		this.ignoreManagerPendingRulePath = "";
		new Notice(this.t("projects.ignore.applied", "已写入忽略规则：{path}", { path: rulePath }), 3000);
		await this.loadProjectIgnoreCandidates(project);
		this.display();
	}

	private async refreshProjectGitDetection(draft: ProjectEditorDraft): Promise<void> {
		if (draft.mode !== "local_only" || !draft.boundaryPath.trim()) {
			this.projectGitDetection = null;
			return;
		}
		const previousDetectedRemote = this.projectGitDetection?.gitRemote?.trim() || "";
		const basePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? ".";
		const absolutePath = path.join(basePath, ...draft.boundaryPath.trim().replace(/\\/g, "/").split("/"));
		const nextDetection = await detectProjectGitState(absolutePath);
		const currentRemote = draft.gitRemote.trim();
		if (!currentRemote || currentRemote === previousDetectedRemote) {
			draft.gitRemote = nextDetection.gitRemote;
		}
		this.projectGitDetection = nextDetection;
		if (!this.getDraftAutoSyncAvailability(draft).enabled) {
			draft.autoSync = false;
		}
	}

	private async submitProjectEditor(): Promise<void> {
		if (!this.projectEditorDraft) {
			return;
		}
		const draft = this.projectEditorDraft;
		try {
			const isEditing = Boolean(this.projectEditorInitialProjectId);
			const entry = await submitProjectDraft({
				app: this.app,
				syncService: this.host.syncService,
				draft,
				initial: this.projectEditorInitialProjectId
					? this.host.settings.projects.find((project) => this.getProjectKey(project) === this.projectEditorInitialProjectId)
					: undefined,
				existingProjectIds: new Set(this.host.settings.projects.map((project) => this.getProjectKey(project))),
				fridayRoot: this.host.dataService.getFridayRoot(),
				currentUserId: this.host.getPrimaryUserId(),
			});
			await this.host.upsertProject(entry);
			await this.host.setActiveProject(this.getProjectKey(entry));
			this.projectEditorDraft = null;
			this.projectEditorInitialProjectId = "";
			this.projectEditorError = "";
			new Notice(
				this.t(
					isEditing ? "settings.project.notice.updated" : "settings.project.notice.registered",
					isEditing ? "项目已更新：{slug}" : "项目已注册：{slug}",
					{ slug: this.getProjectLabel(entry) },
				),
				3000,
			);
			this.display();
		} catch (error) {
			this.projectEditorError = error instanceof Error ? error.message : String(error ?? "");
			this.display();
		}
	}

	private async ensureUserGitCredentialLoaded(): Promise<void> {
		if (this.userGitCredentialLoaded) {
			return;
		}
		const credential = await this.host.getUserGitCredential();
		this.userGitUsernameDraft = credential?.username ?? "";
		this.userGitTokenDraft = credential?.token ?? "";
		this.userGitCredentialLoaded = true;
		this.display();
	}

	private async ensureGitRuntimeStatusLoaded(): Promise<void> {
		if (this.gitRuntimeStatusLoading) {
			return;
		}
		if (this.gitRuntimeStatus) {
			return;
		}
		this.gitRuntimeStatusLoading = true;
		try {
			this.gitRuntimeStatus = await this.host.getGitRuntimeStatus();
		} finally {
			this.gitRuntimeStatusLoading = false;
			this.display();
		}
	}

	private async persistUserGitCredential(): Promise<void> {
		await this.host.setUserGitCredential(
			this.userGitUsernameDraft && this.userGitTokenDraft
				? {
					username: this.userGitUsernameDraft,
					token: this.userGitTokenDraft,
				}
				: null,
		);
	}

	private isGitProfileComplete(): boolean {
		return Boolean(
			this.host.settings.user.gitUserEmail.trim() &&
			this.userGitUsernameDraft.trim() &&
			this.userGitTokenDraft.trim(),
		);
	}

	private getGitRuntimeStatusDesc(): string {
		if (this.gitRuntimeStatusLoading) {
			return this.t("settings.user.update.gitRuntime.checking", "正在检测本机 Git 环境...");
		}
		if (!this.gitRuntimeStatus) {
			return this.t("settings.user.update.gitRuntime.idle", "尚未检测 Git 环境。");
		}
		if (!this.gitRuntimeStatus.available) {
			return this.t("settings.user.update.gitRuntime.unavailable", "未检测到本机 Git：{error}", {
				error: this.gitRuntimeStatus.error || this.t("common.unknownError", "未知错误"),
			});
		}
		return this.t("settings.user.update.gitRuntime.available", "Git 已可用：{version}", {
			version: this.gitRuntimeStatus.version || this.t("common.notSet", "未设置"),
		});
	}

	private getPluginUpdateStatusDesc(): string {
		const lastChecked = this.host.settings.update.lastCheckedAt || this.t("common.never", "从未同步");
		const availableVersion = this.host.settings.update.availableVersion || this.t("common.notSet", "未设置");
		return this.t("settings.user.update.status.desc", "结果：{result} | 最近检查：{checkedAt} | 可用版本：{version}", {
			result: this.host.settings.update.lastResult,
			checkedAt: lastChecked,
			version: availableVersion,
		});
	}

	private async runPluginUpdateCheck(): Promise<void> {
		this.pluginUpdateActionPending = true;
		try {
			const result = await this.host.pluginUpdateService.checkForUpdate();
			this.host.settings.update.lastCheckedAt = new Date().toISOString();
			this.host.settings.update.lastResult = result.hasUpdate ? "available" : "up-to-date";
			this.host.settings.update.availableVersion = result.hasUpdate ? result.latestVersion : "";
			await this.host.saveSettings();
			new Notice(
				result.hasUpdate
					? this.t("settings.user.update.notice.available", "发现新版本：{version}", { version: result.latestVersion })
					: this.t("settings.user.update.notice.upToDate", "当前已是最新版本。"),
				4000,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			this.host.settings.update.lastResult = "error";
			this.host.settings.update.lastCheckedAt = new Date().toISOString();
			await this.host.saveSettings();
			new Notice(this.t("settings.user.update.notice.failed", "更新检查失败：{error}", { error: message }), 6000);
		} finally {
			this.pluginUpdateActionPending = false;
			this.display();
		}
	}

	private async runPluginUpdateApply(): Promise<void> {
		this.pluginUpdateActionPending = true;
		try {
			const result = await this.host.pluginUpdateService.applyUpdate();
			if (!result.success) {
				this.host.settings.update.lastResult = "error";
				await this.host.saveSettings();
				new Notice(this.t("settings.user.update.notice.applyFailed", "应用更新失败：{error}", {
					error: result.error || this.t("common.unknownError", "未知错误"),
				}), 6000);
				return;
			}
			this.host.settings.update.lastResult = "applied";
			this.host.settings.update.availableVersion = "";
			await this.host.saveSettings();
			this.showPluginUpdateRestartNotice();
		} finally {
			this.pluginUpdateActionPending = false;
			this.display();
		}
	}

	private showPluginUpdateRestartNotice(): void {
		const fragment = document.createDocumentFragment();
		const wrapper = document.createElement("div");
		wrapper.className = "friday-plugin-update-notice";

		const message = document.createElement("div");
		message.className = "friday-plugin-update-notice-text";
		message.textContent = this.t(
			"settings.user.update.notice.applied",
			"更新已写入。点击下方按钮立即重启 Obsidian，新版本加载后会按内置 studio 源内容重建“来自制作组”栏目。",
		);
		wrapper.appendChild(message);

		const actions = document.createElement("div");
		actions.className = "friday-plugin-update-notice-actions";
		const restartButton = document.createElement("button");
		restartButton.type = "button";
		restartButton.classList.add("mod-cta");
		restartButton.textContent = this.t("settings.user.update.notice.restart", "立即重启 Obsidian");
		let notice: Notice | null = null;
		restartButton.addEventListener("click", () => {
			notice?.hide();
			this.host.reloadObsidianApp();
		});
		actions.appendChild(restartButton);
		wrapper.appendChild(actions);
		fragment.appendChild(wrapper);
		notice = new Notice(fragment, 0);
	}

	private buildProjectDescription(project: ProjectEntry): string {
		const syncText = project.lastSyncAt
			? this.t("settings.project.desc.lastSync", "最近同步：{value}", { value: project.lastSyncAt })
			: this.t("settings.project.desc.lastSyncNever", "从未同步");
		const remoteText = project.gitRemote
			? this.t("settings.project.desc.remote", "远程：{value}", { value: project.gitRemote })
			: this.t("settings.project.desc.remoteNotSet", "未设置远程");
		const modeText = project.autoSync
			? this.t("settings.project.desc.autoSyncOn", "自动同步：开")
			: this.t("settings.project.desc.autoSyncOff", "自动同步：关");
		return `${remoteText} | ${modeText} | ${syncText}`;
	}

	private getProjectKey(project: ProjectEntry): string {
		return project.projectId;
	}

	private getProjectLabel(project: ProjectEntry): string {
		return project.projectName || project.projectId || project.slug;
	}
}

type SettingsSection = FridaySettingsSection;

export function isFridaySettingsSection(value: string | undefined): value is FridaySettingsSection {
	return value === "user" || value === "project" || value === "sync" || value === "llm" || value === "agent" || value === "slash";
}

