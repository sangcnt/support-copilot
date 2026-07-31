<?php

namespace App\Http\Controllers;

use App\Models\UsageEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

class AdminUsageController extends Controller
{
    public function __invoke(): JsonResponse
    {
        Gate::authorize('viewAny', UsageEvent::class);
        $query = UsageEvent::query();

        return response()->json([
            'data' => [
                'requests' => (clone $query)->where('event_type', 'chat')->count(),
                'input_tokens' => (int) (clone $query)->sum('input_tokens'),
                'output_tokens' => (int) (clone $query)->sum('output_tokens'),
                'estimated_cost' => number_format(
                    (float) (clone $query)->sum('estimated_cost'),
                    6,
                    '.',
                    '',
                ),
            ],
        ]);
    }
}
