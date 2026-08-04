<?php

namespace Tests\Feature;

use App\Models\AnonymousSession;
use App\Models\Document;
use App\Services\AnonymousSessionManager;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class PublicDocumentAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_anonymous_visitor_can_only_read_their_own_document(): void
    {
        $ownerToken = 'owner-session-token';
        $owner = AnonymousSession::factory()->create([
            'token_hash' => hash('sha256', $ownerToken),
        ]);
        $document = Document::factory()->for($owner)->ready()->create();

        $request = Request::create(
            "/api/public/documents/{$document->id}",
            'GET',
            cookies: [config('demo.session.cookie') => $ownerToken],
        );

        $this->assertSame($owner->id, $document->anonymous_session_id);
        $this->assertSame(
            $owner->id,
            app(AnonymousSessionManager::class)->resolve($request)?->id,
        );

        $this->withHeader('Origin', 'http://localhost')
            ->withCredentials()
            ->withCookie(config('demo.session.cookie'), $ownerToken)
            ->getJson("/api/public/documents/{$document->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $document->id);

        $otherToken = 'other-session-token';
        AnonymousSession::factory()->create([
            'token_hash' => hash('sha256', $otherToken),
        ]);

        $this->withHeader('Origin', 'http://localhost')
            ->withCredentials()
            ->withCookie(config('demo.session.cookie'), $otherToken)
            ->getJson("/api/public/documents/{$document->id}")
            ->assertNotFound()
            ->assertExactJson([
                'error' => [
                    'code' => 'not_found',
                    'message' => 'The requested resource was not found.',
                ],
            ]);
    }

    public function test_sample_document_is_readable_without_an_anonymous_cookie(): void
    {
        $sample = Document::factory()->sample()->create();

        $this->getJson("/api/public/documents/{$sample->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $sample->id)
            ->assertJsonPath('data.is_sample', true);
    }

    public function test_expired_private_document_is_no_longer_accessible(): void
    {
        $token = 'active-owner-with-expired-document';
        $owner = AnonymousSession::factory()->create([
            'token_hash' => hash('sha256', $token),
        ]);
        $document = Document::factory()->for($owner)->create([
            'expires_at' => now()->subMinute(),
        ]);

        $this->withHeader('Origin', 'http://localhost')
            ->withCredentials()
            ->withCookie(config('demo.session.cookie'), $token)
            ->getJson("/api/public/documents/{$document->id}")
            ->assertNotFound();
    }
}
