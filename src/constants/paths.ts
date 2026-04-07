export interface PathPreset {
	root: string;
	projects: string;
	personal: string;
	tasks: string;
	dailyNotes: string;
	configFile: string;
	projectMetaFile: string;
	projectMembersFile: string;
	taskIdPrefix: string;
	dailyFileSuffix?: string;
}

export const PERSONAL_SLUG = "personal";
export const PREVIOUS_CHINESE_ROOT = "星期五";

export const PRIMARY_PATHS: PathPreset = {
	root: "F.R.I.D.A.Y",
	projects: "项目",
	personal: "个人",
	tasks: "任务",
	dailyNotes: "每日任务",
	configFile: "_配置.md",
	projectMetaFile: "_项目.md",
	projectMembersFile: "_成员.md",
	taskIdPrefix: "任务",
	dailyFileSuffix: "-每日任务.md",
};

export const LEGACY_PATHS: PathPreset = {
	root: "Friday",
	projects: "Projects",
	personal: "Personal",
	tasks: "Tasks",
	dailyNotes: "DailyNotes",
	configFile: "_config.md",
	projectMetaFile: "_meta.md",
	projectMembersFile: "_members.md",
	taskIdPrefix: "task",
};

export function getPrimaryDailyFileName(date: string): string {
	return `${date}${PRIMARY_PATHS.dailyFileSuffix}`;
}

export function getLegacyDailyFileName(date: string): string {
	return `${date}.md`;
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

export function getRootCandidates(primaryRoot = PRIMARY_PATHS.root): string[] {
	return unique([primaryRoot, PREVIOUS_CHINESE_ROOT, LEGACY_PATHS.root]);
}

export function getPathPresets(): PathPreset[] {
	return [PRIMARY_PATHS, LEGACY_PATHS];
}

export function getDailyFileNameCandidates(date: string): string[] {
	return unique([getPrimaryDailyFileName(date), getLegacyDailyFileName(date)]);
}

