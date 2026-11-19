from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator, model_validator


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://our_memories:change-me@localhost:5432/our_memories"
    jwt_secret: str = "development-only-change-this-secret-before-deployment"
    frontend_origin: str = "http://localhost:5173"
    cookie_secure: bool = False
    upload_dir: str = "./uploads"
    max_upload_mb: int = 25

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        if value.startswith("postgres://"):
            return "postgresql+psycopg://" + value[len("postgres://"):]
        if value.startswith("postgresql://"):
            return "postgresql+psycopg://" + value[len("postgresql://"):]
        return value

    @model_validator(mode="after")
    def validate_production(self):
        if self.cookie_secure and (self.jwt_secret == "development-only-change-this-secret-before-deployment" or len(self.jwt_secret) < 32):
            raise ValueError("Для HTTPS задайте собственный JWT_SECRET длиной минимум 32 символа")
        if self.cookie_secure and not self.frontend_origin.startswith("https://"):
            raise ValueError("При COOKIE_SECURE=true нужен HTTPS FRONTEND_ORIGIN")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()

