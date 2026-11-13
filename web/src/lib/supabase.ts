// Demo build: no Supabase project. `supabase` is an in-browser stand-in (src/demo/db.ts) with the same API
// surface the app uses, typed as the real client so every page compiles unchanged.
import type { SupabaseClient } from '@supabase/supabase-js'
import { demoClient, publicUrl } from '../demo/db'

export const supabaseConfigured = true

export const supabase = demoClient as unknown as SupabaseClient

/** Public URL for a file in the "assets" storage bucket. */
export function assetPublicUrl(storagePath: string): string {
  return publicUrl(storagePath)
}
