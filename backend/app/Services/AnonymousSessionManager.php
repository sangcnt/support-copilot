<?php

namespace App\Services;

use App\Models\AnonymousSession;
use Illuminate\Cookie\CookieJar;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie;

class AnonymousSessionManager
{
    public function __construct(private readonly CookieJar $cookies) {}

    /**
     * @return array{session: AnonymousSession, cookie: Cookie}
     */
    public function start(Request $request): array
    {
        $token = $this->tokenFromRequest($request);
        $session = $this->resolveToken($token);
        $expiresAt = now()->addDays($this->lifetimeDays());

        if ($session === null) {
            $token = Str::random(64);
            $session = AnonymousSession::query()->create([
                'token_hash' => hash('sha256', $token),
                'last_seen_at' => now(),
                'expires_at' => $expiresAt,
            ]);
        } else {
            $session->forceFill([
                'last_seen_at' => now(),
                'expires_at' => $expiresAt,
            ])->save();
        }

        return [
            'session' => $session,
            'cookie' => $this->makeCookie($token),
        ];
    }

    public function resolve(Request $request): ?AnonymousSession
    {
        return $this->resolveToken($this->tokenFromRequest($request));
    }

    private function tokenFromRequest(Request $request): ?string
    {
        $token = $request->cookie((string) config('demo.session.cookie'));

        return is_string($token) && $token !== '' ? $token : null;
    }

    private function resolveToken(?string $token): ?AnonymousSession
    {
        if ($token === null) {
            return null;
        }

        return AnonymousSession::query()
            ->where('token_hash', hash('sha256', $token))
            ->where('expires_at', '>', now())
            ->first();
    }

    private function makeCookie(string $token): Cookie
    {
        return $this->cookies->make(
            name: (string) config('demo.session.cookie'),
            value: $token,
            minutes: $this->lifetimeDays() * 24 * 60,
            path: (string) config('demo.session.path'),
            domain: config('demo.session.domain'),
            secure: (bool) config('demo.session.secure'),
            httpOnly: true,
            sameSite: (string) config('demo.session.same_site'),
        );
    }

    private function lifetimeDays(): int
    {
        return max(1, (int) config('demo.session.lifetime_days'));
    }
}
