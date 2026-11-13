// Demo build only: which voice feeds the board while recording, remembered per browser.
//  - 'script': a sample lecture, spoken word by word (works everywhere, no permissions).
//  - 'mic': the browser's own speech recognition (Chrome, Edge, Safari), free and keyless.
import { useSyncExternalStore } from 'react'

export type VoiceMode = 'script' | 'mic'

const KEY = 'aside-demo-voice'
const listeners = new Set<() => void>()

function read(): VoiceMode {
  try {
    return localStorage.getItem(KEY) === 'mic' && micSupported() ? 'mic' : 'script'
  } catch {
    return 'script'
  }
}

let mode: VoiceMode = read()

export function micSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  return typeof window !== 'undefined' && !!(w.SpeechRecognition || w.webkitSpeechRecognition)
}

export function setVoiceMode(next: VoiceMode) {
  mode = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // private mode: keep it for this visit only
  }
  for (const l of listeners) l()
}

export function useVoiceMode(): VoiceMode {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => mode,
  )
}
