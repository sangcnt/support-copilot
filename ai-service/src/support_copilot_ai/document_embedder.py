from collections.abc import Iterator, Sequence
from typing import Any

from openai import AsyncOpenAI
from pydantic import BaseModel

from support_copilot_ai.document_chunker import ChunkedDocument, DocumentChunk

DEFAULT_EMBEDDING_BATCH_SIZE = 32


class DocumentEmbeddingError(RuntimeError):
    """Raised when embeddings cannot be generated or validated safely."""


class ChunkEmbedding(BaseModel):
    chunk_ordinal: int
    chunk_checksum: str
    vector: list[float]


class EmbeddedDocument(BaseModel):
    provider: str
    model: str
    batch_size: int
    batch_count: int
    embedding_count: int
    dimensions: int
    input_tokens: int
    embeddings: list[ChunkEmbedding]


class EmbeddingSummary(BaseModel):
    provider: str
    model: str
    batch_size: int
    batch_count: int
    embedding_count: int
    dimensions: int
    input_tokens: int

    @classmethod
    def from_document(cls, document: EmbeddedDocument) -> "EmbeddingSummary":
        return cls(**document.model_dump(exclude={"embeddings"}))


class DocumentEmbedder:
    """Create one embedding per chunk using bounded OpenAI API batches."""

    def __init__(
        self,
        client: AsyncOpenAI | Any,
        model: str,
        batch_size: int = DEFAULT_EMBEDDING_BATCH_SIZE,
    ) -> None:
        if not model.strip():
            raise ValueError("An embedding model is required.")

        if batch_size < 1:
            raise ValueError("Embedding batch size must be at least one.")

        self._client = client
        self._model = model
        self._batch_size = batch_size

    async def embed(self, document: ChunkedDocument) -> EmbeddedDocument:
        if not document.chunks:
            return EmbeddedDocument(
                provider="openai",
                model=self._model,
                batch_size=self._batch_size,
                batch_count=0,
                embedding_count=0,
                dimensions=0,
                input_tokens=0,
                embeddings=[],
            )

        embeddings: list[ChunkEmbedding] = []
        dimensions: int | None = None
        input_tokens = 0
        batch_count = 0

        for batch in self._batches(document.chunks):
            try:
                response = await self._client.embeddings.create(
                    model=self._model,
                    input=[chunk.text for chunk in batch],
                    encoding_format="float",
                )
            except Exception as exception:
                raise DocumentEmbeddingError(
                    "The embedding provider request failed."
                ) from exception

            ordered_data = sorted(response.data, key=lambda item: item.index)

            if [item.index for item in ordered_data] != list(range(len(batch))):
                raise DocumentEmbeddingError(
                    "The embedding provider returned an incomplete batch."
                )

            batch_count += 1
            input_tokens += response.usage.total_tokens

            for chunk, item in zip(batch, ordered_data, strict=True):
                current_dimensions = len(item.embedding)

                if current_dimensions == 0:
                    raise DocumentEmbeddingError(
                        "The embedding provider returned an empty vector."
                    )

                if dimensions is None:
                    dimensions = current_dimensions
                elif current_dimensions != dimensions:
                    raise DocumentEmbeddingError(
                        "The embedding provider returned inconsistent dimensions."
                    )

                embeddings.append(
                    ChunkEmbedding(
                        chunk_ordinal=chunk.ordinal,
                        chunk_checksum=chunk.checksum,
                        vector=item.embedding,
                    )
                )

        return EmbeddedDocument(
            provider="openai",
            model=self._model,
            batch_size=self._batch_size,
            batch_count=batch_count,
            embedding_count=len(embeddings),
            dimensions=dimensions or 0,
            input_tokens=input_tokens,
            embeddings=embeddings,
        )

    def _batches(
        self,
        chunks: Sequence[DocumentChunk],
    ) -> Iterator[Sequence[DocumentChunk]]:
        for offset in range(0, len(chunks), self._batch_size):
            yield chunks[offset : offset + self._batch_size]
