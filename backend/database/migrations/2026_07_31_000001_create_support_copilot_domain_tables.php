<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('anonymous_sessions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->char('token_hash', 64)->unique();
            $table->timestamp('last_seen_at');
            $table->timestamp('expires_at')->index();
            $table->timestamps();
        });

        Schema::create('documents', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('anonymous_session_id')
                ->nullable()
                ->constrained('anonymous_sessions')
                ->cascadeOnDelete();
            $table->string('display_name');
            $table->string('source_type')->default('upload');
            $table->string('status')->default('pending')->index();
            $table->boolean('is_sample')->default(false)->index();
            $table->timestamp('expires_at')->nullable()->index();
            $table->text('failure_reason')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['anonymous_session_id', 'status']);
        });

        Schema::create('document_versions', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('document_id')
                ->constrained('documents')
                ->cascadeOnDelete();
            $table->unsignedInteger('version');
            $table->string('storage_key')->nullable()->unique();
            $table->string('mime_type');
            $table->unsignedBigInteger('byte_size');
            $table->char('content_checksum', 64)->nullable()->index();
            $table->string('parser_version')->nullable();
            $table->string('ingestion_status')->default('pending')->index();
            $table->timestamps();

            $table->unique(['document_id', 'version']);
        });

        Schema::create('chunks', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('document_version_id')
                ->constrained('document_versions')
                ->cascadeOnDelete();
            $table->unsignedInteger('ordinal');
            $table->string('heading')->nullable();
            $table->unsignedInteger('page_number')->nullable();
            $table->text('normalized_text');
            $table->unsignedInteger('token_count');
            $table->char('content_checksum', 64)->index();
            $table->string('embedding_model')->nullable();
            $table->string('chunking_version')->nullable();
            $table->timestamps();

            $table->unique(['document_version_id', 'ordinal']);
        });

        Schema::create('conversations', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('anonymous_session_id')
                ->constrained('anonymous_sessions')
                ->cascadeOnDelete();
            $table->foreignUlid('document_id')
                ->constrained('documents')
                ->cascadeOnDelete();
            $table->string('status')->default('open')->index();
            $table->timestamp('last_message_at')->nullable()->index();
            $table->timestamps();

            $table->index(['anonymous_session_id', 'document_id']);
        });

        Schema::create('messages', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('conversation_id')
                ->constrained('conversations')
                ->cascadeOnDelete();
            $table->string('role');
            $table->text('content');
            $table->string('model')->nullable();
            $table->unsignedInteger('latency_ms')->nullable();
            $table->unsignedInteger('input_tokens')->nullable();
            $table->unsignedInteger('output_tokens')->nullable();
            $table->decimal('estimated_cost', 12, 6)->nullable();
            $table->string('fallback_reason')->nullable();
            $table->timestamps();

            $table->index(['conversation_id', 'created_at']);
        });

        Schema::create('message_citations', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('message_id')
                ->constrained('messages')
                ->cascadeOnDelete();
            $table->foreignUlid('chunk_id')
                ->constrained('chunks')
                ->cascadeOnDelete();
            $table->unsignedSmallInteger('citation_order');
            $table->text('quoted_excerpt');
            $table->decimal('retrieval_score', 8, 6)->nullable();
            $table->timestamps();

            $table->unique(['message_id', 'citation_order']);
        });

        Schema::create('usage_events', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('anonymous_session_id')
                ->nullable()
                ->constrained('anonymous_sessions')
                ->nullOnDelete();
            $table->foreignUlid('document_id')
                ->nullable()
                ->constrained('documents')
                ->nullOnDelete();
            $table->foreignUlid('conversation_id')
                ->nullable()
                ->constrained('conversations')
                ->nullOnDelete();
            $table->foreignUlid('message_id')
                ->nullable()
                ->constrained('messages')
                ->nullOnDelete();
            $table->string('event_type')->index();
            $table->string('provider')->nullable();
            $table->string('model')->nullable();
            $table->unsignedInteger('input_tokens')->default(0);
            $table->unsignedInteger('output_tokens')->default(0);
            $table->unsignedInteger('latency_ms')->nullable();
            $table->decimal('estimated_cost', 12, 6)->default(0);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['event_type', 'created_at']);
        });

        Schema::create('audit_events', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action')->index();
            $table->string('auditable_type');
            $table->string('auditable_id');
            $table->json('metadata')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['auditable_type', 'auditable_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_events');
        Schema::dropIfExists('usage_events');
        Schema::dropIfExists('message_citations');
        Schema::dropIfExists('messages');
        Schema::dropIfExists('conversations');
        Schema::dropIfExists('chunks');
        Schema::dropIfExists('document_versions');
        Schema::dropIfExists('documents');
        Schema::dropIfExists('anonymous_sessions');
    }
};
