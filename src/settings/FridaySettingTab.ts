import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { App, Notice, Plugin, PluginSettingTab, Setting, TFolder } from "obsidian";
import { normalizeProjectGroupIdCandidate } from "./projectGroupId";
import {
	buildDefaultProjectRootPath,
	buildRemoteBootstrapDefaults,
	buildVaultRootProjectPath,
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
import type { LegacyFridayRootReport } from "../services/LegacyFridayRootMigrationService";
import { FridayPluginApi, type FridaySettingsSection } from "../types/plugin";
import type { OfficialContentSyncProgress } from "../types/officialContent";
import { ProjectEntry, ProjectGroupEntry } from "../types/project";
import { SlashCommandTemplate, isWorkbenchStartupPlacement } from "../types/settings";
import type { SoulTonePreset } from "../types/soul";
import type { LocaleCode } from "../i18n/types";
import { FRIDAY_WORDMARK_FONT_FAMILY } from "../constants/wordmarkFont";
import { OFFICIAL_CONTENT_LEGACY_TOP_LEVEL_PATHS } from "../constants/officialContent";
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
	private soulEditorDraftId = "";
	private soulEditorNameDraft = "";
	private soulEditorSummaryDraft = "";
	private soulEditorDefinitionDraft = "";
	private soulEditorTonePresetDraft: SoulTonePreset = "balanced";
	private soulEditorToneDraft = "";
	private pendingSoulCleanupConfirm = false;
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
	private projectEditorCreateInVaultRoot = false;
	private projectEditorVaultRootConfirmPending = false;
	private legacyFridayRootReport: LegacyFridayRootReport | null = null;
	private legacyFridayRootReportLoading = false;
	private officialContentGuardState: Awaited<ReturnType<SettingsHost["legacyFridayRootMigrationService"]["inspectDestructiveApplySafety"]>> | null = null;
	private officialContentGuardLoading = false;
	private pendingOfficialContentArchiveConfirm = false;
	private officialContentRefreshStatus: OfficialContentSyncProgress | null = null;
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
		if (section === "soul") {
			section = "agent";
		}
		if (this.activeSection === section) {
			return;
		}
		this.activeSection = section;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.renderSettingsTitle(containerEl);
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
		if (this.activeSection === "agent" || this.activeSection === "soul") {
			this.renderSoulSection(containerEl);
			return;
		}
		if (this.activeSection === "subscriptions") {
			this.renderSubscriptionsSection(containerEl);
			return;
		}
		this.renderProjectSection(containerEl);
	}

	private renderSettingsTitle(containerEl: HTMLElement): void {
		const titleText = this.host.t("settings.title");
		const brandText = this.t("nav.friday", "FRIDAY");
		const brandIndex = titleText.indexOf(brandText);
		if (brandIndex < 0) {
			containerEl.createEl("h2", { text: titleText });
			return;
		}

		const titleEl = containerEl.createEl("h2", { cls: "friday-settings-title" });
		const prefixText = titleText.slice(0, brandIndex).trim();
		const suffixText = titleText.slice(brandIndex + brandText.length).trim();

		if (prefixText) {
			titleEl.createSpan({ cls: "friday-settings-title-prefix", text: prefixText });
		}
		const brandEl = titleEl.createSpan({
			cls: "friday-settings-title-brand friday-wordmark",
			text: brandText,
		});
		brandEl.style.fontFamily = FRIDAY_WORDMARK_FONT_FAMILY;
		if (suffixText) {
			titleEl.createSpan({ cls: "friday-settings-title-suffix", text: suffixText });
		}
	}

	private renderSectionTabs(containerEl: HTMLElement): void {
		const nav = containerEl.createDiv({ cls: "friday-top-nav" });
		const items: Array<{ id: SettingsSection; label: string }> = [
			{ id: "user", label: this.host.t("settings.section.user") },
			{ id: "project", label: this.host.t("settings.section.project") },
			{ id: "sync", label: this.host.t("settings.section.sync") },
			{ id: "llm", label: this.host.t("settings.section.llm") },
			{ id: "agent", label: this.host.t("settings.section.agent") },
			{ id: "subscriptions", label: this.host.t("settings.section.subscriptions") },
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
		const workbenchGroup = this.createNativeSettingsGroup(containerEl, {
			title: this.t("settings.workbench.title", "启动入口"),
			description: this.t("settings.workbench.desc", "控制 Obsidian 启动后 FRIDAY 是否自动出现，以及出现在哪个工作区位置。"),
		});
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

		new Setting(profileGroup).setName(this.t("settings.user.displayName.name", "FRIDAY 如何称呼你")).addText((text) =>
			text
				.setPlaceholder(this.t("settings.user.displayName.placeholder", "FRIDAY 怎么称呼您"))
				.setValue(this.host.settings.user.displayName)
				.onChange(async (value) => {
					this.host.settings.user.displayName = value.trim();
					await this.host.saveSettings();
				}),
		);

		new Setting(workbenchGroup)
			.setName(this.t("settings.workbench.openOnStartup.name", "Obsidian 启动后自动唤醒 FRIDAY"))
			.setDesc(this.t("settings.workbench.openOnStartup.desc", "仅自动打开工作台入口，不会自动同步项目、刷新官方内容或调用模型。"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.workbench.openOnStartup)
					.onChange(async (value) => {
						this.host.settings.workbench.openOnStartup = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(workbenchGroup)
			.setName(this.t("settings.workbench.startupPlacement.name", "自动打开位置"))
			.setDesc(this.t("settings.workbench.startupPlacement.desc", "选择启动时 FRIDAY 工作台默认打开的侧边栏位置。"))
			.addDropdown((dropdown) => {
				dropdown.addOption("right-sidebar", this.t("settings.workbench.startupPlacement.rightSidebar", "右侧边栏"));
				dropdown.addOption("left-sidebar", this.t("settings.workbench.startupPlacement.leftSidebar", "左侧边栏"));
				dropdown.setValue(this.host.settings.workbench.startupPlacement);
				dropdown.onChange(async (value) => {
					if (!isWorkbenchStartupPlacement(value)) {
						return;
					}
					this.host.settings.workbench.startupPlacement = value;
					await this.host.saveSettings();
				});
			});

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

		const accessStatus = this.getReleaseFeedAccessStatus();
		const prerequisitesReady = accessStatus.ready;
		const prereqDetails = accessStatus;
		const availableVersion = this.host.settings.update.availableVersion.trim();
		const hasAvailableUpdate = Boolean(availableVersion);
		const needsPluginReload = this.host.settings.update.lastResult === "applied";

		new Setting(card)
			.setName(
				this.t("settings.user.update.currentVersion.name", "当前版本号：{version}", {
					version: this.host.manifest.version,
				}),
			)
			.setDesc(
				needsPluginReload
					? this.t(
						"settings.user.update.notice.applied",
						"更新已写入。点击下方按钮重新加载 FRIDAY 插件，新版本加载后会按内置 studio 源内容重建“来自制作组”栏目。",
					)
					: this.getPluginUpdateStatusDesc(),
			)
			.addButton((button) => {
				button
					.setButtonText(
						needsPluginReload
							? this.t("settings.user.update.notice.restart", "重新加载 FRIDAY 插件")
							: hasAvailableUpdate
							? this.t("settings.user.update.currentVersion.apply", "应用更新")
							: this.t("settings.user.update.currentVersion.check", "检查更新"),
					)
					.setDisabled(!prerequisitesReady || this.pluginUpdateActionPending);
				if (needsPluginReload || hasAvailableUpdate) {
					button.setCta();
				} else {
					button.removeCta();
				}
				button.onClick(async () => {
					if (needsPluginReload) {
						await this.runPluginUpdateReload();
						return;
					}
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

	private renderSubscriptionsUnavailableState(
		containerEl: HTMLElement,
		details: { readyLabels: string[]; pendingLabels: string[]; summary: string },
	): void {
		const group = this.createNativeSettingsGroup(containerEl, {
			title: this.t("settings.subscriptions.unavailable.title", "订阅频道暂不可用"),
			description: this.t(
				"settings.subscriptions.unavailable.desc",
				"当前还不能使用订阅频道。请先补充读取发布 feed 所需的基础配置，然后再返回这里。",
			),
			extraClass: "friday-project-settings-panel",
		});
		if (details.readyLabels.length > 0) {
			group.createEl("p", {
				text: this.t("settings.user.update.prerequisites.ready", "已完成：{items}", {
					items: details.readyLabels.join("、"),
				}),
			});
		}
		if (details.pendingLabels.length > 0) {
			group.createEl("p", {
				text: this.t("settings.user.update.prerequisites.pending", "待完成：{items}", {
					items: details.pendingLabels.join("、"),
				}),
			});
		}
		new Setting(group)
			.setName(this.t("settings.subscriptions.unavailable.action", "前往基础配置补充信息"))
			.setDesc(details.summary)
			.addButton((button) =>
				button
					.setCta()
					.setButtonText(this.t("settings.subscriptions.unavailable.action", "前往基础配置补充信息"))
					.onClick(() => {
						this.focusSection("user");
						this.display();
					}),
			);
	}

	private getReleaseFeedAccessStatus(): { ready: boolean; readyLabels: string[]; pendingLabels: string[]; summary: string } {
		const gitAvailable = Boolean(this.gitRuntimeStatus?.available);
		const items = [
			{ done: this.userGitUsernameDraft.trim().length > 0, label: this.t("settings.user.gitUsername.name", "Git 用户名") },
			{ done: this.userGitTokenDraft.trim().length > 0, label: this.t("settings.user.gitToken.name", "Git 令牌") },
			{ done: gitAvailable, label: this.t("settings.user.update.gitRuntime.summary", "本地 Git 环境") },
		];
		const readyLabels = items.filter((item) => item.done).map((item) => item.label);
		const pendingLabels = items.filter((item) => !item.done).map((item) => item.label);
		let missingCount = 0;
		if (!this.userGitUsernameDraft.trim()) missingCount += 1;
		if (!this.userGitTokenDraft.trim()) missingCount += 1;
		if (!gitAvailable) missingCount += 1;
		return {
			ready: pendingLabels.length === 0,
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

	private renderSubscriptionsSection(containerEl: HTMLElement): void {
		void this.ensureUserGitCredentialLoaded();
		void this.ensureGitRuntimeStatusLoaded();
		const accessStatus = this.getReleaseFeedAccessStatus();
		if (!accessStatus.ready) {
			this.renderSubscriptionsUnavailableState(containerEl, accessStatus);
			return;
		}

		void this.ensureOfficialContentGuardStateLoaded();
		const controls = this.createNativeSettingsGroup(containerEl, {
			title: this.t("settings.subscriptions.title", "订阅频道"),
			description: this.t(
				"settings.subscriptions.desc",
				"在这里选择要挂载到 F.R.I.D.A.Y/ 的官方栏目。官方栏目默认会自动订阅，你也可以手动关闭不需要的栏目。",
			),
		});

		new Setting(controls)
			.setName(this.t("settings.subscriptions.lastChecked.name", "最近检查"))
			.setDesc(
				this.host.settings.officialContent.lastCheckedAt
					|| this.t("settings.subscriptions.lastChecked.never", "尚未检查官方内容。"),
			)
			.addButton((button) =>
				button
					.setButtonText(this.t("settings.subscriptions.refresh", "刷新官方内容"))
					.setCta()
					.setDisabled(this.isOfficialContentRefreshRunning())
					.onClick(() => this.queueOfficialContentBackgroundSync()),
			);
		this.renderOfficialContentRefreshStatus(controls);

		const blockingPaths = this.officialContentGuardState?.blockingPaths ?? [];
		if (this.officialContentGuardState?.blocked) {
			const warningGroup = this.createNativeSettingsGroup(containerEl, {
					title: this.t("settings.subscriptions.legacy.warning", "检测到 FRIDAY 根目录历史内容"),
				description: this.t(
					"settings.subscriptions.legacy.warningDesc",
					"F.R.I.D.A.Y/ 将作为订阅频道目录使用。你可以先把当前旧文件夹归档改名，再刷新官方内容。",
				),
				extraClass: "friday-project-settings-panel",
			});
			warningGroup.createEl("p", {
				text: this.t("settings.subscriptions.legacy.blockingPaths", "阻断路径：{paths}", {
					paths: blockingPaths.join(" | "),
				}),
			});
			new Setting(warningGroup)
				.setName(
					this.pendingOfficialContentArchiveConfirm
						? this.t("settings.subscriptions.legacy.archiveConfirm", "确认归档旧版本文件夹")
						: this.t("settings.subscriptions.legacy.archive", "归档旧版本文件夹"),
				)
				.setDesc(
					this.pendingOfficialContentArchiveConfirm
						? this.t("settings.subscriptions.legacy.archiveConfirmDesc", "这不会删除旧数据；只会把当前 F.R.I.D.A.Y/ 改名，为订阅频道腾出新的 F.R.I.D.A.Y/。")
						: this.t("settings.subscriptions.legacy.archiveDesc", "将当前 F.R.I.D.A.Y/ 改名为“旧版本F.R.I.D.A.Y文件夹”，保留里面的项目、个人和 Agent 数据供你之后手动整理。"),
				)
				.addButton((button) =>
					button
						.setWarning()
						.setButtonText(
							this.pendingOfficialContentArchiveConfirm
								? this.t("settings.subscriptions.legacy.archiveConfirm", "确认归档旧版本文件夹")
								: this.t("settings.subscriptions.legacy.archive", "归档旧版本文件夹"),
						)
						.onClick(async () => {
							if (!this.pendingOfficialContentArchiveConfirm) {
								this.pendingOfficialContentArchiveConfirm = true;
								this.display();
								return;
							}
							try {
								const result = await this.host.legacyFridayRootMigrationService.archiveVisibleLegacyRoot();
								this.pendingOfficialContentArchiveConfirm = false;
								await this.host.officialContentService.applySubscriptions();
								await this.refreshOfficialContentGuardState();
								new Notice(
									this.t("settings.subscriptions.legacy.archiveSuccess", "已归档旧版本文件夹：{path}。你可以稍后自行迁移其中与项目相关的信息。", {
										path: result.archivedPath,
									}),
									5000,
								);
							} catch (error) {
								this.pendingOfficialContentArchiveConfirm = false;
								new Notice(
									this.t("settings.subscriptions.legacy.archiveFailed", "归档旧版本文件夹失败：{error}", {
										error: String(error ?? ""),
									}),
									6000,
								);
							} finally {
								this.display();
							}
						}),
				);
		}

		new Setting(controls)
			.setName(this.t("settings.subscriptions.checkOnStartup.name", "启动时自动检查"))
			.setDesc(this.t("settings.subscriptions.checkOnStartup.desc", "插件启动时自动刷新官方内容目录并尝试应用订阅。"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.officialContent.checkOnStartup)
					.onChange(async (value) => {
						this.host.settings.officialContent.checkOnStartup = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(controls)
			.setName(this.t("settings.subscriptions.delay.name", "启动检查延迟（ms）"))
			.setDesc(this.t("settings.subscriptions.delay.desc", "避免在插件刚启动时立即拉取官方内容目录。"))
			.addText((text) =>
				text
					.setPlaceholder("5000")
					.setValue(String(this.host.settings.officialContent.startupDelayMs))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						this.host.settings.officialContent.startupDelayMs = Number.isFinite(parsed) ? Math.max(parsed, 0) : 5000;
						await this.host.saveSettings();
					}),
			);

		const providerGroup = this.createNativeSettingsGroup(containerEl, {
			title: this.t("settings.subscriptions.provider.official", "Official channel"),
			description: this.t(
				"settings.subscriptions.provider.official.desc",
				"F.R.I.D.A.Y/ 本身是官方频道挂载点；下面的一级目录或一级 Markdown 会作为可订阅栏目显示。",
			),
		});

		if (this.host.settings.officialContent.catalog.length === 0) {
			providerGroup.createEl("p", {
				text: this.t("settings.subscriptions.empty", "暂无可显示的栏目。先点击“刷新官方内容”。"),
			});
			return;
		}

		for (const entry of this.host.settings.officialContent.catalog) {
			const state = this.ensureOfficialContentChannelState(entry.id);
			new Setting(providerGroup)
				.setName(entry.title)
				.setDesc(
					this.t("settings.subscriptions.column.desc", "{kind} | 路径：{path} | 版本：{version}", {
						kind: entry.kind,
						path: entry.path,
						version: entry.version,
					}),
				)
				.addToggle((toggle) =>
					toggle
						.setValue(state.subscribed)
						.onChange(async (value) => {
							const target = this.ensureOfficialContentChannelState(entry.id);
							target.subscribed = value;
							target.path = entry.path;
							target.lastAppliedVersion = "";
							await this.host.saveSettings();
							if (value) {
								this.queueOfficialContentBackgroundSync();
							} else {
								await this.host.officialContentService.applySubscriptions();
							}
							await this.refreshOfficialContentGuardState();
							this.display();
						}),
				);
		}
	}

	private renderOfficialContentRefreshStatus(containerEl: HTMLElement): void {
		const status = this.getOfficialContentRefreshStatus();
		if (status.stage === "idle") {
			return;
		}

		const statusLabel = this.getOfficialContentRefreshStatusLabel(status);
		const detail = status.error?.trim()
			? this.t("settings.subscriptions.refreshStatus.error", "错误：{error}", { error: status.error })
			: status.message;
		const statusSetting = new Setting(containerEl)
			.setName(this.t("settings.subscriptions.refreshStatus.name", "刷新状态"))
			.setDesc(
				this.t("settings.subscriptions.refreshStatus.desc", "当前状态：{status}。{detail}", {
					status: statusLabel,
					detail,
				}),
			);
		const progressContainer = statusSetting.controlEl.createDiv({ cls: "friday-subscriptions-refresh-progress" });
		const progressEl = progressContainer.createEl("progress") as HTMLProgressElement;
		const percent = Math.max(0, Math.min(100, Math.round(status.percent)));
		progressEl.max = 100;
		progressEl.value = percent;
		progressEl.setAttribute("aria-label", statusLabel);
		progressContainer.createSpan({
			cls: "friday-subscriptions-refresh-progress-label",
			text: this.t("settings.subscriptions.refreshStatus.progress", "{percent}%", { percent }),
		});
	}

	private queueOfficialContentBackgroundSync(): void {
		new Notice(this.t("settings.subscriptions.refreshQueued", "官方内容正在后台刷新。图片较多时可稍后回来查看。"), 4000);
		void this.host.officialContentService.runBackgroundSync((progress) => {
			this.officialContentRefreshStatus = progress;
			if (this.activeSection === "subscriptions") {
				this.display();
			}
		})
			.then(async () => {
				await this.refreshOfficialContentGuardState();
				new Notice(this.t("settings.subscriptions.refreshSuccess", "官方内容目录已刷新。"), 3000);
			})
			.catch((error) => {
				new Notice(
					this.t("settings.subscriptions.refreshFailed", "刷新官方内容失败：{error}", {
						error: String(error ?? ""),
					}),
					6000,
				);
			})
			.finally(() => {
				this.display();
			});
	}

	private getOfficialContentRefreshStatus(): OfficialContentSyncProgress {
		return this.officialContentRefreshStatus ?? this.host.officialContentService.getBackgroundSyncProgress();
	}

	private isOfficialContentRefreshRunning(): boolean {
		const stage = this.getOfficialContentRefreshStatus().stage;
		return stage === "refreshingCatalog" || stage === "applyingSubscriptions";
	}

	private getOfficialContentRefreshStatusLabel(status: OfficialContentSyncProgress): string {
		switch (status.stage) {
			case "refreshingCatalog":
				return this.t("settings.subscriptions.refreshStatus.refreshingCatalog", "正在读取官方内容目录");
			case "applyingSubscriptions":
				return this.t("settings.subscriptions.refreshStatus.applyingSubscriptions", "正在应用订阅内容");
			case "completed":
				return this.t("settings.subscriptions.refreshStatus.completed", "刷新完成");
			case "failed":
				return this.t("settings.subscriptions.refreshStatus.failed", "刷新失败");
			default:
				return this.t("settings.subscriptions.refreshStatus.idle", "空闲");
		}
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

	private renderSoulSection(containerEl: HTMLElement): void {
		const souls = this.host.listSouls();
		const activeSoul = this.host.getActiveSoul();
		const activeSoulDefinition = activeSoul ? this.host.soulStore.getSoulSync(activeSoul.id) : null;
		const identityGroup = this.createNativeSettingsGroup(containerEl);
		const managementGroup = this.createNativeSettingsGroup(containerEl, {
			title: this.t("settings.agent.manage.title", "Soul 管理"),
			description: this.t(
				"settings.agent.manage.desc",
				"先看当前有哪些已配置的 Soul，再决定切换、编辑或删除。下面的定义编辑区用于修改当前选中的 Soul。",
			),
		});
		const profileGroup = this.createNativeSettingsGroup(containerEl, {
			title: this.t("settings.agent.profile.title", "当前 Soul 定义"),
			description: this.t(
				"settings.agent.profile.desc",
				"这里配置当前 Soul，也就是 FRIDAY 的人格、风格和行为方式。",
			),
		});
		const runtimeGroup = this.createNativeSettingsGroup(containerEl);
		const pathGroup = this.createNativeSettingsGroup(containerEl);

		new Setting(identityGroup)
				.setName(this.t("settings.agent.currentSoul.name", "当前 FRIDAY Soul"))
			.setDesc(
				this.t(
					"settings.agent.currentSoul.desc",
				"Soul 是对 FRIDAY 的人格、风格的定义，可灵活调整。",
				),
			)
			.addDropdown((dropdown) => {
				for (const soul of souls) {
					dropdown.addOption(soul.id, this.resolveSoulDisplayName(soul));
				}
				if (souls.length > 0) {
					dropdown.setValue(activeSoul?.id || souls[0]!.id);
				}
				dropdown.onChange(async (value) => {
					await this.host.setActiveSoul(value);
					this.display();
				});
			});

		if (activeSoulDefinition) {
			this.ensureSoulEditorDraft(activeSoulDefinition);
			new Setting(identityGroup)
				.setName(this.t("settings.agent.currentModel.name", "当前 FRIDAY Model"))
				.setDesc(this.t("settings.agent.model.desc", "优先级高于全局默认模型。留空则使用全局模型。"))
				.addDropdown((dropdown) => {
					const agentModelOptions = this.getAvailableAgentModelOptions();
					const selectedModelValue = resolveSelectedAgentModelValue({
						model: activeSoulDefinition.preferredModel ?? "",
						modelMode: activeSoulDefinition.preferredModelMode,
					}, agentModelOptions);
					dropdown.addOption("", this.t("settings.agent.model.followGlobal", "跟随全局默认"));
					for (const option of agentModelOptions) {
						dropdown.addOption(option.value, option.label);
					}
					dropdown.setValue(selectedModelValue);
					dropdown.onChange(async (value) => {
						const parsed = parseAgentModelChoice(value);
						await this.host.soulStore.updateSoul(activeSoulDefinition.id, {
							preferredModel: parsed?.model ?? "",
							preferredModelMode: parsed?.mode,
						});
						await this.host.saveSettings();
						this.display();
					});
				});

			new Setting(managementGroup)
				.setName(this.t("settings.agent.create.name", "新建 Soul"))
				.setDesc(this.t("settings.agent.create.desc", "先创建一个新的 Soul，再补充它的定义。"))
				.addText((text) =>
					text
						.setPlaceholder(this.t("settings.agent.create.placeholder", "新 Soul 名称"))
						.setValue(this.newAgentDraft)
						.onChange((value) => {
							this.newAgentDraft = value.trim();
						}),
				)
				.addButton((button) =>
					button.setButtonText(this.t("settings.agent.create.button", "新建 Soul")).setCta().onClick(async () => {
						const suggestedName = `Soul-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
						const nextName = this.newAgentDraft || suggestedName;
						const created = await this.host.createSoul({
							name: nextName,
							summary: this.t("settings.agent.create.manualDesc", "新的 Soul，待补充定义"),
							description: this.t("settings.agent.create.manualDesc", "新的 Soul，待补充定义"),
						});
						this.newAgentDraft = "";
						const createdDefinition = this.host.soulStore.getSoulSync(created.id);
						if (createdDefinition) {
							this.setSoulEditorDraft(createdDefinition);
						}
						new Notice(this.t("settings.agent.create.success", "已创建 Soul: {name}", { name: created.name }), 3000);
						this.display();
					}),
				);

			for (const soul of souls) {
				const summary = soul.summary?.trim() || this.t("settings.agent.manage.emptySummary", "尚未补充简介");
				const row = new Setting(managementGroup)
					.setName(this.resolveSoulDisplayName(soul))
					.setDesc(
						soul.id === activeSoulDefinition.id
							? this.t("settings.agent.manage.currentBadge", "当前使用中 · {summary}", { summary })
							: summary,
					);
				if (soul.id !== activeSoulDefinition.id) {
					row.addButton((button) =>
						button.setButtonText(this.t("settings.agent.manage.setCurrent", "设为当前")).onClick(async () => {
							await this.openSoulProfileEditor(soul.id);
						}),
					);
				}
				row.addButton((button) =>
					button.setButtonText(this.t("settings.agent.manage.edit", "编辑")).onClick(async () => {
						await this.openSoulProfileEditor(soul.id);
					}),
				);
				row.addButton((button) => {
					button.setButtonText(this.t("settings.agent.manage.delete", "删除"));
					if (!this.canDeleteSoul(soul, souls.length)) {
						button.setDisabled(true);
						button.setTooltip(this.t("settings.agent.manage.deleteBlocked", "原生 FRIDAY 或最后一个 Soul 不能删除。"));
						return;
					}
					button.onClick(async () => {
						await this.deleteSoulFromSettings(soul.id);
					});
					});
			}

			new Setting(profileGroup)
				.setName(this.t("settings.agent.profile.name", "Soul 名称"))
				.setDesc(this.t("settings.agent.profile.nameDesc", "这是这个 Soul 的显示名称。"))
				.addText((text) =>
					text
						.setPlaceholder(this.t("settings.agent.defaultName", "原生 FRIDAY"))
						.setValue(this.soulEditorNameDraft)
						.onChange((value) => {
							this.soulEditorNameDraft = value;
						}),
				);

			new Setting(profileGroup)
				.setName(this.t("settings.agent.profile.summary", "一句话简介"))
				.setDesc(this.t("settings.agent.profile.summaryDesc", "用于快速说明这个 Soul 的定位和特点。"))
				.addText((text) =>
					text
						.setPlaceholder(this.t("settings.agent.profile.summaryPlaceholder", "例如：偏研究和结构化表达"))
						.setValue(this.soulEditorSummaryDraft)
						.onChange((value) => {
							this.soulEditorSummaryDraft = value;
						}),
				);

			new Setting(profileGroup)
				.setName(this.t("settings.agent.profile.definition", "人格与风格定义"))
				.setDesc(this.t("settings.agent.profile.definitionDesc", "用自然语言描述 FRIDAY 的人格、风格和行为方式。"))
				.addTextArea((textArea) => {
					textArea
						.setPlaceholder(this.t("settings.agent.profile.definitionPlaceholder", "例如：先给结论，再展开；语气克制、清晰，少说空话。"))
						.setValue(this.soulEditorDefinitionDraft)
						.onChange((value) => {
							this.soulEditorDefinitionDraft = value;
						});
					textArea.inputEl.rows = 4;
					textArea.inputEl.style.width = "100%";
				});

			new Setting(profileGroup)
				.setName(this.t("settings.agent.profile.tonePreset", "语气风格"))
				.setDesc(this.t("settings.agent.profile.tonePresetDesc", "选择 FRIDAY 默认的表达气质。"))
				.addDropdown((dropdown) => {
					dropdown.addOption("balanced", this.t("settings.agent.profile.tonePreset.balanced", "平衡"));
					dropdown.addOption("calm", this.t("settings.agent.profile.tonePreset.calm", "冷静"));
					dropdown.addOption("warm", this.t("settings.agent.profile.tonePreset.warm", "亲和"));
					dropdown.setValue(this.soulEditorTonePresetDraft);
					dropdown.onChange((value) => {
						this.soulEditorTonePresetDraft = (value as SoulTonePreset) ?? "balanced";
					});
				});

			new Setting(profileGroup)
				.setName(this.t("settings.agent.profile.toneNote", "补充说明（可选）"))
				.setDesc(this.t("settings.agent.profile.toneNoteDesc", "只补一句微调要求，例如先给结论、少用术语。"))
				.addTextArea((textArea) => {
					textArea
						.setPlaceholder(this.t("settings.agent.profile.toneNotePlaceholder", "例如：先给结论，少用术语。"))
						.setValue(this.soulEditorToneDraft)
						.onChange((value) => {
							this.soulEditorToneDraft = value;
						});
					textArea.inputEl.rows = 2;
					textArea.inputEl.style.width = "100%";
				});

			new Setting(profileGroup)
				.setName(this.t("settings.agent.profile.reset", "重置为最新原生默认配置"))
				.setDesc(this.t("settings.agent.profile.resetDesc", "仅对内置原生 FRIDAY 可用，会用最新默认参数覆盖当前 Soul 定义。"))
				.addButton((button) =>
					button
						.setButtonText(this.t("settings.agent.profile.reset", "重置为最新原生默认配置"))
						.setDisabled(!(activeSoulDefinition.builtIn && activeSoulDefinition.id.startsWith("default")))
						.onClick(async () => {
							await this.resetActiveSoulToBuiltInPreset(activeSoulDefinition.id);
						}),
				);

			new Setting(profileGroup)
				.setName(this.t("settings.agent.profile.save", "保存 Soul 定义"))
				.setDesc(this.t("settings.agent.profile.saveDesc", "会保存当前 Soul 的显示信息和背后的定义。"))
				.addButton((button) =>
					button.setButtonText(this.t("settings.agent.profile.save", "保存 Soul 定义")).setCta().onClick(async () => {
						await this.saveActiveSoulProfile(activeSoulDefinition.id);
					}),
				);
		}

		new Setting(runtimeGroup)
			.setName(this.t("settings.agent.runtime.name", "启用 Agent 工具运行时"))
			.setDesc(this.t("settings.agent.runtime.desc", "开启后，AI 将按需调用 read/grep/glob/ls/memory/write/delete。"))
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
				title: this.t("settings.soul.policy.title", "项目工具策略"),
				description: this.t(
					"settings.soul.policy.desc",
					"持久化层按 project > global 合并；session 级临时覆写在工作台对话页设置，只影响当前会话。",
				),
			});
			this.renderProjectPolicyEditor(policyGroup);
		}

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

		if (this.host.legacyAgentCleanupService.hasLegacyAgentData()) {
			const cleanupGroup = this.createNativeSettingsGroup(containerEl, {
				title: this.t("settings.soul.cleanup.name", "迁移并清理旧 Agent 数据"),
				description: this.t(
					this.pendingSoulCleanupConfirm
						? "settings.soul.cleanup.danger"
						: "settings.soul.cleanup.desc",
					this.pendingSoulCleanupConfirm
						? "这会强制删除 F.R.I.D.A.Y/Agents 下的旧会话、快照、memory、preset、global knowledge 与 agent knowledge。仅部分文件会先备份到本地状态层，备份内容不会继续出现在 Obsidian 正常编辑流里。再次点击按钮才会真正执行。"
						: "自动迁移完成后，可清理 F.R.I.D.A.Y/Agents 中的旧运行数据；这是强清理动作，会删除旧 preset 与知识文件。",
				),
			});
			new Setting(cleanupGroup)
				.setName(this.t("settings.soul.cleanup.name", "迁移并清理旧 Agent 数据"))
				.setDesc(
					this.pendingSoulCleanupConfirm
						? this.t(
								"settings.soul.cleanup.danger",
								"这会强制删除旧 Agent 目录中的可见资产。再次点击按钮才会真正执行。",
						  )
						: this.t(
								"settings.soul.cleanup.desc",
								"自动迁移完成后，可清理 F.R.I.D.A.Y/Agents 中的旧运行数据；这是强清理动作。",
						  ),
				)
				.addButton((button) =>
					button
						.setButtonText(
							this.pendingSoulCleanupConfirm
								? this.t("settings.soul.cleanup.confirm", "确认删除旧 Agent 目录")
								: this.t("settings.soul.cleanup.button", "清理旧 Agent 数据"),
						)
						.setWarning()
						.onClick(async () => {
							if (!this.pendingSoulCleanupConfirm) {
								this.pendingSoulCleanupConfirm = true;
								this.display();
								return;
							}
							try {
								const result = await this.host.legacyAgentCleanupService.cleanupLegacyAgentData();
								this.pendingSoulCleanupConfirm = false;
								if (result.removedCount === 0 && result.backedUpCount === 0) {
									new Notice(this.t("settings.soul.cleanup.noop", "没有检测到可清理的旧 Agent 数据。"), 3000);
								} else {
									new Notice(
										this.t("settings.soul.cleanup.success", "旧 Agent 数据已清理，已备份 {count} 个文件。", {
											count: result.backedUpCount,
										}),
										4000,
									);
								}
								this.display();
							} catch (error) {
								this.pendingSoulCleanupConfirm = false;
								new Notice(
									this.t("settings.soul.cleanup.failed", "清理旧 Agent 数据失败：{error}", {
										error: error instanceof Error ? error.message : String(error ?? ""),
									}),
									6000,
								);
							}
						}),
				);
		}

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
		void this.ensureLegacyFridayRootReportLoaded();
		this.renderActiveProjectSelector(shell);

		if (this.projectEditorDraft) {
			this.renderProjectEditorCard(shell);
		}

		this.renderProjectGroupSection(shell);
		this.renderLegacyFridayRootSection(shell);

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
			.setName(this.t("settings.project.workFolder.title", "选择 FRIDAY 可以工作的文件夹"))
			.setDesc(this.t("settings.project.workFolder.desc", "这个文件夹会作为 FRIDAY 的工作范围，用来限制读取、写入和同步边界。"))
			.addButton((button) =>
				button.setButtonText(this.t("settings.project.workFolder.action", "选择文件夹")).setCta().onClick(() => {
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
		const activeSoul = this.host.getActiveSoul();
		const activeSoulDefinition = activeSoul ? this.host.soulStore.getSoulSync(activeSoul.id) : null;
		const mode = activeSoulDefinition?.preferredModelMode || this.host.settings.llm.mode;
		const model = activeSoulDefinition?.preferredModel?.trim() || this.host.settings.llm.model.trim();
		return `${mode}::${model}`;
	}

	private resolveSoulDisplayName(soul: { id: string; name: string }): string {
		const name = soul.name.trim();
		if (soul.id.startsWith("default") && (!name || name === "默认 Soul" || name === "默认 Agent" || name === "原生F.R.I.D.A.Y")) {
			return this.t("settings.agent.defaultName", "原生 FRIDAY");
		}
		return name || soul.id;
	}

	private canDeleteSoul(
		soul: { id: string; builtIn?: boolean; editable?: boolean },
		totalSouls: number,
	): boolean {
		if (totalSouls <= 1) {
			return false;
		}
		if (soul.builtIn || soul.editable === false || soul.id.startsWith("default")) {
			return false;
		}
		return true;
	}

	private async openSoulProfileEditor(soulId: string): Promise<void> {
		const target = this.host.soulStore.getSoulSync(soulId);
		if (!target) {
			throw new Error(this.t("settings.agent.profile.missing", "当前 Agent 不存在或已被移除。"));
		}
		await this.host.setActiveSoul(soulId);
		this.setSoulEditorDraft(target);
		this.display();
	}

	private async deleteSoulFromSettings(soulId: string): Promise<void> {
		const souls = this.host.listSouls();
		const target = souls.find((item) => item.id === soulId);
		if (!target || !this.canDeleteSoul(target, souls.length)) {
			throw new Error(this.t("settings.agent.manage.deleteBlocked", "原生 FRIDAY 或最后一个 Soul 不能删除。"));
		}
		const fallback = souls.find((item) => item.id !== soulId);
		await this.host.soulStore.deleteSoul(soulId);
		if (this.host.settings.activeSoulId === soulId && fallback) {
			await this.host.setActiveSoul(fallback.id);
		}
		if (this.soulEditorDraftId === soulId) {
			const nextTarget = fallback ? this.host.soulStore.getSoulSync(fallback.id) : null;
			if (nextTarget) {
				this.setSoulEditorDraft(nextTarget);
			} else {
				this.soulEditorDraftId = "";
				this.soulEditorNameDraft = "";
				this.soulEditorSummaryDraft = "";
				this.soulEditorDefinitionDraft = "";
				this.soulEditorTonePresetDraft = "balanced";
				this.soulEditorToneDraft = "";
			}
		}
		await this.host.saveSettings();
		new Notice(this.t("settings.agent.manage.deleteSuccess", "已删除 Soul: {name}", { name: this.resolveSoulDisplayName(target) }), 3000);
		this.display();
	}

	private ensureSoulEditorDraft(activeSoulDefinition: {
		id: string;
		name: string;
		summary: string;
		description: string;
		tonePreset?: SoulTonePreset;
		tonePrompt?: string;
	}): void {
		if (this.soulEditorDraftId === activeSoulDefinition.id) {
			return;
		}
		this.setSoulEditorDraft(activeSoulDefinition);
	}

	private setSoulEditorDraft(activeSoulDefinition: {
		id: string;
		name: string;
		summary: string;
		description: string;
		tonePreset?: SoulTonePreset;
		tonePrompt?: string;
	}): void {
		this.soulEditorDraftId = activeSoulDefinition.id;
		this.soulEditorNameDraft = activeSoulDefinition.name ?? "";
		this.soulEditorSummaryDraft = activeSoulDefinition.summary ?? "";
		this.soulEditorDefinitionDraft = activeSoulDefinition.description ?? "";
		this.soulEditorTonePresetDraft = activeSoulDefinition.tonePreset ?? "balanced";
		this.soulEditorToneDraft = activeSoulDefinition.tonePrompt ?? "";
	}

	private async saveActiveSoulProfile(soulId: string): Promise<void> {
		const existing = this.host.soulStore.getSoulSync(soulId);
		if (!existing) {
			throw new Error(this.t("settings.agent.profile.missing", "当前 Agent 不存在或已被移除。"));
		}
		const nextName = this.soulEditorNameDraft.trim() || this.resolveSoulDisplayName(existing);
		const nextSummary = this.soulEditorSummaryDraft.trim() || this.t("settings.agent.create.manualDesc", "新的 Soul，待补充定义");
		const nextDefinition = this.soulEditorDefinitionDraft.trim() || nextSummary;
		const nextTonePreset = this.soulEditorTonePresetDraft ?? "balanced";
		const nextTone = this.soulEditorToneDraft.trim();
		const updated = await this.host.soulStore.updateSoul(soulId, {
			name: nextName,
			summary: nextSummary,
			description: nextDefinition,
			rolePrompt: nextDefinition,
			tonePreset: nextTonePreset,
			tonePrompt: nextTone,
		});
		this.setSoulEditorDraft({
			id: updated.id,
			name: updated.name,
			summary: updated.summary,
			description: updated.description,
			tonePreset: updated.tonePreset,
			tonePrompt: this.soulEditorToneDraft,
		});
		await this.host.saveSettings();
		new Notice(this.t("settings.agent.profile.saveSuccess", "已保存 Soul 定义：{name}", { name: updated.name }), 3000);
		this.display();
	}

	private async resetActiveSoulToBuiltInPreset(soulId: string): Promise<void> {
		const updated = await this.host.resetBuiltInSoulPreset(soulId);
		this.setSoulEditorDraft({
			id: updated.id,
			name: updated.name,
			summary: updated.summary,
			description: updated.description,
			tonePreset: (updated as typeof updated & { tonePreset?: SoulTonePreset }).tonePreset,
			tonePrompt: (updated as typeof updated & { tonePrompt?: string }).tonePrompt,
		});
		new Notice(this.t("settings.agent.profile.resetSuccess", "已恢复最新原生 Soul 默认配置：{name}", { name: updated.name }), 3000);
		this.display();
	}

	private async openRegisterProjectModal(initial?: ProjectEntry): Promise<void> {
		const draft = this.createProjectEditorDraft(initial);
		this.projectEditorDraft = draft;
		this.projectEditorInitialProjectId = initial ? this.getProjectKey(initial) : "";
		this.projectEditorError = "";
		this.projectGitDetection = null;
		this.projectEditorCreateInVaultRoot = false;
		this.projectEditorVaultRootConfirmPending = false;
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
				useVaultRootAsProject: boundaryPath.trim() === "/",
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
			useVaultRootAsProject: false,
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
			this.t("projects.editor.mode", "创建方式"),
			this.t("settings.project.editor.mode.desc", "决定项目是本地新建，还是从远端拉取。"),
			draft.mode,
			(value) => {
				draft.mode = value as ProjectEditorDraft["mode"];
				draft.useVaultRootAsProject = false;
				this.projectEditorCreateInVaultRoot = false;
				this.projectEditorVaultRootConfirmPending = false;
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
			this.t("settings.project.editor.projectName.desc", "用于在 FRIDAY 中识别这个工作范围。"),
			draft.projectName,
			(value) => {
				draft.projectName = value.trim();
				if (draft.mode === "remote_bootstrap") {
					this.syncRemoteBootstrapBoundaryPath(draft);
				}
				if (this.projectEditorCreateInVaultRoot) {
					this.syncLocalVaultRootBoundaryPath(draft);
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
			const vaultRootChildSelection = "__vault_root_child__";
			const wholeVaultSelection = "__whole_vault__";
			const directoryOptions = this.listVaultDirectoryOptions(false);
			if (draft.boundaryPath.trim() && draft.boundaryPath.trim() !== "/" && !directoryOptions.includes(draft.boundaryPath.trim())) {
				directoryOptions.unshift(draft.boundaryPath.trim());
			}
			const currentLocalSelection = draft.useVaultRootAsProject
				? wholeVaultSelection
				: this.projectEditorCreateInVaultRoot
					? vaultRootChildSelection
					: draft.boundaryPath.trim()
						? this.normalizeVaultDirectorySelectionValue(draft.boundaryPath)
						: "";
			this.renderProjectEditorDropdownSetting(
				card,
				this.t("projects.editor.vaultDir", "Obsidian local path"),
				this.t(
					"settings.project.editor.vaultDir.localDesc",
					"从当前 Obsidian Vault 中选择一个目录；如果该目录已经是 Git 仓库，会自动识别远端。",
				),
				currentLocalSelection,
				(value) => {
					if (value === vaultRootChildSelection || value === "/") {
						this.projectEditorCreateInVaultRoot = true;
						this.projectEditorVaultRootConfirmPending = false;
						draft.useVaultRootAsProject = false;
						this.syncLocalVaultRootBoundaryPath(draft);
						void this.refreshProjectGitDetection(draft);
						this.display();
						return;
					}
					if (value === wholeVaultSelection && draft.useVaultRootAsProject) {
						return;
					}
					this.projectEditorCreateInVaultRoot = false;
					this.projectEditorVaultRootConfirmPending = false;
					draft.useVaultRootAsProject = false;
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
					{
						value: vaultRootChildSelection,
						label: this.t("settings.project.editor.vaultDir.rootCreate", "/（在 Vault 根目录下新建同名文件夹）"),
					},
					...(draft.useVaultRootAsProject
						? [{
							value: wholeVaultSelection,
							label: this.t("settings.project.editor.vaultDir.wholeVaultSelected", "整个 Vault（高级，已确认）"),
						}]
						: []),
					...directoryOptions.map((option) => ({ value: option, label: this.getVaultDirectoryOptionLabel(option) })),
				],
			);
			if (this.projectEditorCreateInVaultRoot) {
				this.renderLocalVaultRootCreatePreview(card, draft);
			}
			this.renderWholeVaultProjectOption(card, draft);
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
			this.projectEditorCreateInVaultRoot = false;
			this.projectEditorVaultRootConfirmPending = false;
			this.resetRemoteBootstrapDirectoryChoice();
			this.display();
		};
	}

	private renderLocalVaultRootCreatePreview(containerEl: HTMLElement, draft: ProjectEditorDraft): void {
		const targetPath = this.syncLocalVaultRootBoundaryPath(draft);
		const setting = new Setting(containerEl)
			.setName(this.t("settings.project.editor.vaultDir.rootCreatePreviewTitle", "保存位置"))
			.setDesc(this.t(
				"settings.project.editor.vaultDir.rootCreatePreview",
				"保存后会在 Vault 根目录创建：{path}",
				{ path: targetPath },
			));
		setting.settingEl.addClass("friday-project-editor-setting");
		setting.settingEl.addClass("friday-project-editor-derived-setting");
	}

	private renderWholeVaultProjectOption(containerEl: HTMLElement, draft: ProjectEditorDraft): void {
		const setting = new Setting(containerEl)
			.setName(this.t("settings.project.editor.vaultDir.wholeVault", "高级选项：将整个 Vault 作为项目"))
			.setDesc(this.t(
				"settings.project.editor.vaultDir.wholeVaultRisk",
				"这会让项目边界覆盖整个 Vault，Agent 和同步相关功能会更容易触及非项目笔记。仅在你明确需要时使用。",
			));
		setting.settingEl.addClass("friday-project-editor-setting");
		setting.settingEl.addClass("friday-project-editor-advanced-setting");
		setting.addButton((button) => {
			button.setButtonText(
				draft.useVaultRootAsProject
					? this.t("settings.project.editor.vaultDir.wholeVaultSelected", "整个 Vault（高级，已确认）")
					: this.projectEditorVaultRootConfirmPending
						? this.t("settings.project.editor.vaultDir.wholeVaultArmed", "再次点击确认")
						: this.t("settings.project.editor.vaultDir.wholeVaultConfirm", "使用整个 Vault"),
			);
			button.setDisabled(Boolean(draft.useVaultRootAsProject));
			button.onClick(() => {
				if (draft.useVaultRootAsProject) {
					return;
				}
				if (!this.projectEditorVaultRootConfirmPending) {
					this.projectEditorVaultRootConfirmPending = true;
					this.display();
					return;
				}
				this.projectEditorVaultRootConfirmPending = false;
				this.projectEditorCreateInVaultRoot = false;
				draft.useVaultRootAsProject = true;
				draft.boundaryPath = "/";
				draft.projectRootPath = "/";
				void this.refreshProjectGitDetection(draft);
				this.display();
			});
		});
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

	private getVaultDirectoryOptionLabel(optionValue: string): string {
		if (optionValue === "/") {
			return this.t("settings.project.editor.vaultDir.rootCreate", "/（在 Vault 根目录下新建同名文件夹）");
		}
		return optionValue;
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
				dropdown.addOption(optionValue, this.getVaultDirectoryOptionLabel(optionValue));
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
			.filter((folderPath) => includeVaultRoot || folderPath !== "/")
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

	private syncLocalVaultRootBoundaryPath(draft: ProjectEditorDraft): string {
		const targetPath = buildVaultRootProjectPath(draft.projectName || draft.projectId || draft.slug || "");
		draft.boundaryPath = targetPath;
		draft.projectRootPath = targetPath;
		draft.useVaultRootAsProject = false;
		return targetPath;
	}

	private buildRemoteBootstrapNestedPath(
		draft: Pick<ProjectEditorDraft, "mode" | "projectId" | "projectName" | "gitRemote">,
		basePath: string,
	): string {
		const defaults = buildRemoteBootstrapDefaults(this.host.dataService.getFridayRoot(), draft.gitRemote);
		const preferredName = draft.projectName.trim() || draft.projectId.trim() || defaults.projectId;
		const segment = buildDefaultProjectRootPath(this.host.dataService.getFridayRoot(), preferredName)
			.split("/")
			.filter(Boolean)
			.pop() ?? "new-project";
		return basePath.trim() ? `${basePath.trim()}/${segment}` : segment;
	}

	private async ensureLegacyFridayRootReportLoaded(): Promise<void> {
		if (this.legacyFridayRootReportLoading || this.legacyFridayRootReport) {
			return;
		}
		await this.refreshLegacyFridayRootReport();
	}

	private async refreshLegacyFridayRootReport(): Promise<void> {
		this.legacyFridayRootReportLoading = true;
		try {
			this.legacyFridayRootReport = await this.host.legacyFridayRootMigrationService.scan();
		} finally {
			this.legacyFridayRootReportLoading = false;
			this.display();
		}
	}

	private getOfficialContentOwnedTopLevelPaths(): string[] {
		return [...new Set([
			...this.host.settings.officialContent.catalog.map((item) => item.path),
			...Object.values(this.host.settings.officialContent.channels)
				.map((item) => item.path?.trim() || "")
				.filter((item) => item.trim().length > 0),
			...OFFICIAL_CONTENT_LEGACY_TOP_LEVEL_PATHS,
		])];
	}

	private async ensureOfficialContentGuardStateLoaded(): Promise<void> {
		if (this.officialContentGuardLoading || this.officialContentGuardState) {
			return;
		}
		await this.refreshOfficialContentGuardState();
	}

	private async refreshOfficialContentGuardState(): Promise<void> {
		this.officialContentGuardLoading = true;
		try {
			this.officialContentGuardState = await this.host.legacyFridayRootMigrationService.inspectDestructiveApplySafety({
				ownedTopLevelPaths: this.getOfficialContentOwnedTopLevelPaths(),
			});
		} finally {
			this.officialContentGuardLoading = false;
			if (this.activeSection === "subscriptions") {
				this.display();
			}
		}
	}

	private renderLegacyFridayRootSection(containerEl: HTMLElement): void {
		const report = this.legacyFridayRootReport;
		const hasContent = this.legacyFridayRootReportLoading || (
			report && (
				report.registeredLegacyProjects.length > 0
				|| report.importableLegacyProjects.length > 0
				|| report.legacyPersonalFolders.length > 0
				|| report.hasLegacyAgentData
				|| report.cleanupCandidates.length > 0
			)
		);
		if (!hasContent) {
			return;
		}

		const group = this.createNativeSettingsGroup(containerEl, {
			title: this.t("settings.project.legacy.title", "遗留 Friday 根目录内容"),
			description: this.t(
				"settings.project.legacy.desc",
				"检测到旧版本数据结构。F.R.I.D.A.Y/ 后续将作为订阅频道目录使用，请前往订阅频道设置归档旧版本文件夹。",
			),
			extraClass: "friday-project-settings-panel friday-project-legacy-panel",
		});

		if (this.legacyFridayRootReportLoading || !report) {
			group.createEl("p", {
				text: this.t("settings.project.legacy.loading", "正在扫描遗留目录..."),
			});
			return;
		}

		const legacyProjectCount = report.registeredLegacyProjects.length + report.importableLegacyProjects.length;
		new Setting(group)
			.setName(this.t("settings.project.legacy.summary", "检测到的旧版本内容"))
			.setDesc([
				this.t("settings.project.legacy.summaryProjects", "旧项目目录：{count}", {
					count: legacyProjectCount,
				}),
				this.t("settings.project.legacy.summaryPersonal", "个人目录：{count}", {
					count: report.legacyPersonalFolders.length,
				}),
				this.t("settings.project.legacy.summaryAgents", "Agent 数据：{status}", {
					status: report.hasLegacyAgentData
						? this.t("settings.project.legacy.detected", "已检测到")
						: this.t("settings.project.legacy.notDetected", "未检测到"),
				}),
				this.t("settings.project.legacy.summarySystem", "旧系统项：{count}", {
					count: report.cleanupCandidates.length,
				}),
			].join(" | "));

		new Setting(group)
			.setName(this.t("settings.project.legacy.subscriptionsAction", "前往订阅频道归档旧版本文件夹"))
			.setDesc(
				this.t(
					"settings.project.legacy.subscriptionsDesc",
					"旧项目、个人和 Agent 数据不会在这里自动迁移。请在订阅频道设置中将当前 F.R.I.D.A.Y/ 改名为旧版本文件夹，再自行整理其中与项目相关的信息。",
				),
			)
			.addButton((button) =>
				button
					.setCta()
					.setButtonText(this.t("settings.project.legacy.subscriptionsButton", "打开订阅频道设置"))
					.onClick(() => {
						this.focusSection("subscriptions");
						this.display();
					}),
			);
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
		if (draft.mode === "remote_bootstrap") {
			return "";
		}
		return "";
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
		const absolutePath = draft.boundaryPath.trim() === "/"
			? basePath
			: path.join(basePath, ...draft.boundaryPath.trim().replace(/\\/g, "/").split("/"));
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
			if (this.projectEditorCreateInVaultRoot) {
				this.syncLocalVaultRootBoundaryPath(draft);
			}
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
			this.projectEditorCreateInVaultRoot = false;
			this.projectEditorVaultRootConfirmPending = false;
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

	private ensureOfficialContentChannelState(entryId: string): { subscribed: boolean; lastAppliedVersion: string; path: string } {
		const existing = this.host.settings.officialContent.channels[entryId];
		if (existing) {
			return existing;
		}
		this.host.settings.officialContent.channels[entryId] = {
			subscribed: true,
			lastAppliedVersion: "",
			path: "",
		};
		return this.host.settings.officialContent.channels[entryId];
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

	private async runPluginUpdateReload(): Promise<void> {
		this.pluginUpdateActionPending = true;
		try {
			await this.host.reloadFridayPlugin();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? "");
			new Notice(
				this.t("settings.user.update.notice.applyFailed", "应用更新失败：{error}", {
					error: message || this.t("common.unknownError", "未知错误"),
				}),
				6000,
			);
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
		} finally {
			this.pluginUpdateActionPending = false;
			this.display();
		}
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
	return value === "user" || value === "project" || value === "sync" || value === "llm" || value === "soul" || value === "agent" || value === "subscriptions";
}

