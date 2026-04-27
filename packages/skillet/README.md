# skillet

Toolkit for AI agent skills. Manage reproducible skill dependencies, emit runtime-specific context, and evaluate skills across model providers from one CLI.

## Install

```bash
npm install -g skillet
```

Requires Node.js 20+.

## Core commands

```bash
skillet init
skillet add anthropics/skills/docx@^2.1.0
skillet install
skillet emit --target cursor
skillet update
skillet status
```

### `skillet init`

Scaffold a `skills.json` manifest in the current project. Interactive prompts collect the project name, target runtimes, and injection strategy.

### `skillet add <spec...>`

Add one or more skill dependencies in `owner/repo/skill-name[@version]` format.

```bash
skillet add anthropics/skills/docx
skillet add anthropics/skills/docx@^2.1.0
skillet add render-com/skills/deploy-workflow@latest
```

This resolves each skill from GitHub, updates `skills.json`, and refreshes the lockfile.

### `skillet install`

Resolve all dependencies from `skills.json`, fetch them, and write `skills.lock`.

Skills are cached locally at `~/.skillet/cache/` and verified by SHA256.

### `skillet emit`

Assemble context from installed skills and write output files for each target runtime.

```bash
skillet emit
skillet emit --target cursor
skillet emit --target claude-code,codex
```

### `skillet status`

Show installed skills, versions, lockfile state, and any stored eval metadata.

## Eval commands

```bash
skillet eval init
skillet eval generate ./my-skill
skillet eval validate ./my-skill
skillet eval run ./my-skill
skillet eval serve ./my-skill
skillet eval compare golden.json current.json
```

`skillet eval` runs a sandboxed agent loop against a skill directory, grades the result with an LLM judge, reads config from `skillet.eval.yaml` by default, and writes results to `.skillet-evals/results/<skill-name>/`.

### Integration Mocks

Use integration mocks when a skill expects access to an external API or MCP server, but you want evals to stay local, deterministic, and safe. Instead of calling a real account, Skillet builds a per-run mock environment from source definitions you provide during `skillet eval init`.

This feature is opt-in. If `skillet.eval.yaml` has no `integrations` block, or if an eval case does not reference an integration, eval behavior is unchanged.

#### Configure Sources During Init

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

#### Add Scenario Data To Evals

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

During the eval run, Skillet starts an isolated mock environment for that one agent run. The agent receives:

- the local mock HTTP base URL, if `http` is exposed
- imported MCP-style tools, if `tools` is exposed
- the normal sandbox tools (`bash`, `read_file`, `write_file`, and `list_directory`)

The integration state snapshot is included in grading context, so assertions can reference the final mock state.

#### OpenAPI Import

When you expose `http`, Skillet reads the configured OpenAPI spec and creates local routes for the operations under `paths`.

Supported behavior:

- `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` operations are imported.
- Path parameters such as `/services/{id}` are matched against incoming requests.
- If an operation includes an `application/json` example response, Skillet can use it as the default response.
- Eval-level overrides can replace the default response for a specific operation.
- For `GET` routes, Skillet can also resolve common collection state automatically. For example, `/services/{id}` can resolve an item from `state.services`.

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

#### MCP-Style Tool Import

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

#### State Expressions

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

#### Compatibility Notes

Integration mocks do not use your real MCP tools or real external account. They are generated from the configured sources and scenario data for each eval run.

Each eval run gets its own isolated mock state and local HTTP server. Parallel evals do not share mock state.

The generated manifests are inspectable build artifacts. Commit them only if you want a stable imported surface in version control; otherwise, regenerate them from `skillet.eval.yaml`.

## Manifest (`skills.json`)

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "skills": {
    "anthropics/skills/docx": "^2.1.0",
    "render-com/skills/deploy-workflow": "latest"
  },
  "config": {
    "target": ["cursor", "claude-code"],
    "inject": "eager"
  }
}
```

### Skill specifiers

Skills are identified as `owner/repo/skill-name`, mirroring the skills.sh convention. Version ranges follow semver such as `^1.0.0`, `~1.2.0`, `1.0.0`, and `latest`.

### Injection strategies

| Strategy | Behavior |
| --- | --- |
| `eager` | All skill content injected upfront. |
| `lazy` | Only metadata injected; full content loads on demand. |
| `tiered` | Per-skill override in the manifest. |

For tiered injection, use an object instead of a version string:

```json
{
  "skills": {
    "owner/repo/core-skill": { "version": "^1.0.0", "inject": "eager" },
    "owner/repo/reference-skill": { "version": "^1.0.0", "inject": "lazy" }
  }
}
```

## Lockfile (`skills.lock`)

Pins every dependency to a content-addressed SHA256. Commit this file for reproducible agent behavior.

```json
{
  "lockfileVersion": 1,
  "resolved": {
    "anthropics/skills/docx@2.1.3": {
      "sha256": "e3b0c44298fc1c149afb...",
      "source": "https://github.com/anthropics/skills/tree/abc123/docx",
      "commitSha": "abc123def456"
    }
  }
}
```

## Emit targets

| Target | Output | Format |
| --- | --- | --- |
| `cursor` | `.cursor/rules/<skill>.mdc` | YAML frontmatter + markdown |
| `cursor-legacy` | `.cursorrules` | Plain markdown |
| `claude-code` | `CLAUDE.md` | Plain markdown |
| `codex` | `.agents/skills/<skill>/SKILL.md` | Standard `SKILL.md` |
| `windsurf` | `.windsurfrules` | Plain markdown |
| `cline` | `.clinerules` | Plain markdown |
| `generic` | `agent-context.md` | Plain markdown |

## License

MIT
