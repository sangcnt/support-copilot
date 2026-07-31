<?php

namespace App\Http\Middleware;

use App\Models\Document;
use App\Services\AnonymousSessionManager;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureDocumentAccess
{
    public function __construct(
        private readonly AnonymousSessionManager $sessions,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $document = $request->route('document');

        if (! $document instanceof Document) {
            abort(404);
        }

        $session = $this->sessions->resolve($request);

        if (! $document->isAccessibleBy($session)) {
            abort(404);
        }

        $request->attributes->set('anonymous_session', $session);

        return $next($request);
    }
}
