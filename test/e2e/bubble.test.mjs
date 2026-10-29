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
    expect((await page.locator('.uppy-Dashboard-inner').boundingBox()).height).toBeGreaterThan(350)
    await page.evaluate(() => {
      window.instance.canvas[0].style.height = '500px'
    })
    await expect
      .poll(async () => (await page.locator('.uppy-Dashboard-inner').boundingBox()).height)
      .toBe(500)
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
  await page.evaluate(() => window.resetElement(window.instance, window.context))
  await expect(page.getByRole('button', { name: 'Choose files', exact: true })).toBeVisible()
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

test('releases modal keyboard focus when Bubble resets the element', async ({ page }) => {
  await page.evaluate(async () => {
    await window.mount({ inline_dashboard: false })
    for (const label of ['Outside one', 'Outside two']) {
      const button = document.createElement('button')
      button.textContent = label
      document.body.appendChild(button)
    }
  })
  await page.getByRole('button', { name: 'Upload files', exact: true }).click()
  await expect(page.getByRole('button', { name: 'browse files' })).toBeVisible()
  await page.evaluate(() => window.resetElement(window.instance, window.context))
  await page.getByRole('button', { name: 'Outside one', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Outside two', exact: true })).toBeFocused()
})

test('reports invalid signing data when a failed file is retried', async ({ page }) => {
  await page.evaluate(async () => window.mount({ inline_dashboard: true }))
  await page.locator('input[type=file]').first().setInputFiles('test/fixtures/upload.png')
  await page.getByRole('button', { name: /Upload 1 file/ }).click()
  await expect.poll(() => page.evaluate(() => window.events.includes('error'))).toBe(true)
  await page.evaluate(async () => {
    window.updateElement(
      window.instance,
      {
        inline_dashboard: true,
        params: JSON.stringify({ auth: { key: 'test', expires: 'later' }, template_id: 'test' }),
        signature: '',
      },
      window.context,
    )
    await Promise.resolve()
    const uppy = window.instance.data.uppy
    await uppy.retryUpload(uppy.getFiles()[0].id).catch(() => {})
  })
  expect(await page.evaluate(() => window.states.is_uploading)).toBe(false)
  expect(await page.evaluate(() => window.states.error_message)).toContain('server-signed params')
  expect(await page.evaluate(() => window.events.filter((event) => event === 'error').length)).toBe(
    2,
  )
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toBeVisible()
})

test('uploads a real file and exposes real processed results from the built Bubble export', async ({
  page,
  request,
}) => {
  test.skip(!real, 'Run yarn test:e2e with opentest credentials')
  await page.evaluate(async () => window.mount({ inline_dashboard: true }))
  await page.locator('input[type=file]').first().setInputFiles('test/fixtures/upload.png')
  await page.getByRole('button', { name: /Upload 1 file/ }).click()
  await expect.poll(() => page.evaluate(() => window.events.includes('error'))).toBe(true)
  await page.evaluate(async () => {
    const options = await fetch('/options').then((response) => response.json())
    window.updateElement(window.instance, { ...options, inline_dashboard: true }, window.context)
  })
  await page.getByRole('button', { name: 'Retry upload', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => window.events.includes('completed')), { timeout: 100_000 })
    .toBe(true)
  expect(await page.evaluate(() => window.events.filter((event) => event === 'error').length)).toBe(
    1,
  )
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
  await page.evaluate(async () => {
    window.resetElement(window.instance, window.context)
    const options = await fetch('/options').then((response) => response.json())
    window.updateElement(window.instance, { ...options, inline_dashboard: true }, window.context)
  })
  await page.locator('input[type=file]').first().setInputFiles('test/fixtures/upload.png')
  await page.getByRole('button', { name: /Upload 1 file/ }).click()
  await expect
    .poll(
      () => page.evaluate(() => window.events.filter((event) => event === 'completed').length),
      { timeout: 100_000 },
    )
    .toBe(2)
  expect(await page.evaluate(() => window.states.result_urls.length)).toBe(1)
  const second = await request.get(await page.evaluate(() => window.states.result_urls[0]))
  expect(second.ok()).toBe(true)
  expect((await second.body()).length).toBeGreaterThan(0)
})

test('updates only the launcher label and preserves the modal close button', async ({ page }) => {
  await page.evaluate(async () => {
    await window.mount({ inline_dashboard: false, button_label: 'First label' })
  })
  await page.evaluate(() => {
    window.updateElement(
      window.instance,
      { inline_dashboard: false, button_label: 'New label' },
      window.context,
    )
  })
  await expect(page.getByRole('button', { name: 'New label', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New label', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Close Modal', exact: true })).toHaveText('×')
})

for (const restrictions of [{ max_file_size: 1 }, { allowed_file_types: '.bin' }]) {
  test(`rechecks a selected file after restrictions change: ${JSON.stringify(restrictions)}`, async ({
    page,
  }) => {
    await page.evaluate(async () => window.mount({ inline_dashboard: true }))
    await page.locator('input[type=file]').first().setInputFiles('test/fixtures/upload.png')
    await page.evaluate((restrictions) => {
      window.updateElement(
        window.instance,
        { inline_dashboard: true, ...restrictions },
        window.context,
      )
    }, restrictions)
    await page.getByRole('button', { name: /Upload 1 file/ }).click()
    await expect.poll(() => page.evaluate(() => window.states.is_uploading)).toBe(false)
    expect(await page.evaluate(() => window.states.error_message)).toMatch(/exceeds|only upload/i)
  })
}

for (const phase of ['transfer', 'processing']) {
  test(`starts a fresh tus upload after ${phase} failure`, async ({ page }) => {
    const requests = []
    await page.route(`${harness.url}/assembly/**`, (route) =>
      route.fulfill({
        json: { assembly_id: 'fixture', ok: 'ASSEMBLY_UPLOADING', uploads: [], results: {} },
      }),
    )
    await page.route(`${harness.url}/tus/**`, async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      requests.push(`${request.method()} ${path}`)
      const headers = { 'Tus-Resumable': '1.0.0' }
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 201,
          headers: { ...headers, Location: `${harness.url}${path}file` },
        })
      } else if (
        phase === 'transfer' &&
        path.startsWith('/tus/1/') &&
        request.method() === 'PATCH'
      ) {
        // A protocol failure without an HTTP error or automatic retry: no data reaches Assembly 1.
        await route.fulfill({ status: 204, headers })
      } else {
        await route.fulfill({
          status: request.method() === 'HEAD' ? 200 : 204,
          headers: {
            ...headers,
            'Upload-Offset': request.method() === 'HEAD' ? '0' : '98',
            'Upload-Length': '98',
          },
        })
      }
    })
    await page.evaluate(async () => {
      // Drive the actual processing-error path without an external API, SSE connection or telemetry.
      window.sources = []
      window.EventSource = class {
        listeners = {}
        constructor() {
          window.sources.push(this)
        }
        addEventListener(name, callback) {
          this.listeners[name] = callback
        }
        close() {}
      }
      await window.mount({
        inline_dashboard: true,
        params: JSON.stringify({ auth: { key: 'test', expires: 'later' }, template_id: 'test' }),
        signature: 'test',
      })
      const uppy = window.instance.data.uppy
      uppy.setOptions({ logger: { debug() {}, warn() {}, error() {} } })
      uppy.getPlugin('Tus').setOptions({ retryDelays: [] })
      const client = uppy.getPlugin('Transloadit').client
      let number = 0
      client.createAssembly = async () => {
        number += 1
        return {
          assembly_id: `fixture-${number}`,
          ok: 'ASSEMBLY_UPLOADING',
          uploads: [],
          results: {},
          assembly_url: `${location.origin}/assembly/${number}`,
          assembly_ssl_url: `${location.origin}/assembly/${number}`,
          tus_url: `${location.origin}/tus/${number}/`,
          websocket_url: `${location.origin}/events`,
        }
      }
      client.submitError = async () => {}
      client.cancelAssembly = async () => {}
      client.getAssemblyStatus = async (url) => ({
        assembly_id: `fixture-${url.split('/').at(-1)}`,
        ok: 'ASSEMBLY_COMPLETED',
        uploads: [],
        results: {},
      })
    })
    await page.locator('input[type=file]').first().setInputFiles('test/fixtures/upload.png')
    await page.getByRole('button', { name: /Upload 1 file/ }).click()
    if (phase === 'processing') {
      await expect
        .poll(() =>
          page.evaluate(() => window.instance.data.uppy.getFiles()[0].progress.uploadComplete),
        )
        .toBe(true)
      await page.evaluate(() =>
        window.sources[0].listeners.assembly_error({
          data: JSON.stringify({ message: 'Intentional processing failure' }),
        }),
      )
    }
    await expect.poll(() => page.evaluate(() => window.events.includes('error'))).toBe(true)
    await page.getByRole('button', { name: 'Retry upload', exact: true }).first().click()
    await expect.poll(() => requests.includes('POST /tus/2/')).toBe(true)
    expect(requests).not.toContain('HEAD /tus/1/file')
    await expect
      .poll(() =>
        page.evaluate(() => window.instance.data.uppy.getFiles()[0].progress.uploadComplete),
      )
      .toBe(true)
    // An already pending status request can fail after its Assembly's connection was closed.
    await page.evaluate(() =>
      window.sources[0].listeners.assembly_error({
        data: JSON.stringify({ message: 'Late previous Assembly error' }),
      }),
    )
    expect(await page.evaluate(() => window.states.is_uploading)).toBe(true)
    expect(await page.evaluate(() => window.states.error_message)).toBe('')
    await page.evaluate(() => window.sources[1].listeners.message({ data: 'assembly_finished' }))
    await expect.poll(() => page.evaluate(() => window.events.includes('completed'))).toBe(true)
    expect(await page.evaluate(() => window.states.assembly_id)).toBe('fixture-2')
    await page.evaluate(() => window.resetElement(window.instance, window.context))
  })
}
