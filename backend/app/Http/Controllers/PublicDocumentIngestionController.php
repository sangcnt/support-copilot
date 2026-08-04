<?php

namespace App\Http\Controllers;

use App\Models\Document;
use App\Services\AiIngestionClient;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class PublicDocumentIngestionController extends Controller
{
    public function __invoke(
        Document $document,
        AiIngestionClient $client,
    ): JsonResponse {
        try {
            $receipt = $client->receive($document);
        } catch (ConnectionException|RequestException $exception) {
            Log::warning('The AI service could not receive a document source.', [
                'document_id' => $document->id,
                'exception' => $exception,
            ]);

            return response()->json([
                'error' => [
                    'code' => 'ai_service_unavailable',
                    'message' => 'The AI service could not receive this PDF. Please try again.',
                ],
            ], 502);
        }

        return response()->json(['data' => $receipt], 202);
    }
}
