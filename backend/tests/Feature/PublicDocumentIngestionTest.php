<?php

namespace Tests\Feature;

use App\Models\AnonymousSession;
use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PublicDocumentIngestionTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('documents');
        config(['services.ai_service.url' => 'http://ai-service:8000']);
    }

    public function test_owner_can_send_the_private_pdf_to_the_ai_service(): void
    {
        [$session, $token] = $this->sessionContext('ingestion-owner-token');
        $pdf = "%PDF-1.4\n%%EOF";
        $checksum = hash('sha256', $pdf);
        $document = Document::factory()->for($session)->create([
            'display_name' => 'policy.pdf',
            'status' => 'pending_ingestion',
        ]);
        $version = DocumentVersion::factory()->for($document)->create([
            'storage_key' => "{$session->id}/{$document->id}/source.pdf",
            'byte_size' => strlen($pdf),
            'content_checksum' => $checksum,
            'ingestion_status' => 'pending',
        ]);
        Storage::disk('documents')->put($version->storage_key, $pdf);

        Http::fake([
            'http://ai-service:8000/internal/ingestions' => Http::response([
                'status' => 'received',
                'document_version_id' => $version->id,
                'file' => [
                    'filename' => 'policy.pdf',
                    'content_type' => 'application/pdf',
                    'byte_size' => strlen($pdf),
                    'sha256' => $checksum,
                    'checksum_matches' => true,
                    'pdf_signature' => '%PDF-',
                ],
                'parser' => [
                    'parser_version' => 'pdfplumber-0.11.10:v1',
                    'page_count' => 1,
                    'character_count' => 14,
                    'line_count' => 1,
                    'empty_page_count' => 0,
                    'has_extractable_text' => true,
                    'metadata' => [],
                    'normalized_text' => 'Refund policy.',
                    'pages' => [],
                ],
                'chunking' => [
                    'chunker_version' => 'line-token-v1',
                    'tokenizer' => 'cl100k_base',
                    'min_tokens' => 500,
                    'target_tokens' => 650,
                    'max_tokens' => 800,
                    'overlap_tokens' => 80,
                    'chunk_count' => 1,
                    'checksum' => str_repeat('c', 64),
                    'chunks' => [[
                        'ordinal' => 0,
                        'checksum' => str_repeat('d', 64),
                        'text' => 'Refund policy.',
                        'token_count' => 3,
                        'character_count' => 14,
                        'page_start' => 1,
                        'page_end' => 1,
                        'source_text_start' => 0,
                        'source_text_end' => 14,
                        'source_spans' => [],
                    ]],
                ],
                'embedding' => [
                    'provider' => 'openai',
                    'model' => 'text-embedding-3-small',
                    'batch_size' => 32,
                    'batch_count' => 1,
                    'embedding_count' => 1,
                    'dimensions' => 1536,
                    'input_tokens' => 3,
                ],
            ], 202),
        ]);

        $this->ownedRequest($token)
            ->postJson("/api/public/documents/{$document->id}/ingestions")
            ->assertStatus(202)
            ->assertJsonPath('data.status', 'received')
            ->assertJsonPath('data.document_version_id', $version->id)
            ->assertJsonPath('data.file.checksum_matches', true)
            ->assertJsonPath('data.parser.page_count', 1)
            ->assertJsonPath('data.parser.normalized_text', 'Refund policy.')
            ->assertJsonPath('data.chunking.chunk_count', 1)
            ->assertJsonPath('data.chunking.chunks.0.text', 'Refund policy.')
            ->assertJsonPath('data.embedding.model', 'text-embedding-3-small')
            ->assertJsonPath('data.embedding.embedding_count', 1)
            ->assertJsonPath('data.embedding.dimensions', 1536);

        Http::assertSent(function (Request $request) use ($checksum, $version): bool {
            $parts = collect($request->data())->keyBy('name');

            return $request->method() === 'POST'
                && $request->url() === 'http://ai-service:8000/internal/ingestions'
                && $request->hasFile('file', filename: 'policy.pdf')
                && $parts->get('document_version_id')['contents'] === $version->id
                && $parts->get('checksum')['contents'] === $checksum;
        });

        $this->assertDatabaseHas('documents', [
            'id' => $document->id,
            'status' => 'pending_ingestion',
        ]);
        $this->assertDatabaseHas('document_versions', [
            'id' => $version->id,
            'ingestion_status' => 'pending',
        ]);
    }

    public function test_other_session_cannot_start_ingestion(): void
    {
        [$owner] = $this->sessionContext('private-ingestion-owner');
        $document = Document::factory()->for($owner)->create();
        [, $otherToken] = $this->sessionContext('private-ingestion-other');

        Http::fake();

        $this->ownedRequest($otherToken)
            ->postJson("/api/public/documents/{$document->id}/ingestions")
            ->assertNotFound();

        Http::assertNothingSent();
    }

    public function test_ai_service_failure_returns_a_safe_retryable_error(): void
    {
        [$session, $token] = $this->sessionContext('failed-ingestion-owner');
        $document = Document::factory()->for($session)->create();
        $version = DocumentVersion::factory()->for($document)->create();
        Storage::disk('documents')->put($version->storage_key, '%PDF-1.4');

        Http::fake([
            'http://ai-service:8000/internal/ingestions' => Http::response([
                'detail' => 'Internal diagnostic that must not reach the browser.',
            ], 500),
        ]);

        $this->ownedRequest($token)
            ->postJson("/api/public/documents/{$document->id}/ingestions")
            ->assertStatus(502)
            ->assertExactJson([
                'error' => [
                    'code' => 'ai_service_unavailable',
                    'message' => 'The AI service could not receive this PDF. Please try again.',
                ],
            ]);
    }

    /**
     * @return array{AnonymousSession, string}
     */
    private function sessionContext(string $token): array
    {
        return [
            AnonymousSession::factory()->create([
                'token_hash' => hash('sha256', $token),
            ]),
            $token,
        ];
    }

    private function ownedRequest(string $token): static
    {
        return $this->withHeader('Origin', 'http://localhost')
            ->withCredentials()
            ->withCookie(config('demo.session.cookie'), $token);
    }
}
