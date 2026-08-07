from typing import Any

from pydantic import BaseModel

SAMPLE_QUESTION_SYSTEM_INSTRUCTION = """You write short example questions that \
help a reader discover what a document covers. You will be given an excerpt \
from the start of a document. Write exactly 3 concrete questions a reader \
could ask about THIS document's actual content - not generic placeholders \
like "What is this document about?". Each question must be under 12 words. \
Do not answer the questions."""

DOCUMENT_EXCERPT_MAX_CHARACTERS = 4000
DEFAULT_QUESTION_COUNT = 3


class SampleQuestions(BaseModel):
    questions: list[str]


async def generate_sample_questions(
    *,
    client: Any,
    chat_model: str,
    document_text: str,
) -> list[str]:
    """Best-effort generation of example questions for a newly ingested
    document. Never raises: ingestion must succeed even if this fails, so any
    error - a misconfigured client, a model failure, a malformed response -
    falls back to an empty list rather than blocking the ingestion pipeline."""

    excerpt = document_text.strip()[:DOCUMENT_EXCERPT_MAX_CHARACTERS]

    if not excerpt:
        return []

    try:
        response = await client.responses.parse(
            model=chat_model,
            input=[
                {"role": "system", "content": SAMPLE_QUESTION_SYSTEM_INSTRUCTION},
                {"role": "user", "content": excerpt},
            ],
            text_format=SampleQuestions,
        )
        parsed = response.output_parsed
    except Exception:
        return []

    if parsed is None:
        return []

    questions = [question.strip() for question in parsed.questions if question.strip()]

    return questions[:DEFAULT_QUESTION_COUNT]
