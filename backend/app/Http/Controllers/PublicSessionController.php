<?php

namespace App\Http\Controllers;

use App\Http\Resources\AnonymousSessionResource;
use App\Services\AnonymousSessionManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PublicSessionController extends Controller
{
    public function __invoke(
        Request $request,
        AnonymousSessionManager $sessions,
    ): JsonResponse {
        $context = $sessions->start($request);

        return (new AnonymousSessionResource($context['session']))->response()
            ->setStatusCode(200)
            ->withCookie($context['cookie']);
    }
}
