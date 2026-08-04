<?php

namespace App\Services;

use App\Models\Document;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class DocumentStorage
{
    public function disk(): FilesystemAdapter
    {
        return Storage::disk((string) config('demo.documents.disk'));
    }

    public function deleteSources(Document $document): void
    {
        $keys = $document->versions()
            ->whereNotNull('storage_key')
            ->pluck('storage_key')
            ->all();

        if ($keys === []) {
            return;
        }

        try {
            $this->disk()->delete($keys);
        } catch (\Throwable $exception) {
            Log::error('Unable to delete private document sources.', [
                'document_id' => $document->id,
                'exception' => $exception,
            ]);
        }
    }
}
