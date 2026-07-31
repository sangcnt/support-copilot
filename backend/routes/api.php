<?php

use App\Http\Controllers\AdminAuthController;
use App\Http\Controllers\AdminConversationController;
use App\Http\Controllers\AdminDocumentController;
use App\Http\Controllers\AdminUsageController;
use App\Http\Controllers\PublicDocumentController;
use App\Http\Controllers\PublicSessionController;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'service' => 'support-copilot-backend',
    ]);
});

Route::prefix('public')->group(function (): void {
    Route::get('/session', PublicSessionController::class);
    Route::get('/documents/{document}', [PublicDocumentController::class, 'show'])
        ->middleware('document.access');
});

Route::prefix('auth')->group(function (): void {
    Route::post('/login', [AdminAuthController::class, 'login'])
        ->middleware('throttle:5,1');

    Route::middleware(['auth:sanctum', 'admin'])->group(function (): void {
        Route::get('/me', [AdminAuthController::class, 'me']);
        Route::post('/logout', [AdminAuthController::class, 'logout']);
    });
});

Route::prefix('admin')->middleware(['auth:sanctum', 'admin'])->group(function (): void {
    Route::get('/documents', [AdminDocumentController::class, 'index']);
    Route::patch('/documents/{document}/sample', [AdminDocumentController::class, 'updateSample']);
    Route::delete('/documents/{document}', [AdminDocumentController::class, 'destroy']);
    Route::get('/conversations', [AdminConversationController::class, 'index']);
    Route::get('/usage', AdminUsageController::class);
});
