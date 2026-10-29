import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'jsdom',
    coverage: {
      include: ['src/**/*.ts'],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 75 },
    },
  },
})
