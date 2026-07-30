FROM python:3.13.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN groupadd --system app \
    && useradd --system --gid app --create-home app

WORKDIR /app

COPY ai-service/pyproject.toml ./
COPY ai-service/src ./src
COPY ai-service/tests ./tests

RUN python -m pip install --no-cache-dir ".[dev]"

USER app

EXPOSE 8000

CMD ["uvicorn", "support_copilot_ai.main:app", "--host", "0.0.0.0", "--port", "8000"]
