FROM python:3.13.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache

RUN groupadd --system app \
    && useradd --system --gid app --create-home app

WORKDIR /app

COPY ai-service/pyproject.toml ./
COPY ai-service/src ./src
COPY ai-service/tests ./tests

RUN mkdir -p /opt/tiktoken-cache \
    && python -m pip install --no-cache-dir ".[dev]" \
    && python -c 'import tiktoken; tiktoken.get_encoding("cl100k_base")' \
    && chown -R app:app /opt/tiktoken-cache

USER app

EXPOSE 8000

CMD ["uvicorn", "support_copilot_ai.main:app", "--host", "0.0.0.0", "--port", "8000"]
