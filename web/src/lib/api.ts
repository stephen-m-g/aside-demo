// Demo build: there is no API server. Every endpoint runs in the browser (src/demo/ai.ts) against the demo
// database, with simple rules standing in for Gemini. Same names and shapes as the real client.
import * as demo from '../demo/ai'

export const API_URL = 'demo (in your browser)'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The `detail` string, written for the teacher. */
    readonly detail: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** A message to show the teacher for a failed API call. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.detail ?? fallback
  return fallback
}

export const api = {
  health: async () => ({ ok: true }),
  describeAsset: (assetId: string) => demo.describeAsset(assetId),
  /** Render a PDF's pages to page-image assets (once; later calls return the same pages). */
  renderPdfPages: (assetId: string) => demo.renderPdfPages(assetId),
  /** Batch-clean unrefined speech into one text block: appended to the board, or under its PDF page. */
  refineSession: (sessionId: string) => demo.refineSession(sessionId),
  closeAnnotation: (annotationId: string, _cropPngBase64?: string) => demo.closeAnnotation(annotationId),
  compileSession: (sessionId: string) => demo.compileSession(sessionId),
  /** Not used in the demo: speech comes from src/demo/speech.ts. */
  scribeToken: async (_sessionId: string): Promise<{ token: string }> => {
    throw new ApiError('no speech server in the demo', 503, 'Live transcription service isn’t part of the demo.')
  },
}
