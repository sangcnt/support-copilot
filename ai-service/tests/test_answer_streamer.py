import asyncio
from types import SimpleNamespace

import pytest

from support_copilot_ai.answer_streamer import (
    FALLBACK_ANSWER,
    CitationSelection,
    StreamError,
    stream_answer,
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


class FakeDeltaEvent:
    def __init__(self, delta: str) -> None:
        self.type = "response.output_text.delta"
        self.delta = delta


class FakeCompletedEvent:
    def __init__(self, input_tokens: int, output_tokens: int) -> None:
        self.type = "response.completed"
        self.response = SimpleNamespace(
            usage=SimpleNamespace(
                input_tokens=input_tokens, output_tokens=output_tokens
            )
        )


class FakeFailedEvent:
    def __init__(self) -> None:
        self.type = "response.failed"


class FakeResponseStream:
    def __init__(self, events: list) -> None:
        self._events = events

    def __aiter__(self):
        return self._generator()

    async def _generator(self):
        for event in self._events:
            yield event


class FakeResponses:
    def __init__(
        self,
        stream_events: list | Exception,
        citation_ids: list[str] | None = None,
    ) -> None:
        self._stream_events = stream_events
        self._citation_ids = citation_ids if citation_ids is not None else []
        self.create_calls: list[dict] = []
        self.parse_calls: list[dict] = []

    async def create(self, **kwargs):
        self.create_calls.append(kwargs)

        if isinstance(self._stream_events, Exception):
            raise self._stream_events

        return FakeResponseStream(self._stream_events)

    async def parse(self, **kwargs):
        self.parse_calls.append(kwargs)
        return SimpleNamespace(
            output_parsed=CitationSelection(citation_chunk_ids=self._citation_ids)
        )


class FakeClient:
    def __init__(
        self,
        stream_events: list | Exception,
        citation_ids: list[str] | None = None,
    ) -> None:
        self.responses = FakeResponses(stream_events, citation_ids)


def relevant_row(chunk_id: str = "chunk-1") -> ChunkRow:
    return ChunkRow(
        id=chunk_id,
        ordinal=0,
        page_start=1,
        page_end=1,
        text="Refunds are available within 30 days of purchase.",
        score=0.9,
    )


async def _collect(generator) -> list:
    return [event async for event in generator]


def test_stream_answer_skips_the_model_when_retrieval_has_no_evidence() -> None:
    client = FakeClient(stream_events=[])
    events = asyncio.run(
        _collect(
            stream_answer(
                client=client,
                chat_model="gpt-test",
                embedder=FakeEmbedder(),
                repository=FakeRepository([]),
                document_version_id="version-a",
                query="What is the refund policy?",
                top_k=5,
                min_score=0.2,
            )
        )
    )

    names = [event.event for event in events]
    assert names == ["started", "retrieval", "completed"]
    assert events[1].data["evidence_sufficient"] is False
    assert events[2].data == {
        "fallback": True,
        "fallback_reason": "no_relevant_chunks",
        "answer": FALLBACK_ANSWER,
        "citations": [],
        "model": "gpt-test",
        "input_tokens": 0,
        "output_tokens": 0,
        "latency_ms": 0,
    }
    assert client.responses.create_calls == []


def test_stream_answer_streams_tokens_and_resolves_citations() -> None:
    client = FakeClient(
        stream_events=[
            FakeDeltaEvent("Refunds"),
            FakeDeltaEvent(" are available."),
            FakeCompletedEvent(input_tokens=40, output_tokens=6),
        ],
        citation_ids=["chunk-1"],
    )

    events = asyncio.run(
        _collect(
            stream_answer(
                client=client,
                chat_model="gpt-test",
                embedder=FakeEmbedder(),
                repository=FakeRepository([relevant_row()]),
                document_version_id="version-a",
                query="What is the refund policy?",
                top_k=5,
                min_score=0.2,
            )
        )
    )

    names = [event.event for event in events]
    assert names == [
        "started",
        "retrieval",
        "token",
        "token",
        "citations",
        "usage",
        "completed",
    ]

    token_text = "".join(
        event.data["text"] for event in events if event.event == "token"
    )
    assert token_text == "Refunds are available."

    completed = events[-1].data
    assert completed["fallback"] is False
    assert completed["answer"] == "Refunds are available."
    assert completed["model"] == "gpt-test"
    assert completed["citations"] == [
        {
            "chunk_id": "chunk-1",
            "page_start": 1,
            "page_end": 1,
            "excerpt": "Refunds are available within 30 days of purchase.",
            "score": 0.9,
        }
    ]
    assert completed["input_tokens"] == 40
    assert completed["output_tokens"] == 6


def test_stream_answer_drops_citations_not_in_the_retrieved_set() -> None:
    client = FakeClient(
        stream_events=[
            FakeDeltaEvent("Some answer."),
            FakeCompletedEvent(input_tokens=10, output_tokens=3),
        ],
        citation_ids=["chunk-does-not-exist"],
    )

    events = asyncio.run(
        _collect(
            stream_answer(
                client=client,
                chat_model="gpt-test",
                embedder=FakeEmbedder(),
                repository=FakeRepository([relevant_row()]),
                document_version_id="version-a",
                query="question",
                top_k=5,
                min_score=0.2,
            )
        )
    )

    completed = events[-1].data
    # The streamed answer text is preserved even without valid citations -
    # unlike the non-streaming path, already-streamed text is never erased.
    assert completed["fallback"] is False
    assert completed["answer"] == "Some answer."
    assert completed["citations"] == []


def test_stream_answer_raises_on_provider_failure() -> None:
    client = FakeClient(stream_events=RuntimeError("boom"))

    async def run():
        async for _ in stream_answer(
            client=client,
            chat_model="gpt-test",
            embedder=FakeEmbedder(),
            repository=FakeRepository([relevant_row()]),
            document_version_id="version-a",
            query="question",
            top_k=5,
            min_score=0.2,
        ):
            pass

    with pytest.raises(StreamError):
        asyncio.run(run())


def test_stream_answer_citation_failure_yields_empty_citations_not_an_error() -> None:
    class FailingResponses(FakeResponses):
        async def parse(self, **kwargs):
            raise RuntimeError("citation model unavailable")

    client = FakeClient(
        stream_events=[
            FakeDeltaEvent("An answer."),
            FakeCompletedEvent(input_tokens=5, output_tokens=2),
        ]
    )
    client.responses = FailingResponses(client.responses._stream_events)

    events = asyncio.run(
        _collect(
            stream_answer(
                client=client,
                chat_model="gpt-test",
                embedder=FakeEmbedder(),
                repository=FakeRepository([relevant_row()]),
                document_version_id="version-a",
                query="question",
                top_k=5,
                min_score=0.2,
            )
        )
    )

    completed = events[-1].data
    assert completed["answer"] == "An answer."
    assert completed["citations"] == []
