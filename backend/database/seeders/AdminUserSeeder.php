<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $email = (string) env('ADMIN_EMAIL');
        $password = (string) env('ADMIN_PASSWORD');

        if ($email === '' || $password === '') {
            $this->command?->warn('Admin seed skipped: ADMIN_EMAIL and ADMIN_PASSWORD are not configured.');

            return;
        }

        User::query()->updateOrCreate(
            ['email' => $email],
            [
                'name' => (string) env('ADMIN_NAME', 'Support Copilot Admin'),
                'password' => $password,
                'is_admin' => true,
            ],
        );
    }
}
