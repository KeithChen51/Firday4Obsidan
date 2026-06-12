export function isAllowedWorkbenchNavigation(targetUrl: string, allowedWorkbenchUrl: string): boolean {
	return targetUrl === allowedWorkbenchUrl;
}
