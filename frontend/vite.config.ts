import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const productionBase = '/demo/support-copilot/'

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
