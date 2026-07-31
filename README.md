# Support Copilot

A production-oriented, citation-aware AI support assistant built as a public
portfolio project.

## Product overview

Support Copilot turns an uploaded product or policy PDF into a temporary
document session. A visitor can review the source PDF beside the conversation,
ask questions, and inspect the exact passages used to produce each answer.

The project is designed to demonstrate more than a basic LLM integration:
document ingestion, grounded retrieval, verifiable citations, safe fallback,
quota controls, asynchronous processing, and operational visibility are all
part of the product boundary.

## Planned capabilities

- Public, no-sign-up PDF assistant
- Processed document preview with highlighted answer references
- Grounded, streaming answers with validated citations
- Honest fallback when the knowledge base lacks sufficient evidence
- Global public demo quota and higher-quota access passes
- Temporary document/session lifecycle and administrator cleanup
- Feedback, usage, latency, and estimated cost reporting
- Retrieval and answer-quality evaluation

## Architecture

The browser communicates with a Laravel business API. Laravel owns anonymous
sessions, document authorization, quota enforcement, storage, queues, and
application records. A private FastAPI service owns document processing and
the AI workflow. PostgreSQL stores application data and vector embeddings,
while Redis supports queues and short-lived state.

## Technology baseline

- React 19.2, TypeScript 6, and Vite 8.2
- PHP 8.5 and Laravel 13
- Python 3.13 and FastAPI
- PostgreSQL 18 with pgvector 0.8.2
- Redis 8.4
- Nginx and Docker Compose
- OpenAI behind an application-level provider boundary

## Project status

The repository foundation, public product shell, core Laravel domain model,
anonymous document ownership, administrator API, automated checks, and live
container topology are in place. Secure upload, ingestion, retrieval, and live
chat are being delivered incrementally.

## Live demo

The development preview is available at
[sangcnt.online/demo/support-copilot](https://sangcnt.online/demo/support-copilot/).
