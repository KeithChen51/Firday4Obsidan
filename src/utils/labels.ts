import { ProjectRole } from "../types/project";

const ROLE_LABELS: Record<ProjectRole, string> = {
	admin: "管理员",
	editor: "编辑者",
	viewer: "查看者",
};

type TranslateFn = (
	key: string,
	params?: Record<string, string | number | boolean | null | undefined>,
) => string;

export function getRoleLabel(role: ProjectRole | string, t?: TranslateFn): string {
	if (t) {
		if (role === "admin") return t("modal.member.role.admin");
		if (role === "editor") return t("modal.member.role.editor");
		if (role === "viewer") return t("modal.member.role.viewer");
	}
	return ROLE_LABELS[role as ProjectRole] ?? role;
}
