// Demo build only: the FastAPI endpoints, reimplemented in the browser against the demo database.
// Each mirrors what the server does to the data (same rows, same fields, same realtime events), with plain
// rules standing in for Gemini (see language.ts) and pdf.js rendering PDF pages locally.
import type { Asset, Block, NotesContent, NotesSection } from '../types'
import { ApiError } from '../lib/api'
import { supabase } from '../lib/supabase'
import { fileBlobUrl, getData, putFile } from './db'
import { capitalize, cleanSpeech, findTerms, firstSentence, keyTerms, labelFromFileName } from './language'

type Row = Record<string, any>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))])
const rows = (table: string): Row[] => getData()[table] ?? []
const byId = (table: string, id: string | null | undefined) => (id ? rows(table).find((r) => r.id === id) : undefined)

const MAX_REFINE_WORDS = 150

function segmentOrderKey(s: Row): string {
  const created = s.created_at ?? ''
  const start = s.t_start ?? created
  const end = s.t_end ?? start
  return `${start}|${end}|${created}|${s.id}`
}

// ---------------------------------------------------------------- describe

export async function describeAsset(assetId: string) {
  await sleep(900 + Math.random() * 600)
  const asset = byId('assets', assetId)
  if (!asset) throw new ApiError('asset not found', 404, 'asset not found')
  let result: { label: string; description: string; key_terms: string[] }
  if (asset.kind === 'text') {
    const text: string = (asset.text_content ?? '').trim()
    const firstLine = text.split('\n')[0].trim()
    const label = firstLine && firstLine.split(/\s+/).length <= 7 ? firstLine.replace(/[:.]$/, '') : firstSentence(text, 6) || 'Text note'
    // Describe with the first sentence that isn't just the label again.
    const norm = (x: string) => x.replace(/[.:…]+$/, '').trim().toLowerCase()
    const sentences = text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/)
    const description = sentences.find((x) => norm(x) !== norm(label) && !norm(label).startsWith(norm(x))) ?? ''
    result = {
      label: capitalize(label).replace(/[.…]$/, ''),
      description: firstSentence(description, 30),
      key_terms: findTerms(text).slice(0, 8),
    }
  } else {
    const name = asset.file_name ?? (asset.kind === 'pdf' ? 'PDF' : 'Image')
    const label = labelFromFileName(name)
    result = {
      label,
      description:
        asset.kind === 'pdf'
          ? 'Demo mode: in the full app, AI reads the whole PDF and summarizes it here, with its key terms.'
          : 'Demo mode: in the full app, AI looks at the image and describes it here, with its key terms.',
      key_terms: findTerms(label).slice(0, 6),
    }
  }
  await supabase.from('assets').update(result).eq('id', assetId)
  return result
}

// ---------------------------------------------------------------- PDF pages (pdf.js, in the browser)

export async function renderPdfPages(assetId: string): Promise<{ page_count: number; pages: Asset[] }> {
  const pdf = byId('assets', assetId)
  if (!pdf) throw new ApiError('asset not found', 404, 'asset not found')
  if (pdf.kind !== 'pdf') throw new ApiError('only PDF assets have pages', 400, 'only PDF assets have pages')
  const existing = () => rows('assets').filter((a) => a.source_asset_id === assetId).sort((a, b) => a.page_number - b.page_number) as Asset[]
  if (pdf.page_count && existing().length === pdf.page_count) return { page_count: pdf.page_count, pages: existing() }

  const url = pdf.storage_path ? fileBlobUrl(pdf.storage_path) : undefined
  if (!url) throw new ApiError('missing file', 404, 'The PDF file is missing. Remove it and upload it again.')

  try {
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const doc = await withTimeout(pdfjs.getDocument({ data: await (await fetch(url)).arrayBuffer() }).promise, 20_000)
    const count = Math.min(doc.numPages, 40)
    const name = pdf.file_name || 'PDF'
    const pages: Row[] = []
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2, 1400 / base.width) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // 'print' renders in one go (no animation frames), so it also finishes in a background tab.
      await withTimeout(page.render({ canvas, viewport, intent: 'print' }).promise, 20_000)
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('render failed'))), 'image/png'),
      )
      const path = `${pdf.lecture_id}/${pdf.id}/page-${String(n).padStart(4, '0')}.png`
      await putFile(path, blob)
      pages.push({
        id: crypto.randomUUID(), lecture_id: pdf.lecture_id, kind: 'pdf_page', storage_path: path,
        file_name: `${name}, page ${n}`, source_asset_id: pdf.id, page_number: n, aspect: viewport.width / viewport.height,
      })
    }
    await supabase.from('assets').delete().eq('source_asset_id', assetId)
    await supabase.from('assets').insert(pages)
    await supabase.from('assets').update({ page_count: count }).eq('id', assetId)
    return { page_count: count, pages: existing() }
  } catch (e) {
    console.warn('[demo] pdf render failed', e)
    throw new ApiError('render failed', 422, 'Couldn’t read this PDF in the demo. Try a different file.')
  }
}

// ---------------------------------------------------------------- refine (speech -> paragraph on the board)

function paragraphSlot(blocks: Row[], pageId: string | null): { position: number; prev: Row | null; moved: Row[] } {
  if (pageId === null) {
    const prev = [...blocks].reverse().find((b) => b.kind === 'text' && b.text && !b.page_block_id) ?? null
    return { position: blocks.length ? blocks[blocks.length - 1].position + 1 : 1, prev, moved: [] }
  }
  let index = -1
  blocks.forEach((b, i) => {
    if (b.id === pageId || b.page_block_id === pageId) index = i
  })
  const prev = blocks[index]
  const following = blocks.slice(index + 1)
  if (following.length === 0) return { position: prev.position + 1, prev, moved: [] }
  let gap = following[0].position - prev.position
  const moved: Row[] = []
  if (gap < 1e-6) {
    for (const b of following) moved.push({ ...b, position: b.position + 1 })
    gap += 1
  }
  return { position: prev.position + gap / 2, prev, moved }
}

async function refineBatch(sessionId: string): Promise<{ block: Block | null; segment_ids: string[]; moved_blocks: Block[] }> {
  const unrefined = rows('transcript_segments')
    .filter((s) => s.session_id === sessionId && !s.text_block_id)
    .sort((a, b) => segmentOrderKey(a).localeCompare(segmentOrderKey(b)))
  if (unrefined.length === 0) return { block: null, segment_ids: [], moved_blocks: [] }
  const blocks = rows('blocks')
    .filter((b) => b.session_id === sessionId)
    .sort((a, b) => a.position - b.position)
  const imageIds = new Set(blocks.filter((b) => b.kind === 'image').map((b) => b.id))
  const pageOf = (s: Row) => (s.page_block_id && imageIds.has(s.page_block_id) ? s.page_block_id : null)
  const pageId = pageOf(unrefined[0])
  const segs: Row[] = []
  let words = 0
  for (const s of unrefined) {
    if (pageOf(s) !== pageId) break
    segs.push(s)
    words += String(s.raw_text).split(/\s+/).length
    if (words >= MAX_REFINE_WORDS) break
  }

  const { position, prev, moved } = paragraphSlot(blocks, pageId)
  for (const m of moved) await supabase.from('blocks').update({ position: m.position }).eq('id', m.id)

  let text = ''
  const offsets: [number | null, number | null][] = []
  for (const s of segs) {
    const part = cleanSpeech(String(s.raw_text))
    if (!part) {
      offsets.push([null, null])
      continue
    }
    if (text) text += ' '
    const start = text.length
    text += part
    offsets.push([start, text.length])
  }

  let block: Row
  if (text || !prev) {
    const row: Row = { session_id: sessionId, kind: 'text', position, text }
    if (pageId) row.page_block_id = pageId
    const res = await supabase.from('blocks').insert(row).select().single()
    block = res.data as Row
  } else {
    block = prev
  }
  for (let i = 0; i < segs.length; i++) {
    await supabase
      .from('transcript_segments')
      .update({ text_block_id: block.id, text_start: offsets[i][0], text_end: offsets[i][1] })
      .eq('id', segs[i].id)
  }
  return { block: block as Block, segment_ids: segs.map((s) => s.id), moved_blocks: moved as Block[] }
}

export async function refineSession(sessionId: string) {
  await sleep(450 + Math.random() * 400)
  return refineBatch(sessionId)
}

// ---------------------------------------------------------------- smart annotation close

async function reconcileAnnotationSegments(ann: Row, closedAt: string): Promise<Row[]> {
  const drawn = Date.parse(ann.drawn_at ?? closedAt)
  const closed = Date.parse(closedAt)
  const segs = rows('transcript_segments').filter((s) => s.session_id === ann.session_id)
  const link: string[] = []
  const unlink: string[] = []
  for (const s of segs) {
    const start = s.t_start ? Date.parse(s.t_start) : null
    const end = s.t_end ? Date.parse(s.t_end) : start
    const contained = start !== null && end !== null && drawn <= start && end <= closed
    if (s.annotation_id === ann.id && !contained) unlink.push(s.id)
    else if (!s.annotation_id && contained) link.push(s.id)
  }
  if (unlink.length) await supabase.from('transcript_segments').update({ annotation_id: null }).in('id', unlink)
  if (link.length) await supabase.from('transcript_segments').update({ annotation_id: ann.id }).in('id', link)
  return rows('transcript_segments')
    .filter((s) => s.annotation_id === ann.id && String(s.raw_text ?? '').trim())
    .sort((a, b) => segmentOrderKey(a).localeCompare(segmentOrderKey(b)))
}

export async function closeAnnotation(annotationId: string) {
  await sleep(700 + Math.random() * 500)
  const ann = byId('annotations', annotationId)
  if (!ann) throw new ApiError('annotation not found', 404, 'annotation not found')
  const closedAt = ann.closed_at ?? new Date().toISOString()
  if (ann.status !== 'confirmed' || !ann.closed_at)
    await supabase.from('annotations').update({ status: 'confirmed', closed_at: closedAt }).eq('id', annotationId)

  const segs = await reconcileAnnotationSegments(ann, closedAt)
  const block = byId('blocks', ann.block_id)
  const asset = byId('assets', block?.asset_id)
  const said = segs.map((s) => cleanSpeech(String(s.raw_text))).filter(Boolean).join(' ')
  const assetTerms: string[] = asset?.key_terms ?? []
  const spoken = findTerms(said)
  const term = spoken.find((t) => assetTerms.some((a) => a.toLowerCase() === t.toLowerCase())) ?? spoken[0]
  const label = term ? capitalize(term) : asset?.label ? `Part of the ${String(asset.label).toLowerCase()}` : 'Annotation'
  const bubble = said || null
  await supabase.from('annotations').update({ label, bubble_text: bubble }).eq('id', annotationId)
  return { label, bubble_text: bubble }
}

// ---------------------------------------------------------------- compile study notes

function pageHeading(page: Row) {
  const pdf = byId('assets', page.source_asset_id)
  return `${pdf?.label || pdf?.file_name || 'PDF'}, page ${page.page_number}`
}

export async function compileSession(sessionId: string): Promise<NotesContent> {
  await sleep(1800 + Math.random() * 800)
  const session = byId('sessions', sessionId)
  if (!session) throw new ApiError('session not found', 404, 'session not found')
  const lecture = byId('lectures', session.lecture_id)
  const title: string = session.title || lecture?.title || 'Lecture notes'

  while ((await refineBatch(sessionId)).block !== null) {
    /* drain speech that was never refined */
  }
  const blocks = rows('blocks')
    .filter((b) => b.session_id === sessionId)
    .sort((a, b) => a.position - b.position)
  const anns = rows('annotations').filter((a) => a.session_id === sessionId && a.status === 'confirmed')
  for (const a of anns) await reconcileAnnotationSegments(a, a.closed_at ?? new Date().toISOString())

  const sections: (NotesSection & { kind: 'page' | 'image' | 'text' })[] = []
  const pageSections = new Map<string, NotesSection>()
  const start = (kind: 'page' | 'image' | 'text', heading: string) => {
    const s = { kind, id: '', heading, paragraphs: [], paragraph_block_ids: [], key_terms: [], figures: [], annotation_ids: [] }
    sections.push(s)
    return s
  }
  let current: (typeof sections)[number] | null = null
  for (const b of blocks) {
    const asset = byId('assets', b.asset_id)
    if (b.kind === 'image') {
      if (asset?.kind === 'pdf_page') {
        current = start('page', pageHeading(asset))
        pageSections.set(b.id, current)
      } else {
        current = start('image', asset?.label || '')
      }
      current.figures.push({ image_block_id: b.id, caption: asset?.description ? firstSentence(asset.description) : '' })
      current.annotation_ids.push(...anns.filter((a) => a.block_id === b.id).map((a) => a.id))
    } else if (String(b.text ?? '').trim()) {
      const target = (b.page_block_id && pageSections.get(b.page_block_id)) || (current && current.kind !== 'page' ? current : (current = start('text', '')))
      target.paragraphs.push(String(b.text).trim())
      target.paragraph_block_ids!.push(b.id)
    }
  }

  const kept = sections.filter((s) => s.paragraphs.length || s.figures.length)
  const allText = kept.flatMap((s) => s.paragraphs).join(' ')
  const used = new Set<string>()
  kept.forEach((s, i) => {
    s.id = `s${i + 1}`
    const text = s.paragraphs.join(' ')
    s.key_terms = keyTerms(text, 6)
      .filter((k) => !used.has(k.term.toLowerCase()))
      .slice(0, 3)
    for (const k of s.key_terms) used.add(k.term.toLowerCase())
    if (!s.heading) {
      const [a, b] = findTerms(text)
      s.heading = a ? capitalize(b ? `${a} and ${b}` : a) : i === 0 ? 'Introduction' : `Part ${i + 1}`
    }
  })

  const top = findTerms(allText).slice(0, 4)
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
  const diagrams = kept.reduce((n, s) => n + s.figures.length, 0)
  const overview = allText
    ? [
        top.length ? `This session covered ${list(top.map((t) => `**${t}**`))}.` : 'Here is everything said in this session, cleaned up and organized.',
        diagrams ? `Each diagram sits next to what was said about it${anns.length ? ', and circled parts link to the exact words' : ''}.` : '',
        'Read the sections in order, then try the review questions.',
      ]
        .filter(Boolean)
        .join(' ')
    : ''
  const questions = top.length
    ? [
        `What is ${top[0]}, and why does it matter here?`,
        ...(top[1] ? [`How is ${top[0]} connected to ${top[1]}?`] : []),
        ...(top[2] ? [`Explain the role of ${top[2]} in your own words.`] : []),
        ...(anns.length ? ['Look at the circled parts of the diagrams: what was said about each one?'] : []),
      ]
    : []

  const notes: NotesContent = {
    title,
    overview,
    sections: kept.map(({ kind: _kind, ...s }) => s),
    review_questions: questions.slice(0, 5),
  }
  await supabase.from('lecture_notes').upsert({ session_id: sessionId, content: notes })
  return notes
}
