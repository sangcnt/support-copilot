<?php

namespace App\Http\Controllers;

use App\Http\Resources\ConversationResource;
use App\Models\Conversation;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class AdminConversationController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Conversation::class);

        $conversations = Conversation::query()
            ->withCount('messages')
            ->latest('last_message_at')
            ->limit(50)
            ->get();

        return ConversationResource::collection($conversations);
    }
}
