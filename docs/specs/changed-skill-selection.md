# Opt-in changed-skill evaluation

Status: implemented on `rt/change-based-runs`; CI adoption and release pending. Date: 2026-10-26.

## Problem and outcome

A repository can currently run all discovered skills or pass explicit skill directories. A PR changing one skill can therefore trigger model evaluations for every skill when CI invokes `skillet eval run` without arguments. This costs time and model usage without necessarily adding relevant coverage.

Add opt-in Git-based selection of affected skills. Run every eval in each selected skill, subject to existing explicit eval/provider filters. Include shared dependencies, explain the selection, and skip model setup entirely when there is no work. Keep the existing unfiltered command unchanged.

This feature selects skills. It does not reduce assertions, choose representative scenarios, change providers, cache results, or infer semantic dependencies from prose.

## Current implementation

Inspected local checkout: `render-lab/skillet`, commit `d261d24e1c171ba960b724063f895824bdcc7d23`. Implementation was subsequently based on fetched main `d53ca67` (package 0.2.3).

- `packages/skillet/src/cli.ts`: `eval run [skills...]` already accepts multiple paths and eval/provider/model filters.
- `src/eval/config/skills.ts`: explicit paths override discovery; discovery uses configured roots and stops descending when it finds a `SKILL.md`.
- `src/eval/config/paths.ts`: flat `evals.json` wins over `evals/evals.json`; explicit paths resolve relative to the working directory, roots relative to the config directory.
- `src/eval/commands/run.ts`: selects candidates, then uses the existing per-skill runner. Multi-skill discovery skips skills without eval files; a single selected skill without evals currently fails.
- `src/eval/config/loader.ts`: config loading currently resolves credentials and requires an evaluator and grader before discovery. Split structural loading from credential resolution to support credential-free selection.
- The Zod schema and published `schemas/config.schema.json` both need the optional configuration extension.

## CLI contract

```sh
# Existing behavior: unchanged, including outside Git repositories.
skillet eval run --config skillet.eval.yaml
skillet eval run skills/render-sandboxes --config skillet.eval.yaml

# New: affected skills since the branch diverged from this base.
skillet eval run --changed-since origin/main --config skillet.eval.yaml

# Preview selection; no model requests or API keys required.
skillet eval run --changed-since origin/main --dry-run --config skillet.eval.yaml

# Optionally persist an explanation for CI.
skillet eval run --changed-since origin/main \
  --selection-output .skillet-evals/selection.json --config skillet.eval.yaml
```

- `--changed-since <ref>` activates selection. No implicit activation from CI variables, branch names, or presence of the new config block.
- `--dry-run` is supported only with `--changed-since` in v1; it previews selection, not estimated tokens, costs, or execution outcomes.
- `--selection-output <path>` is likewise scoped to changed mode. It writes selection metadata, not a benchmark.
- Positional skill paths plus `--changed-since` are rejected in v1. Avoid silently intersecting away an affected skill or unexpectedly expanding an explicit request. Users can preview then invoke the existing explicit-path mode.
- `--providers`, `--model`, `--eval-id`, `--runs`, `--timeout`, and `--concurrency` retain their existing execution semantics after selection. Do not claim complete coverage when filters are supplied.
- Preserve the existing single-skill restrictions for `--evals` and `--golden`, evaluated after selection. A supplied external `--evals` file is an input to the selected skill; changes to it outside skill directories conservatively trigger all candidates unless mapped.
- Without the new flag, existing output, discovery order, credential handling, error behavior, benchmark schemas, and result locations remain unchanged.

## Git comparison

1. Resolve the repository using Git, not package-root heuristics. Support worktrees, detached HEAD, nested invocation, and paths containing spaces.
2. Resolve the requested ref and HEAD to commit IDs, then compute their merge base. Selection compares the merge base to HEAD, so target-branch-only changes do not select skills.
3. Include staged and unstaged tracked changes relative to HEAD, plus nonignored untracked files. This makes local selection reflect files the runner will actually read. Report whether local changes contributed. Ignored untracked files do not count; already-tracked files still count even if later ignored.
4. Use argument-array Git invocations, verified commit IDs, NUL-delimited path output, and no shell interpolation. Use `--no-ext-diff` and `--no-textconv` when applicable. Never execute repository diff helpers.
5. Preserve both old and new paths for renames; classify copies/additions, deletions, and type changes. Rename detection is an optimization: delete/add representation must produce equally conservative selection.
6. Missing Git, non-Git directory, unresolved ref, missing merge base, or incomplete shallow history fails before model requests. Explain how to fetch the base/history. Never fetch automatically or interpret a Git failure as no changes.
7. Skill roots outside this repository, or symlinked inputs escaping it, fail changed mode with guidance to use an unfiltered run. Cross-repository selection is not in v1.
8. Selection is a filesystem snapshot, not a lock. Do not edit inputs during a run; CI uses a fixed checkout.

## Selecting affected skills

Discover current skills using existing conventions. Also inspect the merge-base tree, without checking it out or running its code, to identify deleted/moved skills and their former paths. If roots/configuration changed, the active-config rule below selects all current candidates, so no historical config execution is needed.

For every changed path, accumulate reasons rather than stopping at the first match:

| Change | Selection |
| --- | --- |
| Any file under a current skill directory | That skill's full suite, including references, fixtures, scripts, and eval definitions |
| New skill | New skill, if runnable; report missing evals explicitly |
| File deleted from an existing skill | The surviving skill |
| Whole skill removed | Record as removed; never try to evaluate the missing directory |
| Skill moved/renamed | Evaluate the destination; report the old location as removed/moved |
| Configured dependency input | All current consumers, even if generated copies are unchanged |
| Active config or global input | All current discovered skills |
| Explicitly ignored outside input | No selection for that path |
| Unmapped outside input | All current discovered skills, with an unmapped-input reason |

Direct matches, dependency matches, and global matches take precedence over ignore patterns. Ignore rules cannot suppress a skill's own changed files. Evaluate dependency rules even when the source path is inside another skill: this supports explicit skill-to-skill dependencies. No transitive graph is inferred; list the actual source paths each consumer depends on.

Any changed path under an old skill can still match a dependency rule and select surviving consumers. Deleted skills alone need no execution. A missing root that existed at the base is a reported removal; a root absent both at base and now is a configuration error, not a successful empty selection.

In changed mode, consistently report selected skills without eval files as skipped, even when only one is selected. This is an opt-in behavior; legacy single-skill errors remain unchanged. Invalid eval files in selected runnable skills are errors. Zero discovered skills because everything was removed is distinguishable from a bad discovery setup.

Order selected skills deterministically by repository-relative directory. Deduplicate by normalized directory, not skill name. Use path containment checks, not string-prefix matches (`skills/foo` must not match `skills/foobar`).

## Optional configuration

Add an optional top-level `changes` object to existing config files. Existing files need no migration. These rules apply only with `--changed-since`.

```yaml
skills:
  roots: [skills]

changes:
  global:
    - shared/manifest.json
    - scripts/shared-content.mjs
    - .github/workflows/skillet-evals.yml
  ignore:
    - README.md
    - docs/**
  dependencies:
    - paths: [shared/blueprints.md]
      skills:
        - skills/render-blueprints
        - skills/render-deploy
        - skills/render-migrate-from-heroku
    - paths: [shared/documentation-retrieval.md]
      skills: [skills/**]
```

Path and skill patterns are repository-root-relative, use forward slashes, and support `*`, `**`, and `?` with documented dotfile behavior. No negation, absolute paths, `..` traversal, executable hooks, or environment interpolation in these patterns. `skills` patterns match whole discovered skill-directory paths, not frontmatter names. A rule whose consumer pattern matches neither a current nor a base skill is an error; consumers removed in this diff are recorded, not treated as a typo. Changed dependency rules themselves trigger all via the config rule.

Always treat the active config file, repository-root dependency manifests, and lockfiles as global inputs. Include root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`, `bun.lockb`, `pyproject.toml`, `uv.lock`, `poetry.lock`, `requirements*.txt`, and `.gitmodules`. Nested manifests already select their owning skill, or conservatively select all when outside a skill and unmapped. `changes.global` extends these defaults; it cannot remove them. `.skillet-evals/**` is ignored by default only outside skill directories.

Conservative behavior is intentional: an unmapped shared file triggers all until its consumers are configured. A root README-only PR skips evals only when README is explicitly ignored. Print the unmatched paths so users can improve their mapping.

Do not parse Render's shared manifest inside Skillet. Render can initially map `shared/**` globally, then add explicit dependency rules for narrower coverage. A manifest adapter/generator is separate follow-up work; shared-content synchronization checks remain necessary.

Local mock files and external fixture inputs must be covered by the same dependency/global rules; unmapped changes select all. Remote URLs changing without a Git change cannot be detected. Manual full runs remain useful for that reason.

## Preview, artifacts, and empty selections

Always print the ref, resolved base/HEAD/merge-base IDs, local-change inclusion, discovered count, selected paths with reasons, removed skills, and skipped skills. Display a prominent explanation when a global or unmapped input selects everything.

The optional selection JSON is versioned independently (`schemaVersion: 1`) and includes:

- Mode, requested ref, base commit, HEAD, merge-base commit, and local-change presence.
- Changed paths and statuses, including rename sides.
- Selected skills with reasons (`direct`, `dependency`, `global`, `unmapped`) and triggering paths.
- Removed skills, ignored paths, unrunnable skills, and selection status (`selected` or `no-runnable-skills`).

Use repository-relative paths; exclude credentials, file contents, environment values, and expanded provider configuration. Write before model execution, so selection evidence survives a later run failure. Do not change existing benchmark JSON or create fake passing benchmark results for skipped skills.

A valid empty selection exits 0 with `No affected runnable skills; no model evaluations started.` No evaluator/grader authentication, remote mock fetching, sandbox setup, or model calls occur. Preview also requires no credentials. Invalid configuration, dependency mappings, or Git state exits 1; errors are never presented as successful skips. Normal execution retains existing eval exit behavior.

## Implementation boundaries

1. Separate config parsing/path resolution from execution credential resolution. Keep `loadConfig()` as the compatibility facade used by existing commands. New selection code uses the credential-free structural loader. Preserve default config filename and explicit `--config` handling.
2. Add a Git change collector and pure skill-selection module under `src/eval/config/`. Keep Git I/O separate from matching and reasoning.
3. Extend CLI/RunOpts and both config schemas. Wire the new branch before provider setup in `runRun()`. Return early for preview/no work; otherwise hand the selected directories to the established runner.
4. Add selection reporting and optional JSON writing without altering per-skill benchmark serialization.
5. Update CLI/package documentation. `validate`, `generate`, and other commands retain their current behavior; changed selection for them is out of scope.

## CI adoption

Ship Skillet support first; migrate the Render skills workflow separately after pinning a release that supports it. Keep the full-suite command for manual runs.

For PRs, use a complete checkout of the evaluated commit and explicitly fetch/retain the target base. Pass the PR base SHA through an environment variable, not interpolated shell source:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- name: Evaluate affected skills
  env:
    EVAL_BASE: ${{ github.event.pull_request.base.sha }}
  run: >-
    pnpm exec skillet eval run --config skillet.eval.yaml
    --changed-since "$EVAL_BASE"
    --selection-output .skillet-evals/selection.json
```

GitHub's normal PR merge checkout evaluates the proposed merged tree. Compare its merge base with the base SHA; if CI explicitly checks out the PR head instead, the same merge-base semantics apply. Do not silently choose a base from provider-specific environment variables inside Skillet.

Keep structural/shared-content checks repo-wide. Existing `eval validate` also checks credentials; this feature does not relabel it as a credential-free structural validator. Ensure the workflow triggers for shared/config/dependency inputs too, otherwise selection never gets a chance to include consumers. The summary must say which skills ran and which were skipped; no selection is a successful skip, not an eval pass. Do not aggregate stale result files from previous runs. Use the selection artifact alongside current-run results.

Preserve the repository's secret-access policy for fork PRs. Never switch to `pull_request_target` and execute untrusted PR code with secrets to enable model tests.

## Acceptance tests

Use temporary Git repositories and mocked orchestration; no paid model calls are necessary for selection tests.

1. Existing no-flag command tests pass unchanged: explicit/discovered paths, non-Git execution, providers, eval filters, flat/nested eval files, failures, output metadata, and missing-eval behavior.
2. Editing SKILL.md, a nested reference, fixture, script, or eval selects only its skill; all evals in that skill remain eligible.
3. Two changed skills select both once; prefix-similar names do not collide; nested config/cwd resolution agrees with legacy discovery.
4. Added, deleted, moved, copied, and type-changed files select correctly, with and without Git rename detection; removed skills are not executed.
5. Shared dependency changes select every mapped consumer, including when generated copies have not changed. Multiple rules union their consumers. Removed/invalid consumers are distinguished.
6. Active config and global inputs select all. Unknown inputs select all with reasons. Explicitly ignored outside docs select none. Ignores cannot override direct/dependency/global matches.
7. Staged, unstaged, and nonignored untracked additions are included; ignored untracked files are excluded. Worktree and detached-head cases work.
8. Divergent target-branch-only edits are excluded. Base changes already present in the evaluated merge checkout are not incorrectly treated as PR changes.
9. Bad refs, shallow history, non-Git state, escaping roots, malformed patterns, and invalid mappings fail before credentials/model setup. Test whitespace, Unicode, newline-containing paths, and option-like refs without shell execution.
10. Preview and valid empty selection work without API keys and perform zero provider, mock-network, or sandbox calls. Unrunnable selected skills are visibly skipped; invalid runnable evals fail.
11. Conflicting options fail clearly. Existing provider/eval filters apply after selection; `--evals`/`--golden` single-skill restrictions remain intact.
12. Selection JSON is deterministic apart from explicitly variable fields, contains no secrets, survives evaluator failure, and leaves benchmark schemas untouched.

## Release criteria

Implement only after syncing and checking the current remote checkout. Deliver as an additive minor release with no required config migration. Verify existing CLI regression tests plus the new selection tests, type checking, schema consistency, and build. Demonstrate a one-skill PR, shared-input PR, global-config PR, and ignored-docs-only PR with mocked execution before migrating Render CI.

Backward compatibility means existing users and commands keep working on the new release. It does not mean older Skillet versions understand the new flags or config block; consumers must upgrade before opting in.
