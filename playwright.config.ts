import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  workers: 1,
  timeout: 120_000,
  use: { browserName: 'chromium', headless: true, trace: 'off' },
  reporter: 'list',
})
