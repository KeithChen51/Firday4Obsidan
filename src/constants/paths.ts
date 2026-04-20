export interface PathPreset {
	root: string;
	projects: string;
	personal: string;
	studio: string;
	studioNotes: string;
	studioReadmeFile: string;
	studioStartHereFile: string;
	studioLogFile: string;
	configFile: string;
	projectMetaFile: string;
	projectMembersFile: string;
}

export const PERSONAL_SLUG = "personal";
export const PREVIOUS_CHINESE_ROOT = "星期五";

export const PRIMARY_PATHS: PathPreset = {
	root: "F.R.I.D.A.Y",
	projects: "项目",
	personal: "个人",
	studio: "来自制作组",
	studioNotes: "幕后笔记 · Behind the Build",
	studioReadmeFile: "README.md",
	studioStartHereFile: "从这里开始 · Start Here/从这里开始.md",
	studioLogFile: "迭代手记 · Changelog.md",
	configFile: "_配置.md",
	projectMetaFile: "_项目.md",
	projectMembersFile: "_成员.md",
};

export const LEGACY_PATHS: PathPreset = {
	root: "Friday",
	projects: "Projects",
	personal: "Personal",
	studio: "From the Studio",
	studioNotes: "Behind the Build",
	studioReadmeFile: "README.md",
	studioStartHereFile: "Start Here.md",
	studioLogFile: "Changelog.md",
	configFile: "_config.md",
	projectMetaFile: "_meta.md",
	projectMembersFile: "_members.md",
};

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

export function getRootCandidates(primaryRoot = PRIMARY_PATHS.root): string[] {
	return unique([primaryRoot, PREVIOUS_CHINESE_ROOT, LEGACY_PATHS.root]);
}

export function getPathPresets(): PathPreset[] {
	return [PRIMARY_PATHS, LEGACY_PATHS];
}
