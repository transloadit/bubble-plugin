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
function report(instance: Instance, error: unknown, configuration = false) {
  const message = error instanceof Error ? error.message : String(error)
  const duplicate = configuration && instance.data.configurationError === message
  if (configuration) instance.data.configurationError = message
  instance.data.errorIsConfiguration = message === instance.data.configurationError
  instance.publishState('error_message', message)
  if (!duplicate) instance.triggerEvent('error')
}
export function fail(instance: Instance, error: unknown) {
  const alreadyFailed = instance.data.failed
  instance.data.failed = true
  instance.data.isUploading = false
  instance.publishState('is_uploading', false)
  if (!alreadyFailed) report(instance, error)
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
function destroy(instance: Instance) {
  const uppy = instance.data.uppy
  instance.data.uppy = undefined
  instance.data.resizeObserver?.disconnect()
  const dashboard = uppy?.getPlugin('Dashboard')
  if (instance.data.mode === false && dashboard?.isModalOpen()) {
    // destroy() alone leaves Dashboard's document keyboard listener behind.
    dashboard.setOptions({ animateOpenClose: false })
    void dashboard.closeModal()
  }
  uppy?.destroy()
}
export function initialize(instance: Instance, _context: Context) {
  instance.data.dispose?.()
  resetStates(instance)
  const canvas = '0' in instance.canvas ? instance.canvas[0] : instance.canvas
  const root = document.createElement('div')
  root.style.cssText = 'width:100%;height:100%;min-width:0'
  canvas.appendChild(root)
  instance.data.root = root
  const dispose = () => {
    instance.data.observer?.disconnect()
    destroy(instance)
    root.remove()
    instance.data.root = undefined
    resetStates(instance)
  }
  instance.data.dispose = dispose
  instance.data.observer = new MutationObserver(() => {
    if (instance.data.root === root && !root.isConnected) dispose()
  })
  instance.data.observer.observe(document.body, { childList: true, subtree: true })
}
export function update(instance: Instance, properties: Properties, context: Context) {
  try {
    instance.data.properties = properties
    const types = properties.allowed_file_types?.split(/[\s,]+/).filter(Boolean)
    const restrictions = {
      // Preserve the original single-file contract: partial multi-file retries lose Assembly results.
      maxNumberOfFiles: 1,
      maxFileSize: positive(properties.max_file_size, 5 * 1024 * 1024),
      allowedFileTypes: types?.length ? types : null,
    }
    if (!instance.data.root) initialize(instance, context)
    const inline = properties.inline_dashboard !== false
    if (!instance.data.uppy || (inline !== instance.data.mode && !instance.data.isUploading)) {
      destroy(instance)
      const root = instance.data.root
      if (!root) throw new Error('Initialize the uploader before updating it')
      root.replaceChildren()
      // Bubble states describe one Assembly cycle at a time.
      const uppy = new Uppy({ restrictions, autoProceed: false, allowMultipleUploadBatches: false })
        .use(Transloadit, {
          waitForEncoding: true,
          errorReporting: false,
          clientName: 'bubble-plugin',
          assemblyOptions: () => {
            try {
              if (instance.data.configurationError)
                throw new Error(instance.data.configurationError)
              for (const file of uppy.getFiles()) {
                const error = uppy.validateSingleFile(file)
                if (error) throw new Error(error)
              }
              return assemblyOptions(instance.data.properties ?? {}, !instance.data.legacy)
            } catch (error) {
              // Uppy retryUpload/retryAll reject without emitting a preprocessor error event.
              // Include the file so Dashboard keeps its Retry control after validation fails.
              uppy.emit(
                'error',
                error instanceof Error ? error : new Error(String(error)),
                uppy.getFiles()[0],
              )
              throw error
            }
          },
        })
        .use(
          Dashboard,
          inline
            ? { target: root, inline: true, width: '100%', height: root.clientHeight || 350 }
            : { target: root, inline: false, closeAfterFinish: true },
        )
      instance.data.uppy = uppy
      instance.data.mode = inline
      const failedAssemblies = new Set<string>()
      instance.data.failedAssemblies = failedAssemblies
      let assemblyId: string | undefined
      const current = () => instance.data.uppy === uppy
      const refreshMode = () =>
        queueMicrotask(() => {
          const latest = instance.data.properties ?? {}
          if (
            current() &&
            !instance.data.isUploading &&
            (latest.inline_dashboard !== false) !== inline
          )
            update(instance, latest, context)
        })
      const failure = (error: unknown) => {
        if (current()) {
          if (assemblyId) failedAssemblies.add(assemblyId)
          fail(instance, error)
          refreshMode()
        }
      }
      if (typeof ResizeObserver !== 'undefined') {
        instance.data.resizeObserver = new ResizeObserver(() => {
          if (current() && instance.data.mode)
            uppy.getPlugin('Dashboard')?.setOptions({ height: root.clientHeight || 350 })
        })
        instance.data.resizeObserver.observe(root)
      }
      if (!inline) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.transloaditUpload = ''
        button.textContent = properties.button_label || 'Upload files'
        button.onclick = () => {
          void uppy.getPlugin('Dashboard')?.openModal()
        }
        root.appendChild(button)
      }
      uppy.on('upload', () => {
        if (!current()) return
        instance.data.failed = false
        instance.data.isUploading = true
        instance.data.errorIsConfiguration = !!instance.data.configurationError
        publish(instance, {
          ...empty(),
          is_uploading: true,
          error_message: instance.data.configurationError ?? '',
        })
        instance.triggerEvent('upload_started')
      })
      uppy.on('progress', (progress) => {
        if (current() && instance.data.isUploading) instance.publishState('progress', progress)
      })
      uppy.on('transloadit:assembly-created', (assembly, fileIDs = []) => {
        if (!current()) return
        assemblyId = assembly.assembly_id
        // A replacement Assembly needs a new tus resource, not the previous Assembly's upload URL.
        for (const id of fileIDs) {
          const file = uppy.getFile(id)
          if (file)
            uppy.setFileState(id, {
              tus: { ...file.tus, uploadUrl: undefined },
              progress: {
                uploadStarted: null,
                uploadComplete: false,
                percentage: 0,
                bytesUploaded: false,
                bytesTotal: file.size,
              },
            })
        }
        instance.publishState('assembly_id', assembly.assembly_id)
      })
      uppy.on('transloadit:complete', (assembly) => {
        // A failed Assembly's final status request can resolve after its retry has started.
        if (!current() || failedAssemblies.has(assembly.assembly_id ?? '')) return
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
        // Uppy per-file retries omit the generic complete event; processing completion is authoritative.
        if (!instance.data.failed && instance.data.isUploading) {
          instance.data.isUploading = false
          instance.data.errorIsConfiguration = !!instance.data.configurationError
          publish(instance, {
            is_uploading: false,
            progress: 100,
            error_message: instance.data.configurationError ?? '',
          })
          instance.triggerEvent('completed')
          refreshMode()
        }
      })
      uppy.on('error', failure)
      uppy.on('upload-error', (_file, error) => failure(error))
      uppy.on('transloadit:assembly-error', (_assembly, error) => failure(error))
      uppy.on('restriction-failed', (_file, error) => {
        if (!current()) return
        report(instance, error)
      })
      uppy.on('cancel-all', () => {
        if (!current()) return
        resetStates(instance)
        // A fresh client prevents pending requests from a cancelled Assembly affecting its successor.
        destroy(instance)
        if (instance.data.legacy === undefined)
          update(instance, instance.data.properties ?? {}, context)
      })
    } else {
      instance.data.uppy.setOptions({ restrictions })
      const button = instance.data.root?.querySelector('button[data-transloadit-upload]')
      if (!instance.data.mode && button)
        button.textContent = properties.button_label || 'Upload files'
    }
    if (instance.data.configurationError) {
      instance.data.configurationError = undefined
      if (instance.data.errorIsConfiguration) instance.publishState('error_message', '')
      instance.data.errorIsConfiguration = false
    }
  } catch (error) {
    // Property errors recover independently from transfer failures and never stop an active upload.
    report(instance, error, true)
  }
}
function resetStates(instance: Instance, configurationError?: string) {
  instance.data.isUploading = false
  instance.data.failed = false
  instance.data.configurationError = configurationError
  instance.data.errorIsConfiguration = !!configurationError
  publish(instance, { ...empty(), error_message: configurationError ?? '' })
}
export function reset(instance: Instance) {
  // Without a client, cancel-all cannot revalidate an unresolved property error.
  resetStates(instance, instance.data.uppy ? undefined : instance.data.configurationError)
  instance.data.uppy?.cancelAll()
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
      max_file_size: Number.parseInt(context.keys['MAX FILE SIZE'] ?? '', 10) || undefined,
      allowed_file_types: context.keys['ALLOWED FILE TYPES'],
    },
    context,
  )
  const uppy = instance.data.uppy
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    instance.data.dispose?.()
    canvas.remove()
  }
  if (!uppy) {
    dispose()
    return
  }
  instance.data.root?.querySelector('button[data-transloadit-upload]')?.remove()
  let closed = false
  uppy.on('transloadit:complete', (assembly) => {
    if (disposed || instance.data.failedAssemblies?.has(assembly.assembly_id ?? '')) return
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
    if (closed) dispose()
  })
  uppy.on('dashboard:modal-closed', () => {
    closed = true
    if (!instance.data.isUploading) dispose()
  })
  uppy.on('cancel-all', dispose)
  for (const event of ['error', 'upload-error', 'transloadit:assembly-error'] as const)
    uppy.on(event, () => {
      if (closed) dispose()
    })
  void uppy.getPlugin('Dashboard')?.openModal()
}
