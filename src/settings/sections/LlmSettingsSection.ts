import { Notice, Setting } from "obsidian";
import { selectOpencodeProvider } from "../../core/llm/OpencodeConfigResolver";
import { patchActiveLlmConfig, patchLlmModeConfig, switchLlmMode } from "../../core/llm/LlmSettingsResolver";
import type { LlmReasoningSettings } from "../../types/settings";
import { renderNativeSettingStatus, renderNativeSettingsFeedback } from "../../ui/obsidian-native/SettingsKit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- transitional extraction keeps using FridaySettingTab helper surface.
type SettingsSectionContext = Record<string, any>;
type LlmMode = "openai" | "group";

export function renderLlmSettingsSection(ctx: SettingsSectionContext, containerEl: HTMLElement): void {
	ctx.syncLlmStatusWithConfig();
	const mode = (ctx.host.settings.llm.mode ?? "openai") as LlmMode;
	if (ctx.host.settings.llm.mode !== mode) {
		ctx.host.settings.llm.mode = mode;
	}
	const statusGroup = ctx.createNativeSettingsGroup(containerEl);
	const connectionGroup = ctx.createNativeSettingsGroup(containerEl);
	const capabilityGroup = ctx.createNativeSettingsGroup(containerEl);

	const llmStatusSetting = new Setting(statusGroup)
		.setName(ctx.t("settings.llm.connection.name", "连通状态"))
		.setDesc(ctx.getLlmStatusDesc())
		.addButton((button) =>
			button
				.setButtonText(
					ctx.llmStatus === "checking"
						? ctx.t("settings.llm.connection.checking", "检测中...")
						: ctx.t("settings.llm.connection.test", "测试连通"),
				)
				.setDisabled(ctx.llmStatus === "checking")
				.onClick(async () => {
					await ctx.runLlmConnectionTest();
				}),
		);
	renderNativeSettingStatus(llmStatusSetting, {
		text: ctx.getLlmStatusLabel(),
		tone: ctx.getLlmStatusTone(),
	});

	new Setting(statusGroup)
		.setName(ctx.t("settings.llm.mode.name", "接入模式"))
		.setDesc(ctx.t("settings.llm.mode.desc", "可选通用 OpenAI 协议，或集团集采网关模式。"))
		.addDropdown((dropdown) => {
			dropdown.addOption("openai", ctx.t("settings.llm.mode.openai", "OpenAI 协议模式"));
			dropdown.addOption("group", ctx.t("settings.llm.mode.group", "集团集采模式"));
			dropdown.setValue(mode);
			dropdown.onChange(async (value: LlmMode) => {
				ctx.host.settings.llm = switchLlmMode(ctx.host.settings.llm, value);
				if (value === "group") {
					const presets = ctx.getModelPresetResult();
					ctx.host.settings.llm = patchActiveLlmConfig(ctx.host.settings.llm, {
						opencodeProviderId: ctx.host.settings.llm.opencodeProviderId || presets.activeProvider?.id || "",
					});
					if (!ctx.host.settings.llm.model.trim()) {
						ctx.host.settings.llm = patchActiveLlmConfig(ctx.host.settings.llm, {
							model: presets.models[0] ?? "",
						});
					}
				}
				await ctx.host.saveSettings();
				ctx.markLlmStatusDirty();
				ctx.display();
			});
		});

	if (mode === "group") {
		const modelPresets = ctx.getModelPresetResult();
		const activeProvider = modelPresets.activeProvider;
		if (modelPresets.providers.length > 0) {
			new Setting(statusGroup)
				.setName(ctx.t("settings.llm.opencodeProvider.name", "OpenCode Provider"))
				.setDesc(
					activeProvider
						? ctx.t("settings.llm.opencodeProvider.desc", "来源: {source} | 当前: {provider}", {
								source: modelPresets.source,
								provider: activeProvider.name,
							})
						: ctx.t(
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
						ctx.host.settings.llm = patchLlmModeConfig(ctx.host.settings.llm, "group", {
							opencodeProviderId: value,
						});
						const selectedProvider = selectOpencodeProvider(ctx.readOpencodeSnapshot(), value);
						if (
							selectedProvider &&
							selectedProvider.models.length > 0 &&
							!selectedProvider.models.some((item) => item.id === ctx.host.settings.llm.model.trim())
						) {
							ctx.host.settings.llm = patchLlmModeConfig(ctx.host.settings.llm, "group", {
								model: selectedProvider.models[0]!.id,
							});
						}
						await ctx.host.saveSettings();
						ctx.markLlmStatusDirty();
						ctx.display();
					});
				})
				.addButton((button) =>
					button
						.setButtonText(ctx.t("settings.llm.opencodeProvider.sync", "一键同步 OpenCode 配置"))
						.setCta()
						.onClick(async () => {
							await ctx.syncSelectedOpencodeProvider();
						}),
				)
				.addExtraButton((button) =>
					button
						.setIcon("refresh-cw")
						.setTooltip(ctx.t("settings.llm.presetModel.reload", "重新读取模型预置"))
						.onClick(() => {
							ctx.modelPresetResult = null;
							ctx.display();
						}),
				);
		} else {
			new Setting(statusGroup)
				.setName(ctx.t("settings.llm.opencodeProvider.name", "OpenCode Provider"))
				.setDesc(
					ctx.t(
						"settings.llm.opencodeProvider.missing",
						"未在 OpenCode 配置中读取到 provider。请检查 opencode.json。",
					),
				);
		}
		ctx.renderGroupModelCatalogSetting(statusGroup);
	}

	new Setting(connectionGroup)
		.setName(ctx.t("settings.llm.apiUrl.name", "API 地址（必填）"))
		.setDesc(ctx.t("settings.llm.apiUrl.desc", "可填网关基础地址或完整 chat/completions 地址。"))
		.addText((text) =>
			text
				.setPlaceholder(ctx.t("settings.llm.apiUrl.placeholder", "例如: https://api.openai.com/v1"))
				.setValue(ctx.host.settings.llm.apiUrl)
				.onChange(async (value) => {
					ctx.host.settings.llm = patchActiveLlmConfig(ctx.host.settings.llm, {
						apiUrl: value.trim(),
					});
					await ctx.host.saveSettings();
					ctx.markLlmStatusDirty();
				}),
		);

	new Setting(connectionGroup)
		.setName(ctx.t("settings.llm.apiKey.name", "API 密钥（选填）"))
		.setDesc(ctx.t("settings.llm.apiKey.desc", "如果网关不需要密钥，可留空。"))
		.addText((text) => {
			text.inputEl.type = "password";
			text
				.setPlaceholder(ctx.t("settings.llm.apiKey.placeholder", "可留空"))
				.setValue(ctx.host.settings.llm.apiKey)
				.onChange(async (value) => {
					ctx.host.settings.llm = patchActiveLlmConfig(ctx.host.settings.llm, {
						apiKey: value.trim(),
					});
					await ctx.host.saveSettings();
					ctx.markLlmStatusDirty();
				});
		});

	if (mode === "group") {
		const modelPresets = ctx.getModelPresetResult();
		const currentModel = ctx.host.settings.llm.model.trim();
		const selected = modelPresets.models.includes(currentModel)
			? currentModel
			: modelPresets.models[0] ?? "";
		new Setting(connectionGroup)
			.setName(ctx.t("settings.llm.defaultModel.name", "默认模型"))
			.setDesc(ctx.t("settings.llm.presetModel.source", "来源: {source}", { source: modelPresets.source }))
			.addDropdown((dropdown) => {
				for (const model of modelPresets.models) {
					dropdown.addOption(model, modelPresets.modelLabels[model] ?? model);
				}
				dropdown.setValue(selected);
				dropdown.onChange(async (value) => {
					ctx.host.settings.llm = patchLlmModeConfig(ctx.host.settings.llm, "group", {
						model: value,
					});
					await ctx.host.saveSettings();
					ctx.markLlmStatusDirty();
					ctx.display();
				});
			})
			.addExtraButton((button) =>
				button
					.setIcon("refresh-cw")
					.setTooltip(ctx.t("settings.llm.presetModel.reload", "重新读取模型预置"))
					.onClick(() => {
						ctx.modelPresetResult = null;
						ctx.display();
					}),
			);
	}

	if (mode !== "group") {
		new Setting(connectionGroup)
			.setName(ctx.t("settings.llm.defaultModel.name", "默认模型"))
			.setDesc(ctx.t("settings.llm.defaultModel.desc", "可被当前 Agent 的模型覆盖。"))
			.addText((text) =>
				text
					.setPlaceholder(ctx.t("settings.llm.defaultModel.placeholder", "例如: glm-5 或 gpt-4o-mini"))
					.setValue(ctx.host.settings.llm.model)
					.onChange(async (value) => {
						ctx.host.settings.llm = patchActiveLlmConfig(ctx.host.settings.llm, {
							model: value.trim(),
						});
						await ctx.host.saveSettings();
						ctx.markLlmStatusDirty();
					}),
			);
	}

	const currentVisionModelKey = ctx.getCurrentVisionModelKey();
	const capability =
		ctx.testedVisionCapability && ctx.testedVisionModel === currentVisionModelKey
			? ctx.testedVisionCapability
			: null;
	const confidenceLabel = capability
		? capability.confidence === "high"
			? ctx.t("settings.llm.vision.confidence.high", "高")
			: capability.confidence === "medium"
				? ctx.t("settings.llm.vision.confidence.medium", "中")
				: ctx.t("settings.llm.vision.confidence.low", "低")
		: ctx.t("settings.llm.vision.confidence.unknown", "未测试");
	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.vision.name", "视觉能力"))
		.setDesc(
			ctx.t("settings.llm.vision.desc", "结果：{result} | 置信度：{confidence} | {reason}", {
				result: capability
					? ctx.formatVisionCapability(capability)
					: ctx.t("settings.llm.vision.notTested", "未测试"),
				confidence: confidenceLabel,
				reason: capability?.reason ?? ctx.t("settings.llm.vision.pending", "点击右侧“能力测试”后会更新结果。"),
			}),
		)
		.addButton((button) =>
			button
				.setButtonText(
					ctx.visionProbeStatus === "checking"
						? ctx.t("settings.llm.vision.checking", "能力测试中...")
						: ctx.t("settings.llm.vision.test", "能力测试"),
				)
				.setDisabled(ctx.visionProbeStatus === "checking")
				.onClick(async () => {
					await ctx.runVisionCapabilityTest();
				}),
		);

	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.temperature.name", "温度（选填）"))
		.setDesc(ctx.t("settings.llm.temperature.desc", "留空时不发送 temperature 参数。"))
		.addText((text) =>
			text
				.setPlaceholder(ctx.t("settings.llm.temperature.placeholder", "例如 0.7"))
				.setValue(ctx.host.settings.llm.temperature == null ? "" : String(ctx.host.settings.llm.temperature))
				.onChange(async (value) => {
					ctx.host.settings.llm = patchActiveLlmConfig(ctx.host.settings.llm, {
						temperature: ctx.parseOptionalFloat(value),
					});
					await ctx.host.saveSettings();
				}),
		);

	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.maxTokens.name", "最大 Token（选填）"))
		.setDesc(ctx.t("settings.llm.maxTokens.desc", "留空时不发送 max_tokens 参数。"))
		.addText((text) =>
			text
				.setPlaceholder(ctx.t("settings.llm.maxTokens.placeholder", "例如 4096"))
				.setValue(ctx.host.settings.llm.maxTokens == null ? "" : String(ctx.host.settings.llm.maxTokens))
				.onChange(async (value) => {
					ctx.host.settings.llm = patchActiveLlmConfig(ctx.host.settings.llm, {
						maxTokens: ctx.parseOptionalPositiveInt(value),
					});
					await ctx.host.saveSettings();
				}),
		);

	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.streaming.name", "流式输出"))
		.setDesc(ctx.t("settings.llm.streaming.desc", "开启后，聊天回复将实时逐字显示。"))
		.addToggle((toggle) =>
			toggle.setValue(ctx.host.settings.llm.enableStreaming ?? true).onChange(async (value) => {
				ctx.host.settings.llm = patchActiveLlmConfig(ctx.host.settings.llm, {
					enableStreaming: value,
				});
				await ctx.host.saveSettings();
			}),
		);

	const reasoning = ctx.host.settings.llm.reasoning;
	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.reasoning.enabled.name", "推理能力"))
		.setDesc(ctx.t("settings.llm.reasoning.enabled.desc", "为支持 thinking/reasoning 的 provider 发送对应参数；未知网关不会发送专用字段。"))
		.addToggle((toggle) =>
			toggle.setValue(reasoning.enabled).onChange(async (value) => {
				await ctx.patchActiveLlmReasoningConfig({ enabled: value });
			}),
		);

	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.reasoning.effort.name", "推理强度"))
		.setDesc(ctx.t("settings.llm.reasoning.effort.desc", "映射到 ZenMux/OpenAI Responses 等 provider 的 effort 字段。"))
		.addDropdown((dropdown) => {
			dropdown.addOption("", ctx.t("settings.llm.reasoning.effort.default", "默认"));
			dropdown.addOption("minimal", "minimal");
			dropdown.addOption("low", "low");
			dropdown.addOption("medium", "medium");
			dropdown.addOption("high", "high");
			dropdown.addOption("xhigh", "xhigh");
			dropdown.setValue(reasoning.effort).onChange(async (value) => {
				await ctx.patchActiveLlmReasoningConfig({
					effort: (["", "minimal", "low", "medium", "high", "xhigh"].includes(value) ? value : "") as LlmReasoningSettings["effort"],
				});
			});
		});

	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.reasoning.summary.name", "推理摘要"))
		.setDesc(ctx.t("settings.llm.reasoning.summary.desc", "仅使用 provider summary 或 FRIDAY 的安全摘要进入过程 UI。"))
		.addDropdown((dropdown) => {
			dropdown.addOption("auto", "auto");
			dropdown.addOption("concise", "concise");
			dropdown.addOption("detailed", "detailed");
			dropdown.addOption("none", "none");
			dropdown.setValue(reasoning.summary).onChange(async (value) => {
				await ctx.patchActiveLlmReasoningConfig({
					summary: (["auto", "concise", "detailed", "none"].includes(value) ? value : "auto") as LlmReasoningSettings["summary"],
				});
			});
		});

	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.reasoning.maxTokens.name", "推理 Token 上限"))
		.setDesc(ctx.t("settings.llm.reasoning.maxTokens.desc", "用于 Anthropic thinking budget；留空则不发送。"))
		.addText((text) =>
			text
				.setPlaceholder("2048")
				.setValue(reasoning.maxTokens == null ? "" : String(reasoning.maxTokens))
				.onChange(async (value) => {
					await ctx.patchActiveLlmReasoningConfig({
						maxTokens: ctx.parseOptionalPositiveInt(value),
					});
				}),
		);

	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.reasoning.thinking.name", "DashScope thinking"))
		.setDesc(ctx.t("settings.llm.reasoning.thinking.desc", "映射为百炼/DashScope 的 enable_thinking 与 thinking_budget。"))
		.addToggle((toggle) =>
			toggle.setValue(reasoning.enableThinking).onChange(async (value) => {
				await ctx.patchActiveLlmReasoningConfig({ enableThinking: value });
			}),
		)
		.addText((text) =>
			text
				.setPlaceholder("4096")
				.setValue(reasoning.thinkingBudget == null ? "" : String(reasoning.thinkingBudget))
				.onChange(async (value) => {
					await ctx.patchActiveLlmReasoningConfig({
						thinkingBudget: ctx.parseOptionalPositiveInt(value),
					});
				}),
		);

	new Setting(capabilityGroup)
		.setName(ctx.t("settings.llm.reasoning.debug.name", "调试时保留 raw reasoning"))
		.setDesc(ctx.t("settings.llm.reasoning.debug.desc", "仅用于隔离调试路径；普通 replay 和过程 UI 不显示 raw CoT。"))
		.addToggle((toggle) =>
			toggle.setValue(reasoning.showRawInDebug).onChange(async (value) => {
				await ctx.patchActiveLlmReasoningConfig({ showRawInDebug: value });
			}),
		);

	if (ctx.llmStatus === "failed" && ctx.llmStatusDetail) {
		const feedback = renderNativeSettingsFeedback(statusGroup, {
			title: ctx.t("settings.llm.errorDetail.title", "错误详情（点击文本可复制）"),
			message: ctx.t("settings.llm.status.failedDesc", "连接失败，请查看下方错误详情。"),
			tone: "danger",
			detail: ctx.llmStatusDetail,
		});
		const detail = feedback.querySelector(".friday-native-settings-feedback-detail");
		if (detail instanceof HTMLElement) {
			detail.classList.add("friday-llm-error-detail");
			detail.onclick = async () => {
				try {
					await navigator.clipboard.writeText(ctx.llmStatusDetail);
					new Notice(ctx.t("settings.llm.errorDetail.copySuccess", "已复制错误详情"), 2500);
				} catch {
					new Notice(ctx.t("settings.llm.errorDetail.copyFailed", "复制失败，请手动复制"), 2500);
				}
			};
		}
	}
}
