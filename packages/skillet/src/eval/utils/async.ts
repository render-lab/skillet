function resolveLabel(label: string | (() => string)): string {
	return typeof label === "function" ? label() : label;
}

export class TimeoutError extends Error {
	override name = "TimeoutError";
}

/** Race a promise against a timeout. Rejects with a descriptive error if the timeout fires first. */
export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string | (() => string),
	signal?: AbortSignal,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
		};
		const abort = () => {
			cleanup();
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new TimeoutError(`${resolveLabel(label)} timed out after ${ms / 1000}s`));
		}, ms);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		promise.then(
			(v) => {
				cleanup();
				resolve(v);
			},
			(e) => {
				cleanup();
				reject(e);
			},
		);
	});
}

/** Emit periodic heartbeat updates while awaiting a promise. */
export async function withHeartbeat<T>(
	promise: Promise<T>,
	opts: {
		intervalMs: number;
		onHeartbeat: (elapsedMs: number) => void;
	},
): Promise<T> {
	let timer: ReturnType<typeof setInterval> | undefined;
	const startedAt = Date.now();

	if (opts.intervalMs > 0) {
		timer = setInterval(() => {
			opts.onHeartbeat(Date.now() - startedAt);
		}, opts.intervalMs);
	}

	try {
		return await promise;
	} finally {
		if (timer) clearInterval(timer);
	}
}
