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
      this.plugins.set(plugin.name, {
        opts,
        openModal: vi.fn(),
        closeModal: vi.fn(),
        isModalOpen: () => false,
        setOptions: vi.fn(),
      })
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
    getFiles() {
      return []
    }
    cancelAll = vi.fn(() => this.emit('cancel-all'))
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
    client.emit('upload', 'upload-1')
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
    client.emit('complete', { uploadID: 'upload-1', successful: [{}], failed: [] })
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
    expect(states.is_uploading).toBe(false)
    expect(states.progress).toBe(100)
    client.emit('upload', 'upload-1')
    expect(states.result_urls).toEqual([])
    expect(states.assembly_json).toBe('')
  })

  it.each([
    'error',
    'upload-error',
    'transloadit:assembly-error',
  ])('publishes %s without a false completed event', (event) => {
    const client = clients[0]
    client.emit('upload', 'upload-1')
    const error = new Error('API request failed')
    client.emit(event, ...(event === 'error' ? [error] : [null, error]))
    client.emit('complete', { uploadID: 'upload-1', successful: [{}], failed: [] })
    expect(states.error_message).toBe('API request failed')
    expect(states.is_uploading).toBe(false)
    expect(instance.triggerEvent).not.toHaveBeenCalledWith('completed')
  })

  it('does not signal completed for an upload result with failed files', () => {
    clients[0].emit('complete', { failed: [{}] })
    expect(instance.triggerEvent).not.toHaveBeenCalledWith('completed')
  })

  it('cancels uploads and resets all states', () => {
    clients[0].emit('upload', 'upload-1')
    reset(instance)
    expect(clients[0].cancelAll).toHaveBeenCalledOnce()
    expect(states).toMatchObject({ is_uploading: false, progress: 0, error_message: '' })
    clients[0].emit('cancel-all')
    expect(states.result_urls).toEqual([])
  })

  it('releases Uppy and its DOM observer when Bubble removes the element', async () => {
    clients[0].emit('upload', 'removed-upload')
    document.body.replaceChildren()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clients[0].destroyed).toBe(true)
    expect(instance.data.uppy).toBeUndefined()
    expect(states.is_uploading).toBe(false)
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
        max_file_size: 2048,
        allowed_file_types: '.png, image/jpeg',
      },
      context,
    )
    expect(button?.textContent).toBe('Add file')
    expect(client.setOptions).toHaveBeenCalledWith({
      restrictions: {
        maxNumberOfFiles: 1,
        maxFileSize: 2048,
        allowedFileTypes: ['.png', 'image/jpeg'],
      },
    })
  })

  it('defers display changes until an active upload has finished', async () => {
    clients[0].emit('upload', 'upload-1')
    update(instance, { ...properties, inline_dashboard: false }, context)
    expect(clients).toHaveLength(1)
    expect(clients[0].destroyed).toBe(false)
    clients[0].emit('transloadit:assembly-created', { assembly_id: 'finished' })
    clients[0].emit('transloadit:complete', { assembly_id: 'finished', results: {} })
    await Promise.resolve()
    expect(instance.data.root?.querySelector('button')?.textContent).toBe('Upload files')
  })

  it('reports invalid dynamic properties without failing an ongoing upload', () => {
    clients[0].emit('upload', 'active-upload')
    update(instance, { ...properties, max_file_size: -1 }, context)
    expect(states.error_message).toContain('positive integers')
    expect(states.is_uploading).toBe(true)
    update(instance, properties, context)
    clients[0].emit('transloadit:assembly-created', { assembly_id: 'finished' })
    clients[0].emit('transloadit:complete', { assembly_id: 'finished', results: {} })
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
  })

  it('clears corrected property errors without hiding upload failures', () => {
    update(instance, { ...properties, max_file_size: -1 }, context)
    update(instance, properties, context)
    expect(states.error_message).toBe('')
    clients[0].emit('upload', 'failed-upload')
    clients[0].emit('error', new Error('Transfer failed'))
    update(instance, properties, context)
    expect(states.error_message).toBe('Transfer failed')
  })

  it('reports a new property error after upload failure and deduplicates unchanged bad updates', () => {
    clients[0].emit('upload', 'failed-upload')
    clients[0].emit('error', new Error('Transfer failed'))
    vi.mocked(instance.triggerEvent).mockClear()
    update(instance, { ...properties, max_file_size: -1 }, context)
    update(instance, { ...properties, max_file_size: -1 }, context)
    expect(states.error_message).toContain('positive integers')
    expect(instance.triggerEvent).toHaveBeenCalledExactlyOnceWith('error')
    update(instance, properties, context)
    update(instance, { ...properties, max_file_size: -1 }, context)
    expect(instance.triggerEvent).toHaveBeenCalledTimes(2)
  })

  it('blocks new Assemblies until invalid properties are corrected', () => {
    update(instance, { ...properties, max_file_size: -1, signature: 'sha384:fresh' }, context)
    clients[0].emit('upload', 'blocked-upload')
    const options = clients[0].getPlugin('Transloadit').opts
    expect(() => options.assemblyOptions()).toThrow('positive integers')
    expect(states.is_uploading).toBe(false)
    expect(states.error_message).toContain('positive integers')
    update(instance, { ...properties, signature: 'sha384:fresh' }, context)
    expect(states.error_message).toBe('')
    expect(options.assemblyOptions().signature).toBe('sha384:fresh')
  })

  it('retains property validation across rejected additions and reset', () => {
    update(instance, { ...properties, max_file_size: -1 }, context)
    vi.mocked(instance.triggerEvent).mockClear()
    clients[0].emit('restriction-failed', null, new Error('Disallowed type'))
    update(instance, { ...properties, max_file_size: -1 }, context)
    expect(instance.triggerEvent).toHaveBeenCalledExactlyOnceWith('error')
    reset(instance)
    expect(states.error_message).toContain('positive integers')
    reset(instance)
    expect(states.error_message).toContain('positive integers')
  })

  it('finishes active processing without hiding an outstanding property error', () => {
    clients[0].emit('upload', 'active-upload')
    update(instance, { ...properties, max_file_size: -1 }, context)
    clients[0].emit('transloadit:assembly-created', { assembly_id: 'finished' })
    clients[0].emit('transloadit:complete', { assembly_id: 'finished', results: {} })
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
    expect(states.error_message).toContain('positive integers')
  })

  it.each([0, -1, 1.5, Number.NaN])('reports an invalid upload limit (%s)', (limit) => {
    update(instance, { ...properties, max_file_size: limit }, context)
    expect(states.error_message).toContain('positive integers')
    expect(instance.triggerEvent).toHaveBeenCalledWith('error')
  })
})

describe('signing contract', () => {
  it.each([undefined, null, '', '  '])('names missing Assembly params (%j)', (params) => {
    expect(() => assemblyOptions({ params })).toThrow('Provide signed Assembly params JSON')
  })
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
  it.each([
    ['2048 bytes', 2048],
    ['10.5', 10],
  ])('preserves the legacy integer size parsing for %s', (size, expected) => {
    open({}, { ...context, keys: { 'MAX FILE SIZE': size } })
    expect(clients[0].opts.restrictions).toMatchObject({ maxFileSize: expected })
    clients[0].emit('dashboard:modal-closed')
  })

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
    clients[0].emit('transloadit:assembly-created', { assembly_id: 'a' })
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

describe('council regression cases', () => {
  beforeEach(() => {
    initialize(instance, context)
    update(instance, properties, context)
  })

  it.each(['', ' ,  '])('treats blank allowed types (%j) as unrestricted', (allowed_file_types) => {
    update(instance, { ...properties, allowed_file_types }, context)
    expect(clients[0].setOptions).toHaveBeenLastCalledWith({
      restrictions: expect.objectContaining({ allowedFileTypes: null }),
    })
  })

  it('signals an upload failure only once across overlapping Uppy error events', () => {
    const client = clients[0]
    client.emit('upload', 'upload-1')
    const error = new Error('Assembly failed')
    client.emit('upload-error', null, error)
    client.emit('error', error)
    client.emit('transloadit:assembly-error', {}, error)
    expect(
      vi.mocked(instance.triggerEvent).mock.calls.filter(([event]) => event === 'error'),
    ).toHaveLength(1)
  })

  it('reports rejected additions without failing the active upload', () => {
    const client = clients[0]
    client.emit('upload', 'upload-1')
    client.emit('restriction-failed', null, new Error('Too many files'))
    expect(states.is_uploading).toBe(true)
    expect(states.error_message).toBe('Too many files')
    client.emit('transloadit:assembly-created', { assembly_id: 'active' })
    client.emit('transloadit:complete', { assembly_id: 'active', results: {} })
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
  })

  it('ignores cancelled completions even after a subsequent upload starts', () => {
    const client = clients[0]
    client.emit('upload', 'cancelled-upload')
    reset(instance)
    const next = clients.at(-1)
    next?.emit('upload', 'next-upload')
    client.emit('complete', { uploadID: 'cancelled-upload', successful: [], failed: [] })
    expect(states.is_uploading).toBe(true)
    expect(instance.triggerEvent).not.toHaveBeenCalledWith('completed')
    next?.emit('transloadit:assembly-created', { assembly_id: 'next' })
    next?.emit('transloadit:complete', { assembly_id: 'next', results: {} })
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
  })
})

describe('upload session isolation', () => {
  beforeEach(() => {
    initialize(instance, context)
    update(instance, properties, context)
  })

  it('ignores late errors, progress and results from a cancelled session', () => {
    const old = clients[0]
    old.emit('upload', 'old-upload')
    reset(instance)
    const next = clients.at(-1)
    next?.emit('upload', 'next-upload')
    old.emit('error', new Error('All files were canceled after assembly was created'))
    old.emit('progress', 100)
    old.emit('transloadit:complete', { assembly_id: 'cancelled', results: {} })
    expect(states.is_uploading).toBe(true)
    expect(states.error_message).toBe('')
    expect(states.progress).toBe(0)
    expect(states.assembly_id).toBe('')
  })

  it('completes a successful per-file retry without a generic Uppy complete event', () => {
    const client = clients[0]
    client.emit('upload', 'failed-upload')
    client.emit('error', new Error('Transfer failed'))
    client.emit('upload', 'retry-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'retried' })
    client.emit('transloadit:complete', { assembly_id: 'retried', results: {} })
    expect(states.is_uploading).toBe(false)
    expect(states.progress).toBe(100)
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
  })

  it('ignores a failed Assembly status request that resolves after its retry begins', () => {
    const client = clients[0]
    client.emit('upload', 'first-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'failed' })
    client.emit('error', new Error('Transfer failed'))
    client.emit('upload', 'retry-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'retry' })
    client.emit('transloadit:complete', { assembly_id: 'failed', results: {} })
    expect(states.assembly_id).toBe('retry')
    expect(states.is_uploading).toBe(true)
    expect(instance.triggerEvent).not.toHaveBeenCalledWith('completed')
    client.emit('transloadit:complete', { assembly_id: 'retry', results: {} })
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
  })

  it.each([false, true])('ignores superseded successful completions (created=%s)', (created) => {
    const client = clients[0]
    client.emit('upload', 'first-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'first' })
    const first = { assembly_id: 'first', results: {} }
    client.emit('transloadit:complete', first)
    instance.triggerEvent = vi.fn()
    client.emit('upload', 'second-upload')
    if (created) client.emit('transloadit:assembly-created', { assembly_id: 'second' })
    client.emit('transloadit:complete', first)
    expect(states.is_uploading).toBe(true)
    expect(states.assembly_json).toBe('')
    expect(instance.triggerEvent).not.toHaveBeenCalledWith('completed')
    if (!created) client.emit('transloadit:assembly-created', { assembly_id: 'second' })
    client.emit('transloadit:complete', { assembly_id: 'second', results: {} })
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
  })

  it.each([
    false,
    true,
  ])('ignores old Assembly errors after retry starts (created=%s)', (created) => {
    const client = clients[0]
    client.emit('upload', 'first-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'old' })
    client.emit('error', new Error('Transfer failed'))
    client.emit('upload', 'retry-upload')
    if (created) client.emit('transloadit:assembly-created', { assembly_id: 'retry' })
    client.emit(
      'transloadit:assembly-error',
      { assembly_id: 'old' },
      new Error('Late status error'),
    )
    expect(states.is_uploading).toBe(true)
    expect(states.error_message).toBe('')
    if (!created) client.emit('transloadit:assembly-created', { assembly_id: 'retry' })
    client.emit('transloadit:complete', { assembly_id: 'retry', results: {} })
    expect(instance.triggerEvent).toHaveBeenLastCalledWith('completed')
  })

  it('allows a detached Bubble canvas to be attached and updated again', async () => {
    const canvas = '0' in instance.canvas ? instance.canvas[0] : instance.canvas
    canvas.remove()
    await new Promise((resolve) => setTimeout(resolve, 0))
    document.body.appendChild(canvas)
    update(instance, properties, context)
    expect(instance.data.root?.isConnected).toBe(true)
  })
})

describe('legacy background upload', () => {
  it('notifies only once for duplicate final-status responses after a retry', () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    open(properties, { ...context, keys: { 'NOTIFY URL': 'https://example.com/hook' } })
    const client = clients[0]
    client.emit('upload', 'first-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'first' })
    client.emit('error', new Error('Transfer failed'))
    client.emit('upload', 'retry-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'retry' })
    const result = { assembly_id: 'retry', results: {} }
    client.emit('transloadit:complete', result)
    client.emit('transloadit:complete', result)
    expect(fetch).toHaveBeenCalledOnce()
    client.emit('dashboard:modal-closed')
    vi.unstubAllGlobals()
  })
  it('keeps a dismissed retry alive when the previous Assembly errors late', () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    open(properties, { ...context, keys: { 'NOTIFY URL': 'https://example.com/hook' } })
    const client = clients[0]
    client.emit('upload', 'first-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'old' })
    client.emit('error', new Error('Transfer failed'))
    client.emit('upload', 'retry-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'retry' })
    client.emit('dashboard:modal-closed')
    client.emit(
      'transloadit:assembly-error',
      { assembly_id: 'old' },
      new Error('Late status error'),
    )
    expect(client.destroyed).toBe(false)
    client.emit('transloadit:complete', { assembly_id: 'retry', results: {} })
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://example.com/hook', expect.any(Object))
    expect(client.destroyed).toBe(true)
    vi.unstubAllGlobals()
  })

  it('does not notify for a failed Assembly completing after retry', () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    open(properties, { ...context, keys: { 'NOTIFY URL': 'https://example.com/hook' } })
    const client = clients[0]
    client.emit('upload', 'first-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'failed' })
    client.emit('error', new Error('Transfer failed'))
    client.emit('upload', 'retry-upload')
    client.emit('transloadit:assembly-created', { assembly_id: 'retry' })
    client.emit('transloadit:complete', { assembly_id: 'failed', results: {} })
    expect(fetch).not.toHaveBeenCalled()
    client.emit('cancel-all')
    vi.unstubAllGlobals()
  })

  it.each([
    'error',
    'upload-error',
    'transloadit:assembly-error',
  ])('releases a dismissed picker on %s', (event) => {
    open(properties, context)
    const client = clients[0]
    client.emit('upload', 'legacy-upload')
    client.emit('dashboard:modal-closed')
    const error = new Error('Upload failed')
    client.emit(event, ...(event === 'error' ? [error] : [null, error]))
    expect(client.destroyed).toBe(true)
  })

  it('keeps a dismissed upload alive until it sends its notification', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    open(properties, { ...context, keys: { 'NOTIFY URL': 'https://example.com/hook' } })
    const client = clients[0]
    client.emit('upload', 'legacy-upload')
    client.emit('dashboard:modal-closed')
    expect(client.destroyed).toBe(false)
    client.emit('transloadit:assembly-created', { assembly_id: 'finished' })
    client.emit('transloadit:complete', { assembly_id: 'finished', results: {} })
    expect(fetch).toHaveBeenCalledOnce()
    expect(client.destroyed).toBe(true)
    vi.unstubAllGlobals()
  })
})

it('preserves initial configuration errors across resets before Uppy exists', () => {
  initialize(instance, context)
  update(instance, { ...properties, max_file_size: 0 }, context)
  expect(clients).toHaveLength(0)
  reset(instance)
  reset(instance)
  expect(states.error_message).toContain('positive integers')
  expect(instance.triggerEvent).toHaveBeenCalledExactlyOnceWith('error')
})

it('does not notify from a cancelled legacy picker', () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetch)
  open(properties, { ...context, keys: { 'NOTIFY URL': 'https://example.com/hook' } })
  clients[0].emit('cancel-all')
  clients[0].emit('transloadit:complete', { assembly_id: 'cancelled', results: {} })
  expect(fetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
