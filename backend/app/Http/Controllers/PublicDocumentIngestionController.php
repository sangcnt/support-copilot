<?php

namespace App\Http\Controllers;

use App\Http\Resources\DocumentResource;
use App\Models\Document;
use App\Services\AiIngestionClient;
use App\Services\DocumentIngestionLifecycle;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class PublicDocumentIngestionController extends Controller
{
    public function __invoke(
        Document $document,
        AiIngestionClient $client,
        DocumentIngestionLifecycle $lifecycle,
    ): JsonResponse {
        $version = $lifecycle->start($document);
        $startedAt = hrtime(true);

        try {
            $receipt = $client->receive($document, $version);
            $readyDocument = $lifecycle->complete(
                $document,
                $version,
                $receipt,
                (int) round((hrtime(true) - $startedAt) / 1_000_000),
            );
        } catch (Throwable $exception) {
            [$failureCode, $safeReason, $statusCode] = $this->failureDetails($exception);
            $lifecycle->fail(
                $document,
                $version,
                $failureCode,
                $safeReason,
                $exception,
            );

            Log::warning('Document ingestion failed.', [
                'document_id' => $document->id,
                'document_version_id' => $version->id,
                'failure_code' => $failureCode,
                'exception' => $exception,
            ]);

            return response()->json([
                'error' => [
                    'code' => $failureCode,
                    'message' => $safeReason,
                ],
            ], $statusCode);
        }

        $publicReceipt = Arr::except($receipt, ['embedding_records']);
        $publicReceipt['document'] = (new DocumentResource($readyDocument))->resolve(request());

        return response()->json(['data' => $publicReceipt], 202);
    }

    /** @return array{string, string, int} */
    private function failureDetails(Throwable $exception): array
    {
        if (
            $exception instanceof RequestException
            && $exception->response->status() === Response::HTTP_UNPROCESSABLE_ENTITY
        ) {
            return [
                'document_unprocessable',
                'This PDF does not contain extractable text that can be processed.',
                Response::HTTP_UNPROCESSABLE_ENTITY,
            ];
        }

        if (
            $exception instanceof ConnectionException
            || $exception instanceof RequestException
            || $exception instanceof RuntimeException
        ) {
            return [
                'document_processing_unavailable',
                'Document processing is temporarily unavailable. Please try again.',
                Response::HTTP_BAD_GATEWAY,
            ];
        }

        return [
            'document_processing_failed',
            'The document could not be processed. Please try again.',
            Response::HTTP_INTERNAL_SERVER_ERROR,
        ];
    }
}
