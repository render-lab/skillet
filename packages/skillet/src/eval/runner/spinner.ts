import pc from "picocolors";
import { truncate } from "../utils/string.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ANSI_PATTERN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matches ANSI escape sequences
	/\u001B\[[0-9;?]*[ -/]*[@-~]/g;

function elapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m${s % 60}s`;
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}

function terminalColumns(): number {
	return Math.max(process.stdout.columns ?? 80, 20);
}

function wrappedRows(text: string): number {
	const columns = terminalColumns();
	return Math.max(
		1,
		text.split("\n").reduce((sum, line) => {
			const visibleLength = stripAnsi(line).length;
			return sum + Math.max(1, Math.ceil(Math.max(visibleLength, 1) / columns));
		}, 0),
	);
}

function fitLine(text: string): string {
	const columns = terminalColumns();
	const plain = stripAnsi(text);
	if (plain.length <= columns) return text;
	return `${plain.slice(0, Math.max(columns - 1, 1))}…`;
}

interface ActiveTask {
	label: string;
	detail: string;
	startTime: number;
}

type CompletionLine = string | ((completed: number, total: number) => string);

export class Spinner {
	private frameIdx = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private isInteractive: boolean;
	private lines = 0;
	private globalStart = 0;
	private total = 0;
	private completed = 0;
	private active = new Map<string, ActiveTask>();
	private cycleIdx = 0;

	constructor() {
		this.isInteractive = process.stdout.isTTY ?? false;
	}

	private simpleMessage = "";

	start(totalOrMessage: number | string = 0) {
		if (typeof totalOrMessage === "string") {
			this.total = 1;
			this.simpleMessage = totalOrMessage;
		} else {
			this.total = totalOrMessage;
			this.simpleMessage = "";
		}
		this.completed = 0;
		this.globalStart = Date.now();

		if (!this.isInteractive) {
			if (this.simpleMessage) process.stdout.write(`  … ${this.simpleMessage}\n`);
			return;
		}

		this.render();
		this.timer = setInterval(() => {
			this.frameIdx = (this.frameIdx + 1) % FRAMES.length;
			if (this.frameIdx % 5 === 0) this.cycleIdx++;
			this.render();
		}, 80);
	}

	/** Register a task as actively running. */
	track(id: string, label: string) {
		this.active.set(id, { label, detail: "", startTime: Date.now() });
		if (!this.isInteractive) {
			process.stdout.write(`  … ${label}\n`);
		}
	}

	/** Remove a task without printing a result (e.g. before retry). */
	untrack(id: string) {
		this.active.delete(id);
	}

	/** Update the detail for a specific active task. */
	detail(id: string, text: string) {
		const task = this.active.get(id);
		if (task) task.detail = text;
	}

	/** Mark a task as completed and print its result line. */
	succeed(id: string, line: CompletionLine) {
		this.active.delete(id);
		this.completed++;
		if (this.isInteractive) this.clearLines();
		const renderedLine = typeof line === "function" ? line(this.completed, this.total) : line;
		process.stdout.write(`${renderedLine}\n`);
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		if (this.isInteractive) this.clearLines();
	}

	private render() {
		this.clearLines();

		const frame = pc.cyan(FRAMES[this.frameIdx]);
		const time = pc.yellow(elapsed(Date.now() - this.globalStart));

		if (this.simpleMessage) {
			const spinnerLine = fitLine(
				`  ${frame} ${this.simpleMessage} ${pc.dim("(")}${time}${pc.dim(")")}`,
			);
			process.stdout.write(spinnerLine);
			this.lines = wrappedRows(spinnerLine);
			return;
		}

		const running = this.active.size;
		const status = `[${this.completed}/${this.total}] ${running} running`;
		const spinnerLine = fitLine(`  ${frame} ${status} ${pc.dim("(")}${time}${pc.dim(")")}`);

		const tasks = Array.from(this.active.values());
		if (tasks.length === 0) {
			process.stdout.write(spinnerLine);
			this.lines = wrappedRows(spinnerLine);
			return;
		}

		const shown = tasks.slice(0, 3);
		const detailLines = shown.map((t) => {
			const taskTime = pc.dim(elapsed(Date.now() - t.startTime));
			const detail = t.detail ? ` ${pc.dim("·")} ${pc.dim(truncate(t.detail, 60))}` : "";
			return fitLine(`    ${pc.dim("↳")} ${truncate(t.label, 40)} ${taskTime}${detail}`);
		});

		if (tasks.length > 3) {
			detailLines.push(fitLine(`    ${pc.dim(`  +${tasks.length - 3} more`)}`));
		}

		const block = `${spinnerLine}\n${detailLines.join("\n")}`;
		process.stdout.write(block);
		this.lines = wrappedRows(block);
	}

	private clearLines() {
		if (!this.lines) {
			process.stdout.write("\r");
			return;
		}
		const moveUp = this.lines > 1 ? `\x1b[${this.lines - 1}A` : "";
		process.stdout.write(`\r${moveUp}\x1b[J`);
		this.lines = 0;
	}
}
