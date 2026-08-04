<?php

namespace App\Http\Middleware;

use App\Models\AnonymousSession;
use App\Models\Document;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureDocumentOwner
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $document = $request->route('document');
        $session = $request->attributes->get('anonymous_session');

        if (
            ! $document instanceof Document
            || ! $session instanceof AnonymousSession
            || $document->is_sample
            || $document->anonymous_session_id !== $session->id
        ) {
            abort(404);
        }

        return $next($request);
    }
}
