<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Chunk extends Model
{
    use HasUlids;

    protected $fillable = [
        'document_version_id',
        'ordinal',
        'heading',
        'page_number',
        'page_end',
        'normalized_text',
        'token_count',
        'content_checksum',
        'embedding_model',
        'chunking_version',
        'source_text_start',
        'source_text_end',
        'source_spans',
        'embedding',
    ];

    protected function casts(): array
    {
        return [
            'ordinal' => 'integer',
            'page_number' => 'integer',
            'page_end' => 'integer',
            'token_count' => 'integer',
            'source_text_start' => 'integer',
            'source_text_end' => 'integer',
            'source_spans' => 'array',
        ];
    }

    public function documentVersion(): BelongsTo
    {
        return $this->belongsTo(DocumentVersion::class);
    }

    public function citations(): HasMany
    {
        return $this->hasMany(MessageCitation::class);
    }
}
