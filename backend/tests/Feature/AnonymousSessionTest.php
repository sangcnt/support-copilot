<?php

namespace Tests\Feature;

use App\Models\AnonymousSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AnonymousSessionTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_visitor_can_start_and_resume_an_anonymous_session(): void
    {
        $firstResponse = $this->withHeader('Origin', 'http://localhost')
            ->getJson('/api/public/session')
            ->assertOk()
            ->assertJsonStructure([
                'data' => ['id', 'expires_at'],
            ])
            ->assertCookie(config('demo.session.cookie'));

        $sessionId = $firstResponse->json('data.id');
        $token = $firstResponse->getCookie(config('demo.session.cookie'))->getValue();

        $this->withHeader('Origin', 'http://localhost')
            ->withCredentials()
            ->withCookie(config('demo.session.cookie'), $token)
            ->getJson('/api/public/session')
            ->assertOk()
            ->assertJsonPath('data.id', $sessionId);

        $this->assertDatabaseCount('anonymous_sessions', 1);
    }

    public function test_expired_cookie_is_replaced_with_a_new_session(): void
    {
        $expiredToken = 'expired-public-session-token';
        $expiredSession = AnonymousSession::factory()->expired()->create([
            'token_hash' => hash('sha256', $expiredToken),
        ]);

        $this->withHeader('Origin', 'http://localhost')
            ->withCredentials()
            ->withCookie(config('demo.session.cookie'), $expiredToken)
            ->getJson('/api/public/session')
            ->assertOk()
            ->assertJsonMissing(['id' => $expiredSession->id]);

        $this->assertDatabaseCount('anonymous_sessions', 2);
    }
}
