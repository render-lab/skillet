/** Truncate a string to `max` characters, appending `suffix` if truncated. */
export function truncate(str: string, max: number, suffix = "…"): string {
	if (str.length <= max) return str;
	return `${str.slice(0, max)}${suffix}`;
}
