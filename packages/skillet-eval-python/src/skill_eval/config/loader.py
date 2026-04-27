from __future__ import annotations

import os
import sys
from pathlib import Path

import yaml

from .env import resolve_api_key
from .registry import DEFAULT_MODELS, ENV_KEY_MAP, infer_provider
from .schema import (
    CliOverrides,
    Config,
    GraderConfig,
    ProviderConfig,
    ResolvedConfig,
    ResolvedGraderConfig,
    ResolvedProviderConfig,
    SettingsConfig,
)


def _detect_providers() -> list[ProviderConfig]:
    providers: list[ProviderConfig] = []
    for name, env_names in ENV_KEY_MAP.items():
        for env_name in env_names:
            if os.environ.get(env_name):
                providers.append(
                    ProviderConfig(
                        name=name,
                        model=DEFAULT_MODELS[name],
                        api_key=os.environ[env_name],
                    )
                )
                break
    return providers


def load_config(overrides: CliOverrides | None = None) -> ResolvedConfig:
    overrides = overrides or CliOverrides()
    config_path = overrides.config_path or "skillet.eval.yaml"
    file_config: Config | None = None

    if Path(config_path).exists():
        raw = Path(config_path).read_text()
        parsed = yaml.safe_load(raw)
        file_config = Config.model_validate(parsed)

    providers = file_config.providers if file_config else _detect_providers()

    if overrides.providers:
        providers = [p for p in providers if p.name in overrides.providers]

    if overrides.models:
        resolved_providers: list[ProviderConfig] = []
        for spec in overrides.models:
            if ":" in spec:
                name, model = spec.split(":", 1)
            else:
                name = infer_provider(spec)
                model = spec
            key = resolve_api_key(name)
            resolved_providers.append(
                ProviderConfig(name=name, model=model, api_key=key)
            )
        providers = resolved_providers

    skipped: list[str] = []
    resolved: list[ResolvedProviderConfig] = []
    for p in providers:
        api_key = resolve_api_key(p.name, p.api_key)
        if not api_key:
            env_hint = ENV_KEY_MAP.get(p.name, [f"{p.name} API key"])[0]
            skipped.append(f"{p.model} (no {env_hint})")
            continue
        resolved.append(
            ResolvedProviderConfig(name=p.name, model=p.model, api_key=api_key)
        )

    if skipped:
        print(f"  ⚠ Skipped: {', '.join(skipped)}\n", file=sys.stderr)

    if not resolved:
        raise RuntimeError(
            "No providers configured. Set API keys in the environment "
            "(ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY) "
            "or create a skillet.eval.yaml config file."
        )

    grader_source = (
        file_config.grader
        if file_config and file_config.grader
        else GraderConfig(provider=resolved[0].name, model=resolved[0].model)
    )
    grader_key = resolve_api_key(grader_source.provider)
    if not grader_key:
        raise RuntimeError(
            f'No API key found for grader provider "{grader_source.provider}"'
        )

    settings = (
        file_config.settings
        if file_config
        else SettingsConfig()
    )
    if overrides.runs is not None:
        settings = SettingsConfig(
            max_steps=settings.max_steps,
            timeout=settings.timeout,
            runs_per_provider=overrides.runs,
            temperature=settings.temperature,
        )
    if overrides.timeout is not None:
        settings = SettingsConfig(
            max_steps=settings.max_steps,
            timeout=overrides.timeout,
            runs_per_provider=settings.runs_per_provider,
            temperature=settings.temperature,
        )

    grader = ResolvedGraderConfig(
        provider=grader_source.provider,
        model=grader_source.model,
        api_key=grader_key,
    )

    return ResolvedConfig(
        providers=resolved,
        grader=grader,
        settings=settings,
    )
