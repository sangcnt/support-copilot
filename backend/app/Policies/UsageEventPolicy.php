<?php

namespace App\Policies;

use App\Models\UsageEvent;
use App\Models\User;

class UsageEventPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->is_admin;
    }

    public function view(User $user, UsageEvent $usageEvent): bool
    {
        return $user->is_admin;
    }
}
