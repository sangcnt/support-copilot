<?php

namespace App\Services;

use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\UsageEvent;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class DocumentIngestionLifecycle
{
    public function start(Document $document): DocumentVersion
    {
        return DB::transaction(function () use ($document): DocumentVersion {
            $lockedDocument = Document::query()->lockForUpdate()->findOrFail($document->id);

            // Query the latest version directly instead of through the
            // `latestVersion` ofMany() relation: that relation resolves via a
            // GROUP BY subquery, and PostgreSQL rejects FOR UPDATE combined
            // with GROUP BY.
            $version = DocumentVersion::query()
                ->where('document_id', $lockedDocument->id)
                ->orderByDesc('version')
                ->lockForUpdate()
                ->firstOrFail();

            $lockedDocument->forceFill([
                'status' => 'processing',
                'failure_reason' => null,
            ])->save();

            $version->forceFill([
                'ingestion_status' => 'processing',
                'failure_code' => null,
                'failure_diagnostic' => null,
                'ingestion_started_at' => now(),
                'ingestion_completed_at' => null,
                'ingestion_failed_at' => null,
            ])->save();

            return $version;
        });
    }

    /**
     * @param  array<string, mixed>  $receipt
     */
    public function complete(
        Document $document,
        DocumentVersion $version,
        array $receipt,
        int $latencyMs,
    ): Document {
        $rows = $this->chunkRows($receipt, $version);

        return DB::transaction(function () use (
            $document,
            $version,
            $receipt,
            $latencyMs,
            $rows,
        ): Document {
            $lockedDocument = Document::query()->lockForUpdate()->findOrFail($document->id);
            $lockedVersion = DocumentVersion::query()
                ->whereBelongsTo($lockedDocument)
                ->lockForUpdate()
                ->findOrFail($version->id);

            $lockedVersion->chunks()->delete();

            foreach (array_chunk($rows, 100) as $batch) {
                DB::table('chunks')->insert($batch);
            }

            $parser = $this->arrayValue($receipt, 'parser');
            $chunking = $this->arrayValue($receipt, 'chunking');
            $embedding = $this->arrayValue($receipt, 'embedding');

            $lockedVersion->forceFill([
                'parser_version' => $this->stringValue($parser, 'parser_version'),
                'parser_metadata' => Arr::except($parser, ['normalized_text']),
                'chunking_version' => $this->stringValue($chunking, 'chunker_version'),
                'chunking_checksum' => $this->checksumValue($chunking, 'checksum'),
                'embedding_provider' => $this->stringValue($embedding, 'provider'),
                'embedding_model' => $this->stringValue($embedding, 'model'),
                'embedding_dimensions' => $this->integerValue($embedding, 'dimensions'),
                'embedding_input_tokens' => $this->integerValue($embedding, 'input_tokens'),
                'ingestion_status' => 'ready',
                'failure_code' => null,
                'failure_diagnostic' => null,
                'ingestion_completed_at' => now(),
                'ingestion_failed_at' => null,
            ])->save();

            $lockedDocument->forceFill([
                'status' => 'ready',
                'failure_reason' => null,
            ])->save();

            UsageEvent::query()->create([
                'anonymous_session_id' => $lockedDocument->anonymous_session_id,
                'document_id' => $lockedDocument->id,
                'event_type' => 'document_embedding',
                'provider' => $this->stringValue($embedding, 'provider'),
                'model' => $this->stringValue($embedding, 'model'),
                'input_tokens' => $this->integerValue($embedding, 'input_tokens'),
                'latency_ms' => max(0, $latencyMs),
                'metadata' => [
                    'document_version_id' => $lockedVersion->id,
                    'chunk_count' => count($rows),
                    'batch_count' => $this->integerValue($embedding, 'batch_count'),
                    'dimensions' => $this->integerValue($embedding, 'dimensions'),
                ],
            ]);

            return $lockedDocument->load('latestVersion');
        });
    }

    public function fail(
        Document $document,
        DocumentVersion $version,
        string $failureCode,
        string $safeReason,
        Throwable $exception,
    ): void {
        DB::transaction(function () use (
            $document,
            $version,
            $failureCode,
            $safeReason,
            $exception,
        ): void {
            $lockedDocument = Document::query()->lockForUpdate()->find($document->id);
            $lockedVersion = DocumentVersion::query()->lockForUpdate()->find($version->id);

            if ($lockedDocument === null || $lockedVersion === null) {
                return;
            }

            $lockedDocument->forceFill([
                'status' => 'failed',
                'failure_reason' => $safeReason,
            ])->save();

            $lockedVersion->forceFill([
                'ingestion_status' => 'failed',
                'failure_code' => $failureCode,
                'failure_diagnostic' => Str::limit(
                    $exception::class.': '.$exception->getMessage(),
                    4000,
                    '',
                ),
                'ingestion_completed_at' => null,
                'ingestion_failed_at' => now(),
            ])->save();
        });
    }

    /**
     * @param  array<string, mixed>  $receipt
     * @return list<array<string, mixed>>
     */
    private function chunkRows(array $receipt, DocumentVersion $version): array
    {
        $chunking = $this->arrayValue($receipt, 'chunking');
        $embedding = $this->arrayValue($receipt, 'embedding');
        $chunks = $this->listValue($chunking, 'chunks');
        $embeddingRecords = $this->listValue($receipt, 'embedding_records');
        $dimensions = $this->integerValue($embedding, 'dimensions');

        if (
            $chunks === []
            || count($chunks) !== $this->integerValue($chunking, 'chunk_count')
            || count($chunks) !== $this->integerValue($embedding, 'embedding_count')
            || count($chunks) !== count($embeddingRecords)
        ) {
            throw new RuntimeException('The ingestion receipt has inconsistent chunk counts.');
        }

        $recordsByOrdinal = [];

        foreach ($embeddingRecords as $record) {
            if (! is_array($record)) {
                throw new RuntimeException('An embedding record is invalid.');
            }

            $ordinal = $this->integerValue($record, 'chunk_ordinal');

            if (array_key_exists($ordinal, $recordsByOrdinal)) {
                throw new RuntimeException('The ingestion receipt has duplicate embeddings.');
            }

            $recordsByOrdinal[$ordinal] = $record;
        }

        $now = now();
        $rows = [];

        foreach ($chunks as $expectedOrdinal => $chunk) {
            if (! is_array($chunk)) {
                throw new RuntimeException('A chunk record is invalid.');
            }

            $ordinal = $this->integerValue($chunk, 'ordinal');
            $record = $recordsByOrdinal[$ordinal] ?? null;

            if ($ordinal !== $expectedOrdinal || ! is_array($record)) {
                throw new RuntimeException('The ingestion receipt has a missing chunk embedding.');
            }

            $checksum = $this->checksumValue($chunk, 'checksum');

            if ($checksum !== $this->checksumValue($record, 'chunk_checksum')) {
                throw new RuntimeException('A chunk embedding checksum does not match.');
            }

            $vector = $this->listValue($record, 'vector');

            if (count($vector) !== $dimensions) {
                throw new RuntimeException('A chunk embedding has unexpected dimensions.');
            }

            foreach ($vector as $value) {
                if (! is_int($value) && ! is_float($value)) {
                    throw new RuntimeException('A chunk embedding contains a non-numeric value.');
                }
            }

            $rows[] = [
                'id' => (string) Str::ulid(),
                'document_version_id' => $version->id,
                'ordinal' => $ordinal,
                'heading' => null,
                'page_number' => $this->integerValue($chunk, 'page_start'),
                'page_end' => $this->integerValue($chunk, 'page_end'),
                'normalized_text' => $this->stringValue($chunk, 'text'),
                'token_count' => $this->integerValue($chunk, 'token_count'),
                'content_checksum' => $checksum,
                'embedding_model' => $this->stringValue($embedding, 'model'),
                'chunking_version' => $this->stringValue($chunking, 'chunker_version'),
                'source_text_start' => $this->integerValue($chunk, 'source_text_start'),
                'source_text_end' => $this->integerValue($chunk, 'source_text_end'),
                'source_spans' => json_encode(
                    $this->listValue($chunk, 'source_spans'),
                    JSON_THROW_ON_ERROR,
                ),
                'embedding' => json_encode($vector, JSON_THROW_ON_ERROR),
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        return $rows;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function arrayValue(array $data, string $key): array
    {
        $value = $data[$key] ?? null;

        if (! is_array($value) || array_is_list($value)) {
            throw new RuntimeException("The ingestion receipt field {$key} is invalid.");
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>  $data
     * @return list<mixed>
     */
    private function listValue(array $data, string $key): array
    {
        $value = $data[$key] ?? null;

        if (! is_array($value) || ! array_is_list($value)) {
            throw new RuntimeException("The ingestion receipt field {$key} is invalid.");
        }

        return $value;
    }

    /** @param array<string, mixed> $data */
    private function stringValue(array $data, string $key): string
    {
        $value = $data[$key] ?? null;

        if (! is_string($value) || $value === '') {
            throw new RuntimeException("The ingestion receipt field {$key} is invalid.");
        }

        return $value;
    }

    /** @param array<string, mixed> $data */
    private function integerValue(array $data, string $key): int
    {
        $value = $data[$key] ?? null;

        if (! is_int($value) || $value < 0) {
            throw new RuntimeException("The ingestion receipt field {$key} is invalid.");
        }

        return $value;
    }

    /** @param array<string, mixed> $data */
    private function checksumValue(array $data, string $key): string
    {
        $value = $this->stringValue($data, $key);

        if (preg_match('/\A[a-f0-9]{64}\z/', $value) !== 1) {
            throw new RuntimeException("The ingestion receipt field {$key} is invalid.");
        }

        return $value;
    }
}
