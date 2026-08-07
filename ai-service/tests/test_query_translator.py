import asyncio

from support_copilot_ai.query_translator import build_query_translator


class FakeResponse:
    def __init__(self, output_text: str) -> None:
        self.output_text = output_text


class FakeResponses:
    def __init__(
        self,
        output_text: str | None = None,
        error: Exception | None = None,
    ) -> None:
        self.output_text = output_text
        self.error = error
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)

        if self.error is not None:
            raise self.error

        return FakeResponse(self.output_text or "")


class FakeClient:
    def __init__(self, responses: FakeResponses) -> None:
        self.responses = responses


def test_translate_rewrites_the_query_using_the_reference_text() -> None:
    responses = FakeResponses(output_text="what specifically is this about?")
    translator = build_query_translator(FakeClient(responses), "gpt-5.6-terra")

    result = asyncio.run(
        translator("cụ thể là gì?", "This is an English reference document.")
    )

    assert result == "what specifically is this about?"
    assert len(responses.calls) == 1
    assert responses.calls[0]["model"] == "gpt-5.6-terra"
    user_message = responses.calls[0]["input"][1]["content"]
    assert "cụ thể là gì?" in user_message
    assert "This is an English reference document." in user_message


def test_translate_falls_back_to_the_original_query_on_empty_response() -> None:
    responses = FakeResponses(output_text="   ")
    translator = build_query_translator(FakeClient(responses), "gpt-5.6-terra")

    result = asyncio.run(translator("original query", "reference"))

    assert result == "original query"


def test_translate_falls_back_to_the_original_query_when_the_model_call_fails() -> None:
    responses = FakeResponses(error=RuntimeError("boom"))
    translator = build_query_translator(FakeClient(responses), "gpt-5.6-terra")

    result = asyncio.run(translator("original query", "reference"))

    assert result == "original query"


def test_translate_skips_the_model_call_when_there_is_no_reference_text() -> None:
    responses = FakeResponses(output_text="should not be used")
    translator = build_query_translator(FakeClient(responses), "gpt-5.6-terra")

    result = asyncio.run(translator("original query", "   "))

    assert result == "original query"
    assert responses.calls == []
