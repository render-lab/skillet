/** Safely extract a human-readable error message from an unknown thrown value. */
export function extractErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	const raw = String(err);
	try {
		const parsed = JSON.parse(raw);
		if (parsed?.error?.message) return parsed.error.message;
	} catch {}
	try {
		const match = raw.match(/\{[\s\S]*\}/);
		if (match) {
			const parsed = JSON.parse(match[0]);
			if (parsed?.error?.message) return parsed.error.message;
			if (parsed?.message) return parsed.message;
		}
	} catch {}
	return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}
