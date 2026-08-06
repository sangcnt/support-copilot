# Services and Request Flow

How Support Copilot's services fit together, how to run it locally, and what
the current request flow looks like end to end.

## 1. Runtime boundary

The browser-facing production base path is:

```text
/demo/support-copilot/
```

There is no separate landing page. Opening the demo renders the upload-first
workspace directly, with a source panel and a chat panel.

```text
Browser
  -> reverse proxy
  -> Support Copilot Nginx
       -> React production files
       -> Laravel API through PHP-FPM
```

Only Nginx is exposed publicly. FastAPI, PostgreSQL, and Redis stay on the
private application network. The reverse proxy strips the
`/demo/support-copilot` prefix before Laravel sees the route — every path in
section 4 is shown without that prefix.

## 2. Repository layout

```text
support-copilot/
├── frontend/                          React SPA — upload workspace, PDF preview, static admin preview
├── backend/                           Laravel API — sessions, auth, document lifecycle, admin API
│   ├── app/Services/                    AiIngestionClient, DocumentIngestionLifecycle, ...
│   └── storage/app/private/documents/   private PDF storage (shared by backend + queue)
├── ai-service/                        FastAPI — parses, chunks, and embeds PDFs; stateless, no DB connection
├── infrastructure/
│   ├── nginx/                           serves the React build, proxies /api/* and /sanctum/* to PHP-FPM
│   ├── php/                             Laravel runtime image and upload limits
│   ├── postgres/                        enables the pgvector extension on init
│   └── ai-service/                      Python/FastAPI runtime image
├── compose.yaml                       service orchestration, health checks, volumes
├── Makefile                           setup / dev / test / lint / health commands
└── scripts/prepare-env.sh             bootstraps .env and the Laravel APP_KEY
```

### Compose services

**Laravel** — `backend` (PHP-FPM, private) and `queue` (same image, Redis
worker; idle, no job dispatched yet)

**Frontend** — `nginx` (public, serves the React build and proxies to
`backend`); `frontend` is a dev-only Vite container, not part of production

**Python** — `ai-service` (Uvicorn/FastAPI, loopback-only, no state)

**Data** — `postgres` (pgvector, `postgres_data` volume) and `redis` (AOF,
`redis_data` volume)

## 3. Starting and operating the project

Run commands from the repository root.

```bash
make setup   # .env + APP_KEY, build images, start postgres/redis, migrate
make up      # start the full stack in the background and wait for health
make dev     # run the full stack in the foreground
```

```bash
make health     # Verify Laravel and FastAPI health
make logs       # Follow Nginx, Laravel, queue, and FastAPI logs
make migrate    # Apply Laravel migrations
make test       # Run frontend, backend, and AI-service tests
make lint       # Run lint and formatting checks
make config     # Validate the resolved Compose configuration
make down       # Stop services while retaining persistent data
```

`docker compose down -v` intentionally removes named volumes and should only be
used when resetting persistent PostgreSQL and Redis data.

## 4. Implemented endpoints

Route definitions: [`backend/routes/api.php`](backend/routes/api.php).
React API client: [`frontend/src/api.ts`](frontend/src/api.ts).

### 4.1 Public anonymous document API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Laravel health check |
| GET | `/api/public/session` | Create or refresh the anonymous session cookie |
| GET | `/api/public/documents` | List owned documents and the shared sample |
| POST | `/api/public/documents` | Upload a PDF |
| GET | `/api/public/documents/{document}` | Return authorized document metadata |
| GET | `/api/public/documents/{document}/source` | Stream the authorized PDF inline |
| DELETE | `/api/public/documents/{document}` | Delete an owned document and its source |
| POST | `/api/public/documents/{document}/ingestions` | Send an owned PDF to FastAPI and persist the result |
| GET | `/sanctum/csrf-cookie` | Initialize CSRF protection before any mutation |

Mutating requests need `X-XSRF-TOKEN` from that cookie. Upload accepts PDF
only, ≤10 MB; identical content already in the session returns the existing
document instead of creating a duplicate. See [section 5](#5-current-guest-flow)
for the full upload → ingest sequence.

### 4.2 Administrator API

Implemented in Laravel, but the React `Admin preview` is still a static shell
and does not call these routes yet. All except login require Sanctum
authentication and administrator authorization.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Start an administrator session |
| GET | `/api/auth/me` | Return the authenticated administrator |
| POST | `/api/auth/logout` | Invalidate the administrator session |
| GET | `/api/admin/documents` | List up to 50 documents |
| PATCH | `/api/admin/documents/{document}/sample` | Enable or disable a ready shared sample |
| DELETE | `/api/admin/documents/{document}` | Delete a document, remove its source, and audit it |
| GET | `/api/admin/conversations` | List conversations when public chat data exists |
| GET | `/api/admin/usage` | Aggregate request, token, and estimated-cost data |

### 4.3 Private FastAPI API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Internal health check |
| POST | `/internal/ingestions` | Parse, chunk, and embed a PDF; return a full receipt (incl. vectors) for Laravel to persist |

Not exposed publicly; Swagger UI is available on a dev-only loopback listener
at `/docs`. Retrieval and generation routes do not exist yet.

## 5. Current guest flow

```text
Browser (React)
   │
   ├─ 1) GET  /api/public/session                  → create/refresh anonymous session (cookie)
   ├─ 2) GET  /api/public/documents                 → restore owned document or shared sample
   ├─ 3) GET  /sanctum/csrf-cookie                   → obtain CSRF token before any mutation
   ├─ 4) POST /api/public/documents                  → upload PDF
   ├─ 5) GET  /api/public/documents/{id}/source       → inline PDF preview
   └─ 6) POST /api/public/documents/{id}/ingestions   → start ingestion
   ▼
Laravel (Nginx → PHP-FPM)
   │
   ├─ Route 4 → PublicDocumentController::store()
   │     → validate size / MIME / `%PDF-` signature, SHA-256 checksum (reuse if duplicate)
   │     → store file on private disk
   │     → create `documents` (status=pending_ingestion) + `document_versions` (v1, pending)
   │     → 201 new / 200 duplicate — does not call FastAPI yet
   │
   └─ Route 6 → PublicDocumentIngestionController::__invoke()
         │
         ├─ DocumentIngestionLifecycle::start($document)
         │     → lock document + version, set status = "processing"
         │
         ├─ AiIngestionClient::receive($document, $version)
         │     → read file from private storage
         │     → HTTP POST multipart to FastAPI: /internal/ingestions
         │           │
         │           ▼
         │     FastAPI (ai-service) — stateless, no database connection
         │        ├─ PdfParser.parse()        → text + page/line offsets (pdfplumber)
         │        ├─ DocumentChunker.chunk()  → ~650-token chunks, checksums (tiktoken)
         │        ├─ DocumentEmbedder.embed() → batched calls to OpenAI Embeddings API
         │        └─ returns JSON receipt: {parser, chunking, embedding, embedding_records[vector]}
         │
         ├─ (success) DocumentIngestionLifecycle::complete($receipt)
         │     → transaction: validate ordinal/checksum consistency
         │     → insert each chunk + vector into `chunks` (pgvector)
         │     → set document_version.ingestion_status = "ready"
         │     → set document.status = "ready"
         │     → record one `usage_events` row (tokens, latency, model)
         │
         └─ (failure) DocumentIngestionLifecycle::fail($exception)
               → set status = "failed" + failure_reason (safe for the client)
               → store failure_diagnostic separately (internal only)
   ▼
Response → React (latest document + ingestion receipt)
```

The chat composer unlocks once the document is `ready`, but there is no chat
backend yet — submitting a question just shows a static "not connected"
message until retrieval and generation (section 6) are built.

## 6. Planned retrieval and grounded-answer flow

Ingestion (parsing, chunking, embedding, and persistence) is already
implemented — see [section 5](#5-current-guest-flow). What is still planned is
turning a question into a grounded, cited answer:

```text
Browser (React)
   │  POST <public chat endpoint — route not yet defined>
   ▼
Laravel API
   │  → validate session, document ownership, and quota
   │  → forward to FastAPI grounded-answer workflow
   ▼
FastAPI (ai-service)
   │
   ├─ embed the user question (same embedding model as ingestion)
   │        │
   │        ▼
   ├─ query `chunks` in Postgres/pgvector
   │     → cosine search, filtered by active document_version_id
   │     → top-k above a minimum relevance threshold
   │        │
   │        ▼
   ├─ (evidence found)  build prompt from retrieved chunks → call answer model
   │        → structured output: answer + citation chunk_id(s)
   │
   └─ (no evidence)     return an insufficient-evidence fallback, skip the model call
   ▼
Laravel API
   │  → validate every citation resolves to a chunk actually retrieved
   │  → resolve chunk_id → excerpt/page/document name for the client
   │  → persist message, citations, and usage_events
   ▼
Response (streamed) → React renders the answer with clickable citations
```

No route names are defined yet, to avoid publishing an untested contract.
