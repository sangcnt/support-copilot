<?php

namespace App\Policies;

use App\Models\Document;
use App\Models\User;

class DocumentPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->is_admin;
    }

    public function view(User $user, Document $document): bool
    {
        return $user->is_admin;
    }

    public function update(User $user, Document $document): bool
    {
        return $user->is_admin;
    }

    public function delete(User $user, Document $document): bool
    {
        return $user->is_admin;
    }

    public function markSample(User $user, Document $document): bool
    {
        return $user->is_admin;
    }
}
