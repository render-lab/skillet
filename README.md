# Skillet

<img src="assets/skillet.png" alt="Keep your agent skills fresh and tasty" width="240">

*Keep your agent skills fresh and tasty*

> [!IMPORTANT]
> **Skillet is experimental.** APIs, CLIs, and on-disk formats may change without notice.

Skillet helps teams manage AI agent skills with reproducible installs and runtime-specific context emission. It also includes an eval toolkit for skill authors and maintainers.

AI agents work best when you give them explicit instructions for specialized tasks. A **skill** is a reusable, versioned module that teaches an agent a specific behavior: how to review code, how to debug programs, how to transform data. Skillet manages skills the way `npm` manages packages: declare dependencies, lock versions, emit runtime-specific context, and benchmark how well a model follows those instructions.

## One CLI, two workflows

Skillet exposes a single CLI:

- `skillet ...` for teams consuming skills in a project
- `skillet eval ...` for authors evaluating and improving skills

Use `skillet` when you want to declare skill dependencies, install them, and emit them for an agent runtime. Use `skillet eval` when you maintain a set of local skills and want to generate eval cases, validate them, and measure how well a model follows them.

## How skills work

A skill is a directory containing a `SKILL.md` file with optional YAML frontmatter. The markdown body contains instructions that get injected into the agent's system prompt.

```markdown
---
name: Code Review
description: Reviews source files for bugs, security issues, and style violations
version: 1.2.0
---

# Code Review

You are an expert code reviewer. When given source code files, you:

1. Read the provided files carefully.
2. Identify bugs, security issues, performance problems, and style violations.
3. Write a `review.md` file with your findings, organized by severity.

Be thorough but concise. Focus on actionable findings, not nitpicks.
```

Skills live in GitHub repositories at paths like `owner/repo/skills/my-skill`. You reference them with specifiers like `owner/repo/skills/my-skill@^1.0.0`.

## Using skills in a project

Running `skillet init` creates a `skills.json` manifest in your project:

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "skills": {
    "R4ph-t/opinionated-vibe-coding/skills/ovc-audit": "2.0",
    "R4ph-t/opinionated-vibe-coding/skills/ovc-api-review": "latest"
  },
  "config": {
    "target": ["cursor", "claude-code"],
    "inject": "eager"
  }
}
```

Each entry in `skills` maps a GitHub skill path to a version range. The `config` block declares which agent runtimes to target and how context is injected.

### Core commands

```bash
skillet init
skillet add owner/repo/skills/my-skill@^1.0
skillet install
skillet emit --target cursor
skillet update
skillet status
```

### Lockfile

`skillet install` writes a `skills.lock` file that pins every skill by SHA256 content hash. This ensures reproducible installs across machines and CI environments, regardless of upstream changes.

If some skills fail to resolve during `skillet install`, Skillet preserves their previously locked entries instead of dropping them from the lockfile.

### Injection strategies

The `inject` config controls how skill context is loaded by the agent:

- **`eager`**: All skill content is included in the system prompt upfront.
- **`lazy`**: Skills are referenced by name and loaded only when the agent needs them.
- **`tiered`**: A mix of both, based on per-skill overrides.

### Emit targets

`skillet emit` generates runtime-specific context files. Supported targets:

| Target | Output |
| --- | --- |
| `cursor` | `.cursor/rules/*.mdc` |
| `cursor-legacy` | `.cursorrules` |
| `claude-code` | `CLAUDE.md` |
| `codex` | `.agents/skills/*/SKILL.md` |
| `windsurf` | `.windsurfrules` |
| `cline` | `.clinerules` |
| `generic` | `agent-context.md` |

### Typical consumer flow

```bash
skillet init
skillet add owner/repo/skills/my-skill@^1.0
skillet install
skillet emit --target cursor
```

## Evaluating a skill

`skillet eval` is for skill authors and maintainers. It measures how well an agent follows a skill's instructions. It runs an actual agent loop, with tool calls for bash and file I/O, inside a sandboxed temp directory and grades the resulting transcript with an LLM judge.

Run `skillet eval init` once per project to create `skillet.eval.yaml`. That file configures providers, grader settings, and the local skill roots that `skillet eval` uses to discover skills by default.

### Eval definitions

Each skill can include an `evals.json` file with test cases:

```json
{
  "skill_name": "code-review",
  "evals": [
    {
      "id": 1,
      "prompt": "Review the provided app.py file for bugs and security issues.",
      "files": ["fixtures/app.py"],
      "expected_output": "Identifies SQL injection, path traversal, and hardcoded secrets.",
      "assertions": [
        "The agent identifies the SQL injection vulnerability",
        "The agent writes a review.md file with organized findings"
      ]
    }
  ]
}
```

Evals support single prompts and multi-turn conversations via a `turns` array.

### Eval commands

```bash
skillet eval init
skillet eval scaffold
skillet eval validate
skillet eval run
skillet eval generate ./my-skill
skillet eval fixtures ./my-skill
skillet eval serve ./my-skill
```

`skillet eval` runs evals against Anthropic, OpenAI, and Google models. Configure API keys via environment variables such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY`. By default, eval config lives in `skillet.eval.yaml`, discovered skills come from the configured local roots, and results are written to `.skillet-evals/results/<skill-name>/`.

### Typical eval flow

```bash
skillet eval init
skillet eval scaffold
skillet eval validate
skillet eval run
skillet eval serve
```

The TypeScript implementation lives in `packages/skillet/`, with eval internals under `src/eval/`. A Python reference implementation lives in `packages/skillet-eval-python/`.

## Project structure

```text
skillet/
├── packages/
│   ├── skillet/               # Main TypeScript CLI package and eval engine
│   └── skillet-eval-python/   # Python reference eval engine
├── schemas/                   # Shared JSON schemas (evals, benchmarks, config, grading)
├── fixtures/
│   ├── skills/                # Sample skill definitions for eval testing
│   └── golden/                # Reference benchmark outputs for regression testing
├── skills.json                # This repo's own skill manifest (dogfooding)
└── skills.lock                # Pinned skill versions
```

## Try it

To try skill consumption in your own project, run:

```bash
skillet init
skillet add R4ph-t/opinionated-vibe-coding/skills/ovc-audit@2.0
skillet install
skillet emit --target cursor
```

To try the eval engine against a fixture skill in this repo, run:

```bash
skillet eval run fixtures/skills/code-review
```

## Developing this repo

Prerequisites: Node.js 20+, [pnpm](https://pnpm.io/)

```bash
# Install dependencies and build
pnpm install && pnpm build

# Run verification
pnpm test
pnpm typecheck
pnpm check
```

## License

MIT
