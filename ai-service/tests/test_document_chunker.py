from support_copilot_ai.document_chunker import (
    MAX_CHUNK_TOKENS,
    DocumentChunker,
)
from support_copilot_ai.pdf_parser import ParsedDocument, ParsedLine, ParsedPage


def parsed_document(pages: list[list[str]]) -> ParsedDocument:
    normalized_text = ""
    parsed_pages: list[ParsedPage] = []
    line_count = 0
    empty_page_count = 0

    for page_number, page_lines in enumerate(pages, start=1):
        if page_lines and normalized_text:
            normalized_text += "\n\n"

        page_start = len(normalized_text)
        parsed_lines: list[ParsedLine] = []

        for line_number, line_text in enumerate(page_lines, start=1):
            if parsed_lines:
                normalized_text += "\n"

            text_start = len(normalized_text)
            normalized_text += line_text
            text_end = len(normalized_text)
            parsed_lines.append(
                ParsedLine(
                    line_number=line_number,
                    text=line_text,
                    text_start=text_start,
                    text_end=text_end,
                    bbox=(10.0, float(line_number * 10), 500.0, 20.0),
                )
            )

        if not page_lines:
            empty_page_count += 1

        line_count += len(parsed_lines)
        parsed_pages.append(
            ParsedPage(
                page_number=page_number,
                width=612.0,
                height=792.0,
                rotation=0,
                text_start=page_start,
                text_end=len(normalized_text),
                line_count=len(parsed_lines),
                lines=parsed_lines,
            )
        )

    return ParsedDocument(
        parser_version="test-parser:v1",
        page_count=len(parsed_pages),
        character_count=len(normalized_text),
        line_count=line_count,
        empty_page_count=empty_page_count,
        has_extractable_text=bool(normalized_text),
        metadata={},
        normalized_text=normalized_text,
        pages=parsed_pages,
    )


def test_chunking_is_deterministic_and_preserves_source_ranges() -> None:
    document = parsed_document(
        [
            [
                f"Policy line {line_number}: "
                + "customers may request a refund with valid evidence " * 3
                for line_number in range(1, 80)
            ],
            [
                f"Travel rule {line_number}: "
                + "passengers should contact the airline before departure " * 3
                for line_number in range(1, 60)
            ],
        ]
    )
    chunker = DocumentChunker()

    first_result = chunker.chunk(document)
    second_result = chunker.chunk(document)

    assert first_result == second_result
    assert first_result.chunk_count > 1
    assert len(first_result.checksum) == 64
    assert [chunk.ordinal for chunk in first_result.chunks] == list(
        range(first_result.chunk_count)
    )

    for chunk in first_result.chunks:
        assert chunk.token_count <= MAX_CHUNK_TOKENS
        assert len(chunk.checksum) == 64
        assert (
            chunk.text
            == document.normalized_text[chunk.source_text_start : chunk.source_text_end]
        )
        assert chunk.page_start == chunk.source_spans[0].page_number
        assert chunk.page_end == chunk.source_spans[-1].page_number

    assert any(
        current.source_text_start < previous.source_text_end
        for previous, current in zip(
            first_result.chunks,
            first_result.chunks[1:],
            strict=False,
        )
    )


def test_chunker_splits_a_single_oversized_line() -> None:
    document = parsed_document([["refund " * 2_000]])

    result = DocumentChunker().chunk(document)

    assert result.chunk_count > 1
    assert all(chunk.token_count <= MAX_CHUNK_TOKENS for chunk in result.chunks)
    assert all(chunk.source_spans[0].line_start == 1 for chunk in result.chunks)
    assert all(chunk.text for chunk in result.chunks)


def test_chunker_returns_a_stable_empty_result_without_embedded_text() -> None:
    document = parsed_document([[], []])

    result = DocumentChunker().chunk(document)

    assert result.chunk_count == 0
    assert result.chunks == []
    assert len(result.checksum) == 64
