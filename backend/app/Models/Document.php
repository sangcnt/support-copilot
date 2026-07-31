<?php

namespace App\Models;

use Database\Factories\DocumentFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Document extends Model
{
    /** @use HasFactory<DocumentFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    protected $fillable = [
        'anonymous_session_id',
        'display_name',
        'source_type',
        'status',
        'is_sample',
        'expires_at',
        'failure_reason',
    ];

    protected function casts(): array
    {
        return [
            'is_sample' => 'boolean',
            'expires_at' => 'datetime',
        ];
    }

    public function anonymousSession(): BelongsTo
    {
        return $this->belongsTo(AnonymousSession::class);
    }

    public function versions(): HasMany
    {
        return $this->hasMany(DocumentVersion::class);
    }

    public function conversations(): HasMany
    {
        return $this->hasMany(Conversation::class);
    }

    public function usageEvents(): HasMany
    {
        return $this->hasMany(UsageEvent::class);
    }

    public function isAccessibleBy(?AnonymousSession $session): bool
    {
        return $this->is_sample || (
            $session !== null
            && $this->anonymous_session_id === $session->id
        );
    }
}
