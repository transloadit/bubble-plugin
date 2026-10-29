import type Uppy from '@uppy/core'

export interface Properties {
  params?: string
  signature?: string
  inline_dashboard?: boolean
  button_label?: string
  max_files?: number
  max_file_size?: number
  allowed_file_types?: string
}
export interface Context {
  keys: Record<string, string | undefined>
  reportDebugger: (message: string) => void
}
export interface Instance {
  canvas: HTMLElement | { 0: HTMLElement }
  data: {
    uppy?: Uppy
    properties?: Properties
    root?: HTMLElement
    observer?: MutationObserver
    resizeObserver?: ResizeObserver
    dispose?: () => void
    mode?: boolean
    isUploading?: boolean
    failed?: boolean
    legacy?: boolean
  }
  publishState: (name: string, value: unknown) => void
  triggerEvent: (name: string) => void
}
