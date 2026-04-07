function padTwo(value: number): string {
	return String(value).padStart(2, "0");
}

export function formatDate(date: Date = new Date()): string {
	const year = date.getFullYear();
	const month = padTwo(date.getMonth() + 1);
	const day = padTwo(date.getDate());
	return `${year}-${month}-${day}`;
}

export function formatCompactDate(date: Date = new Date()): string {
	return formatDate(date).replace(/-/g, "");
}

export function isOverdue(dueDate: string, now: Date = new Date()): boolean {
	if (!dueDate) {
		return false;
	}

	return dueDate < formatDate(now);
}

export function isDueWithinDays(dueDate: string, days: number, now: Date = new Date()): boolean {
	if (!dueDate) {
		return false;
	}

	const target = new Date(`${dueDate}T00:00:00`);
	if (Number.isNaN(target.getTime())) {
		return false;
	}

	const startOfToday = new Date(formatDate(now) + "T00:00:00");
	const diffMs = target.getTime() - startOfToday.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	return diffDays >= 0 && diffDays <= days;
}
