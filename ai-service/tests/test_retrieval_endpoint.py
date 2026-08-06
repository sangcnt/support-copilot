import asyncio

from fastapi import HTTPException, status
from httpx import ASGITransport, AsyncClient

from support_copilot_ai.chunk_retriever import ChunkRow
from support_copilot_ai.main import app, get_chunk_repository, get_document_embedder


class StubEmbedder:
    @property
    def model(self) -> str:
        return "text-embedding-3-small"

    @property
    def dimensions(self) -> int:
        return 3

    async def embed_text(self, text: str) -> list[float]:
        return [0.1, 0.2, 0.3]


class StubRepository:
    def __init__(self, rows: list[ChunkRow]) -> None:
        self.rows = rows

    async def search(self, *, document_version_id, query_vector, top_k):
        return self.rows[:top_k]


def _post_retrieval(payload: dict) -> "asyncio.Future":
    async def send() -> object:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/internal/retrieval", json=payload)

    return asyncio.run(send())


def test_retrieval_returns_ranked_chunks_above_threshold() -> None:
    app.dependency_overrides[get_document_embedder] = StubEmbedder
    app.dependency_overrides[get_chunk_repository] = lambda: StubRepository(
        [
            ChunkRow(
                id="chunk-1",
                ordinal=0,
                page_start=1,
                page_end=1,
                text="Refund policy text",
                score=0.87,
            ),
            ChunkRow(
                id="chunk-2",
                ordinal=1,
                page_start=3,
                page_end=3,
                text="Unrelated text",
                score=0.01,
            ),
        ]
    )

    try:
        response = _post_retrieval(
            {
                "document_version_id": "01K1EXAMPLEVERSION",
                "query": "What is the refund policy?",
            }
        )
    finally:
        app.dependency_overrides.pop(get_document_embedder, None)
        app.dependency_overrides.pop(get_chunk_repository, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["document_version_id"] == "01K1EXAMPLEVERSION"
    assert payload["evidence_sufficient"] is True
    assert [chunk["chunk_id"] for chunk in payload["chunks"]] == ["chunk-1"]
    assert payload["top_k"] == 5
    assert payload["min_score"] == 0.2


def test_retrieval_reports_insufficient_evidence_for_unsupported_question() -> None:
    app.dependency_overrides[get_document_embedder] = StubEmbedder
    app.dependency_overrides[get_chunk_repository] = lambda: StubRepository(
        [
            ChunkRow(
                id="chunk-1",
                ordinal=0,
                page_start=1,
                page_end=1,
                text="x",
                score=0.05,
            )
        ]
    )

    try:
        response = _post_retrieval(
            {
                "document_version_id": "01K1EXAMPLEVERSION",
                "query": "Completely unrelated adversarial question?",
            }
        )
    finally:
        app.dependency_overrides.pop(get_document_embedder, None)
        app.dependency_overrides.pop(get_chunk_repository, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["evidence_sufficient"] is False
    assert payload["chunks"] == []


def test_retrieval_accepts_a_custom_top_k_and_min_score() -> None:
    app.dependency_overrides[get_document_embedder] = StubEmbedder
    app.dependency_overrides[get_chunk_repository] = lambda: StubRepository(
        [
            ChunkRow(
                id="chunk-1",
                ordinal=0,
                page_start=1,
                page_end=1,
                text="a",
                score=0.9,
            ),
            ChunkRow(
                id="chunk-2",
                ordinal=1,
                page_start=2,
                page_end=2,
                text="b",
                score=0.6,
            ),
        ]
    )

    try:
        response = _post_retrieval(
            {
                "document_version_id": "01K1EXAMPLEVERSION",
                "query": "question",
                "top_k": 1,
                "min_score": 0.5,
            }
        )
    finally:
        app.dependency_overrides.pop(get_document_embedder, None)
        app.dependency_overrides.pop(get_chunk_repository, None)

    payload = response.json()
    assert payload["top_k"] == 1
    assert payload["min_score"] == 0.5
    assert len(payload["chunks"]) == 1


def test_retrieval_rejects_a_blank_query() -> None:
    app.dependency_overrides[get_document_embedder] = StubEmbedder
    app.dependency_overrides[get_chunk_repository] = lambda: StubRepository([])

    try:
        response = _post_retrieval(
            {"document_version_id": "01K1EXAMPLEVERSION", "query": "   "}
        )
    finally:
        app.dependency_overrides.pop(get_document_embedder, None)
        app.dependency_overrides.pop(get_chunk_repository, None)

    assert response.status_code == 422


def test_retrieval_reports_service_unavailable_without_a_configured_store() -> None:
    def unconfigured_repository():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The retrieval store is not configured.",
        )

    app.dependency_overrides[get_document_embedder] = StubEmbedder
    app.dependency_overrides[get_chunk_repository] = unconfigured_repository

    try:
        response = _post_retrieval(
            {"document_version_id": "01K1EXAMPLEVERSION", "query": "question"}
        )
    finally:
        app.dependency_overrides.pop(get_document_embedder, None)
        app.dependency_overrides.pop(get_chunk_repository, None)

    assert response.status_code == 503
