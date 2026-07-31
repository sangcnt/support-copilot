<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateSampleDocumentRequest;
use App\Http\Resources\DocumentResource;
use App\Models\AuditEvent;
use App\Models\Document;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class AdminDocumentController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Document::class);

        $documents = Document::query()
            ->withCount('versions')
            ->latest()
            ->limit(50)
            ->get();

        return DocumentResource::collection($documents);
    }

    public function updateSample(
        UpdateSampleDocumentRequest $request,
        Document $document,
    ): DocumentResource {
        Gate::authorize('markSample', $document);
        $isSample = $request->boolean('is_sample');

        if ($isSample && $document->status !== 'ready') {
            throw ValidationException::withMessages([
                'is_sample' => ['Only a ready document can become the public sample.'],
            ]);
        }

        DB::transaction(function () use ($document, $isSample, $request): void {
            $document->forceFill([
                'anonymous_session_id' => $isSample ? null : $document->anonymous_session_id,
                'is_sample' => $isSample,
                'expires_at' => $isSample ? null : $document->expires_at,
            ])->save();

            AuditEvent::query()->create([
                'user_id' => $request->user()->id,
                'action' => $isSample ? 'document.sample_enabled' : 'document.sample_disabled',
                'auditable_type' => Document::class,
                'auditable_id' => $document->id,
            ]);
        });

        return new DocumentResource($document->refresh());
    }

    public function destroy(Request $request, Document $document): JsonResponse
    {
        Gate::authorize('delete', $document);

        DB::transaction(function () use ($document, $request): void {
            AuditEvent::query()->create([
                'user_id' => $request->user()->id,
                'action' => 'document.deleted',
                'auditable_type' => Document::class,
                'auditable_id' => $document->id,
            ]);

            $document->delete();
        });

        return response()->json(['data' => null]);
    }
}
