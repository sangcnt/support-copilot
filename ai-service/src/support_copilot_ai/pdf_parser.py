import unicodedata
from typing import BinaryIO

import pdfplumber
from pydantic import BaseModel

PARSER_VERSION = "pdfplumber-0.11.10:v1"
MAX_PDF_PAGES = 200
MAX_EXTRACTED_CHARACTERS = 1_000_000
METADATA_KEYS = (
    "Title",
    "Author",
    "Subject",
    "Keywords",
    "Creator",
    "Producer",
    "CreationDate",
    "ModDate",
)


class PdfParsingError(Exception):
    """Raised when a PDF cannot produce a safe parser result."""


class ParsedLine(BaseModel):
    line_number: int
    text: str
    text_start: int
    text_end: int
    bbox: tuple[float, float, float, float]


class ParsedPage(BaseModel):
    page_number: int
    width: float
    height: float
    rotation: int
    text_start: int
    text_end: int
    line_count: int
    lines: list[ParsedLine]


class ParsedDocument(BaseModel):
    parser_version: str
    page_count: int
    character_count: int
    line_count: int
    empty_page_count: int
    has_extractable_text: bool
    metadata: dict[str, str]
    normalized_text: str
    pages: list[ParsedPage]


class PdfParser:
    def parse(self, source: BinaryIO) -> ParsedDocument:
        try:
            return self._parse(source)
        except PdfParsingError:
            raise
        except Exception as exception:
            raise PdfParsingError("The PDF could not be parsed.") from exception

    def _parse(self, source: BinaryIO) -> ParsedDocument:
        document_text = ""
        parsed_pages: list[ParsedPage] = []
        total_lines = 0
        empty_pages = 0

        with pdfplumber.open(source, unicode_norm="NFKC") as pdf:
            page_count = len(pdf.pages)

            if page_count > MAX_PDF_PAGES:
                raise PdfParsingError(
                    f"The PDF exceeds the {MAX_PDF_PAGES}-page parser limit."
                )

            metadata = self._metadata(pdf.metadata or {})

            for page_number, page in enumerate(pdf.pages, start=1):
                deduplicated_page = page.dedupe_chars(tolerance=1)
                extracted_lines = deduplicated_page.extract_text_lines(
                    layout=False,
                    strip=True,
                    return_chars=False,
                    x_tolerance=3,
                    y_tolerance=3,
                )
                line_records = [
                    (normalized, line)
                    for line in extracted_lines
                    if (normalized := self._normalize_line(str(line.get("text", ""))))
                ]
                page_text = "\n".join(text for text, _ in line_records)

                if page_text and document_text:
                    document_text += "\n\n"

                page_start = len(document_text)
                parsed_lines: list[ParsedLine] = []
                line_cursor = page_start

                for line_number, (text, line) in enumerate(line_records, start=1):
                    line_start = line_cursor
                    line_end = line_start + len(text)
                    parsed_lines.append(
                        ParsedLine(
                            line_number=line_number,
                            text=text,
                            text_start=line_start,
                            text_end=line_end,
                            bbox=(
                                self._coordinate(line.get("x0")),
                                self._coordinate(line.get("top")),
                                self._coordinate(line.get("x1")),
                                self._coordinate(line.get("bottom")),
                            ),
                        )
                    )
                    line_cursor = line_end + 1

                document_text += page_text
                page_end = len(document_text)

                if not page_text:
                    empty_pages += 1

                total_lines += len(parsed_lines)
                parsed_pages.append(
                    ParsedPage(
                        page_number=page_number,
                        width=self._coordinate(page.width),
                        height=self._coordinate(page.height),
                        rotation=int(page.rotation or 0),
                        text_start=page_start,
                        text_end=page_end,
                        line_count=len(parsed_lines),
                        lines=parsed_lines,
                    )
                )

                if len(document_text) > MAX_EXTRACTED_CHARACTERS:
                    raise PdfParsingError(
                        "The PDF exceeds the extracted-text parser limit."
                    )

        return ParsedDocument(
            parser_version=PARSER_VERSION,
            page_count=len(parsed_pages),
            character_count=len(document_text),
            line_count=total_lines,
            empty_page_count=empty_pages,
            has_extractable_text=bool(document_text),
            metadata=metadata,
            normalized_text=document_text,
            pages=parsed_pages,
        )

    def _normalize_line(self, text: str) -> str:
        normalized = unicodedata.normalize("NFKC", text).replace("\x00", "")
        return " ".join(normalized.split())

    def _metadata(self, raw_metadata: dict) -> dict[str, str]:
        metadata: dict[str, str] = {}

        for key in METADATA_KEYS:
            value = raw_metadata.get(key)

            if value is None:
                continue

            normalized = self._normalize_line(str(value))

            if normalized:
                metadata[key.lower()] = normalized[:500]

        return metadata

    def _coordinate(self, value: object) -> float:
        return round(float(value or 0), 3)
