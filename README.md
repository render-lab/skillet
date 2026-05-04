# Skillet

[![GitHub release](https://img.shields.io/github/v/release/render-lab/skillet)](https://github.com/render-lab/skillet/releases)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Experimental](https://img.shields.io/badge/status-experimental-orange)

<img src="assets/skillet.png" alt="Keep your agent skills tasty" width="240">

*Keep your agent skills tasty*

Skillet runs multi-provider evals for AI agent skills. Point it at any directory with a `SKILL.md`, and it spins up real agent loops against Claude, ChatGPT, and Gemini, mocks the external APIs and MCP tools your skill expects, grades transcripts with an LLM judge, and writes a per-run manifest of every input that shaped the result so you can re-run the same configuration in CI.

Built on the open Agent Skills standard.

## Highlights

- **Multi-provider runs.** Same skill, same eval cases, run against Claude, GPT, and Gemini in one command. The `benchmark.json` carries a provider dimension so you can see which model your skill works best on.
- **Integration mocks as eval primitives.** Generate deterministic mock HTTP servers from OpenAPI specs and mock MCP-style tools from MCP server repos with `skillet mock import`. Test skills that call Stripe, GitHub, or your own API without touching production.
- **Per-run input manifest.** Every `skillet eval run` writes a sibling `<stamp>.manifest.json` next to the benchmark file with the skillet version, skill content hash, providers/models, mock spec hashes, and the `evals.json` hash. When a future run drifts, diff the manifests to spot which input changed.

## How this differs from generic LLM eval frameworks

Most LLM eval frameworks (Promptfoo, OpenAI Evals, Inspect AI, Braintrust) score `prompt → completion` pairs against a rubric. Skillet evaluates *agent skills*: a `SKILL.md` driving a real agent loop with file system and shell tools running in a sandboxed working directory, plus mock HTTP and MCP tools when a skill declares them. The unit of work is "did the agent follow the skill's instructions and finish the task," not "did the model produce the right string."

That shifts a few things:

- The agent gets a working directory and `bash`/`read_file`/`write_file` tools. Assertions can reference the final state of that environment, not just the last assistant message.
- Integration mocks are first-class. Test a skill that calls Stripe or your own API without standing up a real server.
- A single eval run covers multiple providers so you can see which models your skill generalizes to.

If you're scoring single completions against a rubric, a generic framework is probably a better fit. If you're shipping skills that run as agent loops with tool calls and external APIs, Skillet is built for that.

## Install the CLI

```bash
pnpm add -D @render-lab/skillet
```

To install from a GitHub release tarball instead of npm:

```bash
pnpm add -D "https://github.com/render-lab/skillet/releases/latest/download/render-lab-skillet-latest.tgz"
```

Requires Node.js 20+.

## Quick start

```bash
skillet eval init                  # interactive setup → skillet.config.yaml
skillet mock import openapi ./fixtures/render-openapi.json --name render
skillet eval run ./my-skill        # multi-provider eval run
```

The first command writes `skillet.config.yaml` with your providers and grader. The second imports an OpenAPI spec into the config's `mocks:` block and writes a mock manifest under `.skillet-evals/mocks/`. The third runs every eval case in `./my-skill/evals.json` against every configured provider, writes `<stamp>.json` (benchmark) and `<stamp>.manifest.json` (input manifest) under `.skillet-evals/results/<skill>/`, and prints a side-by-side summary.

## Evaluating a skill

`skillet eval` measures how well an agent follows a skill's instructions. An eval run combines the skill's `SKILL.md`, realistic prompts (single or multi-turn), sandboxed shell and file tools, optional mocks, one or more model providers, and an LLM judge that grades the transcript against explicit assertions. The result is a benchmark history per skill — useful for comparing providers, catching regressions when you edit a skill, and publishing results in CI.

### Multi-provider runs

Configure providers in `skillet.config.yaml`:

```yaml
providers:
  - { name: anthropic, model: claude-sonnet-4-6,      apiKey: ${ANTHROPIC_API_KEY} }
  - { name: openai,    model: gpt-5.4,                apiKey: ${OPENAI_API_KEY} }
  - { name: google,    model: gemini-3.1-pro-preview, apiKey: ${GOOGLE_API_KEY} }
```

You can also use the short form when the model id is enough to infer the provider:

```yaml
providers:
  - claude-sonnet-4-6
  - gpt-5.4
  - gemini-3.1-pro-preview
```

`skillet eval run ./my-skill` runs every case against every provider. The resulting `benchmark.json` has a `provider_summary` block so you can compare side by side:

```json
"provider_summary": {
  "claude-sonnet-4-6":       { "pass_rate": { "mean": 0.92 } },
  "gpt-5.4":                 { "pass_rate": { "mean": 0.81 } },
  "gemini-3.1-pro-preview":  { "pass_rate": { "mean": 0.78 } }
}
```

`skillet eval report` renders the same data as a static HTML page.

### Mocks

Use mocks when a skill expects access to an external API or MCP server but you want evals to stay local, deterministic, and safe. Test a skill that calls the Render API without hitting Render. Test a skill that uses your in-house MCP server without standing it up.

Import a mock from an OpenAPI spec or an MCP server repo:

```bash
skillet mock import openapi ./fixtures/render-openapi.json --name render
skillet mock import mcp ./fixtures/render-mcp-server --name render-tools
```

Each call adds an entry to `skillet.config.yaml` and writes `.skillet-evals/mocks/<name>/manifest.json` with the imported HTTP routes and tool descriptors:

```yaml
mocks:
  render:
    openapi: ./fixtures/render-openapi.json
  render-tools:
    mcpServer: ./fixtures/render-mcp-server
```

Each eval case can then opt in to one or more configured mocks and supply per-test scenario state and overrides:

```json
{
  "id": 1,
  "prompt": "Debug why my service is unhealthy.",
  "mocks": {
    "render": {
      "state": {
        "services": [{ "id": "svc_123", "name": "api", "status": "unhealthy" }],
        "deploys":  [{ "id": "dep_123", "serviceId": "svc_123", "status": "failed" }]
      },
      "overrides": {
        "GET /services/{id}": { "responseFromState": "services[id]" },
        "tool:list_services": { "responseFromState": "services" }
      }
    }
  },
  "assertions": ["Identifies svc_123 as unhealthy", "Connects it to the failed deploy"]
}
```

Each eval run gets its own isolated mock state and local HTTP server, included in grading context so assertions can reference the final state. Parallel evals do not share mock state.

### Eval definitions

Each skill includes an `evals.json` file with test cases:

```json
{
  "skill_name": "code-review",
  "evals": [
    {
      "id": 1,
      "prompt": "Review app.py for bugs and security issues.",
      "files": ["fixtures/app.py"],
      "assertions": [
        "Identifies the SQL injection vulnerability",
        "Writes a review.md file with organized findings"
      ]
    }
  ]
}
```

Evals support single prompts and multi-turn conversations via a `turns` array. Skillet recognizes both the flat layout (`<skill>/evals.json` with fixtures under `<skill>/fixtures/`) and the skill-creator layout (`<skill>/evals/evals.json` with fixtures under `<skill>/evals/files/`).

An `evals.json` file can also declare top-level `providers` (filters which configured providers run for this skill) and `mocks` (a list of mock names this skill depends on, optionally with inline definitions):

```json
{
  "skill_name": "code-review",
  "providers": ["openai", "anthropic"],
  "mocks": ["render"],
  "evals": [ ... ]
}
```

### OpenAPI, MCP, and state expressions

When you expose `http`, Skillet imports `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` operations from the OpenAPI spec (JSON or YAML, must be the document itself with `openapi` and `paths`). Path parameters like `/services/{id}` are matched on incoming requests, and `application/json` example responses are used as defaults. For `GET` routes, Skillet can resolve common collection state automatically (so `/services/{id}` resolves an item from `state.services`). Route override keys use the format `METHOD /path/{param}`.

When you expose `tools`, Skillet imports tool definitions from a GitHub repo URL, a local path with a README tool list, or a directory of tool descriptor JSON files. README import supports the format `- **tool_name** - Description` followed by parameter bullets. Tool override keys use the format `tool:<tool_name>`. You can also declare explicit tools in `skillet.config.yaml` under a mock's `tools:` list.

Use `responseFromState` to return data from the eval scenario state:

- `services` returns `state.services`
- `services[id]` finds an item in `state.services` whose `id` matches the route or tool argument named `id`
- `deploys[serviceId]` finds an item whose `id` or `serviceId` matches the argument named `serviceId`

For static responses, use `response: { ... }` instead of `responseFromState`.

### Per-run input manifest

Every `skillet eval run` writes `<stamp>.manifest.json` next to the benchmark JSON. It records every input that shaped the run:

```json
{
  "run_id": "2026-05-03T17-04-12",
  "skillet_version": "0.2.0",
  "skills": [
    { "path": "./my-skill", "content_sha256": "…", "skill_version": "1.0.0" }
  ],
  "providers": [
    { "name": "anthropic", "model": "claude-sonnet-4-6" },
    { "name": "openai",    "model": "gpt-5.4" }
  ],
  "mocks": [
    { "name": "render", "openapi": "./fixtures/render-openapi.json", "openapi_sha256": ["…"] }
  ],
  "eval_config": {
    "evals_json_sha256": "…",
    "evals_run": [1, 2, 3],
    "runs_per_provider": 1
  }
}
```

LLM calls aren't bit-reproducible, so a replay won't be byte-identical — but if results drift, the manifest pinpoints which input changed (skill content, mock spec, eval case, provider).

### CI integration

`skillet eval init` can scaffold `.github/workflows/skillet-evals.yml`, which validates eval definitions, runs model evals, writes a job summary, comments on the pull request with results, and uploads `.skillet-evals/results` artifacts plus a static HTML report.

`init` also offers an opt-in to host the report on Render. It writes a `render.yaml` for a static site that serves an `eval-reports` branch where each PR's report is published under `pr-<N>/`. The PR comment then prepends a link to `<your-service>.onrender.com/pr-<N>/` whenever the `SKILLET_REPORT_BASE_URL` repo variable is set.

## Command reference

```bash
skillet eval init                  # interactive setup → skillet.config.yaml
skillet eval scaffold              # create a SKILL.md + evals.json starter
skillet eval validate              # check eval definitions
skillet eval generate ./my-skill   # generate eval cases from a SKILL.md
skillet eval fixtures ./my-skill   # generate fixture files referenced by evals
skillet eval run                   # run evals across configured providers
skillet eval report                # render results as static HTML
skillet eval serve ./my-skill      # local UI for browsing results
skillet eval compare a.json b.json # diff two benchmark JSON files

skillet mock import openapi <spec> # import an OpenAPI spec as a mock
skillet mock import mcp <repo>     # import an MCP server repo as a mock
```

Configure API keys via `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY`. Results are written to `.skillet-evals/results/<skill-name>/` and reports to `.skillet-evals/report/`.

## Compatibility

If you've authored evals with Anthropic's skill-creator skill (`evals.json`, `eval_metadata.json`, `benchmark.json`), Skillet reads them with minimal changes — it extends the schema with multi-provider runs and mocks but stays compatible with the core fields.

## Project structure

```text
packages/skillet/              # Main TypeScript CLI and eval engine
packages/skillet-eval-python/  # Python reference eval engine
schemas/                       # Shared JSON schemas (evals, benchmarks, config, grading)
fixtures/skills/               # Sample skills used for eval testing
fixtures/golden/               # Reference benchmark outputs for regression testing
```

## Developing this repo

Prerequisites: Node.js 20+, [pnpm](https://pnpm.io/).

```bash
pnpm install && pnpm build
pnpm test
pnpm typecheck
pnpm check
```

## Releasing

The release workflow runs when you push a tag matching `v*`.

1. Bump `packages/skillet/package.json` to the version you want to release and push the commit to `main`.
2. Run `pnpm release:tag` to create and push `v<version>` (or pass a version explicitly: `pnpm release:tag 0.2.0`).
3. GitHub Actions then runs verification, uploads `render-lab-skillet-<version>.tgz` and `render-lab-skillet-latest.tgz`, and publishes `@render-lab/skillet` to npm.

To pin a specific release tarball: `pnpm add -D "https://github.com/render-lab/skillet/releases/download/v<version>/render-lab-skillet-<version>.tgz"`.

## License

MIT
