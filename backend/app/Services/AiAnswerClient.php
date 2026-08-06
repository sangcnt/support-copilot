<?php

namespace App\Services;

use App\Models\DocumentVersion;
use Generator;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class AiAnswerClient
{
    private const READ_CHUNK_BYTES = 8192;

    /**
     * Open the FastAPI answer stream and yield each parsed Server-Sent
     * Event as it arrives, in order. Reading is push-through: this method
     * does not buffer the whole response before yielding, so the caller can
     * relay events to the browser as they come in.
     *
     * @return Generator<array{event: string, data: array<string, mixed>}>
     */
    public function stream(DocumentVersion $version, string $query): Generator
    {
        $response = $this->request()
            ->withOptions(['stream' => true])
            ->post('/internal/answers/stream', [
                'document_version_id' => $version->id,
                'query' => $query,
            ]);

        if ($response->failed()) {
            throw new RuntimeException(
                'The AI service could not start an answer stream: HTTP '.$response->status(),
            );
        }

        $body = $response->toPsrResponse()->getBody();
        $buffer = '';

        while (! $body->eof()) {
            $buffer .= $body->read(self::READ_CHUNK_BYTES);

            while (($boundary = strpos($buffer, "\n\n")) !== false) {
                $rawEvent = substr($buffer, 0, $boundary);
                $buffer = substr($buffer, $boundary + 2);
                $parsed = $this->parseEvent($rawEvent);

                if ($parsed !== null) {
                    yield $parsed;
                }
            }
        }
    }

    private function request(): PendingRequest
    {
        return Http::baseUrl(rtrim((string) config('services.ai_service.url'), '/'))
            ->acceptJson()
            ->timeout((int) config('services.ai_service.stream_timeout'));
    }

    /**
     * @return array{event: string, data: array<string, mixed>}|null
     */
    private function parseEvent(string $rawEvent): ?array
    {
        $eventName = null;
        $dataLines = [];

        foreach (explode("\n", $rawEvent) as $line) {
            if (str_starts_with($line, 'event: ')) {
                $eventName = substr($line, 7);
            } elseif (str_starts_with($line, 'data: ')) {
                $dataLines[] = substr($line, 6);
            }
        }

        if ($eventName === null || $eventName === '') {
            return null;
        }

        $decoded = json_decode(implode("\n", $dataLines), true);

        return [
            'event' => $eventName,
            'data' => is_array($decoded) ? $decoded : [],
        ];
    }
}
