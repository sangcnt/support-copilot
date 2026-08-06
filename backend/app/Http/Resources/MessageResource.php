<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'role' => $this->role,
            'content' => $this->content,
            'model' => $this->model,
            'latency_ms' => $this->latency_ms,
            'input_tokens' => $this->input_tokens,
            'output_tokens' => $this->output_tokens,
            'fallback_reason' => $this->fallback_reason,
            'citations' => MessageCitationResource::collection(
                $this->whenLoaded('citations'),
            ),
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
