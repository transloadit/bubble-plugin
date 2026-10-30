import { readFileSync } from 'node:fs'

import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

it('reports one CDN failure across initialization, updates and reset', async () => {
  const ready = Promise.reject(new Error('CDN unavailable'))
  vi.stubGlobal('window', { TransloaditBubbleReady: ready })
  const instance = { data: {}, publishState: vi.fn(), triggerEvent: vi.fn() }
  const invoke = (method: string) => {
    const callback = new Function(`return (${readFileSync(`elements/AAu/${method}.js`, 'utf8')})`)()
    callback(instance, {}, {})
  }
  invoke('initialize')
  invoke('update')
  invoke('reset')
  await new Promise((resolve) => setTimeout(resolve, 0))
  invoke('update')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(instance.publishState).toHaveBeenCalledWith('error_message', 'CDN unavailable')
  expect(instance.triggerEvent).toHaveBeenCalledExactlyOnceWith('error')
})
