<?php

namespace Tests\Feature;

use App\Models\AnonymousSession;
use App\Models\Chunk;
use App\Models\Conversation;
use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PublicMessageTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.ai_service.url' => 'http://ai-service:8000']);
    }

    public function test_owner_can_send_a_message_and_receive_a_grounded_stream(): void
    {
        [$session, $token] = $this->sessionContext('chat-owner-token');
        $document = Document::factory()->for($session)->create(['status' => 'ready']);
        $version = DocumentVersion::factory()->for($document)->create(['ingestion_status' => 'ready']);
        $chunk = $this->readyChunk($version);

        Http::fake([
            'http://ai-service:8000/internal/answers/stream' => Http::response(
                $this->sse([
                    ['event' => 'started', 'data' => []],
                    ['event' => 'retrieval', 'data' => [
                        'evidence_sufficient' => true,
                        'chunk_count' => 1,
                        'chunks' => [[
                            'chunk_id' => $chunk->id,
                            'page_start' => 1,
                            'page_end' => 1,
                            'score' => 0.9,
                        ]],
                    ]],
                    ['event' => 'token', 'data' => ['text' => 'Refunds are ']],
                    ['event' => 'token', 'data' => ['text' => 'available.']],
                    ['event' => 'citations', 'data' => [
                        'citations' => [$this->citationPayload($chunk)],
                    ]],
                    ['event' => 'usage', 'data' => [
                        'input_tokens' => 50, 'output_tokens' => 8, 'latency_ms' => 1200,
                    ]],
                    ['event' => 'completed', 'data' => [
                        'fallback' => false,
                        'fallback_reason' => null,
                        'answer' => 'Refunds are available.',
                        'citations' => [$this->citationPayload($chunk)],
                        'model' => 'gpt-test',
                        'input_tokens' => 50,
                        'output_tokens' => 8,
                        'latency_ms' => 1200,
                    ]],
                ]),
                200,
                ['Content-Type' => 'text/event-stream'],
            ),
        ]);

        $response = $this->ownedRequest($token)->post(
            "/api/public/documents/{$document->id}/messages",
            ['content' => 'What is the refund policy?', 'client_message_id' => 'msg-1'],
        );

        $response->assertOk();
        $body = $response->streamedContent();
        $this->assertStringContainsString('event: token', $body);
        $this->assertStringContainsString('Refunds are available.', $body);

        Http::assertSent(function (Request $request) use ($version): bool {
            return $request->url() === 'http://ai-service:8000/internal/answers/stream'
                && $request['document_version_id'] === $version->id
                && $request['query'] === 'What is the refund policy?';
        });

        $this->assertDatabaseCount('conversations', 1);
        $this->assertDatabaseHas('messages', [
            'role' => 'user',
            'content' => 'What is the refund policy?',
            'client_message_id' => 'msg-1',
        ]);
        $this->assertDatabaseHas('messages', [
            'role' => 'assistant',
            'content' => 'Refunds are available.',
            'model' => 'gpt-test',
            'input_tokens' => 50,
            'output_tokens' => 8,
            'latency_ms' => 1200,
        ]);
        $this->assertDatabaseHas('message_citations', [
            'chunk_id' => $chunk->id,
            'citation_order' => 1,
        ]);
        $this->assertDatabaseHas('usage_events', [
            'document_id' => $document->id,
            'event_type' => 'chat',
            'model' => 'gpt-test',
            'input_tokens' => 50,
            'output_tokens' => 8,
        ]);
    }

    public function test_retrying_the_same_client_message_id_does_not_duplicate_messages(): void
    {
        [$session, $token] = $this->sessionContext('chat-retry-token');
        $document = Document::factory()->for($session)->create(['status' => 'ready']);
        DocumentVersion::factory()->for($document)->create(['ingestion_status' => 'ready']);

        Http::fake([
            'http://ai-service:8000/internal/answers/stream' => Http::response(
                $this->sse([
                    ['event' => 'started', 'data' => []],
                    ['event' => 'retrieval', 'data' => [
                        'evidence_sufficient' => false, 'chunk_count' => 0, 'chunks' => [],
                    ]],
                    ['event' => 'completed', 'data' => [
                        'fallback' => true,
                        'fallback_reason' => 'no_relevant_chunks',
                        'answer' => 'I could not find enough information.',
                        'citations' => [],
                        'model' => 'gpt-test',
                        'input_tokens' => 0,
                        'output_tokens' => 0,
                        'latency_ms' => 0,
                    ]],
                ]),
                200,
                ['Content-Type' => 'text/event-stream'],
            ),
        ]);

        $payload = ['content' => 'Unrelated question?', 'client_message_id' => 'retry-1'];

        $first = $this->ownedRequest($token)
            ->post("/api/public/documents/{$document->id}/messages", $payload);
        $first->assertOk();
        $first->streamedContent();

        $second = $this->ownedRequest($token)
            ->post("/api/public/documents/{$document->id}/messages", $payload);
        $second->assertOk();
        $second->streamedContent();

        $this->assertDatabaseCount('conversations', 1);
        $this->assertDatabaseCount('messages', 2); // one user + one assistant, not four
        Http::assertSentCount(1);
    }

    public function test_other_session_cannot_message_a_private_document(): void
    {
        [$owner] = $this->sessionContext('chat-private-owner');
        $document = Document::factory()->for($owner)->create(['status' => 'ready']);
        DocumentVersion::factory()->for($document)->create(['ingestion_status' => 'ready']);
        [, $otherToken] = $this->sessionContext('chat-private-other');

        Http::fake();

        $this->ownedRequest($otherToken)
            ->post(
                "/api/public/documents/{$document->id}/messages",
                ['content' => 'question', 'client_message_id' => 'msg-1'],
            )
            ->assertNotFound();

        Http::assertNothingSent();
    }

    public function test_message_is_rejected_when_the_document_is_not_ready(): void
    {
        [$session, $token] = $this->sessionContext('chat-not-ready-token');
        $document = Document::factory()->for($session)->create(['status' => 'pending_ingestion']);

        Http::fake();

        $this->ownedRequest($token)
            ->post(
                "/api/public/documents/{$document->id}/messages",
                ['content' => 'question', 'client_message_id' => 'msg-1'],
            )
            ->assertStatus(422);

        Http::assertNothingSent();
    }

    public function test_history_restores_persisted_messages_and_citations(): void
    {
        [$session, $token] = $this->sessionContext('chat-history-token');
        $document = Document::factory()->for($session)->create(['status' => 'ready']);
        $version = DocumentVersion::factory()->for($document)->create(['ingestion_status' => 'ready']);
        $chunk = $this->readyChunk($version);

        $conversation = Conversation::query()->create([
            'document_id' => $document->id,
            'anonymous_session_id' => $session->id,
            'status' => 'open',
            'last_message_at' => now(),
        ]);
        $conversation->messages()->create([
            'client_message_id' => 'msg-1',
            'role' => 'user',
            'content' => 'What is the refund policy?',
        ]);
        $assistant = $conversation->messages()->create([
            'role' => 'assistant',
            'content' => 'Refunds are available within 30 days.',
            'model' => 'gpt-test',
        ]);
        $assistant->citations()->create([
            'chunk_id' => $chunk->id,
            'citation_order' => 1,
            'quoted_excerpt' => 'Refunds are available within 30 days.',
            'retrieval_score' => 0.9,
        ]);

        $this->ownedRequest($token)
            ->getJson("/api/public/documents/{$document->id}/messages")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.role', 'user')
            ->assertJsonPath('data.1.role', 'assistant')
            ->assertJsonPath('data.1.citations.0.chunk_id', $chunk->id);
    }

    public function test_history_is_empty_before_any_message_is_sent(): void
    {
        [$session, $token] = $this->sessionContext('chat-empty-history-token');
        $document = Document::factory()->for($session)->create(['status' => 'ready']);

        $this->ownedRequest($token)
            ->getJson("/api/public/documents/{$document->id}/messages")
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    private function readyChunk(DocumentVersion $version): Chunk
    {
        return Chunk::query()->create([
            'document_version_id' => $version->id,
            'ordinal' => 0,
            'page_number' => 1,
            'page_end' => 1,
            'normalized_text' => 'Refunds are available within 30 days.',
            'token_count' => 8,
            'content_checksum' => str_repeat('a', 64),
            'embedding_model' => 'text-embedding-3-small',
            'chunking_version' => 'line-token-v1',
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function citationPayload(Chunk $chunk): array
    {
        return [
            'chunk_id' => $chunk->id,
            'page_start' => 1,
            'page_end' => 1,
            'excerpt' => 'Refunds are available within 30 days.',
            'score' => 0.9,
        ];
    }

    /**
     * @param  list<array{event: string, data: array<string, mixed>}>  $events
     */
    private function sse(array $events): string
    {
        $body = '';

        foreach ($events as $event) {
            $body .= "event: {$event['event']}\n";
            $body .= 'data: '.json_encode($event['data'])."\n\n";
        }

        return $body;
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
