# Skillet

[![GitHub release](https://img.shields.io/github/v/release/render-lab/skillet)](https://github.com/render-lab/skillet/releases)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Experimental](https://img.shields.io/badge/status-experimental-orange)

<img src="assets/skillet.png" alt="Keep your agent skills fresh and tasty" width="240">

*Keep your agent skills fresh and tasty*

> [!IMPORTANT]
> **Skillet is experimental.** APIs, CLIs, and on-disk formats may change without notice.

Skillet helps teams manage AI agent skills with reproducible installs and runtime-specific context emission. It also includes an eval toolkit for skill authors and maintainers.

AI agents work best when you give them explicit instructions for specialized tasks. A **skill** is a reusable, versioned module that teaches an agent a specific behavior: how to review code, how to debug programs, how to transform data. Skillet manages skills the way `npm` manages packages: declare dependencies, lock versions, emit runtime-specific context, and benchmark how well a model follows those instructions.

## Install the CLI

Install the current release from GitHub:

```bash
pnpm add -D "https://github.com/render-lab/skillet/releases/download/v0.1.4/render-lab-skillet-0.1.4.tgz"
```

To install a different release, replace both instances of `0.1.4` in the URL with the version you want.

The packaged CLI installs the `skillet` binary, so you still run commands like `skillet init` and `skillet eval serve`.

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

### Integration mocks

Use integration mocks when a skill expects access to an external API or MCP server, but you want evals to stay local, deterministic, and safe. Instead of calling a real account, Skillet builds a per-run mock environment from source definitions you provide during `skillet eval init`.

This feature is opt-in. If `skillet.eval.yaml` has no `integrations` block, or if an eval case does not reference an integration, eval behavior is unchanged.

#### Configure sources during init

Run `skillet eval init` and answer yes when prompted to configure integration mocks. For each integration, provide:

- an integration name, such as `render`, `stripe`, or `github`
- an OpenAPI spec path or URL
- an MCP server repo or local path
- which surfaces to expose: `http`, `tools`, or both

Skillet writes reusable integration sources to `skillet.eval.yaml`:

```yaml
providers:
  - name: openai
    model: gpt-5.4
    apiKey: ${OPENAI_API_KEY}

integrations:
  render:
    openapi: ./fixtures/render-openapi.json
    mcpServer: ./fixtures/render-mcp-server
    expose: [http, tools]
```

Keep reusable source information in `skillet.eval.yaml`. Put per-test data in `evals.json`.

Skillet also materializes each configured integration under `.skillet-evals/integrations/<name>/manifest.json`. The manifest records the imported OpenAPI route keys, MCP-style tool keys, source paths, and import errors. `skillet eval init`, `skillet eval generate`, and `skillet eval run` refresh this manifest from the configured sources.

`skillet eval generate` also reads configured integration sources. When integrations are present, the generator prompt includes imported OpenAPI route keys and MCP-style tool keys so generated evals can include matching scenario `state` and `overrides`.

#### Add scenario data to evals

Each eval case can opt in to one or more configured integrations. The `state` object describes the account, project, database, or API state for that scenario. The `overrides` object maps imported routes or tools to mock responses.

```json
{
  "id": 1,
  "prompt": "Debug why my service is unhealthy.",
  "expected_output": "Find the unhealthy service and explain the failed deploy.",
  "integrations": {
    "render": {
      "state": {
        "services": [{ "id": "svc_123", "name": "api", "status": "unhealthy" }],
        "deploys": [{ "id": "dep_123", "serviceId": "svc_123", "status": "failed" }]
      },
      "overrides": {
        "GET /services/{id}": { "responseFromState": "services[id]" },
        "tool:list_services": { "responseFromState": "services" }
      }
    }
  },
  "assertions": [
    "Identifies svc_123 as unhealthy",
    "Connects the unhealthy service to the failed deploy"
  ]
}
```

During the eval run, Skillet starts an isolated mock environment for that one agent run. The agent receives the local mock HTTP base URL, imported MCP-style tools, and the normal sandbox tools (`bash`, `read_file`, `write_file`, and `list_directory`).

The integration state snapshot is included in grading context, so assertions can reference the final mock state.

#### OpenAPI import

When you expose `http`, Skillet reads the configured OpenAPI spec and creates local routes for the operations under `paths`.

Supported behavior:

- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` operations are imported.
- Path parameters such as `/services/{id}` are matched against incoming requests.
- If an operation includes an `application/json` example response, Skillet can use it as the default response.
- Eval-level overrides can replace the default response for a specific operation.
- For `GET` routes, Skillet can resolve common collection state automatically. For example, `/services/{id}` can resolve an item from `state.services`.

Route override keys use this format:

```text
METHOD /path/{param}
```

For example:

```json
{
  "overrides": {
    "GET /services/{id}": { "responseFromState": "services[id]" },
    "GET /deploys": { "responseFromState": "deploys" }
  }
}
```

#### MCP-style tool import

When you expose `tools`, Skillet imports tool definitions from the configured MCP server source. The source can be a GitHub repo URL, a local repo/path with a README tool list, or a directory of tool descriptor JSON files. README import supports tool lists in the common format `- **tool_name** - Description` followed by parameter bullets.

Example descriptor JSON:

```json
{
  "name": "list_services",
  "description": "List services in the account",
  "arguments": {
    "type": "object",
    "properties": {
      "includePreviews": {
        "type": "boolean",
        "description": "Whether to include preview services"
      }
    }
  }
}
```

Tool override keys use this format:

```text
tool:<tool_name>
```

For example:

```json
{
  "overrides": {
    "tool:list_services": { "responseFromState": "services" },
    "tool:get_service": { "responseFromState": "services[id]" }
  }
}
```

Skillet also supports explicit tool definitions in `skillet.eval.yaml` for cases where a repo does not provide descriptor JSON:

```yaml
integrations:
  billing:
    expose: [tools]
    tools:
      - name: list_invoices
        description: List invoices for the account
        responseFromState: invoices
```

#### State expressions

Use `responseFromState` to return data from the eval scenario state.

Supported forms:

- `services` returns `state.services`
- `services[id]` finds an item in `state.services` whose `id` matches the route or tool argument named `id`
- `deploys[serviceId]` finds an item whose `id` or `serviceId` matches the argument named `serviceId`

For static responses, use `response`:

```json
{
  "overrides": {
    "tool:get_selected_workspace": {
      "response": { "id": "ws_123", "name": "Production" }
    }
  }
}
```

Integration mocks do not use your real MCP tools or real external account. Each eval run gets its own isolated mock state and local HTTP server. Parallel evals do not share mock state.

The generated manifests are inspectable build artifacts. Commit them only if you want a stable imported surface in version control; otherwise, regenerate them from `skillet.eval.yaml`.

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

## Releasing

The release workflow runs when you push a tag that matches `v*`.

1. Update `packages/skillet/package.json` to the version you want to release.
2. Push the release commit to `main`.
3. Run `pnpm release:tag` to create and push `v<version>` to `origin`.
4. Wait for GitHub Actions to create the GitHub release, run verification, and upload the package tarball.
5. Install that release in another project with:

```bash
pnpm add -D "https://github.com/render-lab/skillet/releases/download/v<version>/render-lab-skillet-<version>.tgz"
```

If you need to push a different tag explicitly, run `pnpm release:tag 0.1.4` or `pnpm release:tag v0.1.4`.

## License

MIT
