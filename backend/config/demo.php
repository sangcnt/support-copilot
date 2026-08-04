<?php

return [
    'session' => [
        'cookie' => env('DEMO_SESSION_COOKIE', 'support_copilot_demo'),
        'lifetime_days' => (int) env('DEMO_SESSION_LIFETIME_DAYS', 7),
        'path' => env('DEMO_SESSION_COOKIE_PATH', '/'),
        'domain' => env('DEMO_SESSION_COOKIE_DOMAIN'),
        'secure' => env('DEMO_SESSION_SECURE_COOKIE', false),
        'same_site' => env('DEMO_SESSION_SAME_SITE', 'lax'),
    ],

    'documents' => [
        'disk' => env('DOCUMENT_DISK', 'documents'),
        'max_kilobytes' => (int) env('DOCUMENT_MAX_KILOBYTES', 10240),
    ],
];
