import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The demo is served from the root of demo.sangcaolabs.com. It used to sit
// under a path prefix on the portfolio domain, which is what VITE_PUBLIC_BASE
// still exists to override.
export default defineConfig(() => ({
  base: process.env.VITE_PUBLIC_BASE ?? '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
}))
