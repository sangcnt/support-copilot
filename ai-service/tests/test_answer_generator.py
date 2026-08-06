import asyncio
from types import SimpleNamespace

import pytest

from support_copilot_ai.answer_generator import (
    FALLBACK_ANSWER,
    GenerationError,
    ModelAnswer,
    generate_answer,
)
from support_copilot_ai.chunk_retriever import ChunkRow


class FakeEmbedder:
    @property
    def model(self) -> str:
        return "text-embedding-3-small"

    @property
    def dimensions(self) -> int:
        return 3

    async def embed_text(self, text: str) -> list[float]:
        return [0.1, 0.2, 0.3]


class FakeRepository:
    def __init__(self, rows: list[ChunkRow]) -> None:
        self.rows = rows

    async def search(self, *, document_version_id, query_vector, top_k):
        return self.rows[:top_k]


class FakeResponsesResource:
    def __init__(self, parsed: ModelAnswer | Exception) -> None:
        self.calls: list[dict] = []
        self._parsed = parsed

    async def parse(self, **kwargs):
        self.calls.append(kwargs)

        if isinstance(self._parsed, Exception):
            raise self._parsed

        return SimpleNamespace(
            output_parsed=self._parsed,
            usage=SimpleNamespace(input_tokens=42, output_tokens=7),
        )


class FakeClient:
    def __init__(self, parsed: ModelAnswer | Exception) -> None:
        self.responses = FakeResponsesResource(parsed)


def relevant_row(chunk_id: str = "chunk-1") -> ChunkRow:
    return ChunkRow(
        id=chunk_id,
        ordinal=0,
        page_start=1,
        page_end=1,
        text="Refunds are available within 30 days of purchase, in full.",
        score=0.9,
    )


def test_generate_answer_skips_the_model_when_retrieval_has_no_evidence() -> None:
    client = FakeClient(
        parsed=ModelAnswer(
            sufficient_evidence=True, answer="unused", citation_chunk_ids=[]
        )
    )
    repository = FakeRepository([])

    result = asyncio.run(
        generate_answer(
            client=client,
            chat_model="gpt-test",
            embedder=FakeEmbedder(),
            repository=repository,
            document_version_id="version-a",
            query="What is the refund policy?",
            top_k=5,
            min_score=0.2,
        )
    )

    assert result.fallback is True
    assert result.fallback_reason == "no_relevant_chunks"
    assert result.answer == FALLBACK_ANSWER
    assert result.citations == []
    assert client.responses.calls == []


def test_generate_answer_returns_a_grounded_answer_with_server_excerpt() -> None:
    row = relevant_row()
    client = FakeClient(
        parsed=ModelAnswer(
            sufficient_evidence=True,
            answer="Refunds are available within 30 days.",
            citation_chunk_ids=["chunk-1"],
        )
    )
    repository = FakeRepository([row])

    result = asyncio.run(
        generate_answer(
            client=client,
            chat_model="gpt-test",
            embedder=FakeEmbedder(),
            repository=repository,
            document_version_id="version-a",
            query="What is the refund policy?",
            top_k=5,
            min_score=0.2,
        )
    )

    assert result.fallback is False
    assert result.answer == "Refunds are available within 30 days."
    assert len(result.citations) == 1
    assert result.citations[0].chunk_id == "chunk-1"
    # The excerpt must come from stored chunk text, not anything the model
    # supplied - the fake model only ever returns a chunk id, never text.
    assert result.citations[0].excerpt == row.text
    assert result.citations[0].page_start == 1
    assert result.input_tokens == 42
    assert result.output_tokens == 7


def test_generate_answer_drops_citations_not_in_the_retrieved_set() -> None:
    client = FakeClient(
        parsed=ModelAnswer(
            sufficient_evidence=True,
            answer="A confident-sounding but unsupported answer.",
            citation_chunk_ids=["chunk-does-not-exist"],
        )
    )
    repository = FakeRepository([relevant_row()])

    result = asyncio.run(
        generate_answer(
            client=client,
            chat_model="gpt-test",
            embedder=FakeEmbedder(),
            repository=repository,
            document_version_id="version-a",
            query="What is the refund policy?",
            top_k=5,
            min_score=0.2,
        )
    )

    assert result.fallback is True
    assert result.fallback_reason == "no_valid_citations"
    assert result.answer == FALLBACK_ANSWER
    assert result.citations == []


def test_generate_answer_respects_a_model_reported_abstention() -> None:
    client = FakeClient(
        parsed=ModelAnswer(
            sufficient_evidence=False,
            answer="I think it might be 30 days but I am not sure.",
            citation_chunk_ids=[],
        )
    )
    repository = FakeRepository([relevant_row()])

    result = asyncio.run(
        generate_answer(
            client=client,
            chat_model="gpt-test",
            embedder=FakeEmbedder(),
            repository=repository,
            document_version_id="version-a",
            query="What is the refund policy?",
            top_k=5,
            min_score=0.2,
        )
    )

    assert result.fallback is True
    assert result.fallback_reason == "model_reported_insufficient_evidence"
    # The fixed fallback message is used, not the model's own uncertain text.
    assert result.answer == FALLBACK_ANSWER


def test_generate_answer_wraps_provider_failures() -> None:
    client = FakeClient(parsed=RuntimeError("boom"))
    repository = FakeRepository([relevant_row()])

    with pytest.raises(GenerationError):
        asyncio.run(
            generate_answer(
                client=client,
                chat_model="gpt-test",
                embedder=FakeEmbedder(),
                repository=repository,
                document_version_id="version-a",
                query="What is the refund policy?",
                top_k=5,
                min_score=0.2,
            )
        )
