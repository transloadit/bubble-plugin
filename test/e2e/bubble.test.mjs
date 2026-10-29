import { expect, test } from '@playwright/test'

import { startHarness } from './harness.mjs'

const real = process.env.BUBBLE_REAL_API === '1'
if (real && (!process.env.TRANSLOADIT_KEY || !process.env.TRANSLOADIT_SECRET)) {
  throw new Error(
    'Real API tests require TRANSLOADIT_KEY and TRANSLOADIT_SECRET (CI: BUBBLE_E2E_TRANSLOADIT_KEY and BUBBLE_E2E_TRANSLOADIT_SECRET)',
  )
}
let harness
const errors = new WeakMap()
test.beforeAll(async () => {
  harness = await startHarness()
})
test.afterAll(async () => {
  await harness?.close()
})
test.beforeEach(async ({ page }) => {
  const issues = []
  errors.set(page, issues)
  page.on('pageerror', (error) => issues.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(message.text())
  })
  page.on('requestfailed', (request) =>
    issues.push(`Failed request: ${new URL(request.url()).origin}`),
  )
  await page.goto(harness.url)
})
test.afterEach(async ({ page }) => {
  // Request payloads and traces are deliberately not recorded: they contain signed params.
  expect(errors.get(page)).toEqual([])
})

for (const width of [1280, 390]) {
  test(`renders built callbacks at ${width}px and retains files on Bubble updates`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate(async () => {
      await window.mount({ inline_dashboard: true })
    })
    await expect(page.getByRole('button', { name: 'browse files' })).toBeVisible()
    await page.locator('input[type=file]').first().setInputFiles('test/fixtures/upload.png')
    await expect(page.getByText('upload.png', { exact: true })).toBeVisible()
    await page.evaluate(() => {
      window.updateElement(window.instance, { inline_dashboard: true }, window.context)
    })
    await expect(page.getByText('upload.png', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => window.resetElement(window.instance, window.context))
    await expect(page.getByText('upload.png', { exact: true })).toHaveCount(0)
  })
}

test('opens and closes the button Dashboard', async ({ page }) => {
  await page.evaluate(async () => {
    await window.mount({ inline_dashboard: false, button_label: 'Choose files' })
  })
  await page.getByRole('button', { name: 'Choose files', exact: true }).click()
  await expect(page.getByRole('button', { name: 'browse files' })).toBeVisible()
  await page.getByRole('button', { name: 'Close Modal' }).click()
  await expect(page.getByRole('button', { name: 'browse files' })).toBeHidden()
})

test('publishes a visible configuration error and recovers after reset', async ({ page }) => {
  await page.evaluate(async () => {
    await window.mount({ inline_dashboard: true })
  })
  await page.locator('input[type=file]').first().setInputFiles('test/fixtures/upload.png')
  await page.getByRole('button', { name: /Upload 1 file/ }).click()
  await expect.poll(() => page.evaluate(() => window.events.includes('error'))).toBe(true)
  expect(await page.evaluate(() => window.states.error_message.length > 0)).toBe(true)
  await page.evaluate(() => window.resetElement(window.instance, window.context))
  expect(await page.evaluate(() => window.states.error_message)).toBe('')
})

test('uploads a real file and exposes real processed results from the built Bubble export', async ({
  page,
  request,
}) => {
  test.skip(!real, 'Run yarn test:e2e with opentest credentials')
  await page.evaluate(async () => {
    const options = await fetch('/options').then((response) => response.json())
    await window.mount({ ...options, inline_dashboard: true })
  })
  await page.locator('input[type=file]').first().setInputFiles('test/fixtures/upload.png')
  await page.getByRole('button', { name: /Upload 1 file/ }).click()
  await expect
    .poll(() => page.evaluate(() => window.events.includes('completed')), { timeout: 100_000 })
    .toBe(true)
  expect(await page.evaluate(() => window.events.includes('error'))).toBe(false)
  const result = await page.evaluate(() => {
    const assembly = JSON.parse(window.states.assembly_json)
    const file = JSON.parse(window.states.results_json).resize[0]
    return {
      status: assembly.ok,
      count: assembly.uploads.length,
      width: file.meta.width,
      height: file.meta.height,
      url: window.states.result_urls[0],
    }
  })
  expect(result.status).toBe('ASSEMBLY_COMPLETED')
  expect(result.count).toBe(1)
  expect(result.width).toBe(16)
  expect(result.height).toBe(16)
  const download = await request.get(result.url)
  expect(download.ok()).toBe(true)
  expect((await download.body()).length).toBeGreaterThan(0)
})
