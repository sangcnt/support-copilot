from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "support-copilot-ai"
    app_environment: str = "local"
    log_level: str = "INFO"
    provider: str = "openai"
    embedding_batch_size: int = Field(default=32, ge=1, le=128)
    openai_api_key: SecretStr | None = Field(
        default=None,
        validation_alias="OPENAI_API_KEY",
    )
    openai_embedding_model: str = Field(
        default="text-embedding-3-small",
        validation_alias="OPENAI_EMBEDDING_MODEL",
    )
    openai_embedding_dimensions: int = Field(
        default=1536,
        ge=1,
        le=3072,
        validation_alias="OPENAI_EMBEDDING_DIMENSIONS",
    )
    openai_chat_model: str = Field(
        default="",
        validation_alias="OPENAI_CHAT_MODEL",
    )

    db_host: str = Field(default="", validation_alias="DB_HOST")
    db_port: int = Field(default=5432, validation_alias="DB_PORT")
    db_database: str = Field(default="", validation_alias="DB_DATABASE")
    db_username: str = Field(default="", validation_alias="DB_USERNAME")
    db_password: str = Field(default="", validation_alias="DB_PASSWORD")

    retrieval_top_k: int = Field(default=5, ge=1, le=20)
    retrieval_min_score: float = Field(default=0.2, ge=0.0, le=1.0)

    model_config = SettingsConfigDict(
        env_prefix="AI_",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
