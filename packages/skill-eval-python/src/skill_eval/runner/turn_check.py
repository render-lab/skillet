from __future__ import annotations

import re

from skill_eval.providers.types import LLMProvider

TURN_CHECK_SYSTEM = """You decide whether a scripted user reply is a reasonable response to what an AI assistant just said.

Answer with a single JSON object: { "relevant": true } or { "relevant": false }.

"relevant" means the user's reply makes sense as a next message — the assistant asked a question, requested information, or is clearly waiting for the specific kind of input the user provides.

"relevant" is false when:
- The assistant already completed the task and the user reply would be a non-sequitur.
- The assistant asked about something completely different from what the user reply addresses.
- The conversation has clearly moved past the point where this reply would make sense.

Be lenient — if the reply could plausibly be relevant, say true."""


def create_turn_checker(grader_provider: LLMProvider):
    async def check_turn_relevance(agent_response: str, next_user_message: str) -> bool:
        trimmed_response = (
            f"{agent_response[:2000]}…" if len(agent_response) > 2000 else agent_response
        )
        try:
            from skill_eval.providers.types import ChatParams, Message

            result = await grader_provider.chat(
                ChatParams(
                    system=TURN_CHECK_SYSTEM,
                    messages=[
                        Message(
                            role="user",
                            content=f"## Assistant's last message\n\n{trimmed_response}\n\n"
                            f"## Scripted user reply\n\n{next_user_message}\n\n"
                            "Is this reply relevant?",
                        )
                    ],
                    temperature=0,
                )
            )
            match = re.search(r'\{[^}]*"relevant"\s*:\s*(true|false)[^}]*\}', result.content)
            if match:
                return match.group(1) == "true"
            return True
        except Exception:
            return True

    return check_turn_relevance
