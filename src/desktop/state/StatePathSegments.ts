const ENCODED_SEGMENT_PREFIX = "~";
const PLAIN_SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/u;

export function encodeStatePathSegment(value: string): string {
	const raw = String(value ?? "");
	if (isPlainSafeSegment(raw)) {
		return raw;
	}
	return `${ENCODED_SEGMENT_PREFIX}${toBase64Url(raw) || "empty"}`;
}

function isPlainSafeSegment(value: string): boolean {
	return Boolean(value) &&
		value !== "." &&
		value !== ".." &&
		!value.startsWith(ENCODED_SEGMENT_PREFIX) &&
		PLAIN_SAFE_SEGMENT_PATTERN.test(value);
}

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}
