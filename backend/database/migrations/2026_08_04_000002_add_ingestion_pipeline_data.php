<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('document_versions', function (Blueprint $table) {
            $table->json('parser_metadata')->nullable();
            $table->string('chunking_version')->nullable();
            $table->char('chunking_checksum', 64)->nullable();
            $table->string('embedding_provider')->nullable();
            $table->string('embedding_model')->nullable();
            $table->unsignedSmallInteger('embedding_dimensions')->nullable();
            $table->unsignedInteger('embedding_input_tokens')->nullable();
            $table->string('failure_code')->nullable();
            $table->text('failure_diagnostic')->nullable();
            $table->timestamp('ingestion_started_at')->nullable();
            $table->timestamp('ingestion_completed_at')->nullable();
            $table->timestamp('ingestion_failed_at')->nullable();
        });

        Schema::table('chunks', function (Blueprint $table) {
            $table->unsignedInteger('page_end')->nullable();
            $table->unsignedBigInteger('source_text_start')->nullable();
            $table->unsignedBigInteger('source_text_end')->nullable();
            $table->json('source_spans')->nullable();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE chunks ADD COLUMN embedding vector(1536)');
        } else {
            Schema::table('chunks', function (Blueprint $table) {
                $table->text('embedding')->nullable();
            });
        }
    }

    public function down(): void
    {
        Schema::table('chunks', function (Blueprint $table) {
            $table->dropColumn([
                'embedding',
                'page_end',
                'source_text_start',
                'source_text_end',
                'source_spans',
            ]);
        });

        Schema::table('document_versions', function (Blueprint $table) {
            $table->dropColumn([
                'parser_metadata',
                'chunking_version',
                'chunking_checksum',
                'embedding_provider',
                'embedding_model',
                'embedding_dimensions',
                'embedding_input_tokens',
                'failure_code',
                'failure_diagnostic',
                'ingestion_started_at',
                'ingestion_completed_at',
                'ingestion_failed_at',
            ]);
        });
    }
};
