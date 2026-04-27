from __future__ import annotations

from skill_eval.config.schema import ResolvedGraderConfig, ResolvedProviderConfig
from skill_eval.providers.anthropic import AnthropicProvider
from skill_eval.providers.google import GoogleProvider
from skill_eval.providers.openai import OpenAIProvider
from skill_eval.providers.types import LLMProvider


def create_provider(
    config: ResolvedProviderConfig | ResolvedGraderConfig,
) -> LLMProvider:
    name = getattr(config, "name", None) or getattr(config, "provider", None)
    match name:
        case "anthropic":
            return AnthropicProvider(config.api_key, config.model)
        case "openai":
            return OpenAIProvider(config.api_key, config.model)
        case "google":
            return GoogleProvider(config.api_key, config.model)
        case _:
            raise ValueError(f"Unknown provider: {name}")
