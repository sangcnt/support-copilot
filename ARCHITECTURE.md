# Architecture

Support Copilot uses Laravel as the only public business API and keeps the AI
workflow behind a private FastAPI service.

## Components

```mermaid
flowchart LR
    User["Anonymous visitor"] --> Nginx["Nginx<br/>React SPA + API routing"]
    Nginx --> Laravel["Laravel API<br/>session, authorization, storage, business rules"]
    Laravel --> Postgres[("PostgreSQL + pgvector")]
    Laravel --> Redis[("Redis<br/>queue, session, cache")]
    Laravel --> Files[("Private PDF storage")]
    Redis --> Worker["Laravel queue worker"]
    Worker --> FastAPI["Private FastAPI service"]
    FastAPI --> Files
    FastAPI --> Postgres
    FastAPI --> Provider["Embedding and LLM provider"]
```

The browser never calls FastAPI, PostgreSQL, Redis, or a model provider
directly.

## Repository boundaries

| Path | Responsibility |
|---|---|
| `frontend/` | React and TypeScript SPA |
| `backend/` | Laravel API and queue code |
| `ai-service/` | Private document-processing and RAG service |
| `infrastructure/nginx/` | Static SPA delivery and PHP-FPM routing |
| `infrastructure/php/` | Laravel PHP-FPM image |
| `infrastructure/postgres/` | PostgreSQL and pgvector initialization |
| `infrastructure/ai-service/` | FastAPI image |
| `compose.yaml` | Service orchestration and persistence |

## Current upload flow

```mermaid
sequenceDiagram
    actor User
    participant UI as React SPA
    participant API as Laravel API
    participant DB as PostgreSQL
    participant Files as Private PDF storage

    User->>UI: Open demo
    UI->>API: Start anonymous session
    API->>DB: Resolve or create session
    API-->>UI: HttpOnly session cookie
    UI->>API: Restore accessible documents
    User->>UI: Select PDF
    UI->>API: Upload PDF
    API->>API: Validate file and calculate checksum
    API->>Files: Store original PDF
    API->>DB: Create document and version
    API-->>UI: Document metadata
    UI->>API: Request authorized PDF source
    API->>Files: Read private source
    API-->>UI: Inline PDF response
```

The current upload ends with `pending_ingestion`. No Python, embedding, vector
retrieval, or LLM call occurs yet.

## Planned RAG flow

```mermaid
sequenceDiagram
    actor User
    participant UI as React SPA
    participant API as Laravel API
    participant Queue as Laravel queue
    participant AI as FastAPI
    participant DB as PostgreSQL + pgvector
    participant Model as Model provider

    API->>Queue: Dispatch idempotent ingestion
    Queue->>AI: Process authorized PDF source
    AI->>AI: Parse and create deterministic chunks
    AI->>Model: Embed chunks
    AI->>DB: Store chunks and vectors
    AI-->>API: Mark document ready or failed

    User->>UI: Ask a question
    UI->>API: Start chat stream
    API->>API: Validate session, document, and quota
    API->>AI: Run grounded-answer workflow
    AI->>Model: Embed query
    AI->>DB: Retrieve document-scoped evidence
    AI->>Model: Generate from retrieved evidence
    AI-->>API: Stream answer and citation references
    API->>API: Validate citations
    API->>DB: Persist messages, citations, and usage
    API-->>UI: Stream validated answer
```

See [API Reference](API.md) for the concrete implemented endpoints and planned
API gaps.
