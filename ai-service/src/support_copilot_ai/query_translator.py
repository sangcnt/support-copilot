from collections.abc import Awaitable, Callable
from typing import Any

TRANSLATION_SYSTEM_INSTRUCTION = """You rewrite short search queries so they \
can be matched against a reference document by meaning, not literal wording. \
You will be given a REFERENCE TEXT sample from a document and a QUERY. \
Respond with ONLY the query rewritten in the same language as the reference \
text, preserving its meaning and intent. If the query is already in that \
language, return it unchanged. Never answer the query, add commentary, \
quotes, or explanation - output only the rewritten query text."""

REFERENCE_TEXT_MAX_CHARACTERS = 500

QueryTranslator = Callable[[str, str], Awaitable[str]]


def build_query_translator(client: Any, chat_model: str) -> QueryTranslator:
    """Build a best-effort query translator bound to an answer model client.

    Used only as a retrieval fallback when a query's own-language embedding
    finds nothing above the relevance threshold - see `retrieve_chunks()` in
    `chunk_retriever.py`. Any failure here should never break retrieval, so
    errors fall back to the original, untranslated query.
    """

    async def translate(query: str, reference_text: str) -> str:
        if not reference_text.strip():
            return query

        try:
            response = await client.responses.create(
                model=chat_model,
                input=[
                    {"role": "system", "content": TRANSLATION_SYSTEM_INSTRUCTION},
                    {
                        "role": "user",
                        "content": (
                            "REFERENCE TEXT:\n"
                            f"{reference_text[:REFERENCE_TEXT_MAX_CHARACTERS]}\n\n"
                            f"QUERY:\n{query}"
                        ),
                    },
                ],
            )
            translated = (getattr(response, "output_text", "") or "").strip()
            return translated or query
        except Exception:
            return query

    return translate
