<?php

namespace App\Http\Controllers;

use App\Http\Resources\MessageResource;
use App\Models\AnonymousSession;
use App\Models\Conversation;
use App\Models\Document;
use App\Models\DocumentVersion;
use App\Models\Message;
use App\Models\UsageEvent;
use App\Services\AiAnswerClient;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class PublicMessageController extends Controller
{
    public function index(Request $request, Document $document): AnonymousResourceCollection
    {
        /** @var AnonymousSession $session */
        $session = $request->attributes->get('anonymous_session');

        $conversation = $this->findConversation($document, $session);
        $messages = $conversation === null
            ? collect()
            : $conversation->messages()->with('citations')->orderBy('created_at')->get();

        return MessageResource::collection($messages);
    }

    public function store(
        Request $request,
        Document $document,
        AiAnswerClient $client,
    ): StreamedResponse {
        $validated = $request->validate([
            'content' => ['required', 'string', 'min:1', 'max:4000'],
            'client_message_id' => ['required', 'string', 'max:64'],
        ]);

        if ($document->status !== 'ready') {
            abort(422, 'This document is not ready for chat yet.');
        }

        /** @var AnonymousSession $session */
        $session = $request->attributes->get('anonymous_session');
        $version = $document->latestVersion()->firstOrFail();

        $conversation = Conversation::query()->firstOrCreate(
            [
                'document_id' => $document->id,
                'anonymous_session_id' => $session->id,
            ],
            ['status' => 'open', 'last_message_at' => now()],
        );

        $userMessage = $conversation->messages()
            ->where('client_message_id', $validated['client_message_id'])
            ->first();

        if ($userMessage !== null) {
            $existingReply = $conversation->messages()
                ->where('role', 'assistant')
                ->where('id', '>', $userMessage->id)
                ->orderBy('id')
                ->with('citations')
                ->first();

            if ($existingReply !== null) {
                return $this->replay($existingReply);
            }
        } else {
            $userMessage = $conversation->messages()->create([
                'client_message_id' => $validated['client_message_id'],
                'role' => 'user',
                'content' => $validated['content'],
            ]);
            $conversation->forceFill(['last_message_at' => now()])->save();
        }

        // A grounded streaming answer can legitimately take longer than the
        // default PHP execution limit; the browser-facing timeout is
        // governed by nginx/fastcgi instead (see infrastructure/nginx).
        set_time_limit(0);

        return response()->stream(
            function () use ($client, $version, $validated, $conversation): void {
                $this->relay($client, $version, $validated['content'], $conversation);
            },
            200,
            [
                'Content-Type' => 'text/event-stream',
                'Cache-Control' => 'no-cache',
                'X-Accel-Buffering' => 'no',
            ],
        );
    }

    private function relay(
        AiAnswerClient $client,
        DocumentVersion $version,
        string $query,
        Conversation $conversation,
    ): void {
        $completedPayload = null;

        try {
            foreach ($client->stream($version, $query) as $event) {
                $this->emit($event['event'], $event['data']);

                if ($event['event'] === 'completed') {
                    $completedPayload = $event['data'];
                }

                if (connection_aborted()) {
                    return;
                }
            }
        } catch (Throwable $exception) {
            Log::warning('Chat answer stream failed.', [
                'conversation_id' => $conversation->id,
                'exception' => $exception,
            ]);

            if (! connection_aborted()) {
                $this->emit('error', [
                    'message' => 'The answer stream failed. Please try again.',
                ]);
            }

            return;
        }

        if ($completedPayload !== null) {
            $this->persistAssistantReply($conversation, $completedPayload);
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function persistAssistantReply(Conversation $conversation, array $payload): void
    {
        DB::transaction(function () use ($conversation, $payload): void {
            $message = $conversation->messages()->create([
                'role' => 'assistant',
                'content' => (string) ($payload['answer'] ?? ''),
                'model' => $payload['model'] ?? null,
                'latency_ms' => $payload['latency_ms'] ?? null,
                'input_tokens' => $payload['input_tokens'] ?? null,
                'output_tokens' => $payload['output_tokens'] ?? null,
                'fallback_reason' => $payload['fallback_reason'] ?? null,
            ]);

            $citations = is_array($payload['citations'] ?? null) ? $payload['citations'] : [];

            foreach (array_values($citations) as $order => $citation) {
                if (! is_array($citation) || ! isset($citation['chunk_id'])) {
                    continue;
                }

                $message->citations()->create([
                    'chunk_id' => $citation['chunk_id'],
                    'citation_order' => $order + 1,
                    'quoted_excerpt' => (string) ($citation['excerpt'] ?? ''),
                    'retrieval_score' => $citation['score'] ?? null,
                ]);
            }

            $conversation->forceFill(['last_message_at' => now()])->save();

            UsageEvent::query()->create([
                'anonymous_session_id' => $conversation->anonymous_session_id,
                'document_id' => $conversation->document_id,
                'conversation_id' => $conversation->id,
                'message_id' => $message->id,
                'event_type' => 'chat',
                'provider' => 'openai',
                'model' => $payload['model'] ?? null,
                'input_tokens' => $payload['input_tokens'] ?? 0,
                'output_tokens' => $payload['output_tokens'] ?? 0,
                'latency_ms' => $payload['latency_ms'] ?? null,
            ]);
        });
    }

    private function replay(Message $assistantMessage): StreamedResponse
    {
        return response()->stream(
            function () use ($assistantMessage): void {
                $this->emit('started', []);
                $this->emit('completed', [
                    'fallback' => $assistantMessage->fallback_reason !== null,
                    'fallback_reason' => $assistantMessage->fallback_reason,
                    'answer' => $assistantMessage->content,
                    'citations' => $assistantMessage->citations->map(fn ($citation) => [
                        'chunk_id' => $citation->chunk_id,
                        'excerpt' => $citation->quoted_excerpt,
                        'score' => $citation->retrieval_score === null
                            ? null
                            : (float) $citation->retrieval_score,
                    ])->all(),
                    'model' => $assistantMessage->model,
                    'input_tokens' => $assistantMessage->input_tokens,
                    'output_tokens' => $assistantMessage->output_tokens,
                    'latency_ms' => $assistantMessage->latency_ms,
                ]);
            },
            200,
            [
                'Content-Type' => 'text/event-stream',
                'Cache-Control' => 'no-cache',
                'X-Accel-Buffering' => 'no',
            ],
        );
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function emit(string $event, array $data): void
    {
        echo "event: {$event}\n";
        echo 'data: '.json_encode($data)."\n\n";

        if (ob_get_level() > 0) {
            ob_flush();
        }

        flush();
    }

    private function findConversation(Document $document, AnonymousSession $session): ?Conversation
    {
        return Conversation::query()
            ->where('document_id', $document->id)
            ->where('anonymous_session_id', $session->id)
            ->first();
    }
}
