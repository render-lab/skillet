# Changelog

All notable changes to Skillet are recorded in this file.

## v0.2.0

Skillet now focuses solely on multi-provider skill evals and integration mocks.

### Added

- `skillet mock import openapi <spec>` and `skillet mock import mcp <repo>` — promote integration mocks to a top-level command group. Each import adds an entry to `skillet.config.yaml` and writes a materialized manifest under `.skillet-evals/mocks/<name>/manifest.json`.
- Per-run input manifest written alongside the benchmark JSON. Every `skillet eval run` now writes `<stamp>.manifest.json` containing `run_id`, `skillet_version`, skill content hashes, providers/models, mock spec hashes, and the `evals.json` hash. LLM calls aren't bit-reproducible, but the manifest pinpoints which input changed if results drift.
- Recognition of the skill-creator `evals/evals.json` layout (with `evals/files/` for fixtures), in addition to the flat `<skill>/evals.json` + `<skill>/fixtures/` layout. The flat layout takes precedence when both exist.
- Top-level `providers` and `mocks` fields in `evals.json`. `providers` filters which configured providers run for a skill. `mocks` is a list of mock names (or inline `MockConfig` objects with a `name`) the skill expects — referenced names are validated against the resolved config and inline definitions are merged in for the run.
- Short-form provider entries in `skillet.config.yaml` (`providers: [gpt-5.4, claude-sonnet-4-6]`). The provider name is inferred from the model id.

### Changed

- **Renamed** `skillet.eval.yaml` to `skillet.config.yaml`. No fallback — Skillet was internal-only at the time of rename.
- **Renamed** the top-level `integrations:` block in the config to `mocks:`. No fallback.
- **Renamed** the per-eval `integrations:` block in `evals.json` to `mocks:`. No fallback.
- Mock manifests now live under `.skillet-evals/mocks/` (was `.skillet-evals/integrations/`).
- Internal type and function names that referenced "integration mock" are now just "mock" (`MockConfig`, `MockEnvironment`, `writeMockManifests`, `createMockEnvironment`, etc.).

### Removed

- Top-level commands: `skillet init`, `skillet add`, `skillet install`, `skillet update`, `skillet emit`, `skillet status`.
- Source modules: `src/commands/`, `src/emitter/`, `src/lockfile/`, `src/resolver/`, `src/schemas/lockfile.ts`, `src/schemas/manifest.ts`.
- Dependencies: `semver`, `@types/semver`.
