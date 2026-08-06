import asyncio

from support_copilot_ai.chunk_retriever import (
    ChunkRow,
    normalize_query,
    retrieve_chunks,
)


class FakeEmbedder:
    def __init__(self, vector: list[float] | None = None) -> None:
        self.calls: list[str] = []
        self._vector = vector or [0.1, 0.2, 0.3]

    @property
    def model(self) -> str:
        return "text-embedding-3-small"

    @property
    def dimensions(self) -> int:
        return len(self._vector)

    async def embed_text(self, text: str) -> list[float]:
        self.calls.append(text)
        return self._vector


class FakeRepository:
    def __init__(self, rows: list[ChunkRow]) -> None:
        self.rows = rows
        self.calls: list[dict] = []

    async def search(
        self,
        *,
        document_version_id: str,
        query_vector: list[float],
        top_k: int,
    ) -> list[ChunkRow]:
        self.calls.append(
            {
                "document_version_id": document_version_id,
                "query_vector": query_vector,
                "top_k": top_k,
            }
        )
        return self.rows[:top_k]


def test_normalize_query_collapses_whitespace_and_applies_nfkc() -> None:
    assert normalize_query("  What   is\tthe\n refund  policy?  ") == (
        "What is the refund policy?"
    )
    assert normalize_query("café") == "café"


def test_retrieve_chunks_scopes_search_to_the_given_document_version() -> None:
    embedder = FakeEmbedder()
    repository = FakeRepository(
        [
            ChunkRow(
                id="chunk-1",
                ordinal=0,
                page_start=1,
                page_end=1,
                text="x",
                score=0.9,
            )
        ]
    )

    result = asyncio.run(
        retrieve_chunks(
            embedder=embedder,
            repository=repository,
            document_version_id="version-a",
            query="refund policy",
            top_k=5,
            min_score=0.2,
        )
    )

    assert repository.calls == [
        {
            "document_version_id": "version-a",
            "query_vector": [0.1, 0.2, 0.3],
            "top_k": 5,
        }
    ]
    assert result.document_version_id == "version-a"
    assert embedder.calls == ["refund policy"]


def test_retrieve_chunks_returns_evidence_above_threshold() -> None:
    embedder = FakeEmbedder()
    repository = FakeRepository(
        [
            ChunkRow(
                id="chunk-1",
                ordinal=0,
                page_start=1,
                page_end=1,
                text="Refund text",
                score=0.83,
            ),
            ChunkRow(
                id="chunk-2",
                ordinal=1,
                page_start=2,
                page_end=2,
                text="Unrelated",
                score=0.05,
            ),
        ]
    )

    result = asyncio.run(
        retrieve_chunks(
            embedder=embedder,
            repository=repository,
            document_version_id="version-a",
            query="What is the refund policy?",
            top_k=5,
            min_score=0.2,
        )
    )

    assert result.evidence_sufficient is True
    assert [chunk.chunk_id for chunk in result.chunks] == ["chunk-1"]
    assert result.chunks[0].score == 0.83


def test_retrieve_chunks_reports_insufficient_evidence_below_threshold() -> None:
    embedder = FakeEmbedder()
    repository = FakeRepository(
        [
            ChunkRow(
                id="chunk-1",
                ordinal=0,
                page_start=1,
                page_end=1,
                text="x",
                score=0.1,
            )
        ]
    )

    result = asyncio.run(
        retrieve_chunks(
            embedder=embedder,
            repository=repository,
            document_version_id="version-a",
            query="unrelated adversarial question",
            top_k=5,
            min_score=0.2,
        )
    )

    assert result.evidence_sufficient is False
    assert result.chunks == []
