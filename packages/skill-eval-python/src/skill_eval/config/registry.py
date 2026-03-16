from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

ProviderName = Literal["anthropic", "openai", "google"]


@dataclass
class ModelEntry:
    id: str
    label: str
    tag: Literal["balanced", "reasoning", "fast", "code"]


@dataclass
class ProviderRegistryEntry:
    label: str
    env_keys: list[str]
    default_model: str
    models: list[ModelEntry] = field(default_factory=list)


PROVIDER_REGISTRY: dict[str, ProviderRegistryEntry] = {
    "anthropic": ProviderRegistryEntry(
        label="Anthropic",
        env_keys=["ANTHROPIC_API_KEY"],
        default_model="claude-sonnet-4-6",
        models=[
            ModelEntry("claude-sonnet-4-6", "Sonnet 4.6", "balanced"),
            ModelEntry("claude-opus-4-6", "Opus 4.6", "reasoning"),
            ModelEntry("claude-haiku-4-5", "Haiku 4.5", "fast"),
        ],
    ),
    "openai": ProviderRegistryEntry(
        label="OpenAI",
        env_keys=["OPENAI_API_KEY"],
        default_model="gpt-5.4",
        models=[
            ModelEntry("gpt-5.4", "GPT-5.4", "balanced"),
            ModelEntry("o4-mini", "o4-mini", "reasoning"),
            ModelEntry("gpt-5.3-codex", "GPT-5.3 Codex", "code"),
        ],
    ),
    "google": ProviderRegistryEntry(
        label="Google",
        env_keys=["GOOGLE_API_KEY", "GEMINI_API_KEY"],
        default_model="gemini-3.1-pro-preview",
        models=[
            ModelEntry("gemini-3.1-pro-preview", "Gemini 3.1 Pro", "balanced"),
            ModelEntry("gemini-3-flash-preview", "Gemini 3 Flash", "fast"),
            ModelEntry("gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash Lite", "fast"),
        ],
    ),
}

DEFAULT_MODELS: dict[str, str] = {
    k: v.default_model for k, v in PROVIDER_REGISTRY.items()
}

ENV_KEY_MAP: dict[str, list[str]] = {
    k: v.env_keys for k, v in PROVIDER_REGISTRY.items()
}

MODEL_PREFIXES: list[tuple[re.Pattern[str], ProviderName]] = [
    (re.compile(r"^claude-"), "anthropic"),
    (re.compile(r"^gpt-"), "openai"),
    (re.compile(r"^o\d"), "openai"),
    (re.compile(r"^chatgpt-"), "openai"),
    (re.compile(r"^gemini-"), "google"),
]


def infer_provider(model: str) -> ProviderName:
    for pattern, provider in MODEL_PREFIXES:
        if pattern.search(model):
            return provider
    raise ValueError(
        f'Cannot infer provider for model "{model}". '
        f"Use provider:model syntax (e.g. openai:{model}) or add it to the config file."
    )
