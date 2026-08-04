import hashlib
from dataclasses import dataclass

import tiktoken
from pydantic import BaseModel

from support_copilot_ai.pdf_parser import ParsedDocument

CHUNKER_VERSION = "line-token-v1"
TOKENIZER_NAME = "cl100k_base"
MIN_CHUNK_TOKENS = 500
TARGET_CHUNK_TOKENS = 650
MAX_CHUNK_TOKENS = 800
OVERLAP_TOKENS = 80


class ChunkSourceSpan(BaseModel):
    page_number: int
    line_start: int
    line_end: int
    text_start: int
    text_end: int


class DocumentChunk(BaseModel):
    ordinal: int
    checksum: str
    text: str
    token_count: int
    character_count: int
    page_start: int
    page_end: int
    source_text_start: int
    source_text_end: int
    source_spans: list[ChunkSourceSpan]


class ChunkedDocument(BaseModel):
    chunker_version: str
    tokenizer: str
    min_tokens: int
    target_tokens: int
    max_tokens: int
    overlap_tokens: int
    chunk_count: int
    checksum: str
    chunks: list[DocumentChunk]


@dataclass(frozen=True)
class _SourceUnit:
    page_number: int
    line_number: int
    text_start: int
    text_end: int


class DocumentChunker:
    def __init__(self) -> None:
        self._encoding = tiktoken.get_encoding(TOKENIZER_NAME)

    def chunk(self, document: ParsedDocument) -> ChunkedDocument:
        units = self._source_units(document)
        chunks: list[DocumentChunk] = []
        start = 0

        while start < len(units):
            end, token_count = self._choose_chunk_end(document, units, start)
            selected_units = units[start:end]
            text_start = selected_units[0].text_start
            text_end = selected_units[-1].text_end
            chunk_text = document.normalized_text[text_start:text_end]
            ordinal = len(chunks)
            spans = self._source_spans(selected_units)

            chunks.append(
                DocumentChunk(
                    ordinal=ordinal,
                    checksum=self._chunk_checksum(
                        ordinal=ordinal,
                        text_start=text_start,
                        text_end=text_end,
                        text=chunk_text,
                    ),
                    text=chunk_text,
                    token_count=token_count,
                    character_count=len(chunk_text),
                    page_start=selected_units[0].page_number,
                    page_end=selected_units[-1].page_number,
                    source_text_start=text_start,
                    source_text_end=text_end,
                    source_spans=spans,
                )
            )

            if end == len(units):
                break

            start = self._next_chunk_start(document, units, start, end)

        return ChunkedDocument(
            chunker_version=CHUNKER_VERSION,
            tokenizer=TOKENIZER_NAME,
            min_tokens=MIN_CHUNK_TOKENS,
            target_tokens=TARGET_CHUNK_TOKENS,
            max_tokens=MAX_CHUNK_TOKENS,
            overlap_tokens=OVERLAP_TOKENS,
            chunk_count=len(chunks),
            checksum=self._document_checksum(chunks),
            chunks=chunks,
        )

    def _source_units(self, document: ParsedDocument) -> list[_SourceUnit]:
        units: list[_SourceUnit] = []

        for page in document.pages:
            for line in page.lines:
                for text_start, text_end in self._split_source_range(
                    document.normalized_text,
                    line.text_start,
                    line.text_end,
                ):
                    units.append(
                        _SourceUnit(
                            page_number=page.page_number,
                            line_number=line.line_number,
                            text_start=text_start,
                            text_end=text_end,
                        )
                    )

        return units

    def _split_source_range(
        self,
        text: str,
        source_start: int,
        source_end: int,
    ) -> list[tuple[int, int]]:
        ranges: list[tuple[int, int]] = []
        cursor = source_start

        while cursor < source_end:
            if self._token_count(text[cursor:source_end]) <= MAX_CHUNK_TOKENS:
                ranges.append((cursor, source_end))
                break

            boundary = self._largest_fitting_boundary(
                text,
                cursor,
                source_end,
                MAX_CHUNK_TOKENS,
            )
            whitespace = text.rfind(" ", cursor, boundary + 1)

            if whitespace > cursor:
                boundary = whitespace

            ranges.append((cursor, boundary))
            cursor = boundary

            while cursor < source_end and text[cursor].isspace():
                cursor += 1

        return ranges

    def _largest_fitting_boundary(
        self,
        text: str,
        source_start: int,
        source_end: int,
        token_limit: int,
    ) -> int:
        low = source_start + 1
        high = source_end
        best = low

        while low <= high:
            midpoint = (low + high) // 2

            if self._token_count(text[source_start:midpoint]) <= token_limit:
                best = midpoint
                low = midpoint + 1
            else:
                high = midpoint - 1

        return best

    def _choose_chunk_end(
        self,
        document: ParsedDocument,
        units: list[_SourceUnit],
        start: int,
    ) -> tuple[int, int]:
        end = start + 1
        token_count = self._range_token_count(document, units, start, end)

        while end < len(units):
            proposed_count = self._range_token_count(document, units, start, end + 1)

            if proposed_count > MAX_CHUNK_TOKENS:
                break

            current_distance = abs(TARGET_CHUNK_TOKENS - token_count)
            proposed_distance = abs(TARGET_CHUNK_TOKENS - proposed_count)

            if (
                token_count >= MIN_CHUNK_TOKENS
                and current_distance <= proposed_distance
            ):
                break

            end += 1
            token_count = proposed_count

        return end, token_count

    def _next_chunk_start(
        self,
        document: ParsedDocument,
        units: list[_SourceUnit],
        chunk_start: int,
        chunk_end: int,
    ) -> int:
        overlap_start = chunk_end

        while overlap_start > chunk_start:
            candidate = overlap_start - 1
            overlap_count = self._range_token_count(
                document,
                units,
                candidate,
                chunk_end,
            )

            if overlap_count > OVERLAP_TOKENS:
                break

            overlap_start = candidate

        if overlap_start == chunk_end:
            return chunk_end

        with_next_unit = self._range_token_count(
            document,
            units,
            overlap_start,
            chunk_end + 1,
        )

        return overlap_start if with_next_unit <= MAX_CHUNK_TOKENS else chunk_end

    def _range_token_count(
        self,
        document: ParsedDocument,
        units: list[_SourceUnit],
        start: int,
        end: int,
    ) -> int:
        text_start = units[start].text_start
        text_end = units[end - 1].text_end
        return self._token_count(document.normalized_text[text_start:text_end])

    def _source_spans(self, units: list[_SourceUnit]) -> list[ChunkSourceSpan]:
        spans: list[ChunkSourceSpan] = []

        for unit in units:
            previous = spans[-1] if spans else None
            is_adjacent_line = (
                previous is not None and unit.line_number <= previous.line_end + 1
            )

            if (
                previous
                and previous.page_number == unit.page_number
                and is_adjacent_line
            ):
                previous.line_end = max(previous.line_end, unit.line_number)
                previous.text_end = unit.text_end
                continue

            spans.append(
                ChunkSourceSpan(
                    page_number=unit.page_number,
                    line_start=unit.line_number,
                    line_end=unit.line_number,
                    text_start=unit.text_start,
                    text_end=unit.text_end,
                )
            )

        return spans

    def _token_count(self, text: str) -> int:
        return len(self._encoding.encode_ordinary(text))

    def _chunk_checksum(
        self,
        ordinal: int,
        text_start: int,
        text_end: int,
        text: str,
    ) -> str:
        canonical = (
            f"{CHUNKER_VERSION}\0{TOKENIZER_NAME}\0{ordinal}\0"
            f"{text_start}\0{text_end}\0{text}"
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def _document_checksum(self, chunks: list[DocumentChunk]) -> str:
        canonical = "\n".join(
            [
                CHUNKER_VERSION,
                TOKENIZER_NAME,
                str(MIN_CHUNK_TOKENS),
                str(TARGET_CHUNK_TOKENS),
                str(MAX_CHUNK_TOKENS),
                str(OVERLAP_TOKENS),
                *(chunk.checksum for chunk in chunks),
            ]
        )
        return hashlib.sha256(canonical.encode("ascii")).hexdigest()
