<?php

namespace App\Services;

use App\Models\AnonymousSession;
use App\Models\Document;
use App\Models\DocumentVersion;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class DocumentUploader
{
    public function __construct(
        private readonly DocumentStorage $storage,
    ) {}

    /**
     * @return array{document: Document, duplicate: bool}
     */
    public function upload(AnonymousSession $session, UploadedFile $file): array
    {
        $realPath = $file->getRealPath();

        if ($realPath === false) {
            throw new \RuntimeException('The uploaded file is unavailable.');
        }

        $checksum = hash_file('sha256', $realPath);
        $duplicate = Document::query()
            ->where('anonymous_session_id', $session->id)
            ->whereHas('versions', fn ($query) => $query->where('content_checksum', $checksum))
            ->with('latestVersion')
            ->latest()
            ->first();

        if (
            $duplicate !== null
            && $duplicate->latestVersion?->storage_key !== null
            && $this->storage->disk()->exists($duplicate->latestVersion->storage_key)
        ) {
            return ['document' => $duplicate, 'duplicate' => true];
        }

        $documentId = (string) Str::ulid();
        $versionId = (string) Str::ulid();
        $storageKey = "{$session->id}/{$documentId}/{$versionId}.pdf";
        $displayName = $this->safeDisplayName($file->getClientOriginalName());

        $this->storage->disk()->putFileAs(
            dirname($storageKey),
            $file,
            basename($storageKey),
        );

        try {
            $document = DB::transaction(function () use (
                $session,
                $file,
                $checksum,
                $documentId,
                $versionId,
                $storageKey,
                $displayName,
            ): Document {
                $document = new Document;
                $document->forceFill([
                    'id' => $documentId,
                    'anonymous_session_id' => $session->id,
                    'display_name' => $displayName,
                    'source_type' => 'upload',
                    'status' => 'pending_ingestion',
                    'expires_at' => $session->expires_at,
                ])->save();

                $document = Document::query()->findOrFail($documentId);

                $version = new DocumentVersion;
                $version->forceFill([
                    'id' => $versionId,
                    'document_id' => $document->id,
                    'version' => 1,
                    'storage_key' => $storageKey,
                    'mime_type' => 'application/pdf',
                    'byte_size' => $file->getSize(),
                    'content_checksum' => $checksum,
                    'ingestion_status' => 'pending',
                ])->save();

                return $document;
            });
        } catch (\Throwable $exception) {
            $this->storage->disk()->delete($storageKey);

            throw $exception;
        }

        return [
            'document' => $document->load('latestVersion'),
            'duplicate' => false,
        ];
    }

    private function safeDisplayName(string $originalName): string
    {
        $name = basename(str_replace('\\', '/', $originalName));
        $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name) ?: 'document.pdf';

        if (! str_ends_with(strtolower($name), '.pdf')) {
            $name .= '.pdf';
        }

        return Str::limit($name, 240, '.pdf');
    }
}
