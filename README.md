# Skillet

> [!IMPORTANT]
> **Skillet is experimental.** APIs, CLIs, and on-disk formats may change without notice.

Toolkit for AI agent skills: dependency management, runtime context emission, and cross-provider evaluation.

AI agents work best when given explicit instructions for specialized tasks. A **skill** is a reusable, versioned module that teaches an agent a specific behavior: how to review code, how to debug programs, how to transform data. Skillet manages skills the way `npm` manages packages: declare dependencies, lock versions, emit runtime-specific context, and benchmark how well a model actually follows those instructions.

## One CLI, two workflows

Skillet now exposes a single CLI:

- `skillet ...` for package-management workflows
- `skillet eval ...` for evaluation workflows

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

## Package management

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
skillet add owner/repo/skill@^1.0
skillet install
skillet emit --target cursor
skillet update
skillet status
```

### Lockfile

`skillet install` writes a `skills.lock` file that pins every skill by SHA256 content hash. This ensures reproducible installs across machines and CI environments, regardless of upstream changes.

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

## Evaluation

`skillet eval` measures how well an agent follows a skill's instructions. It runs an actual agent loop, with tool calls for bash and file I/O, inside a sandboxed temp directory and grades the resulting transcript with an LLM judge.

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
skillet eval generate ./my-skill
skillet eval validate ./my-skill
skillet eval run ./my-skill
skillet eval serve ./my-skill
```

`skillet eval` runs evals against Anthropic, OpenAI, and Google models. Configure API keys via environment variables such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY`. By default, eval config lives in `skillet.eval.yaml`, and results are written to `.skillet-evals/results/<skill-name>/`.

The TypeScript implementation lives in `packages/skillet/`, with eval internals under `src/eval/`. A Python reference implementation lives in `packages/skillet-eval-python/`.

## Comparison with Vercel `npx skills`

Vercel's [`npx skills`](https://github.com/vercel-labs/skills) is a popular tool in the same space. Both projects solve the same core problem: managing reusable context for AI agents. They make different trade-offs:

| Aspect | `skillet` | Vercel `npx skills` |
| --- | --- | --- |
| Dependency model | Declarative manifest with version ranges | Imperative add/remove |
| Lockfile | SHA256 content-hash pinning | In progress (global/project lock split) |
| Injection control | Eager, lazy, and tiered strategies | N/A |
| Evaluation | Built-in cross-provider benchmarking | N/A |
| Discovery | N/A | Public catalog at skills.sh |
| Agent support | 7 targets | 40+ agents |
| Onboarding | Requires `init` and a manifest | Zero-config `npx` |

Skillet prioritizes reproducibility and eval-gated quality. Vercel's tool prioritizes breadth and zero-friction onboarding. They're complementary rather than competing.

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

## Quick start

Prerequisites: Node.js 20+, [pnpm](https://pnpm.io/)

```bash
# Install dependencies and build
pnpm install && pnpm build

# Run all tests
pnpm test
```

Try the eval engine on a fixture skill:

```bash
skillet eval run fixtures/skills/code-review
```

Or manage skills in your own project:

```bash
skillet init
skillet add R4ph-t/opinionated-vibe-coding/skills/ovc-audit@2.0
skillet install
skillet emit --target cursor
```

## License

MIT
