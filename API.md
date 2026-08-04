# API Reference

This document lists the concrete routes implemented by Support Copilot. All
browser requests are prefixed by the deployed Vite base path:

```text
/demo/support-copilot/
```

For example, the upload route is:

```text
Application path: POST /api/public/documents
Public path:      POST /demo/support-copilot/api/public/documents
```

The route definitions live in [`backend/routes/api.php`](backend/routes/api.php),
and the current React client lives in [`frontend/src/api.ts`](frontend/src/api.ts).

## Guest session

### Start or restore an anonymous session

```http
GET /api/public/session
Accept: application/json
```

Laravel creates or refreshes an opaque HttpOnly demo cookie. The browser sends
this cookie automatically on later document requests.

## Documents

### Upload a PDF

```http
POST /api/public/documents
Accept: application/json
Content-Type: multipart/form-data
X-XSRF-TOKEN: <token from XSRF-TOKEN cookie>

file=<PDF binary>
```

Before the upload, the SPA initializes same-origin CSRF protection:

```http
GET /sanctum/csrf-cookie
```

Upload requirements:

- Valid anonymous session cookie
- Multipart field name: `file`
- PDF only
- Maximum size: 10 MB
- Detected MIME: `application/pdf`
- File signature starts with `%PDF-`

Example response for a new document (`201 Created`):

```json
{
  "data": {
    "id": "01KZ...",
    "display_name": "airline-rules.pdf",
    "source_type": "upload",
    "status": "pending_ingestion",
    "is_sample": false,
    "expires_at": "2026-08-11T08:00:00Z",
    "latest_version": {
      "id": "01KZ...",
      "mime_type": "application/pdf",
      "byte_size": 355864,
      "content_checksum": "sha256-value",
      "ingestion_status": "pending"
    },
    "created_at": "2026-08-04T08:00:00Z"
  },
  "meta": {
    "duplicate": false
  }
}
```

If the same anonymous session uploads identical content again and the private
source still exists, Laravel returns the existing document with `200 OK` and:

```json
{
  "meta": {
    "duplicate": true
  }
}
```

The upload currently stores the original PDF and creates document metadata. It
does not dispatch ingestion or call FastAPI/OpenAI yet.

### List accessible documents

```http
GET /api/public/documents
Accept: application/json
```

Returns non-expired documents owned by the current anonymous session plus any
shared sample document. The list is limited to 20 records.

### Get document metadata

```http
GET /api/public/documents/{document}
Accept: application/json
```

The document must belong to the current anonymous session or be a shared sample.
The React client currently restores documents through the list endpoint rather
than calling this route separately.

### Preview the original PDF

```http
GET /api/public/documents/{document}/source
```

Returns the authorized original source as an inline `application/pdf` response
with private, no-store caching headers. The React source panel uses this URL as
the PDF iframe source.

### Delete an uploaded PDF

```http
DELETE /api/public/documents/{document}
Accept: application/json
X-XSRF-TOKEN: <token from XSRF-TOKEN cookie>
```

Only the owning anonymous session can delete the document. Shared samples cannot
be deleted by a guest. Laravel soft-deletes the record and removes the physical
PDF source.

## Public endpoint summary

| Method | Application path | Implemented | Used by React |
|---|---|---:|---:|
| `GET` | `/api/health` | Yes | No |
| `GET` | `/api/public/session` | Yes | Yes |
| `GET` | `/api/public/documents` | Yes | Yes |
| `POST` | `/api/public/documents` | Yes | Yes |
| `GET` | `/api/public/documents/{document}` | Yes | No |
| `GET` | `/api/public/documents/{document}/source` | Yes | Yes |
| `DELETE` | `/api/public/documents/{document}` | Yes | Yes |
| `GET` | `/sanctum/csrf-cookie` | Yes | Yes, before mutations |

## Administrator API

The Laravel routes exist, but the current `Admin preview` is a static shell and
is not connected to login or these endpoints yet.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Start an administrator session |
| `GET` | `/api/auth/me` | Return the authenticated administrator |
| `POST` | `/api/auth/logout` | Invalidate the administrator session |
| `GET` | `/api/admin/documents` | List documents |
| `PATCH` | `/api/admin/documents/{document}/sample` | Enable or disable a ready shared sample |
| `DELETE` | `/api/admin/documents/{document}` | Delete document sources and record an audit event |
| `GET` | `/api/admin/conversations` | List conversations when chat data exists |
| `GET` | `/api/admin/usage` | Aggregate AI request, token, and estimated-cost records |

Except for login, these routes require Sanctum authentication and administrator
authorization.

## Private FastAPI API

| Method | Path | Implemented | Purpose |
|---|---|---:|---|
| `GET` | `/health` | Yes | Internal health check |

FastAPI is private and is never called directly by the browser.

## API gaps

The following capabilities do not have endpoints yet. Their route names will be
defined when the corresponding implementation establishes a tested contract.

| Capability | Endpoint | Delivery stage |
|---|---|---|
| Dispatch document ingestion | Not implemented | Ingestion pipeline |
| Laravel-to-FastAPI ingestion | Not implemented | Ingestion pipeline |
| Parsed block and chunk inspection | Not implemented | Ingestion/retrieval |
| Retrieval inspection | Not implemented | Retrieval baseline |
| Create or restore public conversation | Not implemented | Streaming chat |
| Submit question and receive answer stream | Not implemented | Streaming chat |
| FastAPI grounded generation | Not implemented | Generation/chat |
| Answer feedback | Not implemented | Feedback and handoff |
| Human handoff | Not implemented | Feedback and handoff |
| Public quota and access-pass redemption | Not implemented | Quota controls |
