import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import QRCode from "qrcode";
import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder } from "obsidian";
import { normalizeProjectGroupIdCandidate } from "./projectGroupId";
import { renderLlmSettingsSection } from "./sections/LlmSettingsSection";
import { renderProjectSettingsSection } from "./sections/ProjectSettingsSection";
import { renderSoulSettingsSection } from "./sections/SoulSettingsSection";
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
import { buildAgentModelCatalogFromSettings } from "../core/llm/AgentModelCatalog";
import {
	patchActiveLlmConfig,
	patchLlmModeConfig,
	readModeConfig,
} from "../core/llm/LlmSettingsResolver";
import type { ModelCapabilityInfo } from "../services/AIService";
import type { LegacyFridayRootReport } from "../services/LegacyFridayRootMigrationService";
import { FridayPluginApi, type FridaySettingsSection } from "../types/plugin";
import type { OfficialContentSyncProgress } from "../types/officialContent";
import { ProjectEntry, ProjectGroupEntry } from "../types/project";
import { SlashCommandTemplate, isWorkbenchStartupPlacement, type LlmReasoningSettings } from "../types/settings";
import type { GroupModelCatalogModel } from "../types/groupModelCatalog";
import type { SoulDefinition, SoulSummary, SoulTonePreset } from "../types/soul";
import {
	getSoulExperimentTemplate,
	type SoulExperimentTemplate,
} from "../features/soul/SoulExperimentTemplates";
import type { LocaleCode } from "../i18n/types";
import { PLUGIN_UPDATE_REPO_URL } from "../constants/update";
import { FRIDAY_WORDMARK_FONT_FAMILY } from "../constants/wordmarkFont";
import { OFFICIAL_CONTENT_LEGACY_TOP_LEVEL_PATHS } from "../constants/officialContent";
import { CapabilityRegistry } from "../core/capability/CapabilityRegistry";
import type { GitRuntimeStatus } from "../platform/git/GitRuntimeProbe";
import {
	createNativeSettingsGroup,
	markNativeDangerSetting,
	renderFridaySettingsTitle,
	renderNativeInlineAlert,
	renderNativePrerequisiteList,
	renderNativeSectionTabs,
	renderNativeSettingsEmptyState,
	renderNativeSettingsFeedback,
	type NativeSettingsGroupOptions,
	type NativeSettingsTone,
	type NativeSectionTabItem,
} from "../ui/obsidian-native/SettingsKit";

type SettingsHost = FridayPluginApi & Plugin;
type LlmStatus = "unconfigured" | "idle" | "checking" | "connected" | "failed";
type VisionProbeStatus = "idle" | "checking";
type ProjectEditorSelectOption = string | { value: string; label: string };
type RemoteBootstrapDirectoryState = "unknown" | "empty" | "non_empty";
type RemoteBootstrapResolution = "unset" | "direct" | "create_child";
const SOUL_SUGGESTION_FORM_URL =
	"https://doc.weixin.qq.com/smartsheet/form/1_wpUqE6CAAALSz4zPkCQY74bj5Fy9lPBw_69e0b4?journal_source=chat&notreplace=true&clickStart=1779327428534&clientdb=1&fontScale=1.00";
const SOUL_SUGGESTION_ISSUE_TITLE = "Soul 推荐：";
const SOUL_SUGGESTION_ISSUE_BODY = [
	"想推荐的 Soul / 人格 / 沟通风格：",
	"",
	"推荐理由：",
	"",
	"适合的使用场景：",
	"",
	"请不要填写敏感信息。",
].join("\n");
const SOUL_SUGGESTION_ISSUE_URL = buildSoulSuggestionIssueUrl(PLUGIN_UPDATE_REPO_URL);

function buildSoulSuggestionIssueUrl(repoUrl: string): string {
	const issueUrl = new URL(`${repoUrl.replace(/\.git$/i, "").replace(/\/+$/, "")}/issues/new`);
	issueUrl.searchParams.set("issue[title]", SOUL_SUGGESTION_ISSUE_TITLE);
	issueUrl.searchParams.set("issue[description]", SOUL_SUGGESTION_ISSUE_BODY);
	return issueUrl.toString();
}
const BUILTIN_GROUP_MODELS = [
	"glm-4.7",
	"kimi-k2.5",
	"glm-5.1",
	"MiniMax/MiniMax-M2.7",
	"qwen3-coder-plus",
	"deepseek-v4-pro",
	"qwen3.6-plus",
	"qwen3-max-preview",
	"qwen3.5-flash-2026-02-23",
	"qwen3-vl-235b-a22b-instruct",
	"qwen3-max-2026-01-23",
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
	private soulPanelMode: "manage" | "lab" | "editor" = "manage";
	private soulLabDetailsExpanded = false;
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
	private userGitTokenVisible = false;
	private gitRuntimeStatus: GitRuntimeStatus | null = null;
	private gitRuntimeStatusLoading = false;
	private pluginUpdateActionPending = false;
	private groupModelCatalogActionPending = false;
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
		this.soulPanelMode = "manage";
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
		renderFridaySettingsTitle(containerEl, {
			titleText: this.host.t("settings.title"),
			brandText: this.t("nav.friday", "FRIDAY"),
			wordmarkFontFamily: FRIDAY_WORDMARK_FONT_FAMILY,
		});
	}

	private renderSectionTabs(containerEl: HTMLElement): void {
		const items: NativeSectionTabItem<SettingsSection>[] = [
			{ id: "user", label: this.host.t("settings.section.user") },
			{ id: "project", label: this.host.t("settings.section.project") },
			{ id: "sync", label: this.host.t("settings.section.sync") },
			{ id: "llm", label: this.host.t("settings.section.llm") },
			{ id: "agent", label: this.host.t("settings.section.agent") },
			{ id: "subscriptions", label: this.host.t("settings.section.subscriptions") },
		];
		renderNativeSectionTabs(containerEl, {
			items,
			activeId: this.activeSection,
			onSelect: (section) => {
				this.activeSection = section;
				this.soulPanelMode = "manage";
				this.display();
			},
		});
	}

	private createNativeSettingsGroup(
		containerEl: HTMLElement,
		options: NativeSettingsGroupOptions = {},
	): HTMLDivElement {
		return createNativeSettingsGroup(containerEl, options);
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

		let gitTokenInputEl: HTMLInputElement | null = null;
		new Setting(gitGroup)
			.setName(this.t("settings.user.gitToken.name", "Git 令牌"))
			.setDesc(this.t("settings.user.gitToken.desc", "作为所有项目同步认证的统一令牌。"))
			.addText((text) => {
				text.inputEl.type = this.userGitTokenVisible ? "text" : "password";
				text.inputEl.setAttribute("autocomplete", "off");
				text.inputEl.setAttribute("spellcheck", "false");
				gitTokenInputEl = text.inputEl;
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
			})
			.addExtraButton((button) => {
				const syncTokenVisibility = () => {
					if (gitTokenInputEl) {
						gitTokenInputEl.type = this.userGitTokenVisible ? "text" : "password";
					}
					const tooltip = this.userGitTokenVisible
						? this.t("settings.user.gitToken.hide", "隐藏令牌")
						: this.t("settings.user.gitToken.show", "显示令牌");
					button
						.setIcon(this.userGitTokenVisible ? "eye-off" : "eye")
						.setTooltip(tooltip);
					button.extraSettingsEl.setAttribute("aria-label", tooltip);
					button.extraSettingsEl.classList.add("friday-secret-visibility-toggle", "friday-token-visibility-leading");
					button.extraSettingsEl.classList.toggle("is-visible", this.userGitTokenVisible);
				};
				button.extraSettingsEl.addEventListener("mousedown", (event) => {
					event.preventDefault();
				});
				gitTokenInputEl?.insertAdjacentElement("beforebegin", button.extraSettingsEl);
				syncTokenVisibility();
				button.onClick(() => {
					this.userGitTokenVisible = !this.userGitTokenVisible;
					syncTokenVisibility();
					gitTokenInputEl?.focus();
				});
			});

		new Setting(gitGroup)
			.setName(this.t("settings.user.credentialStorage.name", "凭据存储"))
			.setDesc(this.getCredentialStorageStatusDesc());

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

		renderNativePrerequisiteList(setting.descEl, {
			ariaLabel: this.t("settings.user.update.prerequisites.name", "前置条件"),
			items: [
				...details.readyLabels.map((label) => ({
					label,
					state: "ready" as const,
					stateLabel: this.t("settings.user.update.prerequisites.readyState", "已完成"),
				})),
				...details.pendingLabels.map((label) => ({
					label,
					state: "pending" as const,
					stateLabel: this.t("settings.user.update.prerequisites.pendingState", "待完成"),
				})),
			],
		});
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
		if (details.readyLabels.length > 0 || details.pendingLabels.length > 0) {
			renderNativePrerequisiteList(group, {
				ariaLabel: this.t("settings.user.update.prerequisites.name", "前置条件"),
				items: [
					...details.readyLabels.map((label) => ({
						label,
						state: "ready" as const,
						stateLabel: this.t("settings.user.update.prerequisites.readyState", "已完成"),
					})),
					...details.pendingLabels.map((label) => ({
						label,
						state: "blocked" as const,
						stateLabel: this.t("settings.user.update.prerequisites.blockedState", "需补充"),
					})),
				],
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
			renderNativeInlineAlert(warningGroup, {
				tone: "warning",
				title: this.t("settings.subscriptions.legacy.warning", "检测到 FRIDAY 根目录历史内容"),
				message: this.t("settings.subscriptions.legacy.blockingPaths", "阻断路径：{paths}", {
					paths: blockingPaths.join(" | "),
				}),
			});
			const archiveSetting = new Setting(warningGroup)
				.setName(
					this.pendingOfficialContentArchiveConfirm
						? this.t("settings.subscriptions.legacy.archiveConfirm", "确认归档旧版本文件夹")
						: this.t("settings.subscriptions.legacy.archive", "归档旧版本文件夹"),
				)
				.setDesc(
					this.pendingOfficialContentArchiveConfirm
						? this.t("settings.subscriptions.legacy.archiveConfirmDesc", "这不会删除旧数据；只会把当前 F.R.I.D.A.Y/ 改名，为订阅频道腾出新的 F.R.I.D.A.Y/。")
						: this.t("settings.subscriptions.legacy.archiveDesc", "将当前 F.R.I.D.A.Y/ 改名为“旧版本F.R.I.D.A.Y文件夹”，保留里面的项目、个人和 Agent 数据供你之后手动整理。"),
				);
			markNativeDangerSetting(archiveSetting);
			archiveSetting.addButton((button) =>
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
			renderNativeSettingsEmptyState(providerGroup, {
				title: this.t("settings.subscriptions.empty.title", "暂无可显示的栏目"),
				description: this.t("settings.subscriptions.empty", "暂无可显示的栏目。先点击“刷新官方内容”。"),
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
		const percent = Math.max(0, Math.min(100, Math.round(status.percent)));
		const feedback = renderNativeSettingsFeedback(containerEl, {
			title: this.t("settings.subscriptions.refreshStatus.name", "刷新状态"),
			message: this.t("settings.subscriptions.refreshStatus.desc", "当前状态：{status}。{detail}", {
				status: statusLabel,
				detail,
			}),
			tone: this.getOfficialContentRefreshStatusTone(status),
			progressPercent: percent,
			progressLabel: this.t("settings.subscriptions.refreshStatus.progress", "{percent}%", { percent }),
			extraClass: "friday-subscriptions-refresh-status",
		});
		const progressContainer = feedback.querySelector(".friday-native-settings-feedback-progress");
		progressContainer?.classList.add("friday-subscriptions-refresh-progress");
		const progressLabel = feedback.querySelector(".friday-native-settings-feedback-progress-label");
		progressLabel?.classList.add("friday-subscriptions-refresh-progress-label");
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
		renderLlmSettingsSection(this, containerEl);
	}

	private renderSoulSection(containerEl: HTMLElement): void {
		renderSoulSettingsSection(this, containerEl);
	}



	private renderSoulSuggestionPanel(containerEl: HTMLElement): void {
		const panelEl = containerEl.createEl("section", {
			cls: "friday-soul-suggestion-panel",
			attr: {
				"aria-label": this.t("settings.soulLab.suggestion.title", "想要另一种 FRIDAY？"),
			},
		});
		const copyEl = panelEl.createDiv({ cls: "friday-soul-suggestion-copy" });
		copyEl.createDiv({
			cls: "friday-soul-suggestion-title",
			text: this.t("settings.soulLab.suggestion.title", "想要另一种 FRIDAY？"),
		});
		copyEl.createDiv({
			cls: "friday-soul-suggestion-desc",
			text: this.t(
				"settings.soulLab.suggestion.desc",
				"推荐你期待的 Soul、人格或沟通风格，我们会定期整理进 Soul 实验室候选池。",
			),
		});
		copyEl.createDiv({
			cls: "friday-soul-suggestion-note",
			text: this.t(
				"settings.soulLab.suggestion.note",
				"内容会提交到企业微信收集表，请不要填写敏感信息。",
			),
		});
		const actionsEl = panelEl.createDiv({ cls: "friday-soul-suggestion-actions" });
		const formButton = actionsEl.createEl("button", {
			cls: "friday-soul-suggestion-action is-primary",
			text: this.t("settings.soulLab.suggestion.formAction", "通过收集表提交"),
			attr: {
				type: "button",
			},
		});
		formButton.addEventListener("click", () => this.openSoulSuggestionFormModal());
		actionsEl.createEl("a", {
			cls: "friday-soul-suggestion-action is-secondary external-link",
			text: this.t("settings.soulLab.suggestion.issueAction", "通过 issue 发送"),
			attr: {
				href: SOUL_SUGGESTION_ISSUE_URL,
				rel: "noopener nofollow",
			},
		});
	}

	private openSoulSuggestionFormModal(): void {
		const modal = new Modal(this.app);
		modal.titleEl.setText(this.t("settings.soulLab.suggestion.modalTitle", "通过收集表提交"));
		modal.contentEl.empty();
		modal.contentEl.addClass("friday-soul-suggestion-modal");

		const qrEl = modal.contentEl.createDiv({ cls: "friday-soul-suggestion-qr" });
		qrEl.createDiv({
			cls: "friday-soul-suggestion-qr-loading",
			text: this.t("settings.soulLab.suggestion.qrLoading", "正在生成二维码..."),
		});
		void QRCode.toDataURL(SOUL_SUGGESTION_FORM_URL, {
			errorCorrectionLevel: "M",
			margin: 2,
			width: 220,
		})
			.then((src) => {
				qrEl.empty();
				qrEl.createEl("img", {
					cls: "friday-soul-suggestion-qr-image",
					attr: {
						src,
						alt: this.t("settings.soulLab.suggestion.qrAlt", "Soul 推荐收集表二维码"),
					},
				});
			})
			.catch(() => {
				qrEl.empty();
				qrEl.createDiv({
					cls: "friday-soul-suggestion-qr-fallback",
					text: this.t("settings.soulLab.suggestion.qrFailed", "二维码生成失败，请复制链接打开。"),
				});
			});

		const urlRowEl = modal.contentEl.createDiv({ cls: "friday-soul-suggestion-url-row" });
		urlRowEl.createEl("input", {
			cls: "friday-soul-suggestion-url-input",
			attr: {
				type: "text",
				readonly: "true",
				value: SOUL_SUGGESTION_FORM_URL,
				"aria-label": this.t("settings.soulLab.suggestion.linkLabel", "收集表链接"),
			},
		});
		const copyButton = urlRowEl.createEl("button", {
			cls: "friday-soul-suggestion-copy-button",
			text: this.t("settings.soulLab.suggestion.copyLink", "复制链接"),
			attr: {
				type: "button",
			},
		});
		copyButton.addEventListener("click", () => {
			void this.copySoulSuggestionFormUrl();
		});
		modal.contentEl.createDiv({
			cls: "friday-soul-suggestion-modal-hint",
			text: this.t(
				"settings.soulLab.suggestion.modalHint",
				"内网环境可能无法直接访问；也可以把链接粘贴到企业微信会话中打开。",
			),
		});
		modal.open();
	}

	private async copySoulSuggestionFormUrl(): Promise<void> {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(SOUL_SUGGESTION_FORM_URL);
			} else {
				const textArea = document.createElement("textarea");
				textArea.value = SOUL_SUGGESTION_FORM_URL;
				textArea.style.position = "fixed";
				textArea.style.opacity = "0";
				document.body.appendChild(textArea);
				textArea.select();
				const copied = document.execCommand("copy");
				textArea.remove();
				if (!copied) {
					throw new Error("execCommand copy returned false");
				}
			}
			new Notice(this.t("settings.soulLab.suggestion.copied", "已复制收集表链接"));
		} catch {
			new Notice(this.t("settings.soulLab.suggestion.copyFailed", "复制失败，请手动复制链接"));
		}
	}

	private renderSoulTemplateCard(
		containerEl: HTMLElement,
		template: SoulExperimentTemplate,
		isCurrent: boolean,
		isInstalled: boolean,
		detailsExpanded: boolean,
	): void {
		const cardEl = containerEl.createEl("article", {
			cls: `friday-soul-template-card${isCurrent ? " is-current" : ""}${isInstalled ? " is-installed" : ""}${detailsExpanded ? " is-detail-open" : ""}`,
			attr: {
				"data-template-id": template.id,
				"data-template-code": template.typeCode,
			},
		});
		const headerEl = cardEl.createDiv({ cls: "friday-soul-template-header" });
		const titleEl = headerEl.createDiv({ cls: "friday-soul-template-title-block" });
		const titleRowEl = titleEl.createDiv({ cls: "friday-soul-template-title-row" });
		titleRowEl.createDiv({ cls: "friday-soul-template-code", text: template.typeCode });
		titleRowEl.createDiv({ cls: "friday-soul-template-title", text: template.name });
		headerEl.createDiv({
			cls: `friday-soul-template-status${isCurrent ? " is-current" : ""}${isInstalled && !isCurrent ? " is-installed" : ""}`,
			text: isCurrent
				? this.t("settings.soulLab.current", "当前使用")
				: isInstalled
					? this.t("settings.soulLab.subscribed", "已加入")
					: this.t("settings.soulLab.template", "实验模板"),
		});
		const bodyEl = cardEl.createDiv({ cls: "friday-soul-template-body" });
		bodyEl.createDiv({ cls: "friday-soul-template-summary", text: template.summary });
		const chipsEl = bodyEl.createDiv({ cls: "friday-soul-template-chips" });
		for (const chip of [
			{ label: this.t("settings.soulLab.rhythm", "节奏"), title: template.responseRhythm },
			{ label: this.t("settings.soulLab.structure", "结构"), title: template.informationStructure },
			{ label: this.t("settings.soulLab.feedback", "反馈"), title: template.feedbackStyle },
		]) {
			chipsEl.createSpan({
				cls: "friday-soul-template-chip",
				text: chip.label,
				attr: {
					title: chip.title,
				},
			});
		}

		if (detailsExpanded) {
			const previewEl = cardEl.createDiv({ cls: "friday-soul-template-preview" });
			this.renderSoulTemplatePreviewRow(previewEl, this.t("settings.soulLab.previewTone", "语气"), template.tonePrompt);
			this.renderSoulTemplatePreviewRow(previewEl, this.t("settings.soulLab.previewRhythm", "回应节奏"), template.responseRhythm);
			this.renderSoulTemplatePreviewRow(previewEl, this.t("settings.soulLab.previewStructure", "信息组织"), template.informationStructure);
			this.renderSoulTemplatePreviewRow(previewEl, this.t("settings.soulLab.previewFeedback", "反馈方式"), template.feedbackStyle);
			this.renderSoulTemplatePreviewRow(previewEl, this.t("settings.soulLab.previewBoundary", "风险边界"), template.riskBoundary);
			this.renderSoulTemplatePreviewRow(previewEl, this.t("settings.soulLab.previewBestFor", "适用场景"), template.bestFor.join("、"));
			const famousEl = previewEl.createDiv({ cls: "friday-soul-template-famous" });
			famousEl.createDiv({
				cls: "friday-soul-template-famous-title",
				text: this.t("settings.soulLab.previewFamous", "名人参考"),
			});
			famousEl.createDiv({
				cls: "friday-soul-template-famous-value",
				text: template.famousExamples.join("、"),
			});
		}

		const actionsEl = cardEl.createDiv({ cls: "friday-soul-template-actions" });
		const subscribeButton = actionsEl.createEl("button", {
			cls: `friday-soul-template-subscribe${isInstalled ? " is-installed" : ""}`,
			text: isInstalled
				? this.t("settings.soulLab.subscribed", "已加入")
				: this.t("settings.soulLab.subscribe", "加入我的 Soul"),
		});
		subscribeButton.type = "button";
		subscribeButton.setAttribute("aria-pressed", isInstalled ? "true" : "false");
		subscribeButton.onclick = () => {
			void this.toggleSoulExperimentTemplate(template);
		};
	}

	private renderSoulTemplatePreviewRow(containerEl: HTMLElement, label: string, value: string): void {
		const rowEl = containerEl.createDiv({ cls: "friday-soul-template-preview-row" });
		rowEl.createSpan({ cls: "friday-soul-template-preview-label", text: label });
		rowEl.createSpan({ cls: "friday-soul-template-preview-value", text: value });
	}

	private isCurrentSoulTemplate(template: SoulExperimentTemplate, soulDefinition: SoulDefinition | null): boolean {
		if (!soulDefinition || soulDefinition.archived) {
			return false;
		}
		return Boolean(
			soulDefinition.presetRefs?.includes(template.id) ||
			soulDefinition.profile?.id === template.profile.id,
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
		renderProjectSettingsSection(this, containerEl);
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

	private async patchActiveLlmReasoningConfig(patch: Partial<LlmReasoningSettings>): Promise<void> {
		this.host.settings.llm = patchActiveLlmConfig(this.host.settings.llm, {
			reasoning: {
				...this.host.settings.llm.reasoning,
				...patch,
			},
		});
		await this.host.saveSettings();
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
		const syncedCatalog = this.loadModelPresetsFromGroupModelCatalog();
		if (syncedCatalog) {
			this.modelPresetResult = syncedCatalog;
			return syncedCatalog;
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
		return buildAgentModelCatalogFromSettings(
			this.host.settings.llm,
			groupProvider?.models ?? this.getGroupModelCatalogOptions(),
		);
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

	private loadModelPresetsFromGroupModelCatalog(): ModelPresetResult | null {
		const models = this.getGroupModelCatalogOptions();
		if (models.length === 0) {
			return null;
		}
		const catalog = this.host.settings.groupModelCatalog;
		const version = catalog.lastCatalogVersion || this.t("common.notSet", "未设置");
		return {
			models: models.map((item) => item.id),
			modelLabels: Object.fromEntries(models.map((item) => [item.id, item.label])),
			source: this.t("settings.llm.groupModelCatalog.source", "集团模型目录：{version}", { version }),
			editablePaths: [catalog.filePath],
			providers: [],
			activeProvider: null,
		};
	}

	private getGroupModelCatalogOptions(): Array<{ id: string; label: string }> {
		const catalog = this.host.settings.groupModelCatalog;
		if (!catalog.enabled) {
			return [];
		}
		return catalog.models
			.filter((model: GroupModelCatalogModel) => model.enabled && model.id.trim())
			.map((model) => ({
				id: model.id.trim(),
				label: model.label.trim() || model.id.trim(),
			}));
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

	private renderGroupModelCatalogSetting(containerEl: HTMLElement): void {
		const catalog = this.host.settings.groupModelCatalog;
		const modelCount = catalog.models.filter((model) => model.enabled).length;
		const lastChecked = catalog.lastCheckedAt || this.t("common.never", "从未同步");
		const sourceDesc = this.t(
			"settings.llm.groupModelCatalog.desc",
			"最近检查：{checkedAt} | 可用模型：{count}",
			{
				checkedAt: lastChecked,
				count: modelCount,
			},
		);
		new Setting(containerEl)
			.setName(this.t("settings.llm.groupModelCatalog.name", "集团模型目录"))
			.setDesc(sourceDesc)
			.addToggle((toggle) =>
				toggle
					.setValue(catalog.enabled)
					.onChange(async (value) => {
						catalog.enabled = value;
						this.modelPresetResult = null;
						await this.host.saveSettings();
						this.display();
					}),
			)
			.addButton((button) =>
				button
					.setButtonText(
						this.groupModelCatalogActionPending
							? this.t("settings.llm.groupModelCatalog.refreshing", "刷新中...")
							: this.t("settings.llm.groupModelCatalog.refresh", "刷新模型目录"),
					)
					.setDisabled(this.groupModelCatalogActionPending || !catalog.enabled)
					.onClick(async () => {
						await this.refreshGroupModelCatalog();
					}),
			);

		new Setting(containerEl)
			.setName(this.t("settings.llm.groupModelCatalog.repoUrl.name", "模型目录仓库"))
			.setDesc(this.t("settings.llm.groupModelCatalog.repoUrl.desc", "只读取模型与能力目录；个人 baseURL/API Key 仍来自 OpenCode 或下方连接配置。"))
			.addText((text) =>
				text
					.setPlaceholder("https://gitee.example.com/org/friday-model-catalog.git")
					.setValue(catalog.repoUrl)
					.onChange(async (value) => {
						catalog.repoUrl = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(this.t("settings.llm.groupModelCatalog.branch.name", "模型目录分支"))
			.setDesc(this.t("settings.llm.groupModelCatalog.branch.desc", "推荐使用 friday-model-catalog，分支里只放 model-catalog.json。"))
			.addText((text) =>
				text
					.setPlaceholder("friday-model-catalog")
					.setValue(catalog.branch)
					.onChange(async (value) => {
						catalog.branch = value.trim();
						await this.host.saveSettings();
					}),
			);
	}

	private async refreshGroupModelCatalog(): Promise<void> {
		this.groupModelCatalogActionPending = true;
		try {
			const result = await this.host.groupModelCatalogService.refreshCatalog();
			this.modelPresetResult = null;
			if (!result.success) {
				new Notice(
					this.t("settings.llm.groupModelCatalog.refreshFailed", "模型目录刷新失败：{error}", {
						error: result.error || this.t("common.unknownError", "未知错误"),
					}),
					6000,
				);
				return;
			}
			new Notice(
				this.t("settings.llm.groupModelCatalog.refreshSuccess", "已刷新集团模型目录：{count} 个模型。", {
					count: result.modelCount,
				}),
				4000,
			);
		} finally {
			this.groupModelCatalogActionPending = false;
			this.display();
		}
	}

	private getOfficialContentRefreshStatusTone(status: OfficialContentSyncProgress): NativeSettingsTone {
		switch (status.stage) {
			case "refreshingCatalog":
			case "applyingSubscriptions":
				return "active";
			case "completed":
				return "success";
			case "failed":
				return "danger";
			default:
				return "muted";
		}
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

	private getLlmStatusTone(): NativeSettingsTone {
		if (this.llmStatus === "connected") return "success";
		if (this.llmStatus === "checking") return "active";
		if (this.llmStatus === "failed") return "danger";
		if (this.llmStatus === "unconfigured") return "warning";
		return "muted";
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
		soul: Pick<SoulSummary, "id" | "builtIn" | "editable" | "presetRefs"> & Partial<Pick<SoulDefinition, "tags" | "profile">>,
		totalSouls: number,
	): boolean {
		if (totalSouls <= 1) {
			return false;
		}
		if (soul.builtIn || this.isNativeSoul(soul)) {
			return false;
		}
		if (this.isExperimentSoul(soul)) {
			return true;
		}
		if (soul.editable === false) {
			return false;
		}
		return true;
	}

	private canEditSoul(
		soul: Pick<SoulSummary, "id" | "builtIn" | "editable" | "presetRefs"> & Partial<Pick<SoulDefinition, "tags" | "profile">>,
	): boolean {
		return !soul.builtIn && !this.isNativeSoul(soul) && !this.isExperimentSoul(soul) && soul.editable !== false;
	}

	private isNativeSoul(soul: Pick<SoulSummary, "id">): boolean {
		return soul.id.startsWith("default");
	}

	private isExperimentSoul(
		soul: Pick<SoulSummary, "presetRefs"> & Partial<Pick<SoulDefinition, "tags" | "profile">>,
	): boolean {
		return Boolean(
			soul.presetRefs?.some((presetRef) => getSoulExperimentTemplate(presetRef)) ||
			soul.tags?.includes("soul-lab") ||
			soul.profile?.id?.startsWith("mbti-"),
		);
	}

	private getNativeSoulFallbackId(souls = this.host.listSouls(), excludedSoulId = ""): string {
		const candidates = souls.filter((soul) => soul.id !== excludedSoulId);
		return (
			candidates.find((soul) => soul.builtIn || this.isNativeSoul(soul))?.id ||
			candidates[0]?.id ||
			""
		);
	}

	private async setCurrentSoulFromSettings(soulId: string): Promise<void> {
		await this.host.setActiveSoul(soulId);
		this.display();
	}

	private async createCustomSoulFromSettings(): Promise<void> {
		const suggestedName = `Soul-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
		const created = await this.host.createSoul({
			name: suggestedName,
			summary: this.t("settings.agent.create.manualDesc", "新的 Soul，待补充定义"),
			description: this.t("settings.agent.create.manualDesc", "新的 Soul，待补充定义"),
		});
		const createdDefinition = this.host.soulStore.getSoulSync(created.id);
		if (createdDefinition) {
			this.setSoulEditorDraft(createdDefinition);
			this.soulPanelMode = "editor";
		}
		new Notice(this.t("settings.agent.create.success", "已创建 Soul: {name}", { name: created.name }), 3000);
		this.display();
	}

	private async openSoulProfileEditor(soulId: string): Promise<void> {
		const target = this.host.soulStore.getSoulSync(soulId);
		if (!target) {
			throw new Error(this.t("settings.agent.profile.missing", "当前 Agent 不存在或已被移除。"));
		}
		if (!this.canEditSoul(target)) {
			throw new Error(this.t("settings.agent.profile.readonlyTitle", "这个 Soul 不能编辑"));
		}
		this.setSoulEditorDraft(target);
		this.soulPanelMode = "editor";
		this.display();
	}

	private async deleteSoulFromSettings(soulId: string): Promise<void> {
		const souls = this.host.listSouls();
		const target = souls.find((item) => item.id === soulId);
		if (!target || !this.canDeleteSoul(target, souls.length)) {
			throw new Error(this.t("settings.agent.manage.deleteBlocked", "内置 Soul 或最后一个 Soul 不能删除。"));
		}
		const fallbackId = this.getNativeSoulFallbackId(souls, soulId);
		const fallback = fallbackId ? this.host.soulStore.getSoulSync(fallbackId) : null;
		const wasActive = this.host.settings.activeSoulId === soulId;
		await this.host.soulStore.deleteSoul(soulId);
		if (wasActive && fallbackId) {
			await this.host.setActiveSoul(fallbackId);
		}
		if (this.soulEditorDraftId === soulId) {
			if (fallback && this.canEditSoul(fallback)) {
				this.setSoulEditorDraft(fallback);
			} else {
				this.soulPanelMode = "manage";
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
		if (!this.canEditSoul(existing)) {
			throw new Error(this.t("settings.agent.profile.readonlyTitle", "这个 Soul 不能编辑"));
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
		new Notice(this.t("settings.agent.profile.resetSuccess", "已恢复最新内置 Soul 默认配置：{name}", { name: updated.name }), 3000);
		this.display();
	}

	private isSoulTemplateInstalled(template: SoulExperimentTemplate): boolean {
		return Boolean(this.findInstalledSoulForTemplate(template));
	}

	private findInstalledSoulForTemplate(template: SoulExperimentTemplate): SoulDefinition | null {
		for (const soul of this.host.listSouls()) {
			const definition = this.host.soulStore.getSoulSync(soul.id);
			if (definition && this.isSoulTemplateDefinition(template, definition)) {
				return definition;
			}
		}
		return null;
	}

	private isSoulTemplateDefinition(template: SoulExperimentTemplate, soulDefinition: SoulDefinition): boolean {
		return Boolean(
			soulDefinition.id === this.buildExperimentSoulId(template) ||
			soulDefinition.presetRefs?.includes(template.id) ||
			soulDefinition.profile?.id === template.profile.id,
		);
	}

	private async toggleSoulExperimentTemplate(template: SoulExperimentTemplate): Promise<void> {
		if (this.isSoulTemplateInstalled(template)) {
			await this.removeSoulExperimentTemplate(template);
			return;
		}
		await this.installSoulExperimentTemplate(template);
	}

	private async installSoulExperimentTemplate(template: SoulExperimentTemplate): Promise<void> {
		const existing = this.findInstalledSoulForTemplate(template);
		const base = existing ?? await this.host.soulStore.createSoul({
			id: this.buildExperimentSoulId(template),
			name: template.name,
			summary: template.summary,
			description: template.description,
		});
		const updated = await this.host.soulStore.updateSoul(base.id, {
			name: template.name,
			summary: template.summary,
			description: template.description,
			rolePrompt: template.rolePrompt,
			identityAnchor: "FRIDAY",
			profile: template.profile,
			tonePreset: template.tonePreset,
			tonePrompt: template.tonePrompt,
			behaviorRules: template.behaviorRules,
			antiPatterns: template.antiPatterns,
			presetRefs: [template.id],
			tags: template.tags,
			builtIn: false,
			editable: false,
			archived: false,
			builtInPresetVersion: undefined,
		});
		await this.host.saveSettings();
		new Notice(
			this.t("settings.soulLab.installed", "已加入 Soul：{name}", {
				name: updated.name,
			}),
			3000,
		);
		this.display();
	}

	private async removeSoulExperimentTemplate(template: SoulExperimentTemplate): Promise<void> {
		const installed = this.findInstalledSoulForTemplate(template);
		if (!installed) {
			return;
		}
		const fallbackId = this.getNativeSoulFallbackId(this.host.listSouls(), installed.id);
		const wasActive = this.host.settings.activeSoulId === installed.id;
		await this.host.soulStore.deleteSoul(installed.id);
		if (wasActive && fallbackId) {
			await this.host.setActiveSoul(fallbackId);
		}
		await this.host.saveSettings();
		new Notice(
			this.t("settings.soulLab.unsubscribed", "已从 Soul 管理移除：{name}", {
				name: installed.name,
			}),
			3000,
		);
		this.display();
	}

	private buildExperimentSoulId(template: SoulExperimentTemplate): string {
		return template.id;
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

	private getCredentialStorageStatusDesc(): string {
		return this.host.getCredentialStorageMode() === "secure"
			? this.t("settings.user.credentialStorage.secure", "系统安全存储可用，Git 凭据会加密保存在当前设备上。")
			: this.t("settings.user.credentialStorage.local", "未检测到系统安全存储，Git 凭据仅保存在当前设备的本地插件存储中。");
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

