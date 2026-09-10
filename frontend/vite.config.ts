import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Served at demo.sangcaolabs.com/support-copilot/, behind a gateway that strips
// the prefix before it reaches nginx. The browser still sees the prefix, so the
// build needs it; local dev runs at the root.
const productionBase = '/support-copilot/'

export default defineConfig(({ mode }) => ({
  base:
    process.env.VITE_PUBLIC_BASE ??
    (mode === 'production' ? productionBase : '/'),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
}))
