# skillet

Multi-provider skill evals with integration mocks. Run real agent loops against any directory with a `SKILL.md`, mock external APIs and MCP tools with deterministic stubs, grade transcripts with an LLM judge, and write a per-run input manifest so the same configuration can be re-run in CI.

## Install

```bash
pnpm add -D @render-lab/skillet
```

Requires Node.js 20+.

## Quick start

```bash
skillet eval init                  # interactive setup → skillet.config.yaml
skillet mock import openapi ./fixtures/render-openapi.json --name render
skillet eval run ./my-skill        # multi-provider eval run
```

The first command writes `skillet.config.yaml` with your providers and grader. The second imports an OpenAPI spec into the config's `mocks:` block and writes a mock manifest under `.skillet-evals/mocks/`. The third runs every eval case in `./my-skill/evals.json` against every configured provider, writes `<stamp>.json` (benchmark) and `<stamp>.manifest.json` (input manifest) under `.skillet-evals/results/<skill>/`, and prints a side-by-side summary.

## Eval commands

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
```

`skillet eval run` runs a sandboxed agent loop against a skill directory, grades the result with an LLM judge, reads config from `skillet.config.yaml` by default, and writes results to `.skillet-evals/results/<skill-name>/`.

`skillet eval init` can also scaffold `.github/workflows/skillet-evals.yml` with validation, model eval runs, GitHub Actions summaries, PR comments, raw result artifacts, and static HTML report artifacts. It can optionally write a `render.yaml` to host the report on Render — the workflow then publishes each PR's report to an `eval-reports` branch under `pr-<N>/`, and the PR comment links to `<your-service>.onrender.com/pr-<N>/` when `SKILLET_REPORT_BASE_URL` is set.

## Mock commands

```bash
skillet mock import openapi <spec> # import an OpenAPI spec as a mock
skillet mock import mcp <repo>     # import an MCP server repo as a mock
```

`skillet mock import` adds an entry to `skillet.config.yaml` under `mocks:` and writes `.skillet-evals/mocks/<name>/manifest.json` with the imported HTTP routes and tool descriptors. Pass `--name` to override the default name (derived from the source basename) and `--config` to point at a non-default config file.

## Skill layout

Skillet recognizes both layouts a skill might use for evals:

- **Flat** (default): `<skill>/evals.json` and `<skill>/fixtures/`.
- **Nested** (skill-creator convention): `<skill>/evals/evals.json` and `<skill>/evals/files/`.

The flat layout takes precedence when both exist. Fixture paths in `evals.json` resolve relative to the directory containing `evals.json`.

## `skillet.config.yaml`

```yaml
providers:
  - name: anthropic
    model: claude-sonnet-4-6
    apiKey: ${ANTHROPIC_API_KEY}
  - name: openai
    model: gpt-5.4
    apiKey: ${OPENAI_API_KEY}

# Short form is also supported when the model id is enough to infer the provider:
# providers:
#   - claude-sonnet-4-6
#   - gpt-5.4

grader:
  provider: anthropic
  model: claude-sonnet-4-6

skills:
  roots:
    - ./skills

mocks:
  render:
    openapi: ./fixtures/render-openapi.json
    mcpServer: ./fixtures/render-mcp-server
    expose: [http, tools]

settings:
  maxSteps: 20
  timeout: 300
  runsPerProvider: 1
  temperature: 0
```

API keys are also read from the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`). When no `skillet.config.yaml` is present, Skillet falls back to env-var-only auto-detection.

## Mocks

Use mocks when a skill expects access to an external API or MCP server, but you want evals to stay local, deterministic, and safe. Skillet builds a per-run mock environment from sources you import.

### Configure a mock

Import an OpenAPI spec or MCP server repo with `skillet mock import`:

```bash
skillet mock import openapi ./fixtures/render-openapi.json --name render
skillet mock import mcp ./fixtures/render-mcp-server --name render-tools
```

Each call:

1. Adds an entry to `skillet.config.yaml` under `mocks:`.
2. Writes a materialized manifest to `.skillet-evals/mocks/<name>/manifest.json` recording the imported HTTP route keys, MCP-style tool keys, source paths, and any import errors.

`skillet eval init`, `skillet eval generate`, and `skillet eval run` refresh this manifest from the configured sources whenever they're invoked.

### Reference a mock from an eval

Each eval case can opt in to one or more configured mocks. The `state` object describes the account, project, database, or API state for that scenario. The `overrides` object maps imported routes or tools to mock responses.

```json
{
  "id": 1,
  "prompt": "Debug why my service is unhealthy.",
  "expected_output": "Find the unhealthy service and explain the failed deploy.",
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
  "assertions": [
    "Identifies svc_123 as unhealthy",
    "Connects the unhealthy service to the failed deploy"
  ]
}
```

During the eval run, Skillet starts an isolated mock environment for that one agent run. The agent receives:

- the local mock HTTP base URL, if `http` is exposed
- imported MCP-style tools, if `tools` is exposed
- the normal sandbox tools (`bash`, `read_file`, `write_file`, `list_directory`)

The mock state snapshot is included in grading context so assertions can reference the final state. Parallel evals do not share state.

### Top-level mocks/providers in `evals.json`

An `evals.json` file can declare top-level `providers` (filters which configured providers run for this skill) and `mocks` (a list of mock names this skill depends on, optionally with inline definitions):

```json
{
  "skill_name": "code-review",
  "providers": ["openai", "anthropic"],
  "mocks": [
    "render",
    { "name": "github", "openapi": "./fixtures/github.json" }
  ],
  "evals": [ ... ]
}
```

String entries reference mocks defined in `skillet.config.yaml`. Object entries are inline definitions — they're merged into `config.mocks` for the duration of the run. If an eval references a mock name that's not configured anywhere, `skillet eval run` exits with an error.

### OpenAPI import

When you expose `http`, Skillet reads the configured OpenAPI spec and creates local routes for the operations under `paths`.

- JSON and YAML OpenAPI documents are supported.
- The file must be the OpenAPI document itself, with `openapi` and `paths`. Do not point `openapi` at an `oapi-codegen` config file.
- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` operations are imported.
- Path parameters such as `/services/{id}` are matched against incoming requests.
- If an operation includes an `application/json` example response, Skillet uses it as the default response.
- For `GET` routes, Skillet can resolve common collection state automatically. For example, `/services/{id}` resolves an item from `state.services`.

Route override keys use the format `METHOD /path/{param}`.

### MCP-style tool import

When you expose `tools`, Skillet imports tool definitions from the configured MCP server source. The source can be a GitHub repo URL, a local repo/path with a README tool list, or a directory of tool descriptor JSON files. README import supports the format `- **tool_name** - Description` followed by parameter bullets.

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

Tool override keys use the format `tool:<tool_name>`.

You can also declare explicit tools in `skillet.config.yaml` for cases where a repo does not provide descriptor JSON:

```yaml
mocks:
  billing:
    expose: [tools]
    tools:
      - name: list_invoices
        description: List invoices for the account
        responseFromState: invoices
```

### State expressions

Use `responseFromState` to return data from the eval scenario state:

- `services` returns `state.services`
- `services[id]` finds an item in `state.services` whose `id` matches the route or tool argument named `id`
- `deploys[serviceId]` finds an item whose `id` or `serviceId` matches the argument named `serviceId`

For static responses, use `response: { ... }` instead of `responseFromState`.

## Per-run input manifest

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

## License

MIT
