import asyncio
from types import SimpleNamespace

import pytest

from support_copilot_ai.document_chunker import (
    ChunkedDocument,
    DocumentChunk,
)
from support_copilot_ai.document_embedder import (
    DocumentEmbedder,
    DocumentEmbeddingError,
)


class FakeEmbeddingsResource:
    def __init__(self, incomplete: bool = False) -> None:
        self.calls: list[dict] = []
        self.incomplete = incomplete

    async def create(self, **request):
        self.calls.append(request)
        batch_number = len(self.calls)
        data = [
            SimpleNamespace(
                index=index,
                embedding=[float(batch_number), float(index), 0.5],
            )
            for index, _text in enumerate(request["input"])
        ]

        if self.incomplete:
            data = data[:-1]

        return SimpleNamespace(
            data=list(reversed(data)),
            usage=SimpleNamespace(total_tokens=len(request["input"]) * 10),
        )


class FakeOpenAIClient:
    def __init__(self, incomplete: bool = False) -> None:
        self.embeddings = FakeEmbeddingsResource(incomplete=incomplete)


def chunked_document(chunk_count: int) -> ChunkedDocument:
    chunks = [
        DocumentChunk(
            ordinal=ordinal,
            checksum=f"{ordinal:064x}",
            text=f"Chunk text {ordinal}",
            token_count=3,
            character_count=12,
            page_start=1,
            page_end=1,
            source_text_start=ordinal * 12,
            source_text_end=(ordinal + 1) * 12,
            source_spans=[],
        )
        for ordinal in range(chunk_count)
    ]

    return ChunkedDocument(
        chunker_version="test-v1",
        tokenizer="cl100k_base",
        min_tokens=1,
        target_tokens=2,
        max_tokens=3,
        overlap_tokens=0,
        chunk_count=chunk_count,
        checksum="f" * 64,
        chunks=chunks,
    )


def test_embedder_batches_chunks_and_preserves_chunk_identity() -> None:
    client = FakeOpenAIClient()
    embedder = DocumentEmbedder(
        client=client,
        model="text-embedding-3-small",
        batch_size=2,
    )

    result = asyncio.run(embedder.embed(chunked_document(5)))

    assert [len(call["input"]) for call in client.embeddings.calls] == [2, 2, 1]
    assert all(
        call["model"] == "text-embedding-3-small" for call in client.embeddings.calls
    )
    assert all(call["encoding_format"] == "float" for call in client.embeddings.calls)
    assert result.batch_count == 3
    assert result.embedding_count == 5
    assert result.dimensions == 3
    assert result.input_tokens == 50
    assert [item.chunk_ordinal for item in result.embeddings] == list(range(5))
    assert [item.chunk_checksum for item in result.embeddings] == [
        f"{ordinal:064x}" for ordinal in range(5)
    ]


def test_embedder_rejects_an_incomplete_provider_batch() -> None:
    embedder = DocumentEmbedder(
        client=FakeOpenAIClient(incomplete=True),
        model="text-embedding-3-small",
        batch_size=2,
    )

    with pytest.raises(
        DocumentEmbeddingError,
        match="returned an incomplete batch",
    ):
        asyncio.run(embedder.embed(chunked_document(2)))


def test_embedder_skips_provider_for_an_empty_document() -> None:
    client = FakeOpenAIClient()
    embedder = DocumentEmbedder(
        client=client,
        model="text-embedding-3-small",
        batch_size=2,
    )

    result = asyncio.run(embedder.embed(chunked_document(0)))

    assert client.embeddings.calls == []
    assert result.batch_count == 0
    assert result.embedding_count == 0
    assert result.dimensions == 0
    assert result.embeddings == []
