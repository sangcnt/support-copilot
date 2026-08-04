<?php

namespace App\Http\Middleware;

use App\Services\AnonymousSessionManager;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAnonymousSession
{
    public function __construct(
        private readonly AnonymousSessionManager $sessions,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $session = $this->sessions->resolve($request);

        if ($session === null) {
            return response()->json([
                'error' => [
                    'code' => 'anonymous_session_required',
                    'message' => 'Start a demo session before continuing.',
                ],
            ], 401);
        }

        $request->attributes->set('anonymous_session', $session);

        return $next($request);
    }
}
