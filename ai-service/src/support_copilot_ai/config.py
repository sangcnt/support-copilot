from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "support-copilot-ai"
    app_environment: str = "local"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_prefix="AI_",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
