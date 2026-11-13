// Demo build only: what a visitor finds on first load. Three prepared lectures (plus one archived), and two
// recorded sessions with a board, ink, a smart annotation, the raw transcript and compiled study notes, so the
// notes and transcript screens have real content before anyone teaches. Times are relative to the visit.
import type { DemoData } from './db'
import { emptyData } from './db'
import { cleanSpeech } from './language'

/** Bump when the seed changes: visitors with an older copy get the new one on their next load. */
export const SEED_VERSION = 4

type Row = Record<string, unknown>
const id = () => crypto.randomUUID()

const DAY = 86_400_000
const MIN = 60_000

/** Board coordinates are normalized; a loose closed loop of [x, y, pressure] points around (cx, cy). */
function loop(cx: number, cy: number, rx: number, ry: number, n = 28, jitter = 0.08, closeGap = 0.04): [number, number, number][] {
  const pts: [number, number, number][] = []
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI - closeGap * 2 * Math.PI) * (i / n)
    const wob = 1 + jitter * Math.sin(i * 1.7) * 0.5
    pts.push([+(cx + rx * wob * Math.cos(a)).toFixed(4), +(cy + ry * wob * Math.sin(a)).toFixed(4), 0.5])
  }
  return pts
}

function bboxOf(points: [number, number, number][]) {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

interface Spoken {
  raw: string
  /** Index into the session's annotations (the speech was captured while that lasso was open). */
  ann?: number
}

interface BoardItem {
  text?: Spoken[]
  image?: string // asset key
}

/**
 * Builds a recorded session: blocks in board order, transcript segments with exact offsets into the cleaned
 * paragraph they became, and timestamps spaced like real speech.
 */
function recordSession(opts: {
  lectureId: string
  title: string
  startedAt: number
  assets: Record<string, Row>
  board: BoardItem[]
  annotations: { image: string; cx: number; cy: number; rx: number; ry: number; label: string }[]
  strokes: { image: string; points: [number, number, number][]; color: string }[]
}) {
  const sessionId = id()
  const blocks: Row[] = []
  const segments: Row[] = []
  const imageBlockByKey: Record<string, string> = {}
  let clock = opts.startedAt + 2 * MIN
  const iso = (ms: number) => new Date(ms).toISOString()

  const anns = opts.annotations.map((a) => ({ ...a, id: id(), start: 0, end: 0, said: [] as string[] }))

  opts.board.forEach((item, i) => {
    const position = i + 1
    if (item.image) {
      const asset = opts.assets[item.image]
      const blockId = id()
      imageBlockByKey[item.image] = blockId
      blocks.push({
        id: blockId, session_id: sessionId, kind: 'image', position, text: null, asset_id: asset.id,
        aspect: asset.aspect, page_block_id: null, created_at: iso(clock),
      })
      clock += 30_000
      return
    }
    const blockId = id()
    let text = ''
    for (const s of item.text ?? []) {
      const clean = cleanSpeech(s.raw)
      const words = s.raw.split(/\s+/).length
      const tStart = clock
      const tEnd = clock + words * 380
      clock = tEnd + 2_500
      let start: number | null = null
      let end: number | null = null
      if (clean) {
        if (text) text += ' '
        start = text.length
        text += clean
        end = text.length
      }
      const ann = s.ann !== undefined ? anns[s.ann] : null
      if (ann) {
        if (!ann.start) ann.start = tStart - 4_000
        ann.end = tEnd + 3_000
        ann.said.push(clean)
      }
      segments.push({
        id: id(), session_id: sessionId, t_start: iso(tStart), t_end: iso(tEnd), raw_text: s.raw, confidence: null,
        annotation_id: ann ? ann.id : null, text_block_id: blockId, page_block_id: null, text_start: start,
        text_end: end, created_at: iso(tEnd + 400),
      })
    }
    blocks.push({
      id: blockId, session_id: sessionId, kind: 'text', position, text, asset_id: null, aspect: null,
      page_block_id: null, created_at: iso(clock),
    })
  })

  const annotations = anns.map((a) => {
    const path = loop(a.cx, a.cy, a.rx, a.ry, 30, 0.1, 0)
    return {
      id: a.id, session_id: sessionId, block_id: imageBlockByKey[a.image], path, bbox: bboxOf(path),
      status: 'confirmed', drawn_at: iso(a.start), closed_at: iso(a.end), label: a.label, bubble_text: a.said.join(' '),
    }
  })

  const strokes = opts.strokes.map((s, i) => ({
    id: id(), session_id: sessionId, block_id: imageBlockByKey[s.image], points: s.points, color: s.color,
    width: 0.006, created_at: iso(opts.startedAt + (20 + i) * MIN),
  }))

  const session = {
    id: sessionId, lecture_id: opts.lectureId, title: opts.title, status: 'ended', started_at: iso(opts.startedAt),
    ended_at: iso(clock + MIN), join_code: null,
  }
  return { session, blocks, segments, annotations, strokes, imageBlockByKey }
}

export function buildSeed(): DemoData {
  const data = emptyData()
  const now = Date.now()
  const at = (msAgo: number) => new Date(now - msAgo).toISOString()

  // ------------------------------------------------------------ classes
  const bio = { id: id(), name: 'Bio 102', color: '#2563eb', created_at: at(30 * DAY) }
  const ap = { id: id(), name: 'AP Biology', color: '#7c3aed', created_at: at(30 * DAY) }
  const p4 = { id: id(), name: 'Period 4', color: '#d97706', created_at: at(29 * DAY) }
  data.classes.push(bio, ap, p4)

  // ------------------------------------------------------------ lectures + materials
  const lecture = (title: string, daysAgo: number, archived = false) => ({
    id: id(), title, archived_at: archived ? at((daysAgo - 2) * DAY) : null, created_at: at(daysAgo * DAY),
  })
  const resp = lecture('Cellular respiration', 9)
  const photo = lecture('Photosynthesis', 12)
  const genetics = lecture('Mendelian genetics', 3)
  const review = lecture('Cell structure review', 40, true)
  data.lectures.push(resp, photo, genetics, review)
  data.lecture_classes.push(
    { lecture_id: resp.id, class_id: bio.id },
    { lecture_id: resp.id, class_id: ap.id },
    { lecture_id: photo.id, class_id: bio.id },
    { lecture_id: photo.id, class_id: p4.id },
    { lecture_id: genetics.id, class_id: ap.id },
    { lecture_id: review.id, class_id: bio.id },
  )

  const asset = (lectureId: string, daysAgo: number, row: Row): Row => {
    const full = {
      id: id(), lecture_id: lectureId, kind: 'image', storage_path: null, text_content: null, file_name: null,
      label: null, description: null, key_terms: null, source_asset_id: null, page_number: null, page_count: null,
      aspect: null, created_at: at(daysAgo * DAY), ...row,
    }
    data.assets.push(full)
    return full
  }

  const r = {
    cell: asset(resp.id, 9, {
      storage_path: 'demo/cell.svg', file_name: 'animal-cell.png', aspect: 1.5, label: 'Animal cell',
      description: 'A labeled animal cell showing the nucleus, rough ER, Golgi apparatus, mitochondria and ribosomes.',
      key_terms: ['nucleus', 'mitochondria', 'ribosomes', 'Golgi apparatus', 'cell membrane'],
    }),
    mito: asset(resp.id, 9, {
      storage_path: 'demo/mitochondrion.svg', file_name: 'mitochondrion.png', aspect: 1200 / 760, label: 'Mitochondrion cross-section',
      description: 'Cross-section of a mitochondrion: outer and inner membranes, cristae, matrix, ATP synthase.',
      key_terms: ['cristae', 'matrix', 'inner membrane', 'ATP synthase'],
    }),
    flow: asset(resp.id, 9, {
      storage_path: 'demo/respiration.svg', file_name: 'respiration-overview.png', aspect: 1.5, label: 'Cellular respiration overview',
      description: 'Flowchart from glucose through glycolysis, the Krebs cycle and the electron transport chain, with ATP totals.',
      key_terms: ['glycolysis', 'Krebs cycle', 'electron transport chain', 'ATP', 'pyruvate'],
    }),
  }
  const worksheet = asset(resp.id, 8, {
    kind: 'pdf', storage_path: 'demo/worksheet.pdf', file_name: 'respiration-worksheet.pdf', page_count: 2,
    label: 'Cellular respiration worksheet', description: 'Two-page worksheet: the equation, the three stages, and labeling a mitochondrion.',
    key_terms: ['glycolysis', 'cristae', 'ATP'],
  })
  for (const n of [1, 2]) {
    asset(resp.id, 8, {
      kind: 'pdf_page', storage_path: `demo/worksheet-p${n}.svg`, file_name: `respiration-worksheet.pdf, page ${n}`,
      source_asset_id: worksheet.id, page_number: n, aspect: 850 / 1100,
    })
  }
  asset(resp.id, 8, {
    kind: 'text', label: 'Lesson plan',
    text_content:
      'Plan for today\n- Where respiration happens: the cell and its mitochondria\n- Inside the mitochondrion: membranes, cristae, matrix\n- Glycolysis → Krebs cycle → electron transport chain, and the ATP from each\n- Homework: worksheet page 1',
    description: 'Outline of the lesson: where respiration happens, the mitochondrion, the three stages, homework.',
    key_terms: ['mitochondria', 'cristae', 'glycolysis', 'Krebs cycle'],
  })

  const chloro = asset(photo.id, 12, {
    storage_path: 'demo/chloroplast.svg', file_name: 'chloroplast.png', aspect: 1200 / 760, label: 'Chloroplast',
    description: 'A chloroplast with stacked thylakoids (grana) in the stroma, with sunlight coming in.',
    key_terms: ['chloroplast', 'thylakoid', 'granum', 'stroma'],
  })
  asset(photo.id, 12, {
    kind: 'text', label: 'Photosynthesis equation',
    text_content: '6 CO₂ + 6 H₂O + light → C₆H₁₂O₆ + 6 O₂\nLight reactions in the thylakoids, Calvin cycle in the stroma.',
    description: 'The overall equation, and where the light reactions and the Calvin cycle happen.',
    key_terms: ['photosynthesis', 'thylakoid', 'Calvin cycle'],
  })
  asset(genetics.id, 3, {
    storage_path: 'demo/punnett.svg', file_name: 'punnett-square.png', aspect: 1.25, label: 'Punnett square: Bb × Bb',
    description: 'A Punnett square crossing two heterozygous parents, giving a 3:1 ratio.',
    key_terms: ['Punnett square', 'heterozygous', 'dominant', 'recessive'],
  })
  asset(review.id, 40, {
    storage_path: 'demo/cell.svg', file_name: 'animal-cell.png', aspect: 1.5, label: 'Animal cell',
    description: 'A labeled animal cell.', key_terms: ['nucleus', 'mitochondria'],
  })

  // ------------------------------------------------------------ recorded session 1: cellular respiration
  const s1 = recordSession({
    lectureId: resp.id,
    title: 'Cellular respiration (Period 2)',
    startedAt: now - 2 * DAY - 3 * 60 * MIN,
    assets: r,
    board: [
      {
        text: [
          { raw: 'okay so um today we pick up where we left off with the cell' },
          { raw: 'every cell in your body needs energy and the the currency it spends is a tee pee' },
          { raw: 'the process that makes it is called cellular respiration' },
        ],
      },
      { image: 'cell' },
      {
        text: [
          { raw: 'so here is an animal cell uh you can see the nucleus the rough ER and these little bean shaped things' },
          { raw: 'those are the mitochondria and that is where most of the action happens today' },
        ],
      },
      { image: 'mito' },
      {
        text: [
          { raw: 'let us zoom in on one mitochondrion it has two membranes an outer one and a folded inner one' },
          { raw: 'see all these folds um these are the cristae', ann: 0 },
          { raw: 'they pack way more membrane into the same space and more membrane means more room to make a tee pee', ann: 0 },
          { raw: 'the fluid in the middle is called the matrix and that is where the crebs cycle happens' },
        ],
      },
      { image: 'flow' },
      {
        text: [
          { raw: 'so here is the whole path glucose gets split in glycolysis out in the cytoplasm and that only gives us two ATP' },
          { raw: 'the pyruvate moves into the mitochondrion goes through the Krebs cycle and then the electron transport chain' },
          { raw: 'and that last step is the big one uh it makes about thirty two ATP and it needs oxygen which is why we breathe' },
          { raw: 'for tomorrow finish page one of the worksheet' },
        ],
      },
    ],
    annotations: [{ image: 'mito', cx: 0.617, cy: 0.42, rx: 0.06, ry: 0.15, label: 'Cristae' }],
    strokes: [{ image: 'flow', points: loop(0.771, 0.781, 0.07, 0.055, 30, 0.12, -0.03), color: '#dc2626' }],
  })
  const b1 = s1.blocks
  const textIds = b1.filter((b) => b.kind === 'text').map((b) => b.id as string)
  const textOf = (bid: string) => b1.find((b) => b.id === bid)!.text as string
  data.sessions.push(s1.session)
  data.blocks.push(...s1.blocks)
  data.transcript_segments.push(...s1.segments)
  data.annotations.push(...s1.annotations)
  data.strokes.push(...s1.strokes)
  data.session_classes.push({ session_id: s1.session.id, class_id: bio.id }, { session_id: s1.session.id, class_id: ap.id })
  data.lecture_notes.push({
    session_id: s1.session.id,
    created_at: s1.session.ended_at,
    content: {
      title: 'Cellular respiration (Period 2)',
      overview:
        'Cells spend energy as **ATP**, and **cellular respiration** is how they make it from glucose. Glycolysis splits glucose in the cytoplasm for a small payoff; the Krebs cycle and the electron transport chain inside the mitochondrion make most of the ATP, and that last step needs oxygen.',
      sections: [
        {
          id: 's1', heading: 'Energy and the cell',
          paragraphs: [textOf(textIds[0]), textOf(textIds[1])], paragraph_block_ids: [textIds[0], textIds[1]],
          key_terms: [
            { term: 'ATP', definition: 'Adenosine triphosphate, the molecule cells use to carry and spend energy.' },
            { term: 'Cellular respiration', definition: 'How cells release the energy stored in glucose as ATP, using oxygen and giving off carbon dioxide and water.' },
            { term: 'Mitochondria', definition: 'Organelles that carry out most of cellular respiration and make most of the cell’s ATP.' },
          ],
          figures: [{ image_block_id: s1.imageBlockByKey.cell, caption: 'An animal cell. The bean-shaped organelles are mitochondria.' }],
          annotation_ids: [],
        },
        {
          id: 's2', heading: 'Inside the mitochondrion',
          paragraphs: [textOf(textIds[2])], paragraph_block_ids: [textIds[2]],
          key_terms: [
            { term: 'Cristae', definition: 'The folds of the inner mitochondrial membrane; they add surface area for making ATP.' },
            { term: 'Matrix', definition: 'The fluid inside the inner mitochondrial membrane, where the Krebs cycle happens.' },
          ],
          figures: [{ image_block_id: s1.imageBlockByKey.mito, caption: 'Cross-section of a mitochondrion. The circled folds are the cristae.' }],
          annotation_ids: s1.annotations.map((a) => a.id),
        },
        {
          id: 's3', heading: 'From glucose to ATP',
          paragraphs: [textOf(textIds[3])], paragraph_block_ids: [textIds[3]],
          key_terms: [
            { term: 'Glycolysis', definition: 'The first stage of respiration, in the cytoplasm: glucose is split into two pyruvate, making 2 ATP.' },
            { term: 'Electron transport chain', definition: 'Proteins in the inner mitochondrial membrane that pass electrons along and pump hydrogen ions, powering most ATP production.' },
          ],
          figures: [{ image_block_id: s1.imageBlockByKey.flow, caption: 'The three stages of cellular respiration and the ATP each one makes.' }],
          annotation_ids: [],
        },
      ],
      review_questions: [
        'Why does every cell in your body need ATP?',
        'How do the cristae help the mitochondrion make more ATP?',
        'Where does glycolysis happen, and how much ATP does it make?',
        'Which stage makes the most ATP, and why does it need oxygen?',
      ],
    },
  })

  // ------------------------------------------------------------ recorded session 2: photosynthesis
  const s2 = recordSession({
    lectureId: photo.id,
    title: 'Photosynthesis (Period 4)',
    startedAt: now - 5 * DAY - 5 * 60 * MIN,
    assets: { chloro },
    board: [
      {
        text: [
          { raw: 'alright today is photosynthesis which is um basically respiration running backwards' },
          { raw: 'plants take carbon dioxide and water and use light energy to build glucose and they give off oxygen' },
        ],
      },
      { image: 'chloro' },
      {
        text: [
          { raw: 'it all happens in the chloroplast these green stacks are the thylakoids and a stack is called a granum' },
          { raw: 'the light reactions happen in the thylakoids and the Calvin cycle builds the sugar out in the stroma' },
        ],
      },
    ],
    annotations: [],
    strokes: [],
  })
  const t2 = s2.blocks.filter((b) => b.kind === 'text').map((b) => b.id as string)
  const text2 = (bid: string) => s2.blocks.find((b) => b.id === bid)!.text as string
  data.sessions.push(s2.session)
  data.blocks.push(...s2.blocks)
  data.transcript_segments.push(...s2.segments)
  data.session_classes.push({ session_id: s2.session.id, class_id: bio.id }, { session_id: s2.session.id, class_id: p4.id })
  data.lecture_notes.push({
    session_id: s2.session.id,
    created_at: s2.session.ended_at,
    content: {
      title: 'Photosynthesis (Period 4)',
      overview:
        '**Photosynthesis** is how plants turn light energy into sugar. It takes in carbon dioxide and water and gives off oxygen, in the chloroplast: light reactions in the thylakoids, the Calvin cycle in the stroma.',
      sections: [
        {
          id: 's1', heading: 'Respiration in reverse',
          paragraphs: [text2(t2[0])], paragraph_block_ids: [t2[0]],
          key_terms: [{ term: 'Photosynthesis', definition: 'How plants use light energy to make glucose from carbon dioxide and water, releasing oxygen.' }],
          figures: [], annotation_ids: [],
        },
        {
          id: 's2', heading: 'Inside the chloroplast',
          paragraphs: [text2(t2[1])], paragraph_block_ids: [t2[1]],
          key_terms: [
            { term: 'Thylakoid', definition: 'Flattened sacs in the chloroplast where the light reactions happen.' },
            { term: 'Stroma', definition: 'The fluid in the chloroplast where the Calvin cycle builds sugar.' },
          ],
          figures: [{ image_block_id: s2.imageBlockByKey.chloro, caption: 'A chloroplast: stacks of thylakoids (grana) in the stroma.' }],
          annotation_ids: [],
        },
      ],
      review_questions: [
        'Why is photosynthesis described as respiration running backwards?',
        'Where in the chloroplast do the light reactions happen? The Calvin cycle?',
      ],
    },
  })

  return data
}
