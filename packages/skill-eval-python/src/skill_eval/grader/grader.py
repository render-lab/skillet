from __future__ import annotations

import json

from skill_eval.providers.types import ChatParams, LLMProvider, Message
from skill_eval.runner.transcript import AgentRun
from skill_eval.schemas.evals import EvalCase
from skill_eval.schemas.grading import ExpectationResult, GradingResult
from skill_eval.utils.json_utils import extract_json

from .prompts import GRADER_SYSTEM_PROMPT, build_grading_prompt


async def grade_run(
    grader_provider: LLMProvider,
    eval_case: EvalCase,
    agent_run: AgentRun,
    output_files: list[dict[str, str]],
) -> GradingResult:
    prompt = build_grading_prompt(eval_case, agent_run, output_files)

    for attempt in range(2):
        response = await grader_provider.chat(
            ChatParams(
                system=GRADER_SYSTEM_PROMPT,
                messages=[Message(role="user", content=prompt)],
                temperature=0,
            )
        )

        try:
            raw = json.loads(extract_json(response.content))
            expectations = raw.get("expectations", [])
            passed = sum(1 for e in expectations if e.get("passed") is True)
            failed = len(expectations) - passed

            return GradingResult(
                pass_rate=passed / len(expectations) if expectations else 0,
                passed=passed,
                failed=failed,
                total=len(expectations),
                expectations=[ExpectationResult.model_validate(e) for e in expectations],
                claims=raw.get("claims", []),
                eval_feedback=raw.get("eval_feedback"),
            )
        except Exception:
            if attempt == 1:
                return GradingResult(
                    pass_rate=0,
                    passed=0,
                    failed=len(eval_case.assertions),
                    total=len(eval_case.assertions),
                    expectations=[
                        ExpectationResult(
                            text=a,
                            passed=False,
                            evidence="Grader failed to produce valid JSON after 2 attempts",
                        )
                        for a in eval_case.assertions
                    ],
                    claims=[],
                    eval_feedback=f"Grader error: could not parse response. Raw output: {response.content[:500]}",
                )

    raise RuntimeError("Unreachable")
