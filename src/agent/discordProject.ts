/**
 * Discord → Notion Project: everything between reading Discord and writing
 * into Notion.
 *
 *   read      discordProjectSource.js runs inside Discord and returns the real
 *             messages of one channel or Ghost Channel, with their ids.
 *   structure One call through the agent route sorts those messages into a
 *             project. The model sees them as m1…mN and must cite those labels;
 *             parseProject() then throws out anything that does not stand on a
 *             real message — an item with no source, an owner or due date the
 *             cited text does not contain, a link that was never posted.
 *   hand off  The checked project is kept in Modable before Notion is touched,
 *             so a Notion that cannot be reached loses nothing: asking again
 *             reuses it without re-reading the model.
 *
 * The payload in the middle (ProjectPayload) knows nothing about Notion's DOM
 * and little about Discord beyond its source references.
 */
import type { ChatMessage } from '../api'
import { api } from '../api'
import discordProjectSource from './layers/discordProjectSource.js?raw'
import { OPEN_TARGET } from './capabilities'

export type Ask = (messages: ChatMessage[]) => Promise<string>

/* ------------------------------------------------------------------ types */

export interface ExtractedMessage {
  id: string
  channelId: string
  channelName: string
  author: string
  bot: boolean
  timestamp: string
  text: string
  replyTo: { author: string; messageId?: string; text: string } | null
  links: { url: string; title: string }[]
}

export interface ExtractedSource {
  app: 'discord'
  kind: 'channel' | 'ghost'
  serverId: string
  serverName: string
  channelId: string
  channelName: string
  ghostLabel?: string
  topic?: string
}

export interface Extraction {
  ok: boolean
  reason?: string
  source?: ExtractedSource
  messages?: ExtractedMessage[]
}

/** Where an item came from — enough to open the original message again. */
export interface SourceRef {
  app: 'discord'
  serverId?: string
  channelId?: string
  channelName: string
  messageId?: string
  author: string
  timestamp: string
}

export interface ProjectTask { text: string; owner?: string; dueDate?: string; sources: SourceRef[] }
export interface ProjectItem { text: string; sources: SourceRef[] }
export interface ProjectResource { title: string; url?: string; sources: SourceRef[] }

export interface ProjectPayload {
  version: 1
  /** Stable per Discord source, so running the workflow again replaces the project. */
  id: string
  title: string
  overview: string
  tasks: ProjectTask[]
  decisions: ProjectItem[]
  blockers: ProjectItem[]
  questions: ProjectItem[]
  resources: ProjectResource[]
  origin: ExtractedSource & {
    messageCount: number
    firstAt: string
    lastAt: string
    lastMessageId: string
    extractedAt: string
  }
}

/* --------------------------------------------------------------- read */

/** The extraction script, aimed at what the request named (if anything). */
export function sourceScript(channel?: string): string {
  const want = JSON.stringify(channel ? { channel } : {})
  return `(${discordProjectSource.trim()})(${want}, ${OPEN_TARGET})`
}

/* ---------------------------------------------------------- structure */

export const STRUCTURE_SYSTEM = `You turn a real Discord conversation into a project brief for Notion. You only organise what the messages actually say.

Answer with JSON only, no prose, no code fence:
{"title": "...", "overview": "...",
 "tasks": [{"text": "...", "owner": "...", "due": "...", "sources": ["m3"]}],
 "decisions": [{"text": "...", "sources": ["m5"]}],
 "blockers": [{"text": "...", "sources": ["m8"]}],
 "questions": [{"text": "...", "sources": ["m2"]}],
 "resources": [{"title": "...", "url": "...", "sources": ["m7"]}]}

Rules:
- Every item lists in "sources" the message labels (m1, m2, …) it comes from. No message behind it, no item.
- Never invent tasks, owners, deadlines, decisions, blockers, questions or links. A list with nothing real in it stays empty — empty lists are correct and expected.
- tasks: concrete work someone asked for or committed to ("@Hamad can you fix auth tonight?" → task "Fix auth", owner "Hamad", due "tonight"; "I'll write the docs" → owner is that message's author). owner only when the message itself says who will do it, spelled as written. due only when the message itself states a time — copy those exact words. Otherwise leave owner and due out.
- tasks are work items, not requests for advice: "can someone help me choose between X and Y?" is a question, not a task.
- decisions: only what was actually settled, in so many words ("Let's ship Friday.", "We're going with Postgres."). Hedged or tentative ideas ("we should probably maybe launch Friday?") are NOT decisions; if they matter, they are questions. A bare acknowledgement ("ok", "sure", "thanks") is not a decision on its own — if it accepts a plan stated in another message, cite that message too.
- blockers: something stated as stopping progress ("We can't deploy because credentials are missing.").
- questions: unresolved questions that matter to the work. Skip greetings, small talk, and questions answered later in the conversation.
- resources: links, docs, repos and tools that were shared or pointed to. url only when it appears in a cited message.
- Keep the wording close to the original. When unsure, stay nearer the original words rather than adding certainty.
- title: a short name for what the conversation is working on (2 to 6 words). overview: 1 to 3 plain sentences saying what the conversation is about, using only what is said.
- Messages marked [bot] are automated; use them only when they report real project state.
- If the conversation holds no project work at all, return empty lists.
- At most 12 items per list.`

const minute = (iso: string) => {
  const d = new Date(iso)
  return isNaN(+d) ? '' : d.toISOString().slice(0, 16).replace('T', ' ')
}

/** The conversation as the model reads it: labelled, oldest first. */
export function conversationText(x: Extraction): string {
  const src = x.source!
  const where = src.kind === 'ghost'
    ? `Ghost Channel #${src.ghostLabel} (messages gathered from several channels about "${src.topic || src.ghostLabel}")`
    : `#${src.channelName}`
  const lines = [`Discord server: ${src.serverName || 'unknown'} · ${where} · ${x.messages!.length} messages`, '']
  x.messages!.forEach((m, i) => {
    const reply = m.replyTo && m.replyTo.author
      ? ` (replying to ${m.replyTo.author}${m.replyTo.text ? `: "${m.replyTo.text.slice(0, 80)}"` : ''})`
      : ''
    const from = src.kind === 'ghost' ? ` in #${m.channelName}` : ''
    lines.push(`[m${i + 1}] ${minute(m.timestamp)} · ${m.author}${m.bot ? ' [bot]' : ''}${from}${reply}: ${m.text.slice(0, 600)}`)
    const urls = m.links.map(l => l.url).filter(u => !m.text.includes(u))
    if (urls.length) lines.push(`      links: ${urls.slice(0, 4).join(' ')}`)
  })
  return lines.join('\n')
}

export function structureMessages(x: Extraction): ChatMessage[] {
  return [
    { role: 'system', content: STRUCTURE_SYSTEM },
    { role: 'user', content: conversationText(x) },
  ]
}

const LIMIT = 12
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const STOP = new Set((
  'the and for with that this from have has had was were are you your our their they them will would should could ' +
  'can about into what when where which who how why just like want need get got make made does did not but all any ' +
  'some more most very really also then than there here its out use using one able been being him her his she'
).split(' '))
/** Content words, crudely stemmed by their first five letters. */
const stems = (s: string) => fold(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.slice(0, 5))
const trimUrl = (u: string) => u.replace(/[.,;:!?)\]]+$/, '').replace(/\/$/, '')

export type ParseResult =
  | { ok: true; payload: ProjectPayload; dropped: number }
  | { ok: false; reason: 'malformed' | 'empty'; dropped: number }

/**
 * The model's project, checked against the messages it was given.
 *
 * Conservative by construction: an item survives only with at least one
 * source label that names a real message. An owner must be written in a cited
 * message (or be the author of one, for "I'll do it"), a due date must be
 * written in one, a URL must have been posted in one. A field that fails is
 * dropped; an item without a source is dropped whole.
 */
export function parseProject(text: string, x: Extraction, now = new Date()): ParseResult {
  const m = String(text || '').match(/\{[\s\S]*\}/)
  if (!m || !x.ok || !x.source || !x.messages?.length) return { ok: false, reason: 'malformed', dropped: 0 }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(m[0])
  } catch {
    return { ok: false, reason: 'malformed', dropped: 0 }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'malformed', dropped: 0 }

  const src = x.source
  const msgs = x.messages
  let dropped = 0

  const refOf = (msg: ExtractedMessage): SourceRef => ({
    app: 'discord',
    serverId: src.serverId || undefined,
    channelId: msg.channelId || undefined,
    channelName: msg.channelName || src.channelName,
    messageId: msg.id || undefined,
    author: msg.author,
    timestamp: msg.timestamp,
  })

  const cited = (v: unknown): ExtractedMessage[] => {
    const labels = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
    const out: ExtractedMessage[] = []
    for (const l of labels) {
      const n = Number(String(l).trim().replace(/^\[?m/i, '').replace(/\]$/, ''))
      const msg = Number.isInteger(n) && n >= 1 ? msgs[n - 1] : undefined
      if (msg && !out.includes(msg)) out.push(msg)
    }
    return out
  }

  // The item has to be about what its messages say: it must share at least
  // one content word with them. A paraphrase passes ("Fix auth" ← "can you fix
  // auth tonight?"); a conclusion drawn from a bare "Ok" does not.
  const supported = (text: string, from: ExtractedMessage[]) => {
    const theirs = new Set(from.flatMap(msg => stems(`${msg.text} ${msg.links.map(l => l.title).join(' ')}`)))
    return stems(text).some(w => theirs.has(w))
  }

  const said = (needle: string, from: ExtractedMessage[]) => {
    const n = fold(needle)
    return !!n && from.some(msg => ` ${fold(msg.text)} `.includes(` ${n} `))
  }

  function items<T>(key: string, build: (r: Record<string, unknown>, from: ExtractedMessage[]) => T | null): T[] {
    const list = Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []
    const out: T[] = []
    const seen = new Set<string>()
    for (const it of list) {
      if (out.length >= LIMIT) break
      const r = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
      const from = cited(r.sources ?? r.source)
      if (!from.length) { dropped++; continue }
      const built = build(r, from)
      if (!built) { dropped++; continue }
      const k = fold(JSON.stringify(built).slice(0, 200))
      if (seen.has(k)) continue
      seen.add(k)
      out.push(built)
    }
    return out
  }

  const plain = (r: Record<string, unknown>, from: ExtractedMessage[]): ProjectItem | null => {
    const t = str(r.text, 400)
    return t.length >= 3 && supported(t, from) ? { text: t, sources: from.map(refOf) } : null
  }

  const tasks = items<ProjectTask>('tasks', (r, from) => {
    const t = str(r.text, 400)
    if (t.length < 3 || !supported(t, from)) return null
    const task: ProjectTask = { text: t, sources: from.map(refOf) }
    const owner = str(r.owner, 60).replace(/^@/, '')
    if (owner) {
      const isAuthor = from.some(msg => fold(msg.author) === fold(owner))
      if (isAuthor || said(owner, from)) task.owner = owner
      else dropped++
    }
    const due = str(r.due ?? r.dueDate, 60)
    if (due) {
      if (said(due, from)) task.dueDate = due
      else dropped++
    }
    return task
  })

  const resources = items<ProjectResource>('resources', (r, from) => {
    const title = str(r.title ?? r.text, 160)
    const url = str(r.url, 600)
    const posted = from.flatMap(msg => [...msg.links.map(l => l.url), ...(msg.text.match(/https?:\/\/[^\s<>()"']+/g) || [])])
    const real = url && /^https?:\/\//i.test(url) && posted.some(p => trimUrl(p) === trimUrl(url)) ? url : ''
    if (url && !real) dropped++
    // A posted link stands on its own; a resource without one must be named
    // in the message it cites.
    if (!real && (title.length < 3 || !supported(title, from))) return null
    return { title: title || real, ...(real ? { url: real } : {}), sources: from.map(refOf) }
  })

  const decisions = items('decisions', plain)
  const blockers = items('blockers', plain)
  const questions = items('questions', plain)

  const total = tasks.length + decisions.length + blockers.length + questions.length + resources.length
  if (!total) return { ok: false, reason: 'empty', dropped }

  const name = src.kind === 'ghost' ? src.ghostLabel || src.channelName : src.channelName
  const last = msgs[msgs.length - 1]
  const payload: ProjectPayload = {
    version: 1,
    id: `dnp-${src.kind}-${src.kind === 'ghost' ? src.serverId + '-' + (src.ghostLabel || '') : src.channelId}`,
    title: str(raw.title, 80) || `#${name}`,
    overview: str(raw.overview, 600),
    tasks, decisions, blockers, questions, resources,
    origin: {
      ...src,
      messageCount: msgs.length,
      firstAt: msgs[0].timestamp,
      lastAt: last.timestamp,
      lastMessageId: last.id,
      extractedAt: now.toISOString(),
    },
  }
  return { ok: true, payload, dropped }
}

/* ------------------------------------------------------------ hand off */

const STORE = 'modable_discord_notion_project'
/** Bumped whenever structuring or checking changes, so an older project is
 *  never reused for a read it would now come out differently for. */
const SCHEMA = 'v2'

interface Stored {
  key: string
  payload: ProjectPayload
  status: 'structured' | 'handoff-failed'
}

/** What a run of the workflow would produce from this exact read. */
export function readKey(x: Extraction): string {
  const s = x.source!
  const msgs = x.messages!
  return [SCHEMA, s.kind, s.serverId, s.channelId || s.ghostLabel, msgs.length, msgs[msgs.length - 1]?.id].join(':')
}

function loadStored(): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null')
    return s && s.payload && s.key ? s : null
  } catch {
    return null
  }
}

function save(s: Stored) {
  try { localStorage.setItem(STORE, JSON.stringify(s)) } catch { /* the run still has it in memory */ }
}

export interface HandoffContext {
  /** The Discord window this run probed. */
  targetId?: string
  /** A channel the request named, without #. */
  channel?: string
  onStage?: (description: string) => void
}

export interface HandoffResult {
  /** Written into the Notion layer's config slot. */
  config: { payload: ProjectPayload; destination: { title: string } }
  /** The Notion window the layer must be injected into. */
  targetId: string
  description: string
}

export interface HandoffDeps {
  read: (targetId: string, code: string) => Promise<{ success: boolean; error?: string; result?: unknown }>
  notion: () => ReturnType<typeof api.handoffNotion>
}

const APP_WORDS = /^(?:discord|notion|server|project)$/i

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

export function summary(p: ProjectPayload): string {
  return [
    p.tasks.length && plural(p.tasks.length, 'task'),
    p.decisions.length && plural(p.decisions.length, 'decision'),
    p.blockers.length && plural(p.blockers.length, 'blocker'),
    p.questions.length && plural(p.questions.length, 'open question'),
    p.resources.length && plural(p.resources.length, 'resource'),
  ].filter(Boolean).join(', ')
}

/**
 * Read Discord, structure it, and find the Notion page — in that order, each
 * step only after the one before it succeeded. Throws with a sentence the
 * user can act on; nothing in Notion has been touched when it does.
 */
export async function prepareDiscordNotionProject(
  ask: Ask,
  ctx: HandoffContext,
  deps: HandoffDeps = { read: (t, c) => api.handoffRead(t, c), notion: () => api.handoffNotion() },
): Promise<HandoffResult> {
  const stage = ctx.onStage || (() => {})
  if (!ctx.targetId) throw new Error('Modable could not read Discord. Launch Discord from Modable, then ask again.')
  // "this Discord channel" names the app, not a channel.
  const channel = ctx.channel && !APP_WORDS.test(ctx.channel) ? ctx.channel : undefined

  stage(channel ? `reading #${channel}` : 'reading the discord conversation')
  const read = await deps.read(ctx.targetId, sourceScript(channel))
  if (!read.success) throw new Error(`Could not read Discord: ${read.error || 'no answer'}`)
  const x = (read.result || {}) as Extraction
  if (!x.ok || !x.source) throw new Error(x.reason || 'Could not read Discord.')
  const where = x.source.kind === 'ghost' ? `the Ghost Channel #${x.source.ghostLabel}` : `#${x.source.channelName}`
  if (!x.messages || x.messages.length < 2) {
    throw new Error(`${where} has ${x.messages?.length ? 'only one message' : 'no messages'} loaded — there is nothing to build a project from.`)
  }

  // The same read as last time reuses the project already checked, so a retry
  // after Notion failed — or a second run — never asks the model again.
  const key = readKey(x)
  const stored = loadStored()
  let payload: ProjectPayload
  if (stored && stored.key === key) {
    payload = stored.payload
  } else {
    stage(`structuring ${x.messages.length} messages from ${where}`)
    const reply = await ask(structureMessages(x))
    const parsed = parseProject(reply, x)
    if (!parsed.ok) {
      throw new Error(parsed.reason === 'empty'
        ? `${where} has ${x.messages.length} messages, but none of them describe project work — no tasks, decisions, blockers, questions or resources. Nothing was sent to Notion.`
        : 'The model did not return a usable project. Nothing was sent to Notion — run it again.')
    }
    payload = parsed.payload
    save({ key, payload, status: 'structured' })
  }

  stage('opening notion')
  const notion = await deps.notion()
  if (!notion.success || !notion.targetId) {
    save({ key, payload, status: 'handoff-failed' })
    throw new Error(
      `${notion.error || 'Notion could not be reached.'} The project from ${where} (${summary(payload)}) is saved in Modable — ` +
      'ask again and it goes straight to Notion without being re-read.',
    )
  }

  return {
    config: { payload, destination: { title: notion.title || 'this page' } },
    targetId: notion.targetId,
    description:
      `${payload.title}: ${summary(payload)} from ${plural(payload.origin.messageCount, 'message')} in ${where}, ` +
      `each linked to its Discord message. Shown over the Notion page "${notion.title || 'Untitled'}" — nothing is written to Notion, and Remove takes it away.`,
  }
}
