# Services and Request Flow

This document describes the current Support Copilot service boundaries, startup
commands, implemented endpoints, and the request flow from an anonymous visit
through PDF upload, preview, and ingestion. Future endpoints are explicitly
marked as not implemented and should not be treated as established API
contracts.

## 1. Runtime boundary

The browser-facing production base path is:

```text
/demo/support-copilot/
```

There is no separate landing page. Opening the demo renders the upload-first
workspace directly, with a source panel and a chat panel.

The application boundary is:

```text
Browser
  -> reverse proxy
  -> Support Copilot Nginx
       -> React production files
       -> Laravel API through PHP-FPM
```

Only Nginx is exposed publicly. FastAPI, PostgreSQL, and Redis remain on the
private application network.

## 2. Repository and service map

| Service or component | Repository path | Current responsibility |
|---|---|---|
| React SPA | `frontend/` | Public upload workspace, PDF preview, and static admin preview |
| Laravel API | `backend/` | Anonymous sessions, authorization, PDF lifecycle, admin API, and application records |
| Laravel queue worker | Shared code in `backend/` | Runs the Redis worker; no ingestion job exists yet |
| FastAPI AI service | `ai-service/` | Validates PDFs, extracts normalized text and page/line coordinates, creates deterministic token-aware chunks, and generates bounded batches of chunk embeddings; stateless, holds no database connection, and returns everything as a receipt for Laravel to persist. Retrieval and LLM answers are not implemented |
| Nginx | `infrastructure/nginx/` | Builds and serves the React bundle and forwards `/api/*` and `/sanctum/*` to PHP-FPM |
| PHP-FPM image | `infrastructure/php/` | Laravel runtime and file-upload limits |
| PostgreSQL initialization | `infrastructure/postgres/` | Enables pgvector; Laravel migrations manage application tables |
| FastAPI image | `infrastructure/ai-service/` | Builds the Python and FastAPI runtime |
| Docker orchestration | `compose.yaml` | Declares services, networking, health checks, mounts, and persistent volumes |
| Developer commands | `Makefile` | Setup, start, stop, test, lint, migrate, and health commands |
| Environment bootstrap | `scripts/prepare-env.sh` | Creates an ignored `.env` file and generates a Laravel application key when needed |
| Private uploaded PDFs | `backend/storage/app/private/documents/` | Shared storage for the Laravel API and queue worker |

### Compose services

| Compose service | Runtime | Publicly exposed | Persistence |
|---|---|---:|---|
| `nginx` | Nginx and React production build | Yes | Stateless |
| `backend` | PHP-FPM and Laravel | No | Shared private PDF mount |
| `queue` | Laravel queue worker | No | Shared private PDF mount |
| `ai-service` | Uvicorn and FastAPI | Development loopback only | No application state yet |
| `postgres` | PostgreSQL and pgvector | No | `postgres_data` named volume |
| `redis` | Redis with AOF | No | `redis_data` named volume |
| `frontend` | Optional Vite tool container | No | `frontend_node_modules` named volume |

The optional `frontend` Compose profile supports development and tests. In the
default stack, React is built into the Nginx image and served as static files;
there is no production Node server handling browser requests.

## 3. Starting and operating the project

Run commands from the repository root.

### Fresh setup

```bash
make setup
make up
```

`make setup`:

1. Creates `.env` from `.env.example` when missing.
2. Generates a local Laravel `APP_KEY`.
3. Builds the container images.
4. Starts PostgreSQL and Redis.
5. Runs Laravel migrations.

`make up` starts the complete stack in the background and waits for service
health checks.

### Start an existing environment

```bash
make up
```

Equivalent Compose command:

```bash
docker compose up -d --build --wait
```

### Run in the foreground

```bash
make dev
```

### Common operations

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

## 4. Browser paths and application paths

The SPA is deployed below a nested base path. For example:

```text
Browser path:     /demo/support-copilot/api/public/session
Application path: /api/public/session
```

The browser path includes the configured Vite base. The reverse proxy removes
that prefix before Laravel handles the application route.

The route definitions are in
[`backend/routes/api.php`](backend/routes/api.php). The current React API client
is in [`frontend/src/api.ts`](frontend/src/api.ts).

## 5. Implemented endpoints

### 5.1 Public anonymous document API

| Method | Browser path | Application path | Purpose |
|---|---|---|---|
| `GET` | `/demo/support-copilot/api/health` | `/api/health` | Laravel health check |
| `GET` | `/demo/support-copilot/api/public/session` | `/api/public/session` | Create or refresh an anonymous session cookie |
| `GET` | `/demo/support-copilot/api/public/documents` | `/api/public/documents` | List documents owned by the current session and the shared sample |
| `POST` | `/demo/support-copilot/api/public/documents` | `/api/public/documents` | Upload a PDF |
| `GET` | `/demo/support-copilot/api/public/documents/{document}` | `/api/public/documents/{document}` | Return authorized document metadata |
| `GET` | `/demo/support-copilot/api/public/documents/{document}/source` | `/api/public/documents/{document}/source` | Stream the authorized original PDF inline |
| `DELETE` | `/demo/support-copilot/api/public/documents/{document}` | `/api/public/documents/{document}` | Delete an owned document and its source |
| `POST` | `/demo/support-copilot/api/public/documents/{document}/ingestions` | `/api/public/documents/{document}/ingestions` | Send an owned PDF to the internal AI service |
| `GET` | `/demo/support-copilot/sanctum/csrf-cookie` | `/sanctum/csrf-cookie` | Initialize Sanctum CSRF protection before mutations |

#### Upload request

```http
POST /api/public/documents
Accept: application/json
Content-Type: multipart/form-data
X-XSRF-TOKEN: <token from the XSRF-TOKEN cookie>

file=<PDF binary>
```

Upload requirements:

- A valid anonymous session cookie
- Multipart field name `file`
- PDF only
- Maximum size 10 MB
- Detected MIME type `application/pdf`
- File content starts with `%PDF-`

A new upload returns `201 Created`. An identical source already available in
the same anonymous session returns the existing document with `200 OK` and
`meta.duplicate = true`.

#### Ingestion handoff request

The browser sends an empty, CSRF-protected `POST` to Laravel after upload. It
does not send the PDF to FastAPI directly:

```http
POST /api/public/documents/{document}/ingestions
Accept: application/json
X-XSRF-TOKEN: <token from the XSRF-TOKEN cookie>
```

After ownership checks, Laravel sends this internal multipart request:

```text
file=<authorized PDF binary>
document_version_id=<document_versions.id>
checksum=<document_versions.content_checksum>
```

Laravel persists the receipt: each chunk and its embedding vector is inserted
into `chunks` (pgvector) in one transaction, and the document/version status
moves to `ready`. On failure, status moves to `failed` with a safe
`failure_reason` for the client; the raw exception is kept server-side only as
`failure_diagnostic`. The response returns the updated document plus the
ingestion receipt (parser, chunking, and embedding summary; full vectors are
not re-serialized back to the browser).

### 5.2 Administrator API

The Laravel endpoints below exist, but the React `Admin preview` is still a
static product shell. It does not yet provide a login screen or call these
routes.

| Method | Application path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Start an administrator session |
| `GET` | `/api/auth/me` | Return the authenticated administrator |
| `POST` | `/api/auth/logout` | Invalidate the administrator session |
| `GET` | `/api/admin/documents` | List up to 50 documents |
| `PATCH` | `/api/admin/documents/{document}/sample` | Enable or disable a ready shared sample |
| `DELETE` | `/api/admin/documents/{document}` | Delete a document, remove its source, and create an audit event |
| `GET` | `/api/admin/conversations` | List conversations when public chat data exists |
| `GET` | `/api/admin/usage` | Aggregate request, token, and estimated-cost data |

Except for login, all authentication and administrator endpoints require
Sanctum authentication and administrator authorization.

### 5.3 Private FastAPI API

| Method | Internal path | Status |
|---|---|---|
| `GET` | `/health` | Implemented for internal health checks |
| `POST` | `/internal/ingestions` | Receives multipart PDF data; parses, chunks, and embeds it; returns a full receipt (including chunk vectors) for Laravel to persist. FastAPI itself does not write to any database |

FastAPI is not exposed through the public application. Its Swagger UI is
available on a development-only loopback listener at `/docs`. Retrieval and
generation routes have not been implemented or named.

## 6. Current guest flow

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

### 6.1 Opening the demo

1. The base path returns the React application.
2. React calls `GET /api/public/session`.
3. Laravel reads the opaque demo cookie:
   - a valid cookie refreshes the session activity and expiry;
   - a missing or expired cookie creates a random token and stores only its
     SHA-256 hash.
4. Laravel returns an HttpOnly cookie.
5. React calls `GET /api/public/documents` to restore a private document or the
   shared sample.
6. The frontend prefers the newest private document before falling back to the
   shared sample.

### 6.2 Uploading a PDF

1. React performs an early file type and 10 MB size check.
2. React requests `/sanctum/csrf-cookie` and sends `X-XSRF-TOKEN` with the
   mutation.
3. React sends multipart field `file` to `POST /api/public/documents`.
4. Laravel requires a valid anonymous session.
5. Laravel validates the upload, detected MIME type, PDF signature, and size.
6. Laravel calculates a SHA-256 checksum. Identical content in the same session
   reuses the existing document if its source remains available.
7. A new source is stored at:

   ```text
   backend/storage/app/private/documents/<session-id>/<document-id>/<version-id>.pdf
   ```

8. Laravel creates:
   - a `documents` record with `pending_ingestion` status;
   - a version 1 `document_versions` record with `pending` ingestion status.
9. This first request returns before any Python call, so the PDF preview can be
   rendered immediately.

### 6.3 Handing the PDF to FastAPI

1. After upload succeeds, React starts a separate
   `POST /api/public/documents/{document}/ingestions` request.
2. The preview remains available while the second request is in progress.
3. Laravel verifies exact anonymous-session ownership, opens the private PDF,
   and sends it to `POST /internal/ingestions` as multipart data with the
   document-version ID and Laravel checksum.
4. FastAPI reads the source in bounded blocks, verifies the `%PDF-` signature,
   and calculates SHA-256.
5. `pdfplumber` extracts NFKC-normalized text, document metadata, page
   dimensions, ordered lines, character offsets, and line bounding boxes.
6. The line-aware chunker uses the pinned `cl100k_base` tokenizer to create
   stable chunks targeting 650 tokens, capped at 800 tokens, with up to 80
   overlap tokens when the next chunk can still make forward progress.
7. Every chunk includes an ordinal, checksum, token count, source character
   range, page range, and compact page/line source spans. The complete chunk
   set also has a reproducible checksum and versioned configuration.
8. FastAPI sends at most 32 chunk texts per OpenAI Embeddings API request. It
   validates that the provider returns exactly one same-sized vector per chunk
   and returns each vector alongside its chunk ordinal and checksum in
   `embedding_records`.
9. FastAPI does not persist anything itself and does not run OCR in this
   slice; the full receipt — parser output, chunks, and `embedding_records`
   with vectors — travels back to Laravel in the response body.
10. `DocumentIngestionLifecycle::complete()` validates that ordinals and
    checksums line up between `chunking.chunks` and `embedding_records`, then
    inserts each chunk row (including its vector) into `chunks` inside one
    transaction, and moves the document/version to `ready`.
11. On any failure in the FastAPI call or persistence step,
    `DocumentIngestionLifecycle::fail()` moves the document/version to
    `failed`, storing a safe `failure_reason` for the client and the raw
    exception separately as `failure_diagnostic`.
12. The response returns the refreshed document (now `ready` or `failed`)
    together with the receipt. React enables the chat composer once the
    document is `ready`, but submitting a question still shows a static
    "Chat is not connected yet" message — there is no chat endpoint until
    retrieval (stage 6) and generation (stage 7) exist. Chunk `text`/vectors
    are not re-sent to the browser wholesale.

### 6.4 Previewing a PDF

1. React renders an iframe using
   `GET /api/public/documents/{document}/source`.
2. Laravel permits a document owned by the current anonymous session or a
   non-expired shared sample.
3. Laravel reads the private source and returns an inline PDF with
   `Cache-Control: private, no-store`.
4. The browser displays the raw original PDF. Processed blocks, OCR, and
   citation highlighting do not exist yet.

### 6.5 Deleting a PDF

1. React asks for confirmation.
2. React initializes CSRF protection and calls
   `DELETE /api/public/documents/{document}`.
3. Laravel requires exact ownership; a guest cannot delete the shared sample.
4. Laravel soft-deletes the document record and deletes the physical source.
5. React returns to the empty upload state.

### 6.6 Asking a question today

Once ingestion succeeds, the document reaches `ready` and the chat composer
unlocks, but submitting a question only renders a static "Chat is not
connected yet" message. The current application does not yet:

- expose a public chat endpoint;
- create conversations or messages;
- create query embeddings;
- query pgvector for relevant chunks;
- call an answer model;
- stream an answer; or
- create or highlight citations.

Chunks and their vectors are persisted (see [section 6.3](#63-handing-the-pdf-to-fastapi)),
but nothing yet reads them back — that is stage 6 (retrieval).

## 7. Planned retrieval and grounded-answer flow

Ingestion (parsing, chunking, embedding, and persistence) is already
implemented — see [section 6](#6-current-guest-flow). What is still planned is
turning a question into a grounded, cited answer:

```text
Browser (React)
   │  POST <public chat endpoint — route not yet defined, see note below>
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

### Missing endpoints

| Capability | Public or internal endpoint | Status |
|---|---|---|
| Retrieval inspection | — | Not implemented |
| Create or continue a public conversation | — | Not implemented |
| Submit a question and receive a stream | — | API and event contract not defined |
| FastAPI grounded generation | — | Not implemented |
| Restore conversation history | — | Not implemented |
| Submit answer feedback | — | Not implemented |
| Request human handoff | — | Not implemented |
| Redeem an access pass | — | Not implemented |
| Enforce public and access-pass quota | — | Not implemented |

Route names will be defined with their implementation to avoid publishing an
untested contract. The browser will continue to communicate only with Laravel;
FastAPI and model providers remain private.

## 8. Data created by stage

| Stage | Current file or database data | Planned AI data |
|---|---|---|
| Open demo | `anonymous_sessions` | None |
| Upload PDF | Private PDF, `documents`, and `document_versions` | None |
| Ingestion | `chunks` with vectors (pgvector), version/parser/chunking metadata on `document_versions`, and one `usage_events` row | None — already implemented |
| Ask question | Not implemented | `conversations` and user `messages` |
| Generate answer | Not implemented | Assistant `messages`, `message_citations`, and `usage_events` |
| Feedback and handoff | Not implemented | Feedback and conversation support state |

PostgreSQL is the source of truth for application data. The original PDF is
stored on a private Laravel filesystem disk. Redis stores queues, Laravel
sessions, cache, and short-lived state; it is not a source of truth.

## 9. Current implementation snapshot

```text
Implemented
  React upload-first workspace
  anonymous session
  secure PDF upload
  private PDF storage
  document and version metadata
  authorized list, show, preview, and delete
  separate Laravel-to-FastAPI PDF handoff
  FastAPI Swagger and ingestion receipt
  normalized PDF text and page/line structural metadata
  deterministic token-aware chunks with source ranges and checksums
  bounded OpenAI chunk-embedding batches with response validation
  persisted chunks and vectors (pgvector), transactional and re-run-safe
  document/version ready and failed transitions with safe/internal error detail
  static administrator preview
  protected administrator Laravel API

Not implemented
  administrator login UI
  asynchronous ingestion queue job
  OCR for scanned PDFs
  query embeddings
  pgvector retrieval
  grounded generation
  streaming chat
  citations and PDF highlighting
  quota and access passes
  feedback and human handoff
```
