import hashlib
import logging
from typing import Annotated, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from support_copilot_ai.config import get_settings
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


settings = get_settings()
logger = logging.getLogger("uvicorn.error.support_copilot_ai.ingestion")
logger.setLevel(settings.log_level.upper())

MAX_PDF_BYTES = 10 * 1024 * 1024
READ_BLOCK_BYTES = 1024 * 1024

app = FastAPI(
    title="Support Copilot AI Service",
    description=(
        "Internal AI workflow API. The ingestion endpoint receives a PDF and "
        "extracts normalized text with page and line metadata. Chunking, embeddings, "
        "and persistence are not implemented yet."
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
) -> IngestionReceipt:
    """Orchestrate the ingestion pipeline for one document version.

    This endpoint should coordinate the numbered pipeline steps. The detailed work
    for each step belongs in focused parser, chunker, embedding, and repository
    services so this HTTP handler remains easy to follow and test.

    Currently implemented: source receipt/validation and step 3 (PDF parsing).
    Steps 4-8 remain intentionally unimplemented.
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

    # Planned pipeline continuation (not implemented in this step):
    # Step 4: create deterministic chunks from parsed_document.
    # Step 5: generate embeddings in size-limited batches.
    # Step 6: persist chunks, embeddings, and metadata in one transaction.
    # Step 7: mark the document version as ready only after persistence succeeds.
    # Step 8: on failure, persist a safe user-facing reason separately from the
    #         internal diagnostic details used in logs and debugging.

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
    )
