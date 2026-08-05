<?php

namespace App\Models;

use Database\Factories\DocumentVersionFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DocumentVersion extends Model
{
    /** @use HasFactory<DocumentVersionFactory> */
    use HasFactory, HasUlids;

    protected $fillable = [
        'document_id',
        'version',
        'storage_key',
        'mime_type',
        'byte_size',
        'content_checksum',
        'parser_version',
        'parser_metadata',
        'chunking_version',
        'chunking_checksum',
        'embedding_provider',
        'embedding_model',
        'embedding_dimensions',
        'embedding_input_tokens',
        'ingestion_status',
        'failure_code',
        'failure_diagnostic',
        'ingestion_started_at',
        'ingestion_completed_at',
        'ingestion_failed_at',
    ];

    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'byte_size' => 'integer',
            'parser_metadata' => 'array',
            'embedding_dimensions' => 'integer',
            'embedding_input_tokens' => 'integer',
            'ingestion_started_at' => 'datetime',
            'ingestion_completed_at' => 'datetime',
            'ingestion_failed_at' => 'datetime',
        ];
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    public function chunks(): HasMany
    {
        return $this->hasMany(Chunk::class);
    }
}
