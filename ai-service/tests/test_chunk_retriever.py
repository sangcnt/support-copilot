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


class SwitchingEmbedder:
    """Returns a distinct vector per input text, so a retry with a rewritten
    query is distinguishable from the original."""

    def __init__(self, vectors: dict[str, list[float]]) -> None:
        self.calls: list[str] = []
        self._vectors = vectors

    @property
    def model(self) -> str:
        return "text-embedding-3-small"

    @property
    def dimensions(self) -> int:
        return 3

    async def embed_text(self, text: str) -> list[float]:
        self.calls.append(text)
        return self._vectors[text]


class SwitchingRepository:
    """Returns `first_rows` on the first search call and `second_rows` on
    every call after that - simulates a translated query finding real
    matches that the original query's embedding missed."""

    def __init__(
        self,
        first_rows: list[ChunkRow],
        second_rows: list[ChunkRow],
    ) -> None:
        self.first_rows = first_rows
        self.second_rows = second_rows
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
        rows = self.first_rows if len(self.calls) == 1 else self.second_rows
        return rows[:top_k]


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


def test_retrieve_chunks_retries_with_a_translated_query_when_nothing_matches() -> None:
    embedder = SwitchingEmbedder(
        {
            "cụ thể là gì?": [0.1, 0.1, 0.1],
            "what specifically?": [0.9, 0.9, 0.9],
        }
    )
    repository = SwitchingRepository(
        first_rows=[
            ChunkRow(
                id="chunk-1",
                ordinal=0,
                page_start=1,
                page_end=1,
                text="Reference text in English",
                score=0.1,
            )
        ],
        second_rows=[
            ChunkRow(
                id="chunk-1",
                ordinal=0,
                page_start=1,
                page_end=1,
                text="Reference text in English",
                score=0.9,
            )
        ],
    )
    translations: list[tuple[str, str]] = []

    async def translator(query: str, reference_text: str) -> str:
        translations.append((query, reference_text))
        return "what specifically?"

    result = asyncio.run(
        retrieve_chunks(
            embedder=embedder,
            repository=repository,
            document_version_id="version-a",
            query="cụ thể là gì?",
            top_k=5,
            min_score=0.2,
            translator=translator,
        )
    )

    assert result.evidence_sufficient is True
    assert result.chunks[0].score == 0.9
    assert translations == [("cụ thể là gì?", "Reference text in English")]
    assert embedder.calls == ["cụ thể là gì?", "what specifically?"]


def test_retrieve_chunks_does_not_retry_when_translation_is_unchanged() -> None:
    embedder = FakeEmbedder()
    repository = FakeRepository(
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

    async def translator(query: str, reference_text: str) -> str:
        return query

    result = asyncio.run(
        retrieve_chunks(
            embedder=embedder,
            repository=repository,
            document_version_id="version-a",
            query="unrelated question",
            top_k=5,
            min_score=0.2,
            translator=translator,
        )
    )

    assert result.evidence_sufficient is False
    assert len(repository.calls) == 1


def test_retrieve_chunks_keeps_the_original_result_when_the_retry_also_fails() -> None:
    embedder = SwitchingEmbedder(
        {
            "q1": [0.1, 0.1, 0.1],
            "q2": [0.2, 0.2, 0.2],
        }
    )
    repository = SwitchingRepository(
        first_rows=[
            ChunkRow(
                id="chunk-1",
                ordinal=0,
                page_start=1,
                page_end=1,
                text="ref",
                score=0.05,
            )
        ],
        second_rows=[
            ChunkRow(
                id="chunk-2",
                ordinal=1,
                page_start=2,
                page_end=2,
                text="ref2",
                score=0.1,
            )
        ],
    )

    async def translator(query: str, reference_text: str) -> str:
        return "q2"

    result = asyncio.run(
        retrieve_chunks(
            embedder=embedder,
            repository=repository,
            document_version_id="version-a",
            query="q1",
            top_k=5,
            min_score=0.2,
            translator=translator,
        )
    )

    assert result.evidence_sufficient is False
    assert result.chunks == []


def test_retrieve_chunks_skips_translation_when_there_are_no_candidate_rows() -> None:
    embedder = FakeEmbedder()
    repository = FakeRepository([])
    translator_called = False

    async def translator(query: str, reference_text: str) -> str:
        nonlocal translator_called
        translator_called = True
        return "translated"

    result = asyncio.run(
        retrieve_chunks(
            embedder=embedder,
            repository=repository,
            document_version_id="version-a",
            query="anything",
            top_k=5,
            min_score=0.2,
            translator=translator,
        )
    )

    assert result.evidence_sufficient is False
    assert translator_called is False
