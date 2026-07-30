from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from support_copilot_ai.config import get_settings


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str


settings = get_settings()

app = FastAPI(
    title="Support Copilot AI Service",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
)


@app.get("/health", response_model=HealthResponse, tags=["operations"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service=settings.app_name)
