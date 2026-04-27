import pc from "picocolors";

export const HIGH_THRESHOLD = 0.8;
export const MID_THRESHOLD = 0.5;

export type RateLevel = "green" | "yellow" | "red";

export function rateLevel(rate: number): RateLevel {
	if (rate >= HIGH_THRESHOLD) return "green";
	if (rate >= MID_THRESHOLD) return "yellow";
	return "red";
}

const PC_COLORS = { green: pc.green, yellow: pc.yellow, red: pc.red } as const;

/** Return the picocolors formatter for a pass rate. */
export function rateColor(rate: number): (s: string) => string {
	return PC_COLORS[rateLevel(rate)];
}
