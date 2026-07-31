<?php

namespace Database\Factories;

use App\Models\AnonymousSession;
use App\Models\Conversation;
use App\Models\Document;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Conversation>
 */
class ConversationFactory extends Factory
{
    public function definition(): array
    {
        return [
            'anonymous_session_id' => AnonymousSession::factory(),
            'document_id' => Document::factory(),
            'status' => 'open',
            'last_message_at' => null,
        ];
    }
}
