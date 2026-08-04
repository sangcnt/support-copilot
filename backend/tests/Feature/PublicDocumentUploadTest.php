<?php

namespace Tests\Feature;

use App\Models\AnonymousSession;
use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PublicDocumentUploadTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('documents');
    }

    public function test_anonymous_visitor_can_upload_a_private_pdf(): void
    {
        [$session, $token] = $this->sessionContext('upload-owner-token');

        $response = $this->upload($token, $this->pdf('refund-policy.pdf'))
            ->assertCreated()
            ->assertJsonPath('data.display_name', 'refund-policy.pdf')
            ->assertJsonPath('data.status', 'pending_ingestion')
            ->assertJsonPath('data.latest_version.mime_type', 'application/pdf')
            ->assertJsonPath('data.latest_version.ingestion_status', 'pending')
            ->assertJsonPath('meta.duplicate', false);

        $document = Document::query()->findOrFail($response->json('data.id'));
        $version = $document->latestVersion()->firstOrFail();

        $this->assertSame($session->id, $document->anonymous_session_id);
        $this->assertSame($session->expires_at->getTimestamp(), $document->expires_at->getTimestamp());
        $this->assertNotNull($version->content_checksum);
        Storage::disk('documents')->assertExists($version->storage_key);
    }

    public function test_upload_requires_a_valid_anonymous_session(): void
    {
        $this->post('/api/public/documents', [
            'file' => $this->pdf('policy.pdf'),
        ], ['Accept' => 'application/json'])
            ->assertUnauthorized()
            ->assertJsonPath('error.code', 'anonymous_session_required');
    }

    public function test_non_pdf_and_oversized_files_are_rejected(): void
    {
        [, $token] = $this->sessionContext('validation-owner-token');

        $this->upload(
            $token,
            UploadedFile::fake()->createWithContent('not-a-pdf.pdf', 'plain text'),
        )
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'validation_failed')
            ->assertJsonStructure(['error' => ['details' => ['file']]]);

        config(['demo.documents.max_kilobytes' => 1]);

        $this->upload(
            $token,
            $this->pdf('too-large.pdf', 2048),
        )
            ->assertUnprocessable()
            ->assertJsonStructure(['error' => ['details' => ['file']]]);

        $this->assertDatabaseCount('documents', 0);
        $this->assertSame([], Storage::disk('documents')->allFiles());
    }

    public function test_duplicate_pdf_reuses_the_existing_document_and_source(): void
    {
        [, $token] = $this->sessionContext('duplicate-owner-token');
        $content = $this->pdfContent();

        $first = $this->upload(
            $token,
            UploadedFile::fake()->createWithContent('first-name.pdf', $content),
        )->assertCreated();

        $this->upload(
            $token,
            UploadedFile::fake()->createWithContent('second-name.pdf', $content),
        )
            ->assertOk()
            ->assertJsonPath('data.id', $first->json('data.id'))
            ->assertJsonPath('data.display_name', 'first-name.pdf')
            ->assertJsonPath('meta.duplicate', true);

        $this->assertDatabaseCount('documents', 1);
        $this->assertDatabaseCount('document_versions', 1);
        $this->assertCount(1, Storage::disk('documents')->allFiles());
    }

    public function test_owner_can_preview_and_delete_the_private_pdf(): void
    {
        [, $token] = $this->sessionContext('source-owner-token');
        $documentId = $this->upload($token, $this->pdf('support guide.pdf'))
            ->assertCreated()
            ->json('data.id');
        $version = DocumentVersion::query()->firstOrFail();

        $source = $this->ownedRequest($token)
            ->get("/api/public/documents/{$documentId}/source");

        $source->assertOk()->assertHeader('content-type', 'application/pdf');
        $this->assertStringStartsWith(
            'inline;',
            (string) $source->headers->get('content-disposition'),
        );
        $cacheControl = (string) $source->headers->get('cache-control');
        $this->assertStringContainsString('private', $cacheControl);
        $this->assertStringContainsString('no-store', $cacheControl);

        $this->ownedRequest($token)
            ->deleteJson("/api/public/documents/{$documentId}")
            ->assertOk()
            ->assertExactJson(['data' => null]);

        $this->assertSoftDeleted('documents', ['id' => $documentId]);
        Storage::disk('documents')->assertMissing($version->storage_key);
    }

    public function test_other_session_cannot_preview_or_delete_a_private_pdf(): void
    {
        [, $ownerToken] = $this->sessionContext('private-owner-token');
        $documentId = $this->upload($ownerToken, $this->pdf('private.pdf'))
            ->assertCreated()
            ->json('data.id');
        $version = DocumentVersion::query()->firstOrFail();
        [, $otherToken] = $this->sessionContext('different-session-token');

        $this->ownedRequest($otherToken)
            ->getJson("/api/public/documents/{$documentId}/source")
            ->assertNotFound();
        $this->ownedRequest($otherToken)
            ->deleteJson("/api/public/documents/{$documentId}")
            ->assertNotFound();

        $this->assertDatabaseHas('documents', [
            'id' => $documentId,
            'deleted_at' => null,
        ]);
        Storage::disk('documents')->assertExists($version->storage_key);
    }

    public function test_document_list_contains_only_session_documents_and_public_samples(): void
    {
        [$owner, $ownerToken] = $this->sessionContext('list-owner-token');
        [$other] = $this->sessionContext('list-other-token');
        $owned = Document::factory()->for($owner)->create();
        $foreign = Document::factory()->for($other)->create();
        $sample = Document::factory()->sample()->create();

        $response = $this->ownedRequest($ownerToken)
            ->getJson('/api/public/documents')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('id');

        $this->assertTrue($ids->contains($owned->id));
        $this->assertTrue($ids->contains($sample->id));
        $this->assertFalse($ids->contains($foreign->id));
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

    private function upload(string $token, UploadedFile $file)
    {
        return $this->ownedRequest($token)->post('/api/public/documents', [
            'file' => $file,
        ], ['Accept' => 'application/json']);
    }

    private function ownedRequest(string $token): static
    {
        return $this->withHeader('Origin', 'http://localhost')
            ->withCredentials()
            ->withCookie(config('demo.session.cookie'), $token);
    }

    private function pdf(string $name, int $minimumBytes = 0): UploadedFile
    {
        $content = $this->pdfContent();

        if (strlen($content) < $minimumBytes) {
            $content .= str_repeat(' ', $minimumBytes - strlen($content));
        }

        return UploadedFile::fake()->createWithContent($name, $content);
    }

    private function pdfContent(): string
    {
        return "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF";
    }
}
