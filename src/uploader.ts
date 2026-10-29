import Uppy from '@uppy/core'
import Dashboard from '@uppy/dashboard'
import Transloadit from '@uppy/transloadit'

import type { Context, Instance, Properties } from './types'

const empty = () => ({
  is_uploading: false,
  progress: 0,
  assembly_id: '',
  assembly_json: '',
  results_json: '',
  result_urls: [] as string[],
  error_message: '',
})
function publish(instance: Instance, values: Record<string, unknown>) {
  for (const [name, value] of Object.entries(values)) instance.publishState(name, value)
}
export function fail(instance: Instance, error: unknown) {
  instance.data.failed = true
  instance.data.isUploading = false
  publish(instance, {
    is_uploading: false,
    error_message: error instanceof Error ? error.message : String(error),
  })
  instance.triggerEvent('error')
}
function positive(value: number | undefined, fallback: number) {
  const number = value ?? fallback
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error('Upload limits must be positive integers')
  return number
}
export function assemblyOptions(properties: Properties, signed = true) {
  const params = properties.params ?? ''
  const parsed = JSON.parse(params)
  if (!parsed?.auth?.key || !(parsed.template_id || parsed.steps)) {
    throw new Error('Assembly params need auth.key and template_id or steps')
  }
  if (signed && (!properties.signature || !parsed.auth.expires)) {
    throw new Error('Provide server-signed params with auth.expires and a signature')
  }
  // Do not reserialize: signatures authenticate the exact bytes supplied by the server.
  return { params, signature: properties.signature || undefined }
}
export function initialize(instance: Instance, _context: Context) {
  instance.data.dispose?.()
  publish(instance, empty())
  const canvas = '0' in instance.canvas ? instance.canvas[0] : instance.canvas
  const root = document.createElement('div')
  root.style.cssText = 'width:100%;height:100%;min-width:0'
  canvas.appendChild(root)
  instance.data.root = root
  instance.data.dispose = () => {
    instance.data.observer?.disconnect()
    instance.data.resizeObserver?.disconnect()
    instance.data.uppy?.destroy()
    instance.data.uppy = undefined
    root.remove()
  }
  instance.data.observer = new MutationObserver(() => {
    if (!root.isConnected) instance.data.dispose?.()
  })
  instance.data.observer.observe(document.body, { childList: true, subtree: true })
}
export function update(instance: Instance, properties: Properties, _context: Context) {
  try {
    const restrictions = {
      maxNumberOfFiles: positive(properties.max_files, 1),
      maxFileSize: positive(properties.max_file_size, 5 * 1024 * 1024),
      allowedFileTypes: properties.allowed_file_types?.split(/[\s,]+/).filter(Boolean) ?? null,
    }
    instance.data.properties = properties
    const inline = properties.inline_dashboard !== false
    if (!instance.data.uppy || (inline !== instance.data.mode && !instance.data.isUploading)) {
      instance.data.resizeObserver?.disconnect()
      instance.data.uppy?.destroy()
      const root = instance.data.root
      if (!root) throw new Error('Initialize the uploader before updating it')
      root.replaceChildren()
      const uppy = new Uppy({ restrictions, autoProceed: false })
        .use(Transloadit, {
          waitForEncoding: true,
          errorReporting: false,
          clientName: 'bubble-plugin',
          assemblyOptions: () =>
            assemblyOptions(instance.data.properties ?? {}, !instance.data.legacy),
        })
        .use(
          Dashboard,
          inline
            ? { target: root, inline: true, width: '100%', height: root.clientHeight || 350 }
            : { target: root, inline: false, closeAfterFinish: true },
        )
      instance.data.uppy = uppy
      instance.data.mode = inline
      if (typeof ResizeObserver !== 'undefined') {
        instance.data.resizeObserver = new ResizeObserver(() => {
          if (instance.data.mode)
            uppy.getPlugin('Dashboard')?.setOptions({ height: root.clientHeight || 350 })
        })
        instance.data.resizeObserver.observe(root)
      }
      if (!inline) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = properties.button_label || 'Upload files'
        button.onclick = () => {
          void uppy.getPlugin('Dashboard')?.openModal()
        }
        root.appendChild(button)
      }
      uppy.on('upload', () => {
        instance.data.failed = false
        instance.data.isUploading = true
        publish(instance, { ...empty(), is_uploading: true })
        instance.triggerEvent('upload_started')
      })
      uppy.on('progress', (progress) => instance.publishState('progress', progress))
      uppy.on('transloadit:assembly-created', (assembly) =>
        instance.publishState('assembly_id', assembly.assembly_id),
      )
      uppy.on('transloadit:complete', (assembly) => {
        const results = assembly.results ?? {}
        const urls = Object.values(results)
          .flat()
          .flatMap((file) => (file.ssl_url ? [file.ssl_url] : []))
        publish(instance, {
          assembly_id: assembly.assembly_id,
          assembly_json: JSON.stringify(assembly),
          results_json: JSON.stringify(results),
          result_urls: urls,
        })
      })
      uppy.on('complete', (result) => {
        instance.data.isUploading = false
        instance.publishState('is_uploading', false)
        if (!instance.data.failed && !result.failed?.length) {
          instance.publishState('progress', 100)
          instance.triggerEvent('completed')
        }
      })
      uppy.on('error', (error) => fail(instance, error))
      uppy.on('upload-error', (_file, error) => fail(instance, error))
      uppy.on('restriction-failed', (_file, error) => fail(instance, error))
      uppy.on('transloadit:assembly-error', (_assembly, error) => fail(instance, error))
      uppy.on('cancel-all', () => resetStates(instance))
    } else {
      instance.data.uppy.setOptions({ restrictions })
      const button = instance.data.root?.querySelector('button')
      if (!instance.data.mode && button)
        button.textContent = properties.button_label || 'Upload files'
    }
  } catch (error) {
    fail(instance, error)
  }
}
function resetStates(instance: Instance) {
  instance.data.isUploading = false
  instance.data.failed = false
  publish(instance, empty())
}
export function reset(instance: Instance) {
  instance.data.uppy?.cancelAll()
  resetStates(instance)
}
export function open(properties: Properties, context: Context) {
  // Preserve the global action and its existing keys; new elements require signed params.
  const canvas = document.createElement('div')
  document.body.appendChild(canvas)
  const instance: Instance = {
    canvas,
    data: { legacy: !properties.params },
    publishState: () => {},
    triggerEvent: (event) => {
      if (event === 'error')
        context.reportDebugger('Transloadit upload failed; check the Dashboard')
    },
  }
  initialize(instance, context)
  update(
    instance,
    {
      ...properties,
      params:
        properties.params ||
        JSON.stringify({
          auth: { key: context.keys['AUTH KEY'] },
          template_id: context.keys['TEMPLATE ID'],
        }),
      inline_dashboard: false,
      max_file_size: Number(context.keys['MAX FILE SIZE']) || undefined,
      allowed_file_types: context.keys['ALLOWED FILE TYPES'],
    },
    context,
  )
  const uppy = instance.data.uppy
  const dispose = () => {
    instance.data.dispose?.()
    canvas.remove()
  }
  if (!uppy) {
    dispose()
    return
  }
  uppy.on('transloadit:complete', (assembly) => {
    const url = context.keys['NOTIFY URL']
    if (url)
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([assembly]),
      })
        .then((response) => {
          if (!response.ok) throw new Error(`Notification failed: HTTP ${response.status}`)
        })
        .catch(() => context.reportDebugger('Transloadit notification failed'))
  })
  uppy.on('dashboard:modal-closed', dispose)
  void uppy.getPlugin('Dashboard')?.openModal()
}
