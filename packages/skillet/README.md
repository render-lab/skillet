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
