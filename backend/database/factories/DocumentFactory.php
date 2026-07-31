<?php

namespace Database\Factories;

use App\Models\AnonymousSession;
use App\Models\Document;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Document>
 */
class DocumentFactory extends Factory
{
    public function definition(): array
    {
        return [
            'anonymous_session_id' => AnonymousSession::factory(),
            'display_name' => fake()->words(3, true).'.pdf',
            'source_type' => 'upload',
            'status' => 'pending',
            'is_sample' => false,
            'expires_at' => now()->addDays(7),
        ];
    }

    public function ready(): static
    {
        return $this->state(fn () => ['status' => 'ready']);
    }

    public function sample(): static
    {
        return $this->state(fn () => [
            'anonymous_session_id' => null,
            'status' => 'ready',
            'is_sample' => true,
            'expires_at' => null,
        ]);
    }
}
