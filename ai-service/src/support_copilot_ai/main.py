import asyncio
import hashlib
import logging
from functools import lru_cache
from typing import Annotated, Literal

import asyncpg
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from openai import AsyncOpenAI
from pydantic import BaseModel

from support_copilot_ai.chunk_retriever import (
    AsyncpgChunkRepository,
    ChunkRepository,
    RetrievalError,
    RetrievalResult,
    retrieve_chunks,
)
from support_copilot_ai.config import get_settings
from support_copilot_ai.document_chunker import ChunkedDocument, DocumentChunker
from support_copilot_ai.document_embedder import (
    ChunkEmbedding,
    DocumentEmbedder,
    DocumentEmbeddingError,
    EmbeddingSummary,
)
from support_copilot_ai.pdf_parser import ParsedDocument, PdfParser, PdfParsingError


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str


class ReceivedFileDebug(BaseModel):
    filename: str
    content_type: str | None
    byte_size: int
    sha256: str
    checksum_matches: bool | None
    pdf_signature: str


class IngestionReceipt(BaseModel):
    status: Literal["received"]
    document_version_id: str
    file: ReceivedFileDebug
    parser: ParsedDocument
    chunking: ChunkedDocument
    embedding: EmbeddingSummary
    embedding_records: list[ChunkEmbedding]


settings = get_settings()
logger = logging.getLogger("uvicorn.error.support_copilot_ai.ingestion")
logger.setLevel(settings.log_level.upper())

MAX_PDF_BYTES = 10 * 1024 * 1024
READ_BLOCK_BYTES = 1024 * 1024


@lru_cache
def get_document_embedder() -> DocumentEmbedder | None:
    api_key = settings.openai_api_key

    if settings.provider.lower() != "openai" or api_key is None:
        return None

    revealed_key = api_key.get_secret_value().strip()

    if not revealed_key:
        return None

    return DocumentEmbedder(
        client=AsyncOpenAI(
            api_key=revealed_key,
            timeout=30.0,
            max_retries=2,
        ),
        model=settings.openai_embedding_model,
        dimensions=settings.openai_embedding_dimensions,
        batch_size=settings.embedding_batch_size,
    )


_db_pool: asyncpg.Pool | None = None
_db_pool_lock = asyncio.Lock()


async def get_db_pool() -> asyncpg.Pool | None:
    """Lazily create and cache the retrieval database pool.

    Deliberately not created via a FastAPI lifespan hook: httpx's
    ASGITransport does not run the lifespan protocol by default, and a plain
    async dependency is simpler to override in tests than app.state.
    """

    global _db_pool

    if _db_pool is not None:
        return _db_pool

    if not settings.db_host:
        return None

    async with _db_pool_lock:
        if _db_pool is None:
            _db_pool = await asyncpg.create_pool(
                host=settings.db_host,
                port=settings.db_port,
                database=settings.db_database,
                user=settings.db_username,
                password=settings.db_password,
                min_size=1,
                max_size=5,
            )

    return _db_pool


async def get_chunk_repository() -> ChunkRepository:
    pool = await get_db_pool()

    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The retrieval store is not configured.",
        )

    return AsyncpgChunkRepository(pool)


class RetrievalRequest(BaseModel):
    document_version_id: str
    query: str
    top_k: int | None = None
    min_score: float | None = None


app = FastAPI(
    title="Support Copilot AI Service",
    description=(
        "Internal AI workflow API. The ingestion endpoint parses a PDF, "
        "chunks it, and embeds each chunk for Laravel to persist. The "
        "retrieval endpoint embeds a query and returns the most relevant "
        "chunks of one document version by cosine similarity. Grounded "
        "generation is not implemented yet."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
)


@app.get("/health", response_model=HealthResponse, tags=["operations"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service=settings.app_name)


@app.post(
    "/internal/ingestions",
    response_model=IngestionReceipt,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["ingestion"],
    summary="Receive a PDF for the ingestion pipeline",
)
async def receive_ingestion(
    document_version_id: Annotated[str, Form(min_length=1)],
    file: Annotated[UploadFile, File(description="PDF source, maximum 10 MB")],
    checksum: Annotated[
        str | None,
        Form(
            min_length=64,
            max_length=64,
            description="Optional SHA-256 supplied by the calling service",
        ),
    ] = None,
    embedder: Annotated[DocumentEmbedder | None, Depends(get_document_embedder)] = None,
) -> IngestionReceipt:
    """Receive, parse, chunk, and embed one PDF document version.

    Persistence (steps 6-8) happens in Laravel after this receipt is
    returned; this service does not write to any database itself.
    """

    # Steps 1-2 (implemented): receive the authorized PDF source and validate the
    # transport-level constraints before any document processing begins.
    digest = hashlib.sha256()
    byte_size = 0
    signature = b""

    while block := await file.read(READ_BLOCK_BYTES):
        if not signature:
            signature = block[:5]

        byte_size += len(block)
        if byte_size > MAX_PDF_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="The PDF must not exceed 10 MB.",
            )

        digest.update(block)

    if signature != b"%PDF-":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="The uploaded source is not a valid PDF.",
        )

    calculated_checksum = digest.hexdigest()
    checksum_matches = (
        None if checksum is None else calculated_checksum == checksum.lower()
    )
    filename = file.filename or "document.pdf"

    # Step 3 (implemented): extract normalized text and structural metadata.
    # PdfParser returns document/page/line text offsets and line bounding boxes.
    # It does not create chunks, embeddings, or database records.
    await file.seek(0)

    try:
        parsed_document = await run_in_threadpool(PdfParser().parse, file.file)
    except PdfParsingError as exception:
        logger.warning(
            "Unable to parse ingestion source document_version_id=%s filename=%r",
            document_version_id,
            file.filename,
            exc_info=exception,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The PDF could not be parsed.",
        ) from exception

    # Step 4 (implemented): create deterministic, token-aware chunks while
    # retaining source offsets and page/line references for later citations.
    chunked_document = await run_in_threadpool(
        DocumentChunker().chunk,
        parsed_document,
    )

    if not chunked_document.chunks:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="The PDF does not contain extractable text.",
        )

    # Step 5 (implemented): create one embedding per chunk in bounded batches.
    # The full vectors remain in memory for the future persistence step; this
    # development receipt only exposes counts and dimensions to keep it compact.
    if embedder is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The embedding provider is not configured.",
        )

    try:
        embedded_document = await embedder.embed(chunked_document)
    except DocumentEmbeddingError as exception:
        logger.exception(
            "Unable to embed ingestion document_version_id=%s filename=%r",
            document_version_id,
            file.filename,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The document could not be embedded.",
        ) from exception

    # Steps 6-8 (persist chunks/vectors, mark ready, record safe failure
    # reasons) happen in Laravel's DocumentIngestionLifecycle after this
    # receipt is returned. This service stays stateless and does not write
    # to any database itself.

    logger.info(
        "Received ingestion source document_version_id=%s filename=%r "
        "content_type=%s byte_size=%d sha256=%s checksum_matches=%s",
        document_version_id,
        filename,
        file.content_type,
        byte_size,
        calculated_checksum,
        checksum_matches,
    )

    return IngestionReceipt(
        status="received",
        document_version_id=document_version_id,
        file=ReceivedFileDebug(
            filename=filename,
            content_type=file.content_type,
            byte_size=byte_size,
            sha256=calculated_checksum,
            checksum_matches=checksum_matches,
            pdf_signature=signature.decode("ascii"),
        ),
        parser=parsed_document,
        chunking=chunked_document,
        embedding=EmbeddingSummary.from_document(embedded_document),
        embedding_records=embedded_document.embeddings,
    )


@app.post(
    "/internal/retrieval",
    response_model=RetrievalResult,
    tags=["retrieval"],
    summary="Embed a query and retrieve relevant chunks of one document version",
)
async def retrieve(
    request: RetrievalRequest,
    embedder: Annotated[DocumentEmbedder | None, Depends(get_document_embedder)] = None,
    repository: Annotated[ChunkRepository, Depends(get_chunk_repository)] = None,  # type: ignore[assignment]
) -> RetrievalResult:
    """Development-facing retrieval inspection endpoint.

    Every result is scoped to exactly `document_version_id` — the caller
    (Laravel) is responsible for resolving that ID to the document's active,
    `ready` version before calling this endpoint. This service never searches
    across documents or versions on its own.
    """

    if not request.document_version_id.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="document_version_id is required.",
        )

    if not request.query.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="query is required.",
        )

    if embedder is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The embedding provider is not configured.",
        )

    top_k = request.top_k if request.top_k is not None else settings.retrieval_top_k
    min_score = (
        request.min_score
        if request.min_score is not None
        else settings.retrieval_min_score
    )

    if not 1 <= top_k <= 20:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="top_k must be between 1 and 20.",
        )

    if not 0.0 <= min_score <= 1.0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="min_score must be between 0 and 1.",
        )

    try:
        return await retrieve_chunks(
            embedder=embedder,
            repository=repository,
            document_version_id=request.document_version_id,
            query=request.query,
            top_k=top_k,
            min_score=min_score,
        )
    except DocumentEmbeddingError as exception:
        logger.exception(
            "Unable to embed retrieval query document_version_id=%s",
            request.document_version_id,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The query could not be embedded.",
        ) from exception
    except RetrievalError as exception:
        logger.exception(
            "Unable to query the retrieval store document_version_id=%s",
            request.document_version_id,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The retrieval store could not be queried.",
        ) from exception
