export type WorkbenchPermissionMode = "safe" | "standard" | "autonomous";

export interface WorkbenchRailItem {
	id: string;
	label: string;
	icon: string;
}

export interface WorkbenchEntrypoint {
	id: string;
	label: string;
}

export interface WorkbenchResourceTab {
	id: "library" | "fileTree" | "skills" | "artifacts";
	label: string;
	icon: string;
}

export interface WorkbenchLibraryItem {
	type: string;
	name: string;
}

export interface WorkbenchFileTreeAction {
	id: "openInCanvas" | "addToConversation";
	label: string;
}

export interface WorkbenchFileTreeItem {
	name: string;
	type: string;
	actions: WorkbenchFileTreeAction[];
}

export interface WorkbenchSmokeState {
	app: {
		name: string;
		surface: string;
		palette: Record<"graphite" | "warmBone" | "mutedTeal" | "stone" | "accent", string>;
	};
	primaryRail: WorkbenchRailItem[];
	projectMenu: {
		currentProject: {
			id: string;
			name: string;
			status: string;
		};
		homeAction: WorkbenchEntrypoint;
		conversations: WorkbenchEntrypoint[];
		bottomEntrypoints: WorkbenchEntrypoint[];
	};
	projectHome: {
		sections: WorkbenchEntrypoint[];
		remoteConfigStatus: string;
		collaborators: string[];
	};
	resourceWindow: {
		presentation: "shared-window";
		tabs: WorkbenchResourceTab[];
		library: {
			entryAction: string;
			items: WorkbenchLibraryItem[];
		};
		fileTree: {
			items: WorkbenchFileTreeItem[];
		};
		skills: {
			scopeDefault: "project";
			scopeToggle: "global";
			projectFirst: boolean;
			items: WorkbenchEntrypoint[];
		};
		artifacts: {
			conversationScoped: boolean;
			items: WorkbenchEntrypoint[];
		};
	};
	composer: {
		bottomControls: [string, string, string];
		displayText: string;
		permissionMode: WorkbenchPermissionMode;
		permissionScope: "current-conversation";
	};
	conversation: {
		withoutCanvas: {
			layout: "full-conversation-with-resource-window";
			resourceWindow: {
				presentation: "right-shared-window";
			};
		};
		withCanvas: {
			layout: "artifact-canvas-with-friday-process";
			resourceWindow: {
				presentation: "title-row-popover";
			};
		};
	};
}

export const WORKBENCH_SMOKE_STATE: WorkbenchSmokeState = {
	app: {
		name: "FRIDAY Desktop",
		surface: "Electron-first Runtime v0",
		palette: {
			graphite: "#1E1F21",
			warmBone: "#F4F1EB",
			mutedTeal: "#4A7F7B",
			stone: "#D9D5CA",
			accent: "#E07A5F",
		},
	},
	primaryRail: [
		{ id: "search", label: "搜索", icon: "⌕" },
		{ id: "projects", label: "项目", icon: "▦" },
		{ id: "team", label: "团队", icon: "◌" },
		{ id: "calendar", label: "日历", icon: "□" },
		{ id: "modules", label: "模块", icon: "◇" },
		{ id: "soul", label: "SOUL", icon: "✦" },
		{ id: "settings", label: "设置", icon: "⚙" },
	],
	projectMenu: {
		currentProject: {
			id: "friday-desktop-runtime",
			name: "Friday Desktop Runtime",
			status: "本地项目",
		},
		homeAction: { id: "projectHome", label: "返回项目主页" },
		conversations: [
			{ id: "runtime-architecture", label: "Runtime 架构对话" },
			{ id: "ui-integration-smoke", label: "UI Integration Smoke" },
			{ id: "permission-trace", label: "权限与 trace" },
		],
		bottomEntrypoints: [
			{ id: "library", label: "资料库" },
			{ id: "wiki", label: "Wiki" },
			{ id: "skills", label: "技能" },
		],
	},
	projectHome: {
		sections: [
			{ id: "composer", label: "项目输入框" },
			{ id: "projectConversations", label: "项目对话列表" },
			{ id: "librarySummary", label: "项目资料库摘要" },
			{ id: "skillSummary", label: "项目技能摘要" },
			{ id: "wikiPlaceholder", label: "Wiki 占位" },
			{ id: "calendarPlaceholder", label: "日历占位" },
			{ id: "collaborators", label: "项目协作人员" },
			{ id: "remoteConfigStatus", label: "远端配置状态" },
		],
		remoteConfigStatus: "未连接远端，使用本地 FRIDAY runtime 配置",
		collaborators: ["Keith", "FRIDAY"],
	},
	resourceWindow: {
		presentation: "shared-window",
		tabs: [
			{ id: "library", label: "资料库", icon: "▤" },
			{ id: "fileTree", label: "项目文件树", icon: "⌘" },
			{ id: "skills", label: "技能", icon: "✦" },
			{ id: "artifacts", label: "产物", icon: "▧" },
		],
		library: {
			entryAction: "进入项目资料库",
			items: [
				{ type: "Markdown", name: "desktop-runtime-decisions.md" },
				{ type: "PDF", name: "research-brief.pdf" },
				{ type: "Image", name: "workbench-flow.png" },
			],
		},
		fileTree: {
			items: [
				{
					name: "docs/plans/friday-desktop/index.html",
					type: "HTML",
					actions: [
						{ id: "openInCanvas", label: "在画布中打开" },
						{ id: "addToConversation", label: "添加到对话" },
					],
				},
				{
					name: "src/desktop/runtime/DesktopRuntimeSmoke.ts",
					type: "TypeScript",
					actions: [
						{ id: "openInCanvas", label: "在画布中打开" },
						{ id: "addToConversation", label: "添加到对话" },
					],
				},
			],
		},
		skills: {
			scopeDefault: "project",
			scopeToggle: "global",
			projectFirst: true,
			items: [
				{ id: "project-brief", label: "Project Brief" },
				{ id: "implementation-review", label: "Implementation Review" },
			],
		},
		artifacts: {
			conversationScoped: true,
			items: [
				{ id: "runtime-map", label: "Runtime 架构图" },
				{ id: "permission-table", label: "权限 trace 表" },
			],
		},
	},
	composer: {
		bottomControls: ["+", "FRIDAY Local 0.1", "标准"],
		displayText: "+ · FRIDAY Local 0.1 · 标准",
		permissionMode: "standard",
		permissionScope: "current-conversation",
	},
	conversation: {
		withoutCanvas: {
			layout: "full-conversation-with-resource-window",
			resourceWindow: {
				presentation: "right-shared-window",
			},
		},
		withCanvas: {
			layout: "artifact-canvas-with-friday-process",
			resourceWindow: {
				presentation: "title-row-popover",
			},
		},
	},
};

export function createWorkbenchSmokeState(): WorkbenchSmokeState {
	return JSON.parse(JSON.stringify(WORKBENCH_SMOKE_STATE)) as WorkbenchSmokeState;
}
