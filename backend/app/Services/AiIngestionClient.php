<?php

namespace App\Services;

use App\Models\Document;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class AiIngestionClient
{
    public function __construct(
        private readonly DocumentStorage $storage,
    ) {}

    /**
     * @return array{
     *     status: string,
     *     document_version_id: string,
     *     file: array{
     *         filename: string,
     *         content_type: string|null,
     *         byte_size: int,
     *         sha256: string,
     *         checksum_matches: bool|null,
     *         pdf_signature: string
     *     },
     *     parser: array<string, mixed>,
     *     chunking: array<string, mixed>,
     *     embedding: array<string, mixed>
     * }
     */
    public function receive(Document $document): array
    {
        $version = $document->latestVersion()->firstOrFail();
        $storageKey = $version->storage_key;

        if ($storageKey === null || ! $this->storage->disk()->exists($storageKey)) {
            abort(404);
        }

        $stream = $this->storage->disk()->readStream($storageKey);

        if ($stream === false) {
            throw new RuntimeException('Unable to read the document source.');
        }

        try {
            $response = $this->request()
                ->attach(
                    'file',
                    $stream,
                    $document->display_name,
                    ['Content-Type' => 'application/pdf'],
                )
                ->post('/internal/ingestions', [
                    'document_version_id' => $version->id,
                    'checksum' => $version->content_checksum,
                ])
                ->throw();
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        $receipt = $response->json();

        if (
            ! is_array($receipt)
            || ($receipt['status'] ?? null) !== 'received'
            || ($receipt['document_version_id'] ?? null) !== $version->id
            || ! is_array($receipt['file'] ?? null)
            || ! is_array($receipt['parser'] ?? null)
            || ! is_array($receipt['chunking'] ?? null)
            || ! is_array($receipt['embedding'] ?? null)
        ) {
            throw new RuntimeException('The AI service returned an invalid ingestion receipt.');
        }

        return $receipt;
    }

    private function request(): PendingRequest
    {
        return Http::baseUrl(rtrim((string) config('services.ai_service.url'), '/'))
            ->acceptJson()
            ->timeout((int) config('services.ai_service.timeout'));
    }
}
