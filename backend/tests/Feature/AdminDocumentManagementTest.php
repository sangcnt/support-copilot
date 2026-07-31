<?php

namespace Tests\Feature;

use App\Models\AnonymousSession;
use App\Models\AuditEvent;
use App\Models\Document;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminDocumentManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_promote_a_ready_document_to_the_public_sample(): void
    {
        $admin = User::factory()->administrator()->create();
        $session = AnonymousSession::factory()->create();
        $document = Document::factory()->for($session)->ready()->create();

        $this->actingAs($admin)
            ->patchJson("/api/admin/documents/{$document->id}/sample", [
                'is_sample' => true,
            ])
            ->assertOk()
            ->assertJsonPath('data.is_sample', true)
            ->assertJsonPath('data.expires_at', null);

        $document->refresh();

        $this->assertTrue($document->is_sample);
        $this->assertNull($document->anonymous_session_id);
        $this->assertNull($document->expires_at);
        $this->assertDatabaseHas('audit_events', [
            'user_id' => $admin->id,
            'action' => 'document.sample_enabled',
            'auditable_id' => $document->id,
        ]);
    }

    public function test_non_ready_document_cannot_become_the_public_sample(): void
    {
        $admin = User::factory()->administrator()->create();
        $document = Document::factory()->create(['status' => 'processing']);

        $this->actingAs($admin)
            ->patchJson("/api/admin/documents/{$document->id}/sample", [
                'is_sample' => true,
            ])
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'validation_failed');

        $this->assertFalse($document->refresh()->is_sample);
    }

    public function test_admin_can_soft_delete_a_document_and_audit_the_action(): void
    {
        $admin = User::factory()->administrator()->create();
        $document = Document::factory()->create();

        $this->actingAs($admin)
            ->deleteJson("/api/admin/documents/{$document->id}")
            ->assertOk()
            ->assertExactJson(['data' => null]);

        $this->assertSoftDeleted($document);
        $this->assertTrue(AuditEvent::query()
            ->where('action', 'document.deleted')
            ->where('auditable_id', $document->id)
            ->exists());
    }
}
