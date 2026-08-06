<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MessageCitationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'chunk_id' => $this->chunk_id,
            'citation_order' => $this->citation_order,
            'excerpt' => $this->quoted_excerpt,
            'retrieval_score' => $this->retrieval_score === null
                ? null
                : (float) $this->retrieval_score,
        ];
    }
}
