# agent-skills

Package manager for AI agent skills. Manage skills as reproducible, auditable dependencies with lockfile pinning and multi-runtime context assembly.

## Install

```bash
npm install -g agent-skills
```

Requires Node.js 20+.

## Commands

### `agent-skills init`

Scaffold an `skills.json` manifest in the current project. Interactive prompts for project name, target runtimes, and injection strategy.

```bash
agent-skills init
```

### `agent-skills add <spec...>`

Add skill dependencies. Accepts one or more skill specifiers in `owner/repo/skill-name[@version]` format.

```bash
agent-skills add anthropics/skills/docx
agent-skills add anthropics/skills/docx@^2.1.0
agent-skills add render-com/skills/deploy-workflow@latest
```

This resolves the skill from GitHub, adds it to `skills.json`, and updates the lockfile.

### `agent-skills install`

Resolve all dependencies from `skills.json`, fetch from GitHub, and write `skills.lock`.

```bash
agent-skills install
```

Skills are cached locally at `~/.agent-skills/cache/` and verified by SHA256.

### `agent-skills emit`

Assemble context from installed skills and write output files for each target runtime.

```bash
# Emit to all configured targets
agent-skills emit

# Emit to a specific target
agent-skills emit --target cursor
agent-skills emit --target claude-code,codex
```

### `agent-skills status`

Show installed skills, their versions, and lockfile state.

```bash
agent-skills status
```

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

Skills are identified as `owner/repo/skill-name`, mirroring the skills.sh convention. Version ranges follow semver (`^1.0.0`, `~1.2.0`, `1.0.0`, `latest`).

### Injection strategies

| Strategy | Behavior |
| --- | --- |
| `eager` | All skill content injected upfront (simple, predictable, higher token cost) |
| `lazy` | Only metadata injected; full content loaded on demand |
| `tiered` | Per-skill override in manifest |

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

Pins every dependency to a content-addressed SHA256. Commit this to version control for reproducible agent behavior.

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
| `codex` | `.agents/skills/<skill>/SKILL.md` | Standard SKILL.md |
| `windsurf` | `.windsurfrules` | Plain markdown |
| `cline` | `.clinerules` | Plain markdown |
| `generic` | `agent-context.md` | Plain markdown |

## License

MIT
