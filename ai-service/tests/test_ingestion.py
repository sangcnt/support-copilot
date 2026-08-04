import asyncio
import hashlib

from httpx import ASGITransport, AsyncClient

from support_copilot_ai.document_embedder import ChunkEmbedding, EmbeddedDocument
from support_copilot_ai.main import app, get_document_embedder
from tests.pdf_factory import build_text_pdf


class StubDocumentEmbedder:
    async def embed(self, document):
        return EmbeddedDocument(
            provider="openai",
            model="text-embedding-3-small",
            batch_size=32,
            batch_count=1,
            embedding_count=document.chunk_count,
            dimensions=3,
            input_tokens=sum(chunk.token_count for chunk in document.chunks),
            embeddings=[
                ChunkEmbedding(
                    chunk_ordinal=chunk.ordinal,
                    chunk_checksum=chunk.checksum,
                    vector=[0.1, 0.2, 0.3],
                )
                for chunk in document.chunks
            ],
        )


def test_ingestion_receives_pdf_and_returns_debug_receipt() -> None:
    pdf = build_text_pdf(
        ["Refund policy", "Customers may request a refund within 30 days."]
    )
    checksum = hashlib.sha256(pdf).hexdigest()

    async def send_pdf():
        transport = ASGITransport(app=app)
        app.dependency_overrides[get_document_embedder] = StubDocumentEmbedder

        try:
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
            ) as client:
                return await client.post(
                    "/internal/ingestions",
                    data={
                        "document_version_id": "01K1EXAMPLEVERSION",
                        "checksum": checksum,
                    },
                    files={"file": ("policy.pdf", pdf, "application/pdf")},
                )
        finally:
            app.dependency_overrides.pop(get_document_embedder, None)

    response = asyncio.run(send_pdf())

    assert response.status_code == 202
    payload = response.json()

    assert payload["status"] == "received"
    assert payload["document_version_id"] == "01K1EXAMPLEVERSION"
    assert payload["file"] == {
        "filename": "policy.pdf",
        "content_type": "application/pdf",
        "byte_size": len(pdf),
        "sha256": checksum,
        "checksum_matches": True,
        "pdf_signature": "%PDF-",
    }
    assert payload["parser"]["page_count"] == 1
    assert payload["parser"]["line_count"] == 2
    assert payload["parser"]["has_extractable_text"] is True
    assert payload["parser"]["normalized_text"] == (
        "Refund policy\nCustomers may request a refund within 30 days."
    )
    assert payload["chunking"]["chunker_version"] == "line-token-v1"
    assert payload["chunking"]["tokenizer"] == "cl100k_base"
    assert payload["chunking"]["chunk_count"] == 1
    assert payload["chunking"]["chunks"][0]["ordinal"] == 0
    assert payload["chunking"]["chunks"][0]["text"] == (
        "Refund policy\nCustomers may request a refund within 30 days."
    )
    assert payload["embedding"] == {
        "provider": "openai",
        "model": "text-embedding-3-small",
        "batch_size": 32,
        "batch_count": 1,
        "embedding_count": 1,
        "dimensions": 3,
        "input_tokens": payload["chunking"]["chunks"][0]["token_count"],
    }


def test_ingestion_rejects_non_pdf_content() -> None:
    async def send_text():
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            return await client.post(
                "/internal/ingestions",
                data={"document_version_id": "01K1EXAMPLEVERSION"},
                files={"file": ("fake.pdf", b"plain text", "application/pdf")},
            )

    response = asyncio.run(send_text())

    assert response.status_code == 415
    assert response.json() == {"detail": "The uploaded source is not a valid PDF."}


def test_ingestion_rejects_a_malformed_pdf_after_signature_validation() -> None:
    async def send_malformed_pdf():
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            return await client.post(
                "/internal/ingestions",
                data={"document_version_id": "01K1EXAMPLEVERSION"},
                files={
                    "file": (
                        "malformed.pdf",
                        b"%PDF-1.4\nnot a valid document",
                        "application/pdf",
                    )
                },
            )

    response = asyncio.run(send_malformed_pdf())

    assert response.status_code == 422
    assert response.json() == {"detail": "The PDF could not be parsed."}


def test_swagger_is_available_for_manual_testing() -> None:
    async def request_docs():
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            return await client.get("/docs")

    response = asyncio.run(request_docs())

    assert response.status_code == 200
    assert "Swagger UI" in response.text
