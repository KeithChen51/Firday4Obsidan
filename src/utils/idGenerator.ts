import { formatCompactDate } from "./dateUtils";

function randomHex(length: number): string {
	const alphabet = "0123456789abcdef";
	let result = "";

	for (let i = 0; i < length; i++) {
		result += alphabet[Math.floor(Math.random() * alphabet.length)];
	}

	return result;
}

export function generateTaskId(now: Date = new Date(), prefix = "task"): string {
	return `${prefix}-${formatCompactDate(now)}-${randomHex(6)}`;
}
