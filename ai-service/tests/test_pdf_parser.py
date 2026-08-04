from io import BytesIO

from support_copilot_ai.pdf_parser import PARSER_VERSION, PdfParser
from tests.pdf_factory import build_text_pdf


def test_parser_returns_normalized_text_and_page_structure() -> None:
    parsed = PdfParser().parse(
        BytesIO(
            build_text_pdf(
                [
                    "Refund   policy",
                    "Customers may request a refund within 30 days.",
                ]
            )
        )
    )

    assert parsed.parser_version == PARSER_VERSION
    assert parsed.normalized_text == (
        "Refund policy\nCustomers may request a refund within 30 days."
    )
    assert parsed.page_count == 1
    assert parsed.character_count == len(parsed.normalized_text)
    assert parsed.line_count == 2
    assert parsed.empty_page_count == 0
    assert parsed.has_extractable_text is True
    assert parsed.metadata == {"title": "Support Guide", "author": "Sang"}

    page = parsed.pages[0]
    assert page.page_number == 1
    assert page.width == 612
    assert page.height == 792
    assert page.rotation == 0
    assert page.text_start == 0
    assert page.text_end == len(parsed.normalized_text)
    assert page.line_count == 2

    first_line, second_line = page.lines
    assert parsed.normalized_text[first_line.text_start : first_line.text_end] == (
        first_line.text
    )
    assert parsed.normalized_text[second_line.text_start : second_line.text_end] == (
        second_line.text
    )
    assert first_line.bbox[0] < first_line.bbox[2]
    assert first_line.bbox[1] < first_line.bbox[3]


def test_parser_marks_a_page_without_embedded_text() -> None:
    parsed = PdfParser().parse(BytesIO(build_text_pdf([])))

    assert parsed.normalized_text == ""
    assert parsed.has_extractable_text is False
    assert parsed.empty_page_count == 1
    assert parsed.pages[0].lines == []
