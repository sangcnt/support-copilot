import hashlib
import logging
from typing import Annotated, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from support_copilot_ai.config import get_settings


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


settings = get_settings()
logger = logging.getLogger("uvicorn.error.support_copilot_ai.ingestion")
logger.setLevel(settings.log_level.upper())

MAX_PDF_BYTES = 10 * 1024 * 1024
READ_BLOCK_BYTES = 1024 * 1024

app = FastAPI(
    title="Support Copilot AI Service",
    description=(
        "Internal AI workflow API. The ingestion endpoint currently receives and "
        "inspects a PDF only; parsing, chunking, embeddings, and persistence are "
        "not implemented yet."
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
    """Acknowledge a PDF without parsing or persisting it."""

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
    )
