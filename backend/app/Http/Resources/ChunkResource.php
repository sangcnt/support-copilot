<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ChunkResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'chunk_id' => $this->id,
            'ordinal' => $this->ordinal,
            'page_start' => $this->page_number,
            'page_end' => $this->page_end,
            'text' => $this->normalized_text,
        ];
    }
}
