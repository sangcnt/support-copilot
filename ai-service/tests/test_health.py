import asyncio

from httpx import ASGITransport, AsyncClient

from support_copilot_ai.main import app


def test_health_check_reports_service_as_ready() -> None:
    async def request_health():
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
        ) as client:
            return await client.get("/health")

    response = asyncio.run(request_health())

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "support-copilot-ai",
    }
