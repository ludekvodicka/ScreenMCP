import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['app-electron/test-e2e/xvfb-capture.test.ts'],
    testTimeout: 120_000,
  },
})
