/// <reference types="vite/client" />
import type { RdApi } from '../../preload/index'

declare global {
  interface Window {
    rd: RdApi
  }
}

export {}
