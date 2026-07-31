<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'display_name' => $this->display_name,
            'source_type' => $this->source_type,
            'status' => $this->status,
            'is_sample' => $this->is_sample,
            'expires_at' => $this->expires_at?->toIso8601String(),
            'versions_count' => $this->whenCounted('versions'),
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
