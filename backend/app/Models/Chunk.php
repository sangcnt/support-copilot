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
        'normalized_text',
        'token_count',
        'content_checksum',
        'embedding_model',
        'chunking_version',
    ];

    protected function casts(): array
    {
        return [
            'ordinal' => 'integer',
            'page_number' => 'integer',
            'token_count' => 'integer',
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
