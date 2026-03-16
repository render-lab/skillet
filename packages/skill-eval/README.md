# skill-eval

Provider-agnostic skill evaluation tool. Run evals across Anthropic, OpenAI, and Google, grade outputs with an LLM judge, and get a comparison report.

## Why skill-eval

Eval tools exist. Braintrust, Promptfoo, LangSmith, and others are mature platforms. But they solve a different problem: evaluating prompts, RAG pipelines, and chat completions. They send a prompt, get a response, check it.

Skill evaluation is different. A skill gives an LLM a set of instructions and tools, then asks it to complete a multi-step task autonomously — read files, run commands, write code, iterate. The output isn't a text response; it's a transcript of decisions, tool calls, and artifacts. Grading means checking whether the agent *did the right things*, not whether it *said the right things*.

None of the existing tools handle this well:

- **Promptfoo** and **Braintrust** evaluate prompt-response pairs. They don't run an agent loop with tool calling, sandboxed bash, or file I/O. You'd have to build all of that yourself and feed the results back in.
- **LangSmith** is designed for LangChain traces and RAG. If you're not in that ecosystem, it's overhead without payoff.
- **Inspect AI** (UK AISI) is the closest — it supports tool-calling agents with sandboxing and multiple providers. But it's a framework: you write Python evaluation tasks, define solvers, configure scoring. skill-eval is an opinionated tool for one job: point it at a skill directory, define assertions in JSON, and compare models. No code to write.
- **Claude Code `claude -p`** can run skill evals natively, but it's Anthropic-only. No way to answer "does this skill work on GPT-5.2?" or "is Gemini cheaper for this use case?"

skill-eval fills this gap:

- **Runs an actual agent loop** with tool calling (bash, file read/write) in a sandboxed temp directory.
- **Works with any provider** — same skill, same evals, different models. Compare results side by side.
- **Uses your existing eval format** — reads `evals.json` with assertions, outputs `benchmark.json`. No migration.
- **Grades with an LLM judge** that checks each assertion independently against the full transcript.
- **Zero config** — set an API key, point it at a skill directory, and run.

## Quick start

```bash
# Set at least one API key
export ANTHROPIC_API_KEY=sk-...

# Run evals (zero-config — auto-detects providers from env vars)
skill-eval run ./my-skill
```

The tool finds `SKILL.md` and `evals.json` in the skill directory, runs every eval through each detected provider, grades the results, and writes `benchmark.json` + `report.html` to `.skill-evals/results/<skill-name>/` at the project root.

## Install

**TypeScript (Node.js 20+):**

```bash
cd ts && npm install -g .
# or
cd ts && pnpm add -g .
```

**Python (3.10+):**

```bash
cd python && pip install -e .
```

Both implementations provide the same `skill-eval` CLI with identical commands and config format.

## Commands

Every command takes the skill directory as a positional argument:

```bash
skill-eval <command> <skill-path> [options]
```

### `run`

Run evals across configured providers.

```bash
# All evals, all detected providers
skill-eval run ./my-skill

# Specific evals on specific providers
skill-eval run ./my-skill --eval-id 1,2 --providers anthropic,openai

# Custom models
skill-eval run ./my-skill \
  --model claude-sonnet-4-6 \
  --model gpt-5.2 \
  --model gemini-3.1-pro-preview

# Multiple runs for variance analysis
skill-eval run ./my-skill --runs 3

# JSON output only
skill-eval run ./my-skill --output json
```

| Option | Description | Default |
| --- | --- | --- |
| `--evals <path>` | Path to evals.json | `<skill>/evals.json` |
| `--config <path>` | Path to skill-eval.yaml | `./skill-eval.yaml` |
| `--eval-id <ids>` | Comma-separated eval IDs to run | All |
| `--providers <names>` | Comma-separated provider names | All detected |
| `--model <spec>` | `provider:model` pair (repeatable) | Default per provider |
| `--output <format>` | Output format | `json` |
| `--runs <n>` | Runs per provider per eval | `1` |
| `--timeout <s>` | Timeout per eval in seconds | `300` |
| `--concurrency <n>` | Max concurrent runs | `3` |

If an eval fails (API timeout, rate limit, crash), the run is recorded with a 0% pass rate and an error message. Other evals continue normally. All results (successes and failures) appear in the final report.

### `generate`

Auto-generate a starter `evals.json` from `SKILL.md` using an LLM.

```bash
skill-eval generate ./my-skill
skill-eval generate ./my-skill --count 5
```

| Option | Description | Default |
| --- | --- | --- |
| `--count <n>` | Number of evals to generate | `3` |
| `--config <path>` | Path to skill-eval.yaml | `./skill-eval.yaml` |

### `validate`

Pre-flight checks before running evals.

```bash
skill-eval validate ./my-skill
```

Checks:

- Skill directory exists with `SKILL.md`
- `evals.json` exists and is valid
- API keys are set for detected providers

| Option | Description | Default |
| --- | --- | --- |
| `--evals <path>` | Path to evals.json | `<skill>/evals.json` |
| `--config <path>` | Path to skill-eval.yaml | `./skill-eval.yaml` |

### `serve`

Start a local dashboard to browse historical eval results.

```bash
skill-eval serve ./my-skill
skill-eval serve ./my-skill --port 8080
```

| Option | Description | Default |
| --- | --- | --- |
| `--evals <path>` | Path to evals.json | `<skill>/evals.json` |
| `--port <n>` | Port to serve on | `3000` |

### `init`

Scaffold a `skill-eval.yaml` config file interactively. Detects API keys already in your environment.

```bash
skill-eval init
```

## Configuration

### Zero-config mode

If you have API keys in your environment, no config file is needed:

| Variable | Provider | Default model |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic | `claude-sonnet-4-6` |
| `OPENAI_API_KEY` | OpenAI | `gpt-5.2` |
| `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Google | `gemini-3.1-pro-preview` |

Set multiple keys to compare providers in a single run.

### `.env` file

Instead of exporting API keys in your shell, create a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
```

skill-eval loads `.env` automatically from:

1. The current working directory
2. The skill directory (when provided)

Shell environment variables take precedence over `.env` values. The `.env` file supports `KEY=VALUE` lines, comments (`#`), and quoted values.

### Config file

For custom models, grader settings, or advanced options, create `skill-eval.yaml`:

```yaml
providers:
  - name: anthropic
    model: claude-sonnet-4-6
    apiKey: ${ANTHROPIC_API_KEY}
  - name: openai
    model: gpt-5.2
    apiKey: ${OPENAI_API_KEY}
  - name: google
    model: gemini-3.1-pro-preview
    apiKey: ${GOOGLE_API_KEY}

grader:
  provider: anthropic
  model: claude-sonnet-4-6

settings:
  maxSteps: 20
  timeout: 300
  runsPerProvider: 1
  temperature: 0
```

Environment variables in `${VAR}` syntax are interpolated at load time.

| Setting | Description | Default |
| --- | --- | --- |
| `maxSteps` | Maximum agent loop iterations per eval | `20` |
| `timeout` | Seconds before a bash command is killed | `300` |
| `runsPerProvider` | How many times to repeat each eval per provider | `1` |
| `temperature` | LLM temperature for agent calls | `0` |

## Project layout

Evals stay alongside each skill. Results are stored centrally in `.skill-evals/` at the project root (detected by walking up to the nearest `.git`, `package.json`, `pyproject.toml`, or `Cargo.toml`):

```
my-project/
├── .skill-evals/                # Central results directory (git-ignored)
│   └── results/
│       └── render-workflows/    # One folder per skill
│           ├── 2026-03-01T19-00-00.json
│           ├── 2026-03-01T19-05-00.json
│           ├── latest.json      # Copy of most recent run
│           └── index.html       # Dashboard (reads JSON files client-side)
├── skills/
│   └── render-workflows/
│       ├── SKILL.md             # Skill instructions (system prompt)
│       ├── evals.json           # Eval definitions
│       └── references/          # Optional files for the generate command
│           └── ...
└── .gitignore                   # Add .skill-evals/
```

Add `.skill-evals/` to your `.gitignore` — results contain API responses and transcripts that shouldn't be committed.

## Writing evals

### `evals.json` format

```json
{
  "skill_name": "my-skill",
  "models": [
    "claude-sonnet-4-6",
    "gpt-5.2",
    "gemini-3.1-pro-preview"
  ],
  "evals": [
    {
      "id": 1,
      "prompt": "The user prompt to send to the agent",
      "expected_output": "Description of expected behavior for the grader",
      "files": [],
      "assertions": [
        "The agent should do X",
        "The output should contain Y"
      ]
    }
  ]
}
```

#### Top-level fields

| Field | Type | Description |
| --- | --- | --- |
| `skill_name` | string | Name of the skill |
| `models` | string[] | Optional. Models to run evals against. Provider is inferred from the model name (`claude-*` = Anthropic, `gpt-*`/`o*` = OpenAI, `gemini-*` = Google). CLI `--model` flags override this. If omitted, all providers with API keys set are used with default models. |
| `evals` | EvalCase[] | Array of eval definitions (at least one) |

#### Eval fields

| Field | Type | Description |
| --- | --- | --- |
| `id` | number | Unique identifier for the eval |
| `prompt` | string | Single-turn user message. Use for straightforward tasks. Mutually exclusive with `turns`. |
| `turns` | string[] | Ordered user messages for multi-turn conversations. The first message starts the conversation; subsequent messages are injected each time the agent yields (responds without tool calls). Mutually exclusive with `prompt`. |
| `expected_output` | string | Free-text description of what a correct response looks like. Provided to the grader as context. |
| `files` | string[] | Paths to files (relative to the skill directory) to copy into the sandbox before the agent runs. Use this to set up an existing codebase for the agent to work with. |
| `assertions` | string[] | Individual claims the grader checks against the agent's output. Each assertion is graded independently as pass or fail. |

### The `files` field

Use `files` to pre-seed the agent's sandbox with an existing project or fixture files. For example, if your eval tests refactoring an existing app:

```json
{
  "id": 2,
  "prompt": "Refactor this Flask app to use blueprints",
  "expected_output": "Code restructured into blueprints with routes separated",
  "files": ["fixtures/app.py", "fixtures/requirements.txt"],
  "assertions": [
    "Creates a blueprints directory",
    "Moves routes into separate blueprint modules",
    "Main app.py registers the blueprints"
  ]
}
```

The files at `my-skill/fixtures/app.py` and `my-skill/fixtures/requirements.txt` are copied into the sandbox before the agent starts. If `files` is empty, the agent starts with a blank directory.

### Multi-turn evals

Use `turns` instead of `prompt` when the skill involves back-and-forth conversation — clarification questions, follow-ups, or iterative refinement.

```json
{
  "id": 3,
  "turns": [
    "Set up Render Workflows in my project",
    "Python",
    "Yes, include a retry configuration"
  ],
  "expected_output": "Agent asks for language, user says Python, agent asks about retry, user confirms, agent scaffolds the project",
  "assertions": [
    "Agent asks which language to use before proceeding",
    "After the user says Python, the agent creates a workflows/ directory",
    "The generated main.py includes retry configuration",
    "Agent does not modify the root package.json"
  ]
}
```

How it works:

1. The first turn (`"Set up Render Workflows in my project"`) is sent as the initial user message.
2. The agent processes it — possibly making tool calls — then yields with a text response (e.g., asking "Which language?").
3. The next turn (`"Python"`) is injected as a new user message, and the agent continues.
4. This repeats until all turns are consumed or `maxSteps` is reached.

The grading transcript includes `=== User Turn N ===` markers so the LLM judge can evaluate assertions that span multiple turns.

Guardrails:

- **Turn relevance check**: Before injecting the next scripted message, the grader LLM checks whether the agent's response is actually asking for the kind of input the turn provides. If the agent said "All done!" but the next turn is "Python," the turn is skipped and the conversation ends early. This prevents nonsensical transcripts when the agent doesn't follow the expected flow.
- `maxSteps` is shared across all turns, preventing runaway loops.
- If the agent never yields (keeps using tools), follow-up turns are never injected. This is a valid failure — assertions about later turns will fail.
- If the agent yields more times than there are remaining turns, the conversation ends normally after the last turn.
- Skipped turns are marked in the transcript so the grader can reference them when evaluating assertions.

### Writing good assertions

Assertions are graded by an LLM judge, so write them as clear, verifiable statements:

- **Do:** "Uses the `@app.task` decorator with a retry parameter"
- **Do:** "Creates a file named `schema.prisma` with a User model"
- **Don't:** "Code is good" (too vague for reliable grading)
- **Don't:** "Follows best practices" (subjective, inconsistent results)

Each assertion gets an independent pass/fail result with evidence from the grader explaining its reasoning.

## Output

Results are saved to `.skill-evals/results/<skill-name>/` at the project root. Each run produces a timestamped JSON file. `latest.json` is always a copy of the most recent run. A single `index.html` dashboard is written alongside the JSON files — it loads them client-side, so there's no per-run HTML duplication.

### `benchmark.json`

Structured results with per-run data and provider summary statistics:

```json
{
  "metadata": {
    "skill_name": "my-skill",
    "timestamp": "2026-03-01T19:00:00Z",
    "providers": [
      { "name": "anthropic", "model": "claude-sonnet-4-6" }
    ],
    "grader": { "name": "anthropic", "model": "claude-sonnet-4-6" }
  },
  "runs": [
    {
      "eval_id": 1,
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "run_number": 1,
      "result": {
        "pass_rate": 0.85,
        "passed": 6,
        "failed": 1,
        "total": 7,
        "time_seconds": 42.5,
        "total_tokens": 3800,
        "cost_usd": 0.032
      },
      "expectations": [
        { "text": "Uses the decorator", "passed": true, "evidence": "Found @app.task on line 12" }
      ],
      "error": null
    }
  ],
  "provider_summary": {
    "claude-sonnet-4-6": {
      "pass_rate": { "mean": 0.85, "stddev": 0.05 },
      "time_seconds": { "mean": 45.0, "stddev": 12.0 },
      "cost_usd": { "mean": 0.032, "stddev": 0.004 }
    }
  }
}
```

Failed runs have `"error": "message"` with a 0% pass rate and all assertions marked as failed.

### Dashboard (`index.html`)

A single-page dashboard served by `skill-eval serve` that reads from the JSON files:

- Run history with pass rate trend chart
- Click any run to see provider comparison, bar chart, and per-eval details
- Pass/fail indicators with grading evidence for each assertion
- Error details for failed runs

The dashboard requires `skill-eval serve` to work (it fetches JSON via `/api/runs`). It's not a standalone file you can open directly.

## How it works

1. Reads `SKILL.md` as the system prompt.
2. For each eval x provider x run:
   - Creates a sandboxed temp directory.
   - Copies any `files` into the sandbox.
   - Runs the agent loop: sends the first user turn, then tool calls until the agent yields or `maxSteps` is hit. For multi-turn evals, each yield injects the next user message and the loop continues.
   - The agent has access to `bash`, `read_file`, `write_file`, and `list_directory`.
   - Collects the transcript and output files.
3. Grades each run with an LLM judge against the eval's assertions.
4. Aggregates results and writes output files to `.skill-evals/results/<skill-name>/`.

## License

MIT
