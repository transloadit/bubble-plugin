import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

export async function startHarness() {
  const headers = await readFile('html_headers.html', 'utf8')
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname
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
      } else if (path === '/before') {
        const baseline = execFileSync('git', ['show', 'origin/main:html_headers.html'], {
          encoding: 'utf8',
        })
        const action = execFileSync('git', ['show', 'origin/main:actions/AAF/client.js'], {
          encoding: 'utf8',
        })
        response.setHeader('Content-Type', 'text/html')
        response.end(`<!doctype html><html><head>${baseline}</head><body><button id="legacy">Upload files</button><script>
        document.querySelector('#legacy').onclick = () => (${action})({}, {keys: {}});
        </script></body></html>`)
      } else if (path === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${headers}</head>
        <body style="margin:16px;font-family:system-ui"><main id="canvas" style="width:100%;max-width:720px;height:400px"></main>
        <script>
        window.states = {}; window.events = [];
        window.instance = { canvas: {0: document.querySelector('#canvas')}, data: {},
          publishState(name, value) { window.states[name] = value; },
          triggerEvent(name) { window.events.push(name); }
        };
        window.context = { keys: {}, reportDebugger(message) { throw new Error(message); } };
        window.mount = async (properties) => {
          for (const name of ['initialize', 'update', 'reset']) {
            const code = await fetch('/elements/AAu/' + name + '.js').then(r => r.text());
            window[name + 'Element'] = Function('return (' + code + ')')();
          }
          initializeElement(instance, context);
          updateElement(instance, properties, context);
          await instance.data.ready;
        };
        </script></body></html>`)
      } else {
        response.writeHead(404).end()
      }
    } catch {
      response.writeHead(500).end('Harness error')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
