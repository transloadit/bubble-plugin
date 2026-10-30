import type Uppy from '@uppy/core'

import type { Context, Instance, Properties } from '../../src/types.ts'
import type { initialize, reset, update } from '../../src/uploader.ts'

interface HarnessInstance extends Instance {
  canvas: { 0: HTMLElement }
  data: Instance['data'] & { ready?: Promise<unknown> }
}

declare global {
  interface Window {
    states: {
      is_uploading: boolean
      progress: number
      error_message: string
      assembly_id: string
      assembly_json: string
      results_json: string
      result_urls: string[]
    }
    events: string[]
    instance: HarnessInstance
    context: Context
    mount: (properties: Properties) => Promise<void>
    getUppy: () => Uppy
    initializeElement: typeof initialize
    updateElement: typeof update
    resetElement: (instance: Instance, context: Context) => ReturnType<typeof reset>
    sources: { listeners: Record<string, (event: { data: string }) => void> }[]
    finalRequests: (() => void)[]
  }
}

export function start(defaults: Properties): void {
  const canvas = document.querySelector('#canvas')
  if (!(canvas instanceof HTMLElement)) throw new Error('Missing harness canvas')
  window.states = {
    is_uploading: false,
    progress: 0,
    error_message: '',
    assembly_id: '',
    assembly_json: '',
    results_json: '',
    result_urls: [],
  }
  window.events = []
  window.instance = {
    canvas: { 0: canvas },
    data: {},
    publishState(name, value) {
      Object.assign(window.states, { [name]: value })
    },
    triggerEvent(name) {
      window.events.push(name)
    },
  }
  window.context = {
    keys: {},
    reportDebugger(message) {
      throw new Error(message)
    },
  }
  window.getUppy = () => {
    const uppy = window.instance.data.uppy
    if (!uppy) throw new Error('Mount the uploader before accessing Uppy')
    return uppy
  }
  window.mount = async (properties) => {
    for (const name of ['initializeElement', 'updateElement', 'resetElement'] as const) {
      const method = name.replace('Element', '')
      const code = await fetch(`/elements/AAu/${method}.js`).then((response) => response.text())
      // Bubble stores callbacks as function expressions; evaluate the actual generated export.
      window[name] = new Function(`return (${code})`)()
    }
    window.initializeElement(window.instance, window.context)
    window.updateElement(window.instance, { ...defaults, ...properties }, window.context)
    await window.instance.data.ready
  }
}
