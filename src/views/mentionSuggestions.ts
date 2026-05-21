import type { MentionFileTypeIconKind } from "./components/MentionDropdown";

interface MentionFileLike {
	extension?: string | null;
}

const CODE_MENTION_FILE_EXTENSIONS = new Set([
	"c",
	"cc",
	"cpp",
	"cs",
	"css",
	"go",
	"h",
	"htm",
	"html",
	"java",
	"js",
	"json",
	"jsx",
	"mjs",
	"py",
	"rs",
	"sh",
	"ts",
	"tsx",
	"xml",
	"yaml",
	"yml",
]);

const NOTE_MENTION_FILE_EXTENSIONS = new Set(["", "txt"]);

export function getMentionFileTypeIcon(file: MentionFileLike): MentionFileTypeIconKind {
	const extension = (file.extension ?? "").toLowerCase();
	if (extension === "md") {
		return "markdown";
	}
	if (extension === "canvas") {
		return "canvas";
	}
	if (CODE_MENTION_FILE_EXTENSIONS.has(extension)) {
		return "code";
	}
	return "note";
}

export function isMentionableFile(file: MentionFileLike): boolean {
	const extension = (file.extension ?? "").toLowerCase();
	return extension === "md"
		|| extension === "canvas"
		|| CODE_MENTION_FILE_EXTENSIONS.has(extension)
		|| NOTE_MENTION_FILE_EXTENSIONS.has(extension);
}
