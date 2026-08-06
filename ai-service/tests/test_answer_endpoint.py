import asyncio
from types import SimpleNamespace

from httpx import ASGITransport, AsyncClient

from support_copilot_ai.answer_generator import ModelAnswer
from support_copilot_ai.chunk_retriever import ChunkRow
from support_copilot_ai.main import (
    app,
    get_answer_model_client,
    get_chunk_repository,
    get_document_embedder,
)


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


class StubResponses:
    def __init__(self, parsed: ModelAnswer) -> None:
        self._parsed = parsed

    async def parse(self, **kwargs):
        return SimpleNamespace(
            output_parsed=self._parsed,
            usage=SimpleNamespace(input_tokens=11, output_tokens=4),
        )


class StubOpenAIClient:
    def __init__(self, parsed: ModelAnswer) -> None:
        self.responses = StubResponses(parsed)


def _post_answer(payload: dict):
    async def send():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/internal/answers", json=payload)

    return asyncio.run(send())


def _override(embedder=StubEmbedder, repository=None, client=None):
    app.dependency_overrides[get_document_embedder] = embedder
    if repository is not None:
        app.dependency_overrides[get_chunk_repository] = lambda: repository
    if client is not None:
        app.dependency_overrides[get_answer_model_client] = lambda: client


def _clear_overrides():
    app.dependency_overrides.pop(get_document_embedder, None)
    app.dependency_overrides.pop(get_chunk_repository, None)
    app.dependency_overrides.pop(get_answer_model_client, None)


def test_answer_returns_a_grounded_response_with_citations() -> None:
    row = ChunkRow(
        id="chunk-1",
        ordinal=0,
        page_start=1,
        page_end=1,
        text="Refunds are available within 30 days of purchase.",
        score=0.9,
    )
    _override(
        repository=StubRepository([row]),
        client=StubOpenAIClient(
            ModelAnswer(
                sufficient_evidence=True,
                answer="Refunds are available within 30 days.",
                citation_chunk_ids=["chunk-1"],
            )
        ),
    )

    try:
        response = _post_answer(
            {
                "document_version_id": "01K1EXAMPLEVERSION",
                "query": "What is the refund policy?",
            }
        )
    finally:
        _clear_overrides()

    assert response.status_code == 200
    payload = response.json()
    assert payload["fallback"] is False
    assert payload["answer"] == "Refunds are available within 30 days."
    assert payload["citations"] == [
        {
            "chunk_id": "chunk-1",
            "page_start": 1,
            "page_end": 1,
            "excerpt": "Refunds are available within 30 days of purchase.",
        }
    ]
    assert payload["retrieval"]["evidence_sufficient"] is True


def test_answer_falls_back_when_retrieval_has_no_evidence() -> None:
    _override(
        repository=StubRepository([]),
        client=StubOpenAIClient(
            ModelAnswer(
                sufficient_evidence=True,
                answer="unused",
                citation_chunk_ids=[],
            )
        ),
    )

    try:
        response = _post_answer(
            {
                "document_version_id": "01K1EXAMPLEVERSION",
                "query": "Completely unrelated question?",
            }
        )
    finally:
        _clear_overrides()

    assert response.status_code == 200
    payload = response.json()
    assert payload["fallback"] is True
    assert payload["fallback_reason"] == "no_relevant_chunks"
    assert payload["citations"] == []


def test_answer_rejects_a_blank_query() -> None:
    _override(
        repository=StubRepository([]),
        client=StubOpenAIClient(
            ModelAnswer(
                sufficient_evidence=True,
                answer="unused",
                citation_chunk_ids=[],
            )
        ),
    )

    try:
        response = _post_answer(
            {"document_version_id": "01K1EXAMPLEVERSION", "query": "   "}
        )
    finally:
        _clear_overrides()

    assert response.status_code == 422


def test_answer_reports_service_unavailable_without_a_configured_model() -> None:
    row = ChunkRow(
        id="chunk-1",
        ordinal=0,
        page_start=1,
        page_end=1,
        text="Refunds are available within 30 days of purchase.",
        score=0.9,
    )
    app.dependency_overrides[get_document_embedder] = StubEmbedder
    app.dependency_overrides[get_chunk_repository] = lambda: StubRepository([row])
    # Explicitly override to None: relying on the real environment lacking a
    # model would make this test's outcome depend on how the container
    # happens to be configured, rather than on the endpoint's own behavior.
    app.dependency_overrides[get_answer_model_client] = lambda: None

    try:
        response = _post_answer(
            {"document_version_id": "01K1EXAMPLEVERSION", "query": "question"}
        )
    finally:
        _clear_overrides()

    assert response.status_code == 503
