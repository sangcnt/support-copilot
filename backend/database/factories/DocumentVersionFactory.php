<?php

namespace Database\Factories;

use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<DocumentVersion>
 */
class DocumentVersionFactory extends Factory
{
    public function definition(): array
    {
        return [
            'document_id' => Document::factory(),
            'version' => 1,
            'storage_key' => 'documents/'.Str::ulid().'.pdf',
            'mime_type' => 'application/pdf',
            'byte_size' => fake()->numberBetween(10_000, 2_000_000),
            'content_checksum' => hash('sha256', fake()->uuid()),
            'ingestion_status' => 'pending',
        ];
    }
}
