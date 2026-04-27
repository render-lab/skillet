import type { LLMProvider } from "../providers/types.js";
import { withTimeout } from "../utils/async.js";
import { extractJson } from "../utils/json.js";

const TURN_CHECK_SYSTEM = `You decide whether a scripted user reply is a reasonable response to what an AI assistant just said.

Answer with a single JSON object: { "relevant": true } or { "relevant": false }.

"relevant" means the user's reply makes sense as a next message — the assistant asked a question, requested information, or is clearly waiting for the specific kind of input the user provides.

"relevant" is false when:
- The assistant already completed the task and the user reply would be a non-sequitur.
- The assistant asked about something completely different from what the user reply addresses.
- The conversation has clearly moved past the point where this reply would make sense.

Be lenient — if the reply could plausibly be relevant, say true.`;

const TURN_CHECK_TIMEOUT_MS = 30_000;
const TURN_CHECK_MAX_TOKENS = 32;

function parseRelevantFlag(content: string): boolean {
	try {
		const raw = JSON.parse(extractJson(content)) as { relevant?: unknown };
		return raw.relevant === true;
	} catch {
		return false;
	}
}

export function createTurnChecker(graderProvider: LLMProvider) {
	return async function checkTurnRelevance(
		agentResponse: string,
		nextUserMessage: string,
	): Promise<boolean> {
		const trimmedResponse =
			agentResponse.length > 2000 ? `${agentResponse.slice(0, 2000)}…` : agentResponse;

		try {
			const result = await withTimeout(
				graderProvider.chat({
					system: TURN_CHECK_SYSTEM,
					messages: [
						{
							role: "user",
							content: `## Assistant's last message\n\n${trimmedResponse}\n\n## Scripted user reply\n\n${nextUserMessage}\n\nIs this reply relevant?`,
						},
					],
					temperature: 0,
					maxTokens: TURN_CHECK_MAX_TOKENS,
				}),
				TURN_CHECK_TIMEOUT_MS,
				"turn relevance check",
			);

			return parseRelevantFlag(result.content);
		} catch {
			return false;
		}
	};
}
