<?php

namespace App\Http\Controllers;

use App\Http\Requests\UploadDocumentRequest;
use App\Http\Resources\DocumentResource;
use App\Models\AnonymousSession;
use App\Models\Document;
use App\Services\DocumentStorage;
use App\Services\DocumentUploader;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;

class PublicDocumentController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        /** @var AnonymousSession $session */
        $session = $request->attributes->get('anonymous_session');
        $documents = Document::query()
            ->where(function ($query) use ($session): void {
                $query->where('anonymous_session_id', $session->id)
                    ->orWhere('is_sample', true);
            })
            ->where(function ($query): void {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->with('latestVersion')
            ->latest()
            ->limit(20)
            ->get();

        return DocumentResource::collection($documents);
    }

    public function store(
        UploadDocumentRequest $request,
        DocumentUploader $uploader,
    ): JsonResponse {
        /** @var AnonymousSession $session */
        $session = $request->attributes->get('anonymous_session');
        $result = $uploader->upload($session, $request->file('file'));

        return (new DocumentResource($result['document']))
            ->additional(['meta' => ['duplicate' => $result['duplicate']]])
            ->response()
            ->setStatusCode($result['duplicate'] ? 200 : 201);
    }

    public function show(Document $document): DocumentResource
    {
        return new DocumentResource($document->load('latestVersion'));
    }

    public function source(
        Document $document,
        DocumentStorage $storage,
    ): BinaryFileResponse {
        $version = $document->latestVersion()->firstOrFail();

        if ($version->storage_key === null || ! $storage->disk()->exists($version->storage_key)) {
            abort(404);
        }

        $response = response()->file(
            $storage->disk()->path($version->storage_key),
            [
                'Content-Type' => 'application/pdf',
                'Content-Disposition' => HeaderUtils::makeDisposition(
                    ResponseHeaderBag::DISPOSITION_INLINE,
                    $document->display_name,
                    'document.pdf',
                ),
                'X-Content-Type-Options' => 'nosniff',
            ],
        );

        $response->setPrivate();
        $response->headers->set('Cache-Control', 'private, no-store, max-age=0');

        return $response;
    }

    public function destroy(
        Document $document,
        DocumentStorage $storage,
    ): JsonResponse {
        $document->delete();
        $storage->deleteSources($document);

        return response()->json(['data' => null]);
    }
}
