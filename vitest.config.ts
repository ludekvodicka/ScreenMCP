import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['core/**/*.test.ts', 'app-electron/**/*.test.{ts,tsx}', 'skills/**/*.test.mjs'],
    exclude: ['app-electron/test-e2e/**'],
    coverage: { reporter: ['text', 'html'] },
  },
})
