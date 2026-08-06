<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            // Client-generated idempotency key for the user message in a
            // send attempt. Lets a retried POST (flaky network, browser
            // retry) reuse the already-persisted message pair instead of
            // creating a duplicate.
            $table->string('client_message_id')->nullable()->after('conversation_id');
            $table->unique(['conversation_id', 'client_message_id']);
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropUnique(['conversation_id', 'client_message_id']);
            $table->dropColumn('client_message_id');
        });
    }
};
