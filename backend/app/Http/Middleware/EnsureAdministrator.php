<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdministrator
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()?->is_admin) {
            return response()->json([
                'error' => [
                    'code' => 'admin_access_required',
                    'message' => 'Administrator access is required.',
                ],
            ], 403);
        }

        return $next($request);
    }
}
