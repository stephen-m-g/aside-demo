// Demo build only: an in-browser stand-in for the Supabase client.
//
// It implements just the slice of supabase-js the app uses (query builder with filters, ordering, nested selects
// over foreign keys, insert/update/upsert/delete with cascades, realtime postgres_changes, and the storage
// bucket), so every page runs unchanged with no server, no network and no keys. Data lives in this browser:
// IndexedDB keeps it across reloads, and a BroadcastChannel mirrors changes into other tabs (so the student
// view at /join works in a second tab).

type Row = Record<string, unknown>
type EventType = 'INSERT' | 'UPDATE' | 'DELETE'
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null }

// ---------------------------------------------------------------- schema

const now = () => new Date().toISOString()

interface TableDef {
  pk: string[]
  defaults: () => Row
}

const TABLES: Record<string, TableDef> = {
  lectures: { pk: ['id'], defaults: () => ({ title: 'Untitled lecture', archived_at: null, created_at: now() }) },
  assets: {
    pk: ['id'],
    defaults: () => ({
      lecture_id: null, kind: null, storage_path: null, text_content: null, file_name: null, label: null,
      description: null, key_terms: null, source_asset_id: null, page_number: null, page_count: null, aspect: null,
      created_at: now(),
    }),
  },
  sessions: {
    pk: ['id'],
    defaults: () => ({ lecture_id: null, title: null, status: 'live', started_at: now(), ended_at: null, join_code: null }),
  },
  blocks: {
    pk: ['id'],
    defaults: () => ({ session_id: null, kind: null, position: 0, text: null, asset_id: null, aspect: null, page_block_id: null, created_at: now() }),
  },
  strokes: { pk: ['id'], defaults: () => ({ session_id: null, block_id: null, points: [], color: '#111111', width: 0.006, created_at: now() }) },
  annotations: {
    pk: ['id'],
    defaults: () => ({
      session_id: null, block_id: null, path: null, bbox: null, status: 'pending', drawn_at: now(), closed_at: null,
      label: null, bubble_text: null,
    }),
  },
  transcript_segments: {
    pk: ['id'],
    defaults: () => ({
      session_id: null, t_start: null, t_end: null, raw_text: '', confidence: null, annotation_id: null,
      text_block_id: null, page_block_id: null, text_start: null, text_end: null, created_at: now(),
    }),
  },
  lecture_notes: { pk: ['session_id'], defaults: () => ({ content: null, created_at: now() }) },
  classes: { pk: ['id'], defaults: () => ({ created_at: now() }) },
  lecture_classes: { pk: ['lecture_id', 'class_id'], defaults: () => ({}) },
  session_classes: { pk: ['session_id', 'class_id'], defaults: () => ({}) },
}

/** Unique columns besides the primary key. */
const UNIQUE: Record<string, string[]> = { sessions: ['join_code'] }

interface ForeignKey {
  table: string
  col: string
  ref: string
  onDelete: 'cascade' | 'set null'
}

const FKS: ForeignKey[] = [
  { table: 'assets', col: 'lecture_id', ref: 'lectures', onDelete: 'cascade' },
  { table: 'assets', col: 'source_asset_id', ref: 'assets', onDelete: 'cascade' },
  { table: 'sessions', col: 'lecture_id', ref: 'lectures', onDelete: 'cascade' },
  { table: 'blocks', col: 'session_id', ref: 'sessions', onDelete: 'cascade' },
  { table: 'blocks', col: 'asset_id', ref: 'assets', onDelete: 'set null' },
  { table: 'blocks', col: 'page_block_id', ref: 'blocks', onDelete: 'set null' },
  { table: 'strokes', col: 'session_id', ref: 'sessions', onDelete: 'cascade' },
  { table: 'strokes', col: 'block_id', ref: 'blocks', onDelete: 'cascade' },
  { table: 'annotations', col: 'session_id', ref: 'sessions', onDelete: 'cascade' },
  { table: 'annotations', col: 'block_id', ref: 'blocks', onDelete: 'cascade' },
  { table: 'transcript_segments', col: 'session_id', ref: 'sessions', onDelete: 'cascade' },
  { table: 'transcript_segments', col: 'annotation_id', ref: 'annotations', onDelete: 'set null' },
  { table: 'transcript_segments', col: 'text_block_id', ref: 'blocks', onDelete: 'set null' },
  { table: 'transcript_segments', col: 'page_block_id', ref: 'blocks', onDelete: 'set null' },
  { table: 'lecture_notes', col: 'session_id', ref: 'sessions', onDelete: 'cascade' },
  { table: 'lecture_classes', col: 'lecture_id', ref: 'lectures', onDelete: 'cascade' },
  { table: 'lecture_classes', col: 'class_id', ref: 'classes', onDelete: 'cascade' },
  { table: 'session_classes', col: 'session_id', ref: 'sessions', onDelete: 'cascade' },
  { table: 'session_classes', col: 'class_id', ref: 'classes', onDelete: 'cascade' },
]

// ---------------------------------------------------------------- state

export type DemoData = Record<string, Row[]>

let data: DemoData = emptyData()

export function emptyData(): DemoData {
  return Object.fromEntries(Object.keys(TABLES).map((t) => [t, []]))
}

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))
const keyOf = (table: string, row: Row) => TABLES[table].pk.map((c) => String(row[c])).join('|')

/** Replace everything (seeding, loading from storage, reset). */
export function setData(next: DemoData) {
  data = { ...emptyData(), ...next }
}

export function getData(): DemoData {
  return data
}

// ---------------------------------------------------------------- persistence + cross-tab sync

const DB_NAME = 'aside-demo'
const STORE = 'kv'

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function kvDelete(key: string): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function kvClear(): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

let saveTimer: number | undefined
let savesSuspended = false

/** Stop writing to IndexedDB (reset is wiping it). */
export function suspendSaves() {
  savesSuspended = true
  window.clearTimeout(saveTimer)
}

function scheduleSave() {
  if (savesSuspended) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    kvSet('db', data).catch((e) => console.warn('[demo] save failed', e))
  }, 250)
}

type SyncMessage =
  | { kind: 'change'; table: string; eventType: EventType; new: Row | null; old: Row | null }
  | { kind: 'file'; path: string; removed?: boolean }
  | { kind: 'reset' }

const bus: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('aside-demo') : null

bus?.addEventListener('message', (e: MessageEvent<SyncMessage>) => {
  const msg = e.data
  if (msg.kind === 'reset') {
    suspendSaves()
    // Let the tab that reset reseed first, then pick up its data.
    window.setTimeout(() => window.location.reload(), 600)
  } else if (msg.kind === 'file') {
    if (msg.removed) dropFileUrl(msg.path)
    else void loadFileUrl(msg.path)
  } else {
    const rows = data[msg.table]
    if (!rows) return
    if (msg.eventType === 'DELETE' && msg.old) {
      const k = keyOf(msg.table, msg.old)
      data[msg.table] = rows.filter((r) => keyOf(msg.table, r) !== k)
    } else if (msg.new) {
      const k = keyOf(msg.table, msg.new)
      const i = rows.findIndex((r) => keyOf(msg.table, r) === k)
      if (i >= 0) rows[i] = msg.new
      else rows.push(msg.new)
    }
    deliver(msg.table, msg.eventType, msg.new, msg.old)
  }
})

export function broadcastReset() {
  bus?.postMessage({ kind: 'reset' } satisfies SyncMessage)
}

// ---------------------------------------------------------------- realtime

interface Handler {
  event: '*' | EventType
  table: string
  filter: { col: string; value: string } | null
  cb: (payload: unknown) => void
}

class DemoChannel {
  handlers: Handler[] = []
  constructor(readonly name: string) {}
  on(_type: string, opts: { event: '*' | EventType; table: string; filter?: string }, cb: (payload: unknown) => void) {
    const m = opts.filter?.match(/^([a-z_]+)=eq\.(.*)$/)
    this.handlers.push({ event: opts.event, table: opts.table, filter: m ? { col: m[1], value: m[2] } : null, cb })
    return this
  }
  subscribe(cb?: (status: string) => void) {
    channels.add(this)
    cb?.('SUBSCRIBED')
    return this
  }
  unsubscribe() {
    channels.delete(this)
    return Promise.resolve('ok')
  }
}

const channels = new Set<DemoChannel>()

function deliver(table: string, eventType: EventType, newRow: Row | null, oldRow: Row | null) {
  const payload = { schema: 'public', table, eventType, new: newRow ?? {}, old: oldRow ?? {}, commit_timestamp: now() }
  const subject = eventType === 'DELETE' ? oldRow : newRow
  for (const ch of channels) {
    for (const h of ch.handlers) {
      if (h.table !== table || (h.event !== '*' && h.event !== eventType)) continue
      if (h.filter && String(subject?.[h.filter.col]) !== h.filter.value) continue
      // Async like the network, and never inside the caller's React render.
      setTimeout(() => {
        if (channels.has(ch)) h.cb(clone(payload))
      }, 0)
    }
  }
}

function changed(table: string, eventType: EventType, newRow: Row | null, oldRow: Row | null) {
  scheduleSave()
  bus?.postMessage({ kind: 'change', table, eventType, new: newRow, old: oldRow } satisfies SyncMessage)
  deliver(table, eventType, clone(newRow), clone(oldRow))
}

// ---------------------------------------------------------------- nested selects

interface SelectNode {
  cols: string[] // '*' or column names
  embeds: { name: string; node: SelectNode | 'count' }[]
}

function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function parseSelect(s: string): SelectNode {
  const node: SelectNode = { cols: [], embeds: [] }
  for (const part of splitTop(s || '*')) {
    const m = part.match(/^([a-z_]+)\s*\((.*)\)$/s)
    if (m) node.embeds.push({ name: m[1], node: m[2].trim() === 'count' ? 'count' : parseSelect(m[2]) })
    else node.cols.push(part)
  }
  if (node.cols.length === 0 && node.embeds.length === 0) node.cols.push('*')
  return node
}

/** How `child` hangs off `parent`: an array of children, one child (one-to-one), or the parent's referenced row. */
function relation(parent: string, child: string) {
  const down = FKS.find((fk) => fk.table === child && fk.ref === parent && fk.table !== fk.ref)
  if (down) {
    const oneToOne = TABLES[child].pk.length === 1 && TABLES[child].pk[0] === down.col
    return { kind: oneToOne ? ('one' as const) : ('many' as const), col: down.col }
  }
  const up = FKS.find((fk) => fk.table === parent && fk.ref === child)
  if (up) return { kind: 'up' as const, col: up.col }
  return null
}

function project(table: string, row: Row, node: SelectNode): Row {
  const out: Row = {}
  for (const c of node.cols) {
    if (c === '*') Object.assign(out, clone(row))
    else out[c] = clone(row[c])
  }
  for (const { name, node: sub } of node.embeds) {
    const rel = relation(table, name)
    if (!rel) continue
    const pkVal = row[TABLES[table].pk[0]]
    if (rel.kind === 'up') {
      const target = data[name].find((r) => r[TABLES[name].pk[0]] === row[rel.col])
      out[name] = target && sub !== 'count' ? project(name, target, sub) : null
    } else {
      const kids = data[name].filter((r) => r[rel.col] === pkVal)
      if (sub === 'count') out[name] = [{ count: kids.length }]
      else if (rel.kind === 'one') out[name] = kids[0] ? project(name, kids[0], sub) : null
      else out[name] = kids.map((k) => project(name, k, sub))
    }
  }
  return out
}

// ---------------------------------------------------------------- query builder

type Filter = (r: Row) => boolean

const cmp = (a: unknown, b: unknown) => {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  return (a as number | string) < (b as number | string) ? -1 : 1
}

class DemoQuery implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private filters: Filter[] = []
  private orders: { col: string; asc: boolean }[] = []
  private max: number | null = null
  private offset = 0
  private one: 'single' | 'maybe' | null = null
  private cols = '*'
  private returning: string | null = null
  private countMode = false
  private head = false
  private payload: Row | Row[] | null = null

  constructor(private table: string) {}

  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') {
      this.cols = cols
      this.countMode = !!opts?.count
      this.head = !!opts?.head
    } else this.returning = cols
    return this
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert'
    this.payload = rows
    return this
  }
  upsert(rows: Row | Row[]) {
    this.op = 'upsert'
    this.payload = rows
    return this
  }
  update(patch: Row) {
    this.op = 'update'
    this.payload = patch
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v)
    return this
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v)
    return this
  }
  gt(col: string, v: unknown) {
    this.filters.push((r) => cmp(r[col], v) > 0)
    return this
  }
  gte(col: string, v: unknown) {
    this.filters.push((r) => cmp(r[col], v) >= 0)
    return this
  }
  lt(col: string, v: unknown) {
    this.filters.push((r) => cmp(r[col], v) < 0)
    return this
  }
  lte(col: string, v: unknown) {
    this.filters.push((r) => cmp(r[col], v) <= 0)
    return this
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]))
    return this
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === v))
    return this
  }
  not(col: string, op: string, v: unknown) {
    if (op === 'is' && v === null) this.filters.push((r) => r[col] !== null && r[col] !== undefined)
    else if (op === 'eq') this.filters.push((r) => r[col] !== v)
    return this
  }
  match(obj: Row) {
    for (const [k, v] of Object.entries(obj)) this.eq(k, v)
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false })
    return this
  }
  limit(n: number) {
    this.max = n
    return this
  }
  range(from: number, to: number) {
    this.offset = from
    this.max = to - from + 1
    return this
  }
  single() {
    this.one = 'single'
    return this
  }
  maybeSingle() {
    this.one = 'maybe'
    return this
  }
  throwOnError() {
    return this
  }

  then<A = Result, B = never>(onOk?: ((v: Result) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => this.run())
      .then(onOk, onErr)
  }

  private matching(): Row[] {
    return data[this.table].filter((r) => this.filters.every((f) => f(r)))
  }

  private shape(table: string, rows: Row[], cols: string): Result {
    const node = parseSelect(cols)
    let out = rows.map((r) => project(table, r, node))
    if (this.one) {
      if (out.length > 1 && this.one === 'single') return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
      if (out.length === 0) {
        return this.one === 'single'
          ? { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
          : { data: null, error: null }
      }
      return { data: out[0], error: null }
    }
    return { data: out, error: null }
  }

  private run(): Result {
    const def = TABLES[this.table]
    if (!def) return { data: null, error: { message: `relation "${this.table}" does not exist`, code: '42P01' } }

    if (this.op === 'select') {
      let rows = this.matching()
      for (const o of [...this.orders].reverse()) rows = [...rows].sort((a, b) => cmp(a[o.col], b[o.col]) * (o.asc ? 1 : -1))
      const count = rows.length
      if (this.offset || this.max !== null) rows = rows.slice(this.offset, this.max === null ? undefined : this.offset + this.max)
      if (this.head) return { data: null, error: null, count: this.countMode ? count : null }
      return { ...this.shape(this.table, rows, this.cols), count: this.countMode ? count : null }
    }

    if (this.op === 'insert' || this.op === 'upsert') {
      const input = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      const written: Row[] = []
      for (const raw of input) {
        const row: Row = { ...def.defaults(), ...clone(raw) }
        if (def.pk.length === 1 && def.pk[0] === 'id' && !row.id) row.id = crypto.randomUUID()
        const k = keyOf(this.table, row)
        const i = data[this.table].findIndex((r) => keyOf(this.table, r) === k)
        if (i >= 0 && this.op === 'insert')
          return { data: null, error: { message: `duplicate key value violates unique constraint "${this.table}_pkey"`, code: '23505' } }
        const clash = this.uniqueClash(row, i >= 0 ? data[this.table][i] : null)
        if (clash) return clash
        if (i >= 0) {
          const old = data[this.table][i]
          const next = { ...old, ...clone(raw) }
          data[this.table][i] = next
          changed(this.table, 'UPDATE', next, old)
          written.push(next)
        } else {
          data[this.table].push(row)
          changed(this.table, 'INSERT', row, null)
          written.push(row)
        }
      }
      return this.returning === null ? { data: null, error: null } : this.shape(this.table, written, this.returning)
    }

    if (this.op === 'update') {
      const patch = clone(this.payload as Row)
      const targets = this.matching()
      for (const old of targets) {
        const clash = this.uniqueClash({ ...old, ...patch }, old)
        if (clash) return clash
      }
      const written: Row[] = []
      for (const old of targets) {
        const i = data[this.table].indexOf(old)
        const next = { ...old, ...patch }
        data[this.table][i] = next
        changed(this.table, 'UPDATE', next, old)
        written.push(next)
      }
      return this.returning === null ? { data: null, error: null } : this.shape(this.table, written, this.returning)
    }

    // delete
    const targets = this.matching()
    for (const row of targets) removeRow(this.table, row)
    return this.returning === null ? { data: null, error: null } : this.shape(this.table, targets, this.returning)
  }

  private uniqueClash(row: Row, self: Row | null): Result | null {
    for (const col of UNIQUE[this.table] ?? []) {
      if (row[col] === null || row[col] === undefined) continue
      if (data[this.table].some((r) => r !== self && r[col] === row[col]))
        return { data: null, error: { message: `duplicate key value violates unique constraint "${this.table}_${col}_key"`, code: '23505' } }
    }
    return null
  }
}

/** Delete a row and apply ON DELETE rules to everything that points at it. */
function removeRow(table: string, row: Row) {
  if (!data[table].includes(row)) return
  data[table] = data[table].filter((r) => r !== row)
  changed(table, 'DELETE', null, row)
  const pkCol = TABLES[table].pk[0]
  for (const fk of FKS.filter((f) => f.ref === table)) {
    for (const child of data[fk.table].filter((r) => r[fk.col] === row[pkCol])) {
      if (fk.onDelete === 'cascade') removeRow(fk.table, child)
      else {
        const i = data[fk.table].indexOf(child)
        const next = { ...child, [fk.col]: null }
        data[fk.table][i] = next
        changed(fk.table, 'UPDATE', next, child)
      }
    }
  }
}

// ---------------------------------------------------------------- storage ("assets" bucket)

/** Object URLs for files uploaded in this demo, by storage path. Seeded files are static under /demo/. */
const fileUrls = new Map<string, string>()

async function loadFileUrl(path: string) {
  const blob = await kvGet<Blob>(`file:${path}`)
  if (blob) fileUrls.set(path, URL.createObjectURL(blob))
}

function dropFileUrl(path: string) {
  const url = fileUrls.get(path)
  if (url) URL.revokeObjectURL(url)
  fileUrls.delete(path)
}

/** Load every stored upload before the app renders, so getPublicUrl can stay synchronous. */
export async function loadFiles(paths: string[]) {
  await Promise.all(paths.map((p) => loadFileUrl(p).catch(() => undefined)))
}

export async function putFile(path: string, file: Blob) {
  await kvSet(`file:${path}`, file)
  dropFileUrl(path)
  fileUrls.set(path, URL.createObjectURL(file))
  bus?.postMessage({ kind: 'file', path } satisfies SyncMessage)
}

export function fileBlobUrl(path: string): string | undefined {
  return fileUrls.get(path)
}

export function publicUrl(path: string): string {
  if (path.startsWith('demo/')) return `/${path}`
  return fileUrls.get(path) ?? ''
}

const storage = {
  from: (_bucket: string) => ({
    upload: async (path: string, file: Blob) => {
      try {
        await putFile(path, file)
        return { data: { path }, error: null }
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : 'Upload failed' } }
      }
    },
    remove: async (paths: string[]) => {
      for (const p of paths) {
        dropFileUrl(p)
        await kvDelete(`file:${p}`).catch(() => undefined)
        bus?.postMessage({ kind: 'file', path: p, removed: true } satisfies SyncMessage)
      }
      return { data: paths.map((name) => ({ name })), error: null }
    },
    getPublicUrl: (path: string) => ({ data: { publicUrl: publicUrl(path) } }),
  }),
}

// ---------------------------------------------------------------- client

export const demoClient = {
  from: (table: string) => new DemoQuery(table),
  channel: (name: string) => new DemoChannel(name),
  removeChannel: (ch: DemoChannel) => ch.unsubscribe(),
  storage,
}
