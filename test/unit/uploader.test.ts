import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Context, Instance } from '../../src/types'

import { assemblyOptions, initialize, open, reset, update } from '../../src/uploader'

const { clients, MockUppy } = vi.hoisted(() => {
  const clients: MockUppy[] = []
  class MockUppy {
    events = new Map<string, ((...args: unknown[]) => void)[]>()
    plugins = new Map()
    destroyed = false
    opts: Record<string, unknown>
    constructor(opts: Record<string, unknown>) {
      this.opts = opts
      clients.push(this)
    }
    use(plugin: { name: string }, opts: Record<string, unknown>) {
      this.plugins.set(plugin.name, { opts, openModal: vi.fn(), setOptions: vi.fn() })
      return this
    }
    on(name: string, fn: (...args: unknown[]) => void) {
      this.events.set(name, [...(this.events.get(name) ?? []), fn])
      return this
    }
    emit(name: string, ...args: unknown[]) {
      for (const fn of this.events.get(name) ?? []) fn(...args)
    }
    setOptions = vi.fn()
    getPlugin(name: string) {
      return this.plugins.get(name)
    }
    cancelAll = vi.fn()
    destroy() {
      this.destroyed = true
    }
  }
  return { clients, MockUppy }
})
vi.mock('@uppy/core', () => ({ default: MockUppy }))
vi.mock('@uppy/dashboard', () => ({ default: { name: 'Dashboard' } }))
vi.mock('@uppy/transloadit', () => ({ default: { name: 'Transloadit' } }))

const context: Context = { keys: {}, reportDebugger: vi.fn() }
const properties = {
  params:
    '{ "auth": {"key":"public-key","expires":"2030/01/01 00:00:00+00:00"}, "template_id":"template" }',
  signature: 'sha384:test-signature',
  inline_dashboard: true,
}
let instance: Instance
let states: Record<string, unknown>
beforeEach(() => {
  clients.length = 0
  states = {}
  const canvas = document.createElement('div')
  document.body.replaceChildren(canvas)
  instance = {
    canvas: { 0: canvas },
    data: {},
    publishState: vi.fn((name, value) => {
      states[name] = value
    }),
    triggerEvent: vi.fn(),
  }
})

afterEach(() => instance.data.dispose?.())

describe('Bubble uploader lifecycle', () => {
  it('initializes Bubble states and mounts one uploader across repeated updates', () => {
    initialize(instance, context)
    expect(states).toMatchObject({ is_uploading: false, progress: 0, result_urls: [] })
    update(instance, properties, context)
    update(instance, { ...properties }, context)
    expect(clients).toHaveLength(1)
    expect(instance.data.root?.isConnected).toBe(true)
  })

  it('keeps the exact signed params string and reads refreshed signatures per upload', async () => {
    initialize(instance, context)
    update(instance, properties, context)
    const options = clients[0].plugins.get('Transloadit').opts
    expect(await options.assemblyOptions()).toEqual({
      params: properties.params,
      signature: properties.signature,
    })
    update(instance, { ...properties, signature: 'sha384:fresh' }, context)
    expect(await options.assemblyOptions()).toEqual({
      params: properties.params,
      signature: 'sha384:fresh',
    })
    expect(options.waitForEncoding).toBe(true)
  })
})

describe('upload states and failures', () => {
  beforeEach(() => {
    initialize(instance, context)
    update(instance, properties, context)
  })

  it('publishes real results before signaling completion, and clears stale results on the next upload', () => {
    const client = clients[0]
    client.emit('upload')
    expect(states.is_uploading).toBe(true)
    expect(instance.triggerEvent).toHaveBeenCalledWith('upload_started')
    client.emit('progress', 64)
    expect(states.progress).toBe(64)
    client.emit('transloadit:assembly-created', { assembly_id: 'assembly-1' })
    expect(states.assembly_id).toBe('assembly-1')
    const assembly = {
      assembly_id: 'assembly-1',
      results: { thumb: [{ ssl_url: 'https://example.com/file.png' }, {}] },
    }
    client.emit('transloadit:complete', assembly)
    expect(states.result_urls).toEqual(['https://example.com/file.png'])
    expect(JSON.parse(String(states.assembly_json))).toEqual(assembly)
    expect(JSON.parse(String(states.results_json))).toEqual(assembly.results)
    client.emit('complete', { failed: [] })
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
    expect(states.is_uploading).toBe(false)
    expect(states.progress).toBe(100)
    client.emit('upload')
    expect(states.result_urls).toEqual([])
    expect(states.assembly_json).toBe('')
  })

  it.each([
    'error',
    'upload-error',
    'restriction-failed',
    'transloadit:assembly-error',
  ])('publishes %s without a false completed event', (event) => {
    const client = clients[0]
    client.emit('upload')
    const error = new Error('API request failed')
    client.emit(event, ...(event === 'error' ? [error] : [null, error]))
    client.emit('complete', { failed: [] })
    expect(states.error_message).toBe('API request failed')
    expect(states.is_uploading).toBe(false)
    expect(instance.triggerEvent).not.toHaveBeenCalledWith('completed')
  })

  it('does not signal completed for an upload result with failed files', () => {
    clients[0].emit('complete', { failed: [{}] })
    expect(instance.triggerEvent).not.toHaveBeenCalledWith('completed')
  })

  it('cancels uploads and resets all states', () => {
    clients[0].emit('upload')
    reset(instance)
    expect(clients[0].cancelAll).toHaveBeenCalledOnce()
    expect(states).toMatchObject({ is_uploading: false, progress: 0, error_message: '' })
    clients[0].emit('cancel-all')
    expect(states.result_urls).toEqual([])
  })

  it('releases Uppy and its DOM observer when Bubble removes the element', async () => {
    document.body.replaceChildren()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clients[0].destroyed).toBe(true)
    expect(instance.data.uppy).toBeUndefined()
  })

  it('supports the button/modal mode, updates its label and retains the uploader on property changes', () => {
    update(
      instance,
      { ...properties, inline_dashboard: false, button_label: 'Choose photo' },
      context,
    )
    const client = clients[1]
    expect(clients[0].destroyed).toBe(true)
    const button = instance.data.root?.querySelector('button')
    expect(button?.textContent).toBe('Choose photo')
    button?.click()
    expect(client.getPlugin('Dashboard').openModal).toHaveBeenCalledOnce()
    update(
      instance,
      {
        ...properties,
        inline_dashboard: false,
        button_label: 'Add file',
        max_files: 3,
        allowed_file_types: '.png, image/jpeg',
      },
      context,
    )
    expect(button?.textContent).toBe('Add file')
    expect(client.setOptions).toHaveBeenCalledWith({
      restrictions: {
        maxNumberOfFiles: 3,
        maxFileSize: 5242880,
        allowedFileTypes: ['.png', 'image/jpeg'],
      },
    })
  })

  it('does not destroy an active upload when Bubble changes the display mode', () => {
    clients[0].emit('upload')
    update(instance, { ...properties, inline_dashboard: false }, context)
    expect(clients).toHaveLength(1)
    expect(clients[0].destroyed).toBe(false)
  })

  it.each([0, -1, 1.5, Number.NaN])('reports an invalid upload limit (%s)', (limit) => {
    update(instance, { ...properties, max_files: limit }, context)
    expect(states.error_message).toContain('positive integers')
    expect(instance.triggerEvent).toHaveBeenCalledWith('error')
  })
})

describe('signing contract', () => {
  it('accepts signed Assembly Instructions', () => {
    const params = JSON.stringify({
      auth: { key: 'key', expires: 'later' },
      steps: { resize: { robot: '/image/resize' } },
    })
    expect(assemblyOptions({ params, signature: 'sha384:test' })).toEqual({
      params,
      signature: 'sha384:test',
    })
  })
  it.each([
    {},
    { params: '{}' },
    { params: '{"auth":{"key":"key"}}' },
    { ...properties, signature: '' },
    { params: '{"auth":{"key":"key"},"template_id":"template"}', signature: 'sha384:test' },
  ])('rejects missing or invalid signed configuration', (config) => {
    expect(() => assemblyOptions(config)).toThrow()
  })
})

describe('legacy open action', () => {
  it('opens current Uppy with existing shared keys and releases it on close', async () => {
    open({}, { ...context, keys: { 'AUTH KEY': 'public-key', 'TEMPLATE ID': 'template' } })
    const client = clients[0]
    expect(client.getPlugin('Dashboard').openModal).toHaveBeenCalledOnce()
    const options = client.getPlugin('Transloadit').opts.assemblyOptions()
    expect(JSON.parse(options.params)).toEqual({
      auth: { key: 'public-key' },
      template_id: 'template',
    })
    client.emit('dashboard:modal-closed')
    expect(client.destroyed).toBe(true)
  })
  it('forwards completed Assemblies to the old notification URL and reports failures', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetch)
    open(properties, { ...context, keys: { 'NOTIFY URL': 'https://example.com/hook' } })
    clients[0].emit('transloadit:complete', { assembly_id: 'a' })
    await vi.waitFor(() =>
      expect(context.reportDebugger).toHaveBeenCalledWith('Transloadit notification failed'),
    )
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ body: '[{"assembly_id":"a"}]' }),
    )
    clients[0].emit('dashboard:modal-closed')
    vi.unstubAllGlobals()
  })
})
