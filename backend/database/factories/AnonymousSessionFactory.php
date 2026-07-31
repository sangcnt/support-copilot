<?php

namespace Database\Factories;

use App\Models\AnonymousSession;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<AnonymousSession>
 */
class AnonymousSessionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'token_hash' => hash('sha256', Str::random(64)),
            'last_seen_at' => now(),
            'expires_at' => now()->addDays(7),
        ];
    }

    public function expired(): static
    {
        return $this->state(fn () => [
            'expires_at' => now()->subMinute(),
        ]);
    }
}
