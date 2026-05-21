import { Notice, Setting } from "obsidian";
import { parseAgentModelChoice, resolveSelectedAgentModelValue } from "../../core/llm/AgentModelCatalog";
import { SOUL_EXPERIMENT_TEMPLATE_SERIES } from "../../features/soul/SoulExperimentTemplates";
import { deriveFileMutationModeFromToolPermissionMode, type ToolPermissionMode } from "../../types/agent";
import type { SoulTonePreset } from "../../types/soul";
import { markNativeDangerSetting, renderNativeSettingsEmptyState } from "../../ui/obsidian-native/SettingsKit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- transitional extraction keeps using FridaySettingTab helper surface.
type SettingsSectionContext = Record<string, any>;

export function renderSoulSettingsSection(ctx: SettingsSectionContext, containerEl: HTMLElement): void {
	if (ctx.soulPanelMode === "lab") {
		renderSoulLabSettingsSection(ctx, containerEl);
		return;
	}
	if (ctx.soulPanelMode === "editor") {
		renderSoulEditorSettingsSection(ctx, containerEl);
		return;
	}
	const souls = ctx.host.listSouls();
	const activeSoul = ctx.host.getActiveSoul();
	const activeSoulDefinition = activeSoul ? ctx.host.soulStore.getSoulSync(activeSoul.id) : null;
	const identityGroup = ctx.createNativeSettingsGroup(containerEl);
	const managementGroup = ctx.createNativeSettingsGroup(containerEl, {
		title: ctx.t("settings.agent.manage.title", "Soul 管理"),
		description: ctx.t(
			"settings.agent.manage.desc",
			"管理已经加入的 Soul。原生 FRIDAY 和实验性 Soul 只能选择或移除；自定义 Soul 可进入配置页编辑。",
		),
	});
	const runtimeGroup = ctx.createNativeSettingsGroup(containerEl);
	const pathGroup = ctx.createNativeSettingsGroup(containerEl);

	new Setting(identityGroup)
			.setName(ctx.t("settings.agent.currentSoul.name", "当前 FRIDAY Soul"))
		.setDesc(
			ctx.t(
				"settings.agent.currentSoul.desc",
			"Soul 是对 FRIDAY 的人格、风格的定义，可灵活调整。",
			),
		)
		.addDropdown((dropdown) => {
			for (const soul of souls) {
				dropdown.addOption(soul.id, ctx.resolveSoulDisplayName(soul));
			}
			if (souls.length > 0) {
				dropdown.setValue(activeSoul?.id || souls[0]!.id);
			}
			dropdown.onChange(async (value) => {
				await ctx.host.setActiveSoul(value);
				ctx.display();
			});
		});

	if (activeSoulDefinition) {
		new Setting(identityGroup)
			.setName(ctx.t("settings.agent.currentModel.name", "当前 FRIDAY Model"))
			.setDesc(ctx.t("settings.agent.model.desc", "优先级高于全局默认模型。留空则使用全局模型。"))
			.addDropdown((dropdown) => {
				const agentModelOptions = ctx.getAvailableAgentModelOptions();
				const selectedModelValue = resolveSelectedAgentModelValue({
					model: activeSoulDefinition.preferredModel ?? "",
					modelMode: activeSoulDefinition.preferredModelMode,
				}, agentModelOptions);
				dropdown.addOption("", ctx.t("settings.agent.model.followGlobal", "跟随全局默认"));
				for (const option of agentModelOptions) {
					dropdown.addOption(option.value, option.label);
				}
				dropdown.setValue(selectedModelValue);
				dropdown.onChange(async (value) => {
					const parsed = parseAgentModelChoice(value);
					await ctx.host.soulStore.updateSoul(activeSoulDefinition.id, {
						preferredModel: parsed?.model ?? "",
						preferredModelMode: parsed?.mode,
					});
					await ctx.host.saveSettings();
					ctx.display();
				});
			});

	}

	new Setting(managementGroup)
		.setName(ctx.t("settings.agent.create.name", "新建 Soul"))
		.setDesc(ctx.t("settings.agent.create.desc", "进入配置页创建一个只属于你的自定义 Soul。"))
		.addButton((button) =>
			button
				.setButtonText(ctx.t("settings.agent.create.button", "新建 Soul"))
				.setIcon("plus")
				.setCta()
				.onClick(async () => {
					await ctx.createCustomSoulFromSettings();
				}),
		);

	new Setting(managementGroup)
		.setName(ctx.t("settings.agent.create.fromTemplate", "Soul 实验室"))
		.setDesc(ctx.t("settings.agent.create.fromTemplateDesc", "打开 Soul 实验室，勾选要加入的 MBTI 等实验性 Soul。"))
		.addButton((button) =>
			button.setButtonText(ctx.t("settings.agent.create.fromTemplateAction", "去实验室看看")).onClick(() => {
				ctx.soulPanelMode = "lab";
				ctx.display();
			}),
		);

	for (const soul of souls) {
		const definition = ctx.host.soulStore.getSoulSync(soul.id) ?? soul;
		const summary = soul.summary?.trim() || ctx.t("settings.agent.manage.emptySummary", "尚未补充简介");
		const isCurrent = soul.id === activeSoulDefinition?.id;
		const row = new Setting(managementGroup)
			.setName(ctx.resolveSoulDisplayName(soul))
			.setDesc(
				isCurrent
					? ctx.t("settings.agent.manage.currentBadge", "当前使用中 · {summary}", { summary })
				: summary,
			);
		row.settingEl.addClass("friday-soul-manage-row");
		row.controlEl.addClass("friday-soul-manage-actions");
		row.addButton((button) => {
			const currentToggleLabel = isCurrent && ctx.isExperimentSoul(definition)
				? ctx.t("settings.agent.manage.unsetExperiment", "取消当前并回到原生 FRIDAY")
				: ctx.t("settings.agent.manage.current", "当前使用");
			button
				.setIcon(isCurrent ? "check-circle-2" : "circle")
				.setTooltip(isCurrent
					? currentToggleLabel
					: ctx.t("settings.agent.manage.setCurrent", "设为当前"))
				.onClick(async () => {
					if (isCurrent && ctx.isExperimentSoul(definition)) {
						await ctx.setCurrentSoulFromSettings(ctx.getNativeSoulFallbackId(souls, soul.id));
						return;
					}
					if (!isCurrent) {
						await ctx.setCurrentSoulFromSettings(soul.id);
					}
				});
			button.buttonEl.addClass("friday-soul-manage-icon-button");
			button.buttonEl.setAttribute(
				"aria-label",
				isCurrent ? currentToggleLabel : ctx.t("settings.agent.manage.setCurrent", "设为当前"),
			);
			if (isCurrent) {
				button.buttonEl.addClass("is-current");
			}
		});
		const canEdit = ctx.canEditSoul(definition);
		row.addButton((button) => {
			button
				.setIcon("pencil")
				.setTooltip(canEdit
					? ctx.t("settings.agent.manage.edit", "编辑")
					: ctx.t("settings.agent.manage.editUnavailable", "不可编辑"))
				.setDisabled(!canEdit);
			if (canEdit) {
				button.onClick(async () => {
					await ctx.openSoulProfileEditor(soul.id);
				});
			}
			button.buttonEl.addClass("friday-soul-manage-icon-button");
			button.buttonEl.setAttribute(
				"aria-label",
				canEdit
					? ctx.t("settings.agent.manage.edit", "编辑")
					: ctx.t("settings.agent.manage.editUnavailable", "不可编辑"),
			);
			if (!canEdit) {
				button.buttonEl.addClass("friday-soul-manage-placeholder");
			}
		});
		const canDelete = ctx.canDeleteSoul(definition, souls.length);
		row.addButton((button) => {
			button
				.setIcon("trash-2")
				.setTooltip(canDelete
					? ctx.t("settings.agent.manage.delete", "删除")
					: ctx.t("settings.agent.manage.deleteUnavailable", "不可删除"))
				.setDisabled(!canDelete);
			if (canDelete) {
				button.onClick(async () => {
					await ctx.deleteSoulFromSettings(soul.id);
				});
			}
			button.buttonEl.addClass("friday-soul-manage-icon-button");
			button.buttonEl.setAttribute(
				"aria-label",
				canDelete
					? ctx.t("settings.agent.manage.delete", "删除")
					: ctx.t("settings.agent.manage.deleteUnavailable", "不可删除"),
			);
			if (canDelete) {
				button.buttonEl.addClass("is-danger");
			} else {
				button.buttonEl.addClass("friday-soul-manage-placeholder");
			}
		});
	}

	new Setting(runtimeGroup)
		.setName(ctx.t("settings.agent.runtime.name", "启用 Agent 工具运行时"))
		.setDesc(ctx.t("settings.agent.runtime.desc", "开启后，AI 将按需调用 read/grep/glob/ls/memory/write/delete。"))
		.addToggle((toggle) =>
			toggle.setValue(ctx.host.settings.agentRuntime.toolRuntimeEnabled).onChange(async (value) => {
				ctx.host.settings.agentRuntime.toolRuntimeEnabled = value;
				await ctx.host.saveSettings();
			}),
		);

	new Setting(runtimeGroup)
		.setName(ctx.t("settings.agent.toolCalling.name", "Tool Calling 模式"))
		.setDesc(
			ctx.t(
				"settings.agent.toolCalling.desc",
				"auto：优先 native tools，失败后回退 prompt；native：仅 native；prompt：仅提示词 JSON 模式。",
			),
		)
		.addDropdown((dropdown) => {
			dropdown.addOption("auto", ctx.t("settings.agent.toolCalling.auto", "auto（推荐）"));
			dropdown.addOption("native", ctx.t("settings.agent.toolCalling.native", "native only"));
			dropdown.addOption("prompt", ctx.t("settings.agent.toolCalling.prompt", "prompt only"));
			dropdown.setValue(ctx.host.settings.agentRuntime.toolCallingMode ?? "auto");
			dropdown.onChange(async (value) => {
				ctx.host.settings.agentRuntime.toolCallingMode = value as "auto" | "native" | "prompt";
				await ctx.host.saveSettings();
			});
		});

	new Setting(runtimeGroup)
		.setName(ctx.t("settings.agent.permissionMode.name", "工具权限模式"))
		.setDesc(
			ctx.t(
				"settings.agent.permissionMode.desc",
				"全自动：所有工具自动通过 | 标准：读操作自动，写入/执行需审批 | 严格：全部需审批",
			),
		)
		.addDropdown((dropdown) => {
			dropdown.addOption("auto", ctx.t("settings.agent.permissionMode.auto", "全自动"));
			dropdown.addOption("standard", ctx.t("settings.agent.permissionMode.standard", "标准"));
			dropdown.addOption("strict", ctx.t("settings.agent.permissionMode.strict", "严格"));
			dropdown.setValue(ctx.host.settings.agentRuntime.toolPermissionMode);
			dropdown.onChange(async (value) => {
				const mode = value as ToolPermissionMode;
				ctx.host.settings.agentRuntime.toolPermissionMode = mode;
				ctx.host.settings.agentRuntime.fileMutationMode = deriveFileMutationModeFromToolPermissionMode(mode);
				await ctx.host.saveSettings();
			});
		});

	if (ctx.host.settings.projects.length > 0) {
		const policyGroup = ctx.createNativeSettingsGroup(containerEl, {
			title: ctx.t("settings.soul.policy.title", "项目工具策略"),
			description: ctx.t(
				"settings.soul.policy.desc",
				"持久化层按 project > global 合并；session 级临时覆写在工作台对话页设置，只影响当前会话。",
			),
		});
		ctx.renderProjectPolicyEditor(policyGroup);
	}

	ctx.renderPathListSetting(
		pathGroup,
		ctx.t("settings.agent.path.vaultFocus.name", "Vault 聚焦路径"),
		ctx.t("settings.agent.path.vaultFocus.desc", "每行一个相对 Vault 的目录；为空表示允许读取整个 Vault。"),
		ctx.host.settings.agentRuntime.vaultFocusPaths,
		async (paths: string[]) => {
			ctx.host.settings.agentRuntime.vaultFocusPaths = paths;
			await ctx.host.saveSettings();
		},
	);

	ctx.renderPathListSetting(
		pathGroup,
		ctx.t("settings.agent.path.externalReadonly.name", "外路径只读白名单"),
		ctx.t("settings.agent.path.externalReadonly.desc", "每行一个绝对路径，供 Agent 只读访问。"),
		ctx.host.settings.agentRuntime.externalReadOnlyPaths,
		async (paths: string[]) => {
			ctx.host.settings.agentRuntime.externalReadOnlyPaths = paths;
			await ctx.host.saveSettings();
		},
	);

	ctx.renderPathListSetting(
		pathGroup,
		ctx.t("settings.agent.path.skillExternal.name", "Skill 外路径"),
		ctx.t("settings.agent.path.skillExternal.desc", "每行一个绝对路径，用于加载外部 skill 元数据。"),
		ctx.host.settings.agentRuntime.externalSkillPaths,
		async (paths: string[]) => {
			ctx.host.settings.agentRuntime.externalSkillPaths = paths;
			await ctx.host.saveSettings();
		},
	);

	if (ctx.host.legacyAgentCleanupService.hasLegacyAgentData()) {
		const cleanupGroup = ctx.createNativeSettingsGroup(containerEl, {
			title: ctx.t("settings.soul.cleanup.name", "迁移并清理旧 Agent 数据"),
			description: ctx.t(
				ctx.pendingSoulCleanupConfirm
					? "settings.soul.cleanup.danger"
					: "settings.soul.cleanup.desc",
				ctx.pendingSoulCleanupConfirm
					? "这会强制删除 F.R.I.D.A.Y/Agents 下的旧会话、快照、memory、preset、global knowledge 与 agent knowledge。仅部分文件会先备份到本地状态层，备份内容不会继续出现在 Obsidian 正常编辑流里。再次点击按钮才会真正执行。"
					: "自动迁移完成后，可清理 F.R.I.D.A.Y/Agents 中的旧运行数据；这是强清理动作，会删除旧 preset 与知识文件。",
			),
		});
		const cleanupSetting = new Setting(cleanupGroup)
			.setName(ctx.t("settings.soul.cleanup.name", "迁移并清理旧 Agent 数据"))
			.setDesc(
				ctx.pendingSoulCleanupConfirm
					? ctx.t(
							"settings.soul.cleanup.danger",
							"这会强制删除旧 Agent 目录中的可见资产。再次点击按钮才会真正执行。",
					  )
					: ctx.t(
							"settings.soul.cleanup.desc",
							"自动迁移完成后，可清理 F.R.I.D.A.Y/Agents 中的旧运行数据；这是强清理动作。",
					  ),
			);
		markNativeDangerSetting(cleanupSetting);
		cleanupSetting.addButton((button) =>
				button
					.setButtonText(
						ctx.pendingSoulCleanupConfirm
							? ctx.t("settings.soul.cleanup.confirm", "确认删除旧 Agent 目录")
							: ctx.t("settings.soul.cleanup.button", "清理旧 Agent 数据"),
					)
					.setWarning()
					.onClick(async () => {
						if (!ctx.pendingSoulCleanupConfirm) {
							ctx.pendingSoulCleanupConfirm = true;
							ctx.display();
							return;
						}
						try {
							const result = await ctx.host.legacyAgentCleanupService.cleanupLegacyAgentData();
							ctx.pendingSoulCleanupConfirm = false;
							if (result.removedCount === 0 && result.backedUpCount === 0) {
								new Notice(ctx.t("settings.soul.cleanup.noop", "没有检测到可清理的旧 Agent 数据。"), 3000);
							} else {
								new Notice(
									ctx.t("settings.soul.cleanup.success", "旧 Agent 数据已清理，已备份 {count} 个文件。", {
										count: result.backedUpCount,
									}),
									4000,
								);
							}
							ctx.display();
						} catch (error) {
							ctx.pendingSoulCleanupConfirm = false;
							new Notice(
								ctx.t("settings.soul.cleanup.failed", "清理旧 Agent 数据失败：{error}", {
									error: error instanceof Error ? error.message : String(error ?? ""),
								}),
								6000,
							);
						}
					}),
			);
	}

}

function renderSoulEditorSettingsSection(ctx: SettingsSectionContext, containerEl: HTMLElement): void {
	const targetId = ctx.soulEditorDraftId || ctx.host.settings.activeSoulId.trim();
	const target = targetId ? ctx.host.soulStore.getSoulSync(targetId) : null;
	const editorGroup = ctx.createNativeSettingsGroup(containerEl, {
		extraClass: "friday-soul-editor-group",
	});
	const headerEl = editorGroup.createDiv({ cls: "friday-soul-editor-header" });
	const copyEl = headerEl.createDiv({ cls: "friday-soul-editor-copy" });
	copyEl.createDiv({
		cls: "friday-native-settings-group-title friday-soul-editor-title",
		text: ctx.t("settings.agent.profile.title", "编辑 Soul"),
	});
	copyEl.createDiv({
		cls: "friday-native-settings-group-description friday-soul-editor-desc",
		text: ctx.t("settings.agent.profile.desc", "配置自定义 Soul 的显示信息、人格定义和表达方式。"),
	});
	const backButton = headerEl.createEl("button", {
		cls: "friday-soul-editor-back-button",
		text: ctx.t("settings.agent.profile.back", "返回 Soul 管理"),
	});
	backButton.type = "button";
	backButton.onclick = () => {
		ctx.soulPanelMode = "manage";
		ctx.display();
	};
	if (!target || !ctx.canEditSoul(target)) {
		renderNativeSettingsEmptyState(editorGroup, {
			title: ctx.t("settings.agent.profile.readonlyTitle", "这个 Soul 不能编辑"),
			description: ctx.t("settings.agent.profile.readonlyDesc", "原生 FRIDAY 和实验性 Soul 由系统维护，只能选择或移除。"),
		});
		return;
	}
	ctx.ensureSoulEditorDraft(target);

	new Setting(editorGroup)
		.setName(ctx.t("settings.agent.profile.name", "Soul 名称"))
		.setDesc(ctx.t("settings.agent.profile.nameDesc", "这是这个 Soul 的显示名称。"))
		.addText((text) =>
			text
				.setPlaceholder(ctx.t("settings.agent.defaultName", "原生 FRIDAY"))
				.setValue(ctx.soulEditorNameDraft)
				.onChange((value) => {
					ctx.soulEditorNameDraft = value;
				}),
		);

	new Setting(editorGroup)
		.setName(ctx.t("settings.agent.profile.summary", "一句话简介"))
		.setDesc(ctx.t("settings.agent.profile.summaryDesc", "用于快速说明这个 Soul 的定位和特点。"))
		.addText((text) =>
			text
				.setPlaceholder(ctx.t("settings.agent.profile.summaryPlaceholder", "例如：偏研究和结构化表达"))
				.setValue(ctx.soulEditorSummaryDraft)
				.onChange((value) => {
					ctx.soulEditorSummaryDraft = value;
				}),
		);

	new Setting(editorGroup)
		.setName(ctx.t("settings.agent.profile.definition", "人格与风格定义"))
		.setDesc(ctx.t("settings.agent.profile.definitionDesc", "用自然语言描述 FRIDAY 的人格、风格和行为方式。"))
		.addTextArea((textArea) => {
			textArea
				.setPlaceholder(ctx.t("settings.agent.profile.definitionPlaceholder", "例如：先给结论，再展开；语气克制、清晰，少说空话。"))
				.setValue(ctx.soulEditorDefinitionDraft)
				.onChange((value) => {
					ctx.soulEditorDefinitionDraft = value;
				});
			textArea.inputEl.rows = 4;
			textArea.inputEl.style.width = "100%";
		});

	new Setting(editorGroup)
		.setName(ctx.t("settings.agent.profile.tonePreset", "语气风格"))
		.setDesc(ctx.t("settings.agent.profile.tonePresetDesc", "选择 FRIDAY 默认的表达气质。"))
		.addDropdown((dropdown) => {
			dropdown.addOption("balanced", ctx.t("settings.agent.profile.tonePreset.balanced", "平衡"));
			dropdown.addOption("calm", ctx.t("settings.agent.profile.tonePreset.calm", "冷静"));
			dropdown.addOption("warm", ctx.t("settings.agent.profile.tonePreset.warm", "亲和"));
			dropdown.setValue(ctx.soulEditorTonePresetDraft);
			dropdown.onChange((value) => {
				ctx.soulEditorTonePresetDraft = (value as SoulTonePreset) ?? "balanced";
			});
		});

	new Setting(editorGroup)
		.setName(ctx.t("settings.agent.profile.toneNote", "补充说明（可选）"))
		.setDesc(ctx.t("settings.agent.profile.toneNoteDesc", "只补一句微调要求，例如先给结论、少用术语。"))
		.addTextArea((textArea) => {
			textArea
				.setPlaceholder(ctx.t("settings.agent.profile.toneNotePlaceholder", "例如：先给结论，少用术语。"))
				.setValue(ctx.soulEditorToneDraft)
				.onChange((value) => {
					ctx.soulEditorToneDraft = value;
				});
			textArea.inputEl.rows = 2;
			textArea.inputEl.style.width = "100%";
		});

	new Setting(editorGroup)
		.setName(ctx.t("settings.agent.profile.save", "保存 Soul 定义"))
		.setDesc(ctx.t("settings.agent.profile.saveDesc", "会保存这个自定义 Soul 的显示信息和背后的定义。"))
		.addButton((button) =>
			button.setButtonText(ctx.t("settings.agent.profile.save", "保存 Soul 定义")).setCta().onClick(async () => {
				await ctx.saveActiveSoulProfile(target.id);
			}),
		);
}

function renderSoulLabSettingsSection(ctx: SettingsSectionContext, containerEl: HTMLElement): void {
	const introGroup = ctx.createNativeSettingsGroup(containerEl, {
		extraClass: "friday-soul-lab-intro",
	});
	const introHeaderEl = introGroup.createDiv({ cls: "friday-soul-lab-intro-header" });
	const introCopyEl = introHeaderEl.createDiv({ cls: "friday-soul-lab-intro-copy" });
	introCopyEl.createDiv({
		cls: "friday-native-settings-group-title friday-soul-lab-intro-title",
		text: ctx.t("settings.soulLab.title", "Soul 实验室"),
	});
	introCopyEl.createDiv({
		cls: "friday-native-settings-group-description friday-soul-lab-intro-desc",
		text: ctx.t("settings.soulLab.desc", "从实验模板生成一个可编辑的 FRIDAY Soul。"),
	});
	const backButton = introHeaderEl.createEl("button", {
		cls: "friday-soul-lab-back-button",
		text: ctx.t("settings.soulLab.back", "返回 Soul 管理"),
	});
	backButton.type = "button";
	backButton.onclick = () => {
		ctx.soulPanelMode = "manage";
		ctx.display();
	};

	for (const series of SOUL_EXPERIMENT_TEMPLATE_SERIES) {
		const isMbtiSeries = series.id === "mbti-communication";
		const detailsExpanded = isMbtiSeries && ctx.soulLabDetailsExpanded;
		const seriesTitle = isMbtiSeries
			? ctx.t("settings.soulLab.mbti.title", series.title)
			: series.title;
		const seriesDescription = isMbtiSeries
			? ctx.t("settings.soulLab.mbti.desc", series.description)
			: series.description;
		const seriesGroup = ctx.createNativeSettingsGroup(containerEl, {
			extraClass: `friday-soul-lab-series-group${detailsExpanded ? " is-detail-expanded" : ""}`,
		});
		const seriesHeaderEl = seriesGroup.createDiv({ cls: "friday-soul-lab-series-header" });
		const seriesCopyEl = seriesHeaderEl.createDiv({ cls: "friday-soul-lab-series-copy" });
		seriesCopyEl.createDiv({
			cls: "friday-native-settings-group-title friday-soul-lab-series-title",
			text: seriesTitle,
		});
		seriesCopyEl.createDiv({
			cls: "friday-native-settings-group-description friday-soul-lab-series-desc",
			text: seriesDescription,
		});
		if (isMbtiSeries) {
			const detailButton = seriesHeaderEl.createEl("button", {
				cls: "friday-soul-lab-detail-toggle",
				text: detailsExpanded
					? ctx.t("settings.soulLab.detailsCollapse", "收起 Soul 详情")
					: ctx.t("settings.soulLab.detailsExpand", "展开 Soul 详情"),
			});
			detailButton.type = "button";
			detailButton.setAttribute("aria-expanded", detailsExpanded ? "true" : "false");
			detailButton.onclick = () => {
				ctx.soulLabDetailsExpanded = !ctx.soulLabDetailsExpanded;
				ctx.display();
			};
		}

		const activeSoul = ctx.host.getActiveSoul();
		const activeSoulDefinition = activeSoul ? ctx.host.soulStore.getSoulSync(activeSoul.id) : null;
		const seriesSectionEl = seriesGroup.createDiv({
			cls: "friday-soul-lab-series",
			attr: {
				"data-series-id": series.id,
			},
		});
		const gridEl = seriesSectionEl.createDiv({ cls: "friday-soul-template-grid" });
		for (const template of series.templates) {
			ctx.renderSoulTemplateCard(
				gridEl,
				template,
				ctx.isCurrentSoulTemplate(template, activeSoulDefinition),
				ctx.isSoulTemplateInstalled(template),
				detailsExpanded,
			);
		}
	}

	ctx.renderSoulSuggestionPanel(containerEl);
}
