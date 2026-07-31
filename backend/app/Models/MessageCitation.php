<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MessageCitation extends Model
{
    protected $fillable = [
        'message_id',
        'chunk_id',
        'citation_order',
        'quoted_excerpt',
        'retrieval_score',
    ];

    protected function casts(): array
    {
        return [
            'citation_order' => 'integer',
            'retrieval_score' => 'decimal:6',
        ];
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }

    public function chunk(): BelongsTo
    {
        return $this->belongsTo(Chunk::class);
    }
}
