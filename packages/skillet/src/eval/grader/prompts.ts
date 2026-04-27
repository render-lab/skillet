import type { AgentRun } from "../runner/transcript.js";
import type { TranscriptStep } from "../runner/transcript.js";
import type { EvalCase } from "../schemas/evals.js";
import { getTurns } from "../schemas/evals.js";

const MAX_GRADING_CHARS = 300_000;
const CAP_USER_MESSAGE = 1_000;
const CAP_ASSISTANT_RESPONSE = 3_000;
const CAP_OUTPUT_FILE = 5_000;
const CAP_TOOL_VALUE = 2_000;
const CAP_SKIPPED_TURN = 200;

function cap(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n\n... [truncated ${text.length - limit} chars] ...`;
}

function truncVal(val: unknown, max = CAP_TOOL_VALUE): string {
	const s = typeof val === "string" ? val : JSON.stringify(val);
	return s.length > max ? `${s.slice(0, max)}… [${s.length - max} chars truncated]` : s;
}

function formatTranscriptStep(
	step: TranscriptStep,
	lastTurn: number,
): { text: string; newLastTurn: number } {
	const parts: string[] = [];
	let currentLastTurn = lastTurn;

	if (step.turn !== undefined && step.turn !== currentLastTurn) {
		currentLastTurn = step.turn;
		if (step.turn > 0) {
			parts.push(`\n=== User Turn ${step.turn + 1} ===`);
			if (step.userMessage) {
				parts.push(`User: ${cap(step.userMessage, CAP_USER_MESSAGE)}`);
			}
			parts.push("");
		}
	}

	parts.push(`--- Step ${step.step} ---`);
	if (step.response) parts.push(`Assistant: ${cap(step.response, CAP_ASSISTANT_RESPONSE)}`);
	for (const tc of step.toolCalls ?? []) {
		parts.push(`Tool call: ${tc.name}(${truncVal(tc.arguments)})`);
	}
	for (const tr of step.toolResults) {
		parts.push(`Tool result [${tr.name}]: ${truncVal(tr.result)}`);
	}
	if (step.turnSkipped) {
		parts.push(
			`\n⚠ TURN SKIPPED: The next scripted user message ("${cap(step.turnSkipped, CAP_SKIPPED_TURN)}") was not injected because it did not match the agent's response. The conversation ended here.`,
		);
	}

	return { text: parts.join("\n"), newLastTurn: currentLastTurn };
}

function formatTranscript(agentRun: AgentRun): string {
	let lastTurn = -1;
	return agentRun.transcript
		.map((step) => {
			const { text, newLastTurn } = formatTranscriptStep(step, lastTurn);
			lastTurn = newLastTurn;
			return text;
		})
		.join("\n\n");
}

function formatOutputFiles(outputFiles: Array<{ path: string; content: string }>): string {
	if (outputFiles.length === 0) return "(no output files)";
	return outputFiles
		.map((f) => `--- ${f.path} ---\n${cap(f.content, CAP_OUTPUT_FILE)}`)
		.join("\n\n");
}

function formatTurnsSection(turns: string[], isMultiTurn: boolean): string {
	if (isMultiTurn) {
		return `**Conversation turns:**\n${turns.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nThis is a multi-turn conversation. The user sends the first message, the agent responds (possibly with tool calls), then the next user message is injected, and so on. Evaluate assertions across the full conversation.`;
	}
	return `**Prompt given to the agent:**\n${turns[0]}`;
}

export function buildGradingPrompt(
	evalCase: EvalCase,
	agentRun: AgentRun,
	outputFiles: Array<{ path: string; content: string }>,
): string {
	const turns = getTurns(evalCase);
	const isMultiTurn = turns.length > 1;

	const turnsSection = formatTurnsSection(turns, isMultiTurn);
	const transcriptText = formatTranscript(agentRun);
	const filesText = formatOutputFiles(outputFiles);
	const assertionsList = evalCase.assertions.map((a, i) => `${i + 1}. ${a}`).join("\n");

	const prompt = `You are an evaluator grading the output of an AI agent that was given a task.

## Original Task

${turnsSection}

**Expected behavior:**
${evalCase.expected_output}

## Assertions to Evaluate

Evaluate each of the following assertions. For each one, determine whether the agent's behavior satisfies it, and provide specific evidence from the transcript.

${assertionsList}

## Agent Transcript

${transcriptText}

## Output Files Produced

${filesText}

## Instructions

Return a JSON object with this exact structure (no other text, just JSON):

{
  "expectations": [
    {
      "text": "<the assertion text>",
      "passed": true/false,
      "evidence": "<specific evidence from the transcript>"
    }
  ],
  "claims": [],
  "eval_feedback": "<optional overall feedback or null>"
}

There must be exactly one entry in "expectations" for each assertion listed above, in the same order. Be strict: only mark an assertion as passed if the transcript clearly demonstrates it.`;

	return cap(prompt, MAX_GRADING_CHARS);
}

export const GRADER_SYSTEM_PROMPT =
	"You are a precise evaluator. You grade AI agent outputs against specific assertions. " +
	"Return only valid JSON matching the requested schema. Be strict but fair.";
