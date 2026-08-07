import asyncio

from support_copilot_ai.sample_question_generator import (
    SampleQuestions,
    generate_sample_questions,
)


class FakeResponses:
    def __init__(
        self,
        parsed: SampleQuestions | None = None,
        error: Exception | None = None,
    ) -> None:
        self.parsed = parsed
        self.error = error
        self.calls: list[dict] = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)

        if self.error is not None:
            raise self.error

        class Response:
            output_parsed = self.parsed

        return Response()


class FakeClient:
    def __init__(self, responses: FakeResponses) -> None:
        self.responses = responses


def test_generate_sample_questions_returns_the_parsed_questions() -> None:
    responses = FakeResponses(
        parsed=SampleQuestions(
            questions=[
                "What is the refund window?",
                "Who is eligible for a refund?",
            ]
        )
    )

    result = asyncio.run(
        generate_sample_questions(
            client=FakeClient(responses),
            chat_model="gpt-5.6-terra",
            document_text=(
                "Refund policy: customers may request a refund within 30 days."
            ),
        )
    )

    assert result == [
        "What is the refund window?",
        "Who is eligible for a refund?",
    ]
    assert len(responses.calls) == 1
    assert responses.calls[0]["model"] == "gpt-5.6-terra"


def test_generate_sample_questions_truncates_a_long_document() -> None:
    responses = FakeResponses(parsed=SampleQuestions(questions=["Q?"]))
    long_text = "a" * 10_000

    asyncio.run(
        generate_sample_questions(
            client=FakeClient(responses),
            chat_model="gpt-5.6-terra",
            document_text=long_text,
        )
    )

    sent_excerpt = responses.calls[0]["input"][1]["content"]
    assert len(sent_excerpt) <= 4000


def test_generate_sample_questions_caps_the_result_at_three() -> None:
    responses = FakeResponses(
        parsed=SampleQuestions(questions=["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"])
    )

    result = asyncio.run(
        generate_sample_questions(
            client=FakeClient(responses),
            chat_model="gpt-5.6-terra",
            document_text="Some document content.",
        )
    )

    assert result == ["Q1?", "Q2?", "Q3?"]


def test_generate_sample_questions_drops_blank_questions() -> None:
    responses = FakeResponses(
        parsed=SampleQuestions(questions=["  ", "Real question?"])
    )

    result = asyncio.run(
        generate_sample_questions(
            client=FakeClient(responses),
            chat_model="gpt-5.6-terra",
            document_text="Some document content.",
        )
    )

    assert result == ["Real question?"]


def test_generate_sample_questions_fails_soft_when_the_model_call_errors() -> None:
    responses = FakeResponses(error=RuntimeError("boom"))

    result = asyncio.run(
        generate_sample_questions(
            client=FakeClient(responses),
            chat_model="gpt-5.6-terra",
            document_text="Some document content.",
        )
    )

    assert result == []


def test_generate_sample_questions_fails_soft_on_an_unparsed_response() -> None:
    responses = FakeResponses(parsed=None)

    result = asyncio.run(
        generate_sample_questions(
            client=FakeClient(responses),
            chat_model="gpt-5.6-terra",
            document_text="Some document content.",
        )
    )

    assert result == []


def test_generate_sample_questions_skips_the_model_call_for_empty_text() -> None:
    responses = FakeResponses(parsed=SampleQuestions(questions=["should not appear"]))

    result = asyncio.run(
        generate_sample_questions(
            client=FakeClient(responses),
            chat_model="gpt-5.6-terra",
            document_text="   ",
        )
    )

    assert result == []
    assert responses.calls == []
