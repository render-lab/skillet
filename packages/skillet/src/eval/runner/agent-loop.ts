import type { LLMProvider, Message, ToolDefinition, ToolHandler } from "../providers/types.js";
import { withHeartbeat, withTimeout } from "../utils/async.js";
import { extractErrorMessage } from "../utils/error.js";
import { truncate } from "../utils/string.js";
import {
	compactMessages,
	debugPayloadLog,
	extractSnippet,
	summarizeToolArgs,
	totalPayloadSize,
} from "./context.js";
import type { TranscriptStep } from "./transcript.js";
import { type AgentRun, buildAgentRun } from "./transcript.js";

const CHARS_PER_TOKEN = 4;
const API_CALL_TIMEOUT_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

function formatElapsed(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${seconds % 60}s`;
}

export interface AgentLoopParams {
	provider: LLMProvider;
	system: string;
	/** Single-turn prompt (deprecated — prefer `turns`). */
	userPrompt?: string;
	/** Ordered user messages. First is sent immediately; subsequent ones are
	 *  injected each time the model yields (responds without tool calls). */
	turns?: string[];
	tools: ToolDefinition[];
	toolHandlers: Record<string, ToolHandler>;
	maxSteps?: number;
	temperature?: number;
	onActivity?: (detail: string) => void;
	heartbeatIntervalMs?: number;
	/** When provided, called before injecting the next scripted turn to verify
	 *  the reply makes sense given the agent's last response. Return false to
	 *  stop injecting turns (conversation ends early). */
	checkTurnRelevance?: (agentResponse: string, nextUserMessage: string) => Promise<boolean>;
}

export async function runAgentLoop(params: AgentLoopParams): Promise<AgentRun> {
	const {
		provider,
		system,
		tools,
		toolHandlers,
		maxSteps = 20,
		temperature,
		onActivity,
		heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
	} = params;

	const turns = params.turns ?? (params.userPrompt ? [params.userPrompt] : []);
	if (!turns.length) throw new Error("No user turns provided");

	let nextTurn = 1;
	let currentTurn = 0;
	const emit = onActivity ?? (() => {});
	const transcript: TranscriptStep[] = [];
	const messages: Message[] = [{ role: "user", content: turns[0] }];

	const debug = !!process.env.SKILL_EVAL_DEBUG;

	for (let step = 0; step < maxSteps; step++) {
		if (debug) {
			const { preSize, breakdown } = debugPayloadLog(step, messages, system);
			console.error(
				`\n[debug] step ${step + 1} | ${messages.length} msgs | ~${(preSize / 1024).toFixed(0)}KB (~${Math.round(preSize / CHARS_PER_TOKEN).toLocaleString()} tok)`,
			);
			if (breakdown.length) console.error(breakdown.join("\n"));
		}

		emit(`step ${step + 1} — calling model…`);

		const preSize = debug ? totalPayloadSize(system, messages) : 0;
		compactMessages(messages, system);

		if (debug) {
			const postSize = totalPayloadSize(system, messages);
			if (postSize < preSize) {
				console.error(
					`[debug] compacted ${(preSize / 1024).toFixed(0)}KB → ${(postSize / 1024).toFixed(0)}KB`,
				);
			}
		}

		const response = await withHeartbeat(
			withTimeout(
				provider.chat({ system, messages, tools, temperature }),
				API_CALL_TIMEOUT_MS,
				`provider.chat (step ${step + 1})`,
			),
			{
				intervalMs: heartbeatIntervalMs,
				onHeartbeat: (elapsedMs) =>
					emit(`step ${step + 1} — still waiting on model… ${formatElapsed(elapsedMs)}`),
			},
		);

		const transcriptStep: TranscriptStep = {
			step,
			turn: currentTurn,
			response: response.content,
			toolCalls: response.toolCalls,
			toolResults: [],
			usage: response.usage,
			latencyMs: response.latencyMs,
		};

		const textSnippet = extractSnippet(response.content);
		if (textSnippet) {
			emit(textSnippet);
		}

		if (response.stopReason !== "tool_use" || !response.toolCalls?.length) {
			transcript.push(transcriptStep);

			if (nextTurn < turns.length) {
				const userReply = turns[nextTurn];

				if (params.checkTurnRelevance) {
					emit("checking turn relevance…");
					const relevant = await params.checkTurnRelevance(response.content, userReply);
					if (!relevant) {
						emit("turn mismatch — agent didn't ask for expected input, ending conversation");
						transcriptStep.turnSkipped = userReply;
						return buildAgentRun(transcript);
					}
				}

				messages.push({ role: "assistant", content: response.content });
				currentTurn = nextTurn;
				nextTurn++;
				emit(`turn ${currentTurn + 1} — user: ${truncate(userReply, 60)}`);
				transcriptStep.userMessage = userReply;
				messages.push({ role: "user", content: userReply });
				continue;
			}

			emit(textSnippet ? `done — ${textSnippet}` : "done");
			return buildAgentRun(transcript);
		}

		messages.push({
			role: "assistant",
			content: response.content,
			toolCalls: response.toolCalls,
			_rawParts: response._rawParts,
		});

		for (const tc of response.toolCalls) {
			const argSnippet = summarizeToolArgs(tc.name, tc.arguments);
			emit(`${tc.name}(${argSnippet})`);

			const handler = toolHandlers[tc.name];
			let result: unknown;
			if (handler) {
				try {
					result = await handler(tc.arguments);
				} catch (err) {
					result = { error: extractErrorMessage(err) };
				}
			} else {
				result = { error: `Unknown tool: ${tc.name}` };
			}

			transcriptStep.toolResults.push({ id: tc.id, name: tc.name, result });
			messages.push({
				role: "tool_result",
				content: JSON.stringify(result),
				toolCallId: tc.id,
			});
		}

		transcript.push(transcriptStep);
	}

	return buildAgentRun(transcript);
}
