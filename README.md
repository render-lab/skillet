# Skillet

Toolkit for AI agent skills: package management and evaluation.

AI agents work best when given explicit instructions for specialized tasks. A **skill** is a reusable, versioned module that teaches an agent a specific behavior: how to review code, how to debug programs, how to transform data. Skillet manages skills the way `npm` manages packages: declare dependencies, lock versions, and emit context for the agent runtimes you use.

The repo contains two complementary tools:

- **`agent-skills`** manages skill dependencies, lockfiles, and multi-runtime context emission.
- **`skill-eval`** evaluates skills across LLM providers with sandboxed agent loops and LLM-judge grading.

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

## The `agent-skills` CLI

### Manifest

Running `agent-skills init` creates a `skills.json` manifest in your project:

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

### Commands

```bash
agent-skills init                # Create a skills.json manifest
agent-skills add owner/repo/skill@^1.0   # Add a skill dependency
agent-skills install             # Resolve all dependencies and write the lockfile
agent-skills emit                # Emit context files for your configured runtimes
agent-skills update              # Update skills to the latest matching versions
agent-skills status              # Show installed skills and their state
```

### Lockfile

`agent-skills install` writes a `skills.lock` file that pins every skill by SHA256 content hash. This ensures reproducible installs across machines and CI environments, regardless of upstream changes.

### Injection strategies

The `inject` config controls how skill context is loaded by the agent:

- **`eager`**: All skill content is included in the system prompt upfront.
- **`lazy`**: Skills are referenced by name and loaded only when the agent needs them.
- **`tiered`**: A mix of both, based on per-skill overrides.

### Emit targets

`agent-skills emit` generates runtime-specific context files. Supported targets:

| Target | Output |
| --- | --- |
| `cursor` | `.cursor/rules/*.mdc` |
| `cursor-legacy` | `.cursorrules` |
| `claude-code` | `CLAUDE.md` |
| `codex` | `.agents/skills/*/SKILL.md` |
| `windsurf` | `.windsurfrules` |
| `cline` | `.clinerules` |
| `generic` | `agent-context.md` |

See [`packages/agent-skills/README.md`](packages/agent-skills/README.md) for full documentation.

## The `skill-eval` CLI

`skill-eval` measures how well an agent follows a skill's instructions. It runs an actual agent loop (with tool calls for bash, file read, and file write) inside a sandboxed temp directory, then grades the output with an LLM judge.

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

### Commands

```bash
skill-eval init                  # Scaffold a skill-eval.yaml config
skill-eval generate ./my-skill   # Generate evals.json from a SKILL.md
skill-eval validate ./my-skill   # Check skill dir, evals, and API keys
skill-eval run ./my-skill        # Run evals across providers and grade results
skill-eval serve ./my-skill      # Launch a dashboard to view results
```

### Provider support

`skill-eval` runs evals against Anthropic, OpenAI, and Google models. Configure API keys via environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`). Results are written to `.skill-evals/results/<skill-name>/` as timestamped `benchmark.json` files.

A Python implementation with the same CLI and behavior is available in [`packages/skill-eval-python`](packages/skill-eval-python/).

See [`packages/skill-eval/README.md`](packages/skill-eval/README.md) for full documentation.

## Comparison with Vercel `npx skills`

Vercel's [`npx skills`](https://github.com/vercel-labs/skills) is a popular tool in the same space. Both projects solve the same core problem: managing reusable context for AI agents. They make different trade-offs:

| Aspect | `agent-skills` | Vercel `npx skills` |
| --- | --- | --- |
| Dependency model | Declarative manifest with version ranges | Imperative add/remove |
| Lockfile | SHA256 content-hash pinning | In progress (global/project lock split) |
| Injection control | Eager, lazy, and tiered strategies | N/A |
| Evaluation | Built-in cross-provider benchmarking | N/A |
| Discovery | N/A | Public catalog at skills.sh |
| Agent support | 7 targets | 40+ agents |
| Onboarding | Requires `init` and a manifest | Zero-config `npx` |

`agent-skills` prioritizes reproducibility and eval-gated quality. Vercel's tool prioritizes breadth and zero-friction onboarding. They're complementary rather than competing.

## Project structure

```
skillet/
├── packages/
│   ├── agent-skills/          # CLI for dependency management and context emission
│   ├── skill-eval/            # TypeScript eval engine (Anthropic, OpenAI, Google)
│   └── skill-eval-python/     # Python eval engine (same CLI and behavior)
├── schemas/                   # Shared JSON schemas (evals, benchmarks, config, grading)
├── fixtures/
│   ├── skills/                # Sample skill definitions for testing the eval engine
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
# Run evals for the code-review skill
skill-eval run fixtures/skills/code-review
```

Or manage skills in your own project:

```bash
# Initialize a manifest, add a skill, install, and emit
agent-skills init
agent-skills add R4ph-t/opinionated-vibe-coding/skills/ovc-audit@2.0
agent-skills install
agent-skills emit --target cursor
```

## License

MIT
