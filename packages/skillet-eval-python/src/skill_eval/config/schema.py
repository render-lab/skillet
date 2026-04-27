from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ProviderName = Literal["anthropic", "openai", "google"]


class ProviderConfig(BaseModel):
    name: ProviderName
    model: str
    api_key: str | None = Field(default=None, alias="apiKey")

    model_config = {"populate_by_name": True}


class GraderConfig(BaseModel):
    provider: ProviderName
    model: str


class SettingsConfig(BaseModel):
    max_steps: int = Field(default=20, ge=1, alias="maxSteps")
    timeout: float = Field(default=300, gt=0)
    runs_per_provider: int = Field(default=1, ge=1, alias="runsPerProvider")
    temperature: float = Field(default=0, ge=0, le=2)

    model_config = {"populate_by_name": True}


class Config(BaseModel):
    providers: list[ProviderConfig] = Field(min_length=1)
    grader: GraderConfig | None = None
    settings: SettingsConfig = Field(default_factory=SettingsConfig)


class ResolvedProviderConfig(ProviderConfig):
    api_key: str


class ResolvedGraderConfig(GraderConfig):
    api_key: str


class ResolvedConfig(BaseModel):
    providers: list[ResolvedProviderConfig]
    grader: ResolvedGraderConfig
    settings: SettingsConfig


class CliOverrides(BaseModel):
    config_path: str | None = Field(default=None, alias="configPath")
    providers: list[str] | None = None
    models: list[str] | None = None
    runs: int | None = None
    timeout: float | None = None
    concurrency: int | None = None

    model_config = {"populate_by_name": True}
