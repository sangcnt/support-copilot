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
            ], 202),
        ]);

        $this->ownedRequest($token)
            ->postJson("/api/public/documents/{$document->id}/ingestions")
            ->assertStatus(202)
            ->assertJsonPath('data.status', 'received')
            ->assertJsonPath('data.document_version_id', $version->id)
            ->assertJsonPath('data.file.checksum_matches', true);

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
