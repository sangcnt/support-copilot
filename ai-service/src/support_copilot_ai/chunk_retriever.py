import unicodedata
from dataclasses import dataclass
from typing import Protocol

from pydantic import BaseModel

from support_copilot_ai.document_embedder import DocumentEmbedder

RETRIEVAL_SQL = """
    SELECT
        id,
        ordinal,
        page_number,
        page_end,
        normalized_text,
        1 - (embedding <=> $1::vector) AS score
    FROM chunks
    WHERE document_version_id = $2
      AND embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $3
"""


class RetrievalError(RuntimeError):
    """Raised when the retrieval store cannot be queried safely."""


@dataclass(frozen=True)
class ChunkRow:
    id: str
    ordinal: int
    page_start: int | None
    page_end: int | None
    text: str
    score: float


class ChunkRepository(Protocol):
    """Reads document-scoped chunks ranked by vector similarity."""

    async def search(
        self,
        *,
        document_version_id: str,
        query_vector: list[float],
        top_k: int,
    ) -> list[ChunkRow]: ...


class AsyncpgChunkRepository:
    """Exact cosine search over `chunks.embedding` using pgvector."""

    def __init__(self, pool) -> None:  # noqa: ANN001 - asyncpg.Pool, optional dep
        self._pool = pool

    async def search(
        self,
        *,
        document_version_id: str,
        query_vector: list[float],
        top_k: int,
    ) -> list[ChunkRow]:
        vector_literal = "[" + ",".join(repr(value) for value in query_vector) + "]"

        try:
            async with self._pool.acquire() as connection:
                rows = await connection.fetch(
                    RETRIEVAL_SQL,
                    vector_literal,
                    document_version_id,
                    top_k,
                )
        except Exception as exception:
            raise RetrievalError("The retrieval store query failed.") from exception

        return [
            ChunkRow(
                id=row["id"],
                ordinal=row["ordinal"],
                page_start=row["page_number"],
                page_end=row["page_end"],
                text=row["normalized_text"],
                score=float(row["score"]),
            )
            for row in rows
        ]


class RetrievedChunk(BaseModel):
    chunk_id: str
    ordinal: int
    page_start: int | None
    page_end: int | None
    text: str
    score: float


class RetrievalResult(BaseModel):
    document_version_id: str
    query: str
    model: str
    dimensions: int
    top_k: int
    min_score: float
    evidence_sufficient: bool
    chunks: list[RetrievedChunk]


def normalize_query(text: str) -> str:
    """Apply the same NFKC + whitespace-collapse normalization used for
    parsed PDF text, so query and chunk text are treated consistently."""

    normalized = unicodedata.normalize("NFKC", text).replace("\x00", "")
    return " ".join(normalized.split())


async def retrieve_chunks(
    *,
    embedder: DocumentEmbedder,
    repository: ChunkRepository,
    document_version_id: str,
    query: str,
    top_k: int,
    min_score: float,
) -> RetrievalResult:
    """Embed a query and return document-scoped chunks above a relevance
    threshold. The caller is responsible for resolving `document_version_id`
    to the document's active version; every result is scoped to exactly that
    version, never across documents or versions."""

    normalized_query = normalize_query(query)
    query_vector = await embedder.embed_text(normalized_query)

    rows = await repository.search(
        document_version_id=document_version_id,
        query_vector=query_vector,
        top_k=top_k,
    )

    relevant = [row for row in rows if row.score >= min_score]

    return RetrievalResult(
        document_version_id=document_version_id,
        query=normalized_query,
        model=embedder.model,
        dimensions=embedder.dimensions,
        top_k=top_k,
        min_score=min_score,
        evidence_sufficient=len(relevant) > 0,
        chunks=[
            RetrievedChunk(
                chunk_id=row.id,
                ordinal=row.ordinal,
                page_start=row.page_start,
                page_end=row.page_end,
                text=row.text,
                score=row.score,
            )
            for row in relevant
        ],
    )
