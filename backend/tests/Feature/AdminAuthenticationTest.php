<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminAuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_administrator_can_login_with_a_stateful_session(): void
    {
        $admin = User::factory()->administrator()->create([
            'password' => 'correct-password',
        ]);

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/auth/login', [
                'email' => $admin->email,
                'password' => 'correct-password',
            ])
            ->assertOk()
            ->assertJsonPath('data.id', $admin->id)
            ->assertJsonPath('data.is_admin', true);

        $this->assertAuthenticatedAs($admin, 'web');
    }

    public function test_regular_user_cannot_login_to_the_admin_area(): void
    {
        $user = User::factory()->create([
            'password' => 'correct-password',
        ]);

        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/auth/login', [
                'email' => $user->email,
                'password' => 'correct-password',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'validation_failed');

        $this->assertGuest('web');
    }

    public function test_admin_endpoints_require_authentication_and_admin_role(): void
    {
        $this->getJson('/api/admin/documents')
            ->assertUnauthorized()
            ->assertExactJson([
                'error' => [
                    'code' => 'unauthenticated',
                    'message' => 'Authentication is required.',
                ],
            ]);

        $this->get('/api/admin/documents')
            ->assertUnauthorized()
            ->assertHeader('content-type', 'application/json');

        $user = User::factory()->create();

        $this->actingAs($user)
            ->getJson('/api/admin/documents')
            ->assertForbidden()
            ->assertJsonPath('error.code', 'admin_access_required');
    }

    public function test_login_validation_uses_the_standard_error_envelope(): void
    {
        $this->withHeader('Origin', 'http://localhost')
            ->postJson('/api/auth/login', [])
            ->assertUnprocessable()
            ->assertJsonStructure([
                'error' => [
                    'code',
                    'message',
                    'details' => ['email', 'password'],
                ],
            ]);
    }

    public function test_administrator_can_access_each_protected_read_endpoint(): void
    {
        $admin = User::factory()->administrator()->create();

        $this->actingAs($admin)->getJson('/api/admin/documents')->assertOk();
        $this->actingAs($admin)->getJson('/api/admin/conversations')->assertOk();
        $this->actingAs($admin)
            ->getJson('/api/admin/usage')
            ->assertOk()
            ->assertJsonPath('data.requests', 0)
            ->assertJsonPath('data.estimated_cost', '0.000000');
    }
}
