import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { build } from 'esbuild'

import type { Properties } from '../../src/types.ts'

export async function startHarness(): Promise<{ url: string; close: () => Promise<void> }> {
  const headers = await readFile('html_headers.html', 'utf8')
  const {
    fields,
  }: {
    fields: Record<string, { name: keyof Properties; default_val: Properties[keyof Properties] }>
  } = JSON.parse(await readFile('elements/AAu/params.json', 'utf8'))
  const defaults = Object.fromEntries(
    Object.values(fields).map((field) => [field.name, field.default_val]),
  )
  const { outputFiles } = await build({
    entryPoints: ['test/e2e/browser.ts'],
    bundle: true,
    write: false,
    target: 'es2022',
    format: 'iife',
    globalName: 'BubbleTestHarness',
  })
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/options') {
        const { TRANSLOADIT_KEY: key, TRANSLOADIT_SECRET: secret } = process.env
        if (!key || !secret) {
          response.writeHead(503).end()
          return
        }
        const params = JSON.stringify({
          auth: { key, expires: new Date(Date.now() + 300_000).toISOString() },
          steps: {
            resize: {
              robot: '/image/resize',
              use: ':original',
              width: 16,
              height: 16,
              result: true,
            },
          },
        })
        const signature = `sha384:${createHmac('sha384', secret).update(params).digest('hex')}`
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ params, signature }))
      } else if (/^\/elements\/AAu\/(initialize|update|reset)\.js$/.test(path)) {
        response.setHeader('Content-Type', 'text/plain')
        response.end(await readFile(`.${path}`, 'utf8'))
      } else if (path === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${headers}</head>
        <body style="margin:16px;font-family:system-ui"><main id="canvas" style="width:100%;max-width:720px;height:400px"></main>
        <script>${outputFiles[0].text}
        BubbleTestHarness.start(${JSON.stringify(defaults)});</script></body></html>`)
      } else {
        response.writeHead(404).end()
      }
    } catch {
      response.writeHead(500).end('Harness error')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Harness did not bind a TCP port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
