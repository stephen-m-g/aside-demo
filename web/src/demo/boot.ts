// Demo build only: load this browser's demo data (or seed it) before the app renders.
import { broadcastReset, getData, suspendSaves, kvClear, kvGet, kvSet, loadFiles, setData, type DemoData } from './db'
import { SEED_VERSION, buildSeed } from './seed'

export async function bootDemo() {
  try {
    const [version, saved] = await Promise.all([kvGet<number>('version'), kvGet<DemoData>('db')])
    if (saved && version === SEED_VERSION) {
      setData(saved)
      const paths = (getData().assets ?? [])
        .map((a) => a.storage_path as string | null)
        .filter((p): p is string => !!p && !p.startsWith('demo/') && !p.startsWith('data:'))
      await loadFiles(paths)
      return
    }
    await kvClear()
    setData(buildSeed())
    await Promise.all([kvSet('db', getData()), kvSet('version', SEED_VERSION)])
  } catch (e) {
    // IndexedDB unavailable (some private windows): the demo still works, it just won't survive a reload.
    console.warn('[demo] storage unavailable, running in memory', e)
    setData(buildSeed())
  }
}

/** Start over with the original demo content (in every open tab). */
export async function resetDemo() {
  suspendSaves()
  try {
    await kvClear()
  } catch {
    /* in-memory only */
  }
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
  broadcastReset()
  window.location.assign('/')
}
