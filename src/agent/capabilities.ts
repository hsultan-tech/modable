/**
 * Which hand-built layer, if any, a request is asking for.
 *
 * Flagship layers used to be reached by one regex each, which made them
 * phrase-locked: "untangle this channel" opened the Conversation Map, "map the
 * conversations in here" went to the model and came back as something else.
 * A capability is the thing being asked for, independent of how it was said.
 *
 * Routing is two passes. A local reading scores the request against each
 * capability's cues — cheap, deterministic, and enough on its own when the
 * request is unmistakable. Anything it is not sure of goes to the model, which
 * reads the registry's descriptions and examples and answers with an id, a
 * confidence and parameters. Below the threshold, or with no capability for the
 * app at all, the request goes to generic generation exactly as before.
 *
 * The registry knows nothing about any one workspace. A target is whatever the
 * request names ("#career-advice", "the Roadmap page") or, when it names
 * nothing, whatever is on screen — which is what every flagship layer already
 * reads.
 */
import type { ChatMessage } from '../api'
import { topicOf } from './ghostChannels'

export type CapabilityId =
  | 'crossapp.discord-to-notion-project'
  | 'discord.conversation-map'
  | 'discord.ghost-channel'
  | 'slack.command-center'
  | 'notion.spatial-mode'

/** What a capability operates on when the request does not say. */
export type TargetKind = 'channel' | 'page' | 'none'

export interface CapabilityParams {
  /** A channel the request names, without the #. Absent = the visible channel. */
  channel?: string
  /** A page the request names. Absent = the visible page. */
  page?: string
  /** What a generated channel collects. */
  topic?: string
  /** Channels a generated channel should read from, when the request lists them. */
  sourceChannels?: string[]
}

export interface Capability {
  id: CapabilityId
  /** Lowercase application name, as in the app list. */
  app: string
  /** One line the model reads to decide. */
  description: string
  /** Phrasings that mean this capability. The model sees them as examples. */
  examples: string[]
  /** Which parameters this capability reads. Everything else is dropped. */
  params: (keyof CapabilityParams)[]
  /** What an absent target defaults to: the surface on screen. */
  target: TargetKind
  /** The flagship layer that carries it out, by name (src/agent/flagship.ts). */
  layer: string
  /** Weighted cues for the local pass. A cue's weight is how much it alone
   *  says about this capability; matched weights are summed and capped at 1. */
  cues: [RegExp, number][]
}

export const CAPABILITIES: Capability[] = [
  // Ahead of the other Discord capabilities on purpose: "turn this Ghost
  // Channel into a project" scores 1 here and 1 for Ghost Channels (it names
  // one), and a tie goes to whichever is listed first. Every cue below needs
  // "project" or "Notion", so nothing that never mentions either can land here.
  {
    id: 'crossapp.discord-to-notion-project',
    app: 'discord',
    description:
      'Turn the messages of one Discord channel or Ghost Channel into a structured project (overview, tasks, ' +
      'decisions, blockers, open questions, resources) shown in Notion, each item linked back to its Discord message.',
    examples: [
      'turn this into a Notion project',
      'make a Notion project from this Discord channel',
      'make a project from this channel',
      'turn this Ghost Channel into a project',
      'send this discussion to Notion',
      'make #project-showcase into a Notion project',
    ],
    params: ['channel'],
    target: 'channel',
    layer: 'Discord → Notion Project',
    cues: [
      [/\bnotion\b/i, 0.7],
      [/\b(?:turn|make|convert|transform|change)\b[^.?!]{0,50}\b(?:into|to|as)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:notion\s+)?project\b/i, 1],
      [/\b(?:make|create|build|start|spin up|set up)\b[^.?!]{0,12}\b(?:a\s+|an\s+)?(?:new\s+)?(?:notion\s+)?project\b[^.?!]{0,30}\b(?:from|out of|of|for|based on)\b/i, 1],
      [/\b(?:send|export|move|push|copy|put|bring|save)\b[^.?!]{0,50}\b(?:to|into|in|over to)\s+notion\b/i, 1],
      [/\bproject\s+(?:plan|workspace|brief|tracker|page)\b/i, 0.6],
    ],
  },
  {
    id: 'discord.conversation-map',
    app: 'discord',
    description:
      'Lay out the messages of one Discord text channel as separate conversation threads on a pannable map.',
    examples: [
      'untangle this channel',
      'create a conversation map',
      'map the conversations in here',
      'show me the discussions happening in this channel',
      'make a conversation map for #general',
    ],
    params: ['channel'],
    target: 'channel',
    layer: 'Discord Conversation Map',
    cues: [
      [/\buntangle\b/i, 1],
      [/\bconversation(?:al)?\s+map\b/i, 1],
      [/\bmap\b[^.?!]{0,30}\b(?:conversations?|discussions?|threads?|chat)\b/i, 0.9],
      [/\b(?:conversations?|discussions?|threads?)\b[^.?!]{0,40}\b(?:happening|going on|in (?:here|this channel|#))/i, 0.85],
      [/\b(?:separate|split|group)\b[^.?!]{0,30}\b(?:conversations?|discussions?|threads?)\b/i, 0.8],
      [/\b(?:conversations?|discussions?)\b/i, 0.35],
    ],
  },
  {
    id: 'discord.ghost-channel',
    app: 'discord',
    description:
      'Create a local, generated Discord channel that gathers real messages about one topic from the server\'s channels.',
    examples: [
      'make me a channel about AI agents',
      'create a generated channel for interview prep',
      'collect everything about LLMs into one channel',
      'make a ghost channel with everything about rust',
    ],
    params: ['topic', 'sourceChannels'],
    target: 'none',
    layer: 'Discord Ghost Channels',
    cues: [
      [/\bghost\s+channels?\b/i, 1],
      [/\bgenerated\s+channels?\b/i, 1],
      [/\b(?:make|create|build|give|set up|start)\b[^.?!]{0,20}\b(?:a|an|new)\b[^.?!]{0,12}\bchannel\b\s*(?:with|about|for|on|of|that)\b/i, 0.9],
      [/\b(?:collect|gather|pull|put|bring)\b[^.?!]{0,50}\b(?:into|in)\s+(?:one|a|a single|its own)\s+(?:new\s+)?channel\b/i, 0.9],
      [/\b(?:everything|all (?:the )?messages?)\b[^.?!]{0,30}\b(?:about|on|related to)\b/i, 0.4],
    ],
  },
  {
    id: 'slack.command-center',
    app: 'slack',
    description:
      'Sort the messages of one Slack channel into decisions, action items, blockers and open questions.',
    examples: [
      'turn this channel into a command center',
      'organize this channel into decisions and action items',
      'make #general operational',
      'show blockers, decisions and tasks from this channel',
    ],
    params: ['channel'],
    target: 'channel',
    layer: 'Slack Command Center',
    cues: [
      [/\bcommand\s+cent(?:er|re)\b/i, 1],
      [/\boperational\b/i, 0.85],
      [/\b(?:decisions?|action items?|blockers?|open questions?)\b/i, 0.35],
      // Naming two of the groups at once is asking for the sort itself.
      [/\b(?:decisions?|action items?|blockers?|tasks?|open questions?)\b[^.?!]{0,40}\b(?:decisions?|action items?|blockers?|tasks?|open questions?)\b/i, 0.6],
      [/\b(?:organi[sz]e|sort|triage|break down)\b[^.?!]{0,30}\b(?:channel|messages?|here)\b/i, 0.4],
      [/\btasks?\b[^.?!]{0,30}\b(?:from|in)\s+(?:this|the|#)/i, 0.3],
    ],
  },
  {
    id: 'notion.spatial-mode',
    app: 'notion',
    description:
      'Turn one Notion page into a pannable, zoomable canvas of draggable section cards, reversibly.',
    examples: [
      'turn this page into a spatial canvas',
      'make this page spatial',
      'give me a canvas view',
      'turn this document into draggable cards',
    ],
    params: ['page'],
    target: 'page',
    layer: 'Notion Spatial Mode',
    cues: [
      [/\bspatial\b/i, 1],
      [/\bcanvas\b/i, 0.9],
      [/\bdraggable\b[^.?!]{0,20}\b(?:cards?|blocks?|sections?)\b/i, 0.9],
      [/\b(?:whiteboard|infinite board|board view)\b/i, 0.7],
    ],
  },
]

/** At or above this, a capability runs instead of generic generation. */
export const ROUTE_THRESHOLD = 0.6
/** At or above this, the local pass decides without asking the model. */
const SURE = 0.85

export interface CapabilityMatch {
  capabilityId: CapabilityId
  confidence: number
  parameters: CapabilityParams
  /** Which pass decided — for the log and the tests, never for behaviour. */
  via: 'local' | 'model'
}

export function capabilitiesFor(appName: string | undefined | null): Capability[] {
  const app = String(appName || '').trim().toLowerCase()
  return CAPABILITIES.filter(c => c.app === app)
}

export function capabilityById(id: string | undefined | null): Capability | undefined {
  return CAPABILITIES.find(c => c.id === id)
}

// ── parameters ──────────────────────────────────────────────────────────────

const HASH = /(?:^|[\s(,])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu

/** "#career-advice" anywhere in the request, in order. */
function hashChannels(text: string): string[] {
  return [...text.matchAll(HASH)].map(m => m[1].toLowerCase())
}

/** Words that sit before "channel" without naming one: "this channel", "a new channel". */
const NOT_A_NAME =
  /^(?:this|that|the|a|an|one|new|my|our|same|current|whole|entire|single|own|generated|ghost|text|voice)$/

/** "the launch channel", "channel called launch" — a named channel without a #. */
function wordChannel(text: string): string | undefined {
  const m =
    text.match(/\bchannel\s+(?:called|named)\s+["“']?([\p{L}\p{N}][\p{L}\p{N}_-]+)/iu) ||
    text.match(/\b([\p{L}\p{N}][\p{L}\p{N}_-]+)\s+channel\b/iu)
  const name = m?.[1]?.toLowerCase()
  return name && !NOT_A_NAME.test(name) ? name : undefined
}

/** A page named in quotes, or "the Roadmap page" / "page called Roadmap". */
function namedPage(text: string): string | undefined {
  const quoted = text.match(/["“]([^"”]{2,80})["”]/)
  if (quoted) return quoted[1].trim()
  const m =
    text.match(/\bpage\s+(?:called|named|titled)\s+(.{2,80}?)(?:\s+(?:into|as|to)\b|[.?!]|$)/i) ||
    text.match(/\bthe\s+([A-Z][\w' -]{1,60}?)\s+(?:page|doc|document)\b/)
  return m?.[1]?.trim()
}

/** What the request itself says about a capability's inputs. */
export function extractParams(cap: Capability, prompt: string): CapabilityParams {
  const text = String(prompt || '')
  const out: CapabilityParams = {}
  if (cap.params.includes('channel')) {
    const channel = hashChannels(text)[0] || wordChannel(text)
    if (channel) out.channel = channel
  }
  if (cap.params.includes('page')) {
    const page = namedPage(text)
    if (page) out.page = page
  }
  if (cap.params.includes('topic')) {
    const topic = topicOf(text.replace(/\s*\bfrom\s+#.*$/i, ''))
    if (topic) out.topic = topic
  }
  if (cap.params.includes('sourceChannels')) {
    const from = text.match(/\bfrom\s+(#.*)$/i)
    const sources = from ? hashChannels(' ' + from[1]) : []
    if (sources.length) out.sourceChannels = sources
  }
  return out
}

/** Keep only what the capability reads, in the shape it reads it. */
function cleanParams(cap: Capability, raw: unknown): CapabilityParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim().replace(/^#/, '') : ''
    return s && !/^(?:current|this|visible|none|null)$/i.test(s) ? s : undefined
  }
  const out: CapabilityParams = {}
  const channel = str(r.channel)
  if (cap.params.includes('channel') && channel) out.channel = channel.toLowerCase()
  const page = str(r.page)
  if (cap.params.includes('page') && page) out.page = page
  const topic = str(r.topic)
  if (cap.params.includes('topic') && topic) out.topic = topic
  if (cap.params.includes('sourceChannels') && Array.isArray(r.sourceChannels)) {
    const s = r.sourceChannels.map(str).filter((x): x is string => !!x)
    if (s.length) out.sourceChannels = s.map(x => x.toLowerCase())
  }
  return out
}

// ── local pass ──────────────────────────────────────────────────────────────

function score(cap: Capability, text: string): number {
  let s = 0
  for (const [re, w] of cap.cues) if (re.test(text)) s += w
  return Math.min(1, s)
}

/** The best-scoring capability for this app, whatever its score. */
export function localMatch(
  appName: string | undefined | null,
  prompt: string | undefined | null,
): CapabilityMatch | null {
  const text = String(prompt || '')
  let best: { cap: Capability; s: number } | null = null
  for (const cap of capabilitiesFor(appName)) {
    const s = score(cap, text)
    if (s > 0 && (!best || s > best.s)) best = { cap, s }
  }
  if (!best) return null
  return {
    capabilityId: best.cap.id,
    confidence: best.s,
    parameters: extractParams(best.cap, text),
    via: 'local',
  }
}

/** The synchronous route: the local pass alone, held to the threshold. */
export function matchCapability(
  appName: string | undefined | null,
  prompt: string | undefined | null,
): CapabilityMatch | null {
  const m = localMatch(appName, prompt)
  return m && m.confidence >= ROUTE_THRESHOLD ? m : null
}

// ── model pass ──────────────────────────────────────────────────────────────

export type Ask = (messages: ChatMessage[]) => Promise<string>

export function classifierPrompt(caps: Capability[]): string {
  const list = caps
    .map(c =>
      `- id: ${c.id}\n  does: ${c.description}\n  parameters: ${c.params.join(', ')}\n` +
      `  asked as: ${c.examples.map(e => JSON.stringify(e)).join(', ')}`,
    )
    .join('\n')
  return `You route requests in Modable, an app that modifies desktop applications.
Decide whether the user's request asks for one of these existing capabilities, however it is worded:
${list}

Answer with JSON only, no prose, no code fence:
{"capabilityId": "<id or none>", "confidence": 0.0, "parameters": {}}

confidence: 0 to 1, how sure you are the request means that capability and not some other modification.
A request for anything else (a theme, a button, a counter, hiding something) is "none".
parameters, only those the request states:
  channel: a channel the request names, without # (omit for "this channel" or when none is named)
  page: a page or document the request names (omit for "this page")
  topic: what a generated channel should collect
  sourceChannels: channels a generated channel should read from, without #`
}

/** The model's answer, checked against the registry; null when unusable. */
export function parseClassification(
  text: string,
  appName: string | undefined | null,
): CapabilityMatch | { capabilityId: null; confidence: number } | null {
  const m = String(text || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  let raw: { capabilityId?: unknown; confidence?: unknown; parameters?: unknown }
  try {
    raw = JSON.parse(m[0])
  } catch {
    return null
  }
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0))
  const cap = capabilitiesFor(appName).find(c => c.id === raw.capabilityId)
  if (!cap) return { capabilityId: null, confidence }
  return { capabilityId: cap.id, confidence, parameters: cleanParams(cap, raw.parameters), via: 'model' }
}

/**
 * The full route. Null means generic generation.
 *
 * The model is only asked when the app has capabilities and the local pass is
 * not already sure. If it cannot be asked, or answers with something unusable,
 * the local reading stands — held to the same threshold.
 */
export async function routeCapability(
  appName: string | undefined | null,
  prompt: string | undefined | null,
  ask?: Ask,
): Promise<CapabilityMatch | null> {
  const caps = capabilitiesFor(appName)
  if (!caps.length) return null
  const text = String(prompt || '')
  const local = localMatch(appName, text)
  if (local && local.confidence >= SURE) return local
  const fallback = local && local.confidence >= ROUTE_THRESHOLD ? local : null
  if (!ask) return fallback

  let answer: ReturnType<typeof parseClassification> = null
  try {
    answer = parseClassification(
      await ask([
        { role: 'system', content: classifierPrompt(caps) },
        { role: 'user', content: text },
      ]),
      appName,
    )
  } catch {
    return fallback
  }
  if (!answer) return fallback
  if (!answer.capabilityId || answer.confidence < ROUTE_THRESHOLD) return null

  const cap = capabilityById(answer.capabilityId)!
  // A target the request spells out (#name) beats the model's reading of it.
  return { ...answer, parameters: { ...answer.parameters, ...extractParams(cap, text) } }
}

// ── target resolution ───────────────────────────────────────────────────────

/** The named target a match carries, or null for "whatever is on screen". */
export function namedTarget(
  match: Pick<CapabilityMatch, 'capabilityId' | 'parameters'>,
): { kind: 'channel' | 'page'; name: string } | null {
  const cap = capabilityById(match.capabilityId)
  if (!cap || cap.target === 'none') return null
  const name = cap.target === 'channel' ? match.parameters.channel : match.parameters.page
  return name ? { kind: cap.target, name } : null
}

const LAYER_OPEN = '\n/*MODABLE_LAYER*/\n'
const LAYER_CLOSE = '\n/*/MODABLE_LAYER*/\n'

/*
 * Runs in the application: open a named channel or page through its own
 * sidebar. Every flagship reads the surface on screen, so putting the right
 * surface on screen is the whole of target resolution — the layers never learn
 * a name. It clicks the sidebar entry whose text is the name and waits for the
 * window title to show it. Not found, or not opened in time, it rejects, and the
 * layer never runs against the wrong surface.
 *
 * Kept as source text rather than a function so no build step can rewrite it.
 */
export const OPEN_TARGET = `function (want) {
  function norm(s) {
    return String(s || '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9\\u00c0-\\uffff]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function has(hay, needle) { return ('-' + hay + '-').indexOf('-' + needle + '-') !== -1; }
  var name = norm(want.name);
  function showing() { return has(norm(document.title), name); }
  if (showing()) return Promise.resolve();
  var sel = {
    discord: 'a[data-list-item-id^="channels___"], nav a[href*="/channels/"]',
    slack: '[data-qa^="channel_sidebar_name_"], .p-channel_sidebar__channel, [role="treeitem"]',
    notion: '.notion-sidebar a[href], .notion-sidebar [role="treeitem"], .notion-sidebar [role="button"]'
  };
  var els = [].slice.call(document.querySelectorAll(sel[want.app] || 'nav a, [role="treeitem"]'));
  function label(el) {
    return norm((el.getAttribute('aria-label') || '').replace(/\\(.*?\\)/g, '').replace(/^unread,?\\s*/i, ''));
  }
  var hit = els.filter(function (el) { return norm(el.textContent) === name; })[0] ||
    els.filter(function (el) { return label(el) === name; })[0] ||
    els.filter(function (el) { return has(norm(el.textContent), name); })[0];
  var shown = (want.kind === 'channel' ? '#' : '') + want.name;
  if (!hit) return Promise.reject(new Error('Modable could not find ' + shown + ' in the sidebar. Open it, then ask again.'));
  (hit.closest('a, button, [role="treeitem"], [role="button"]') || hit).click();
  return new Promise(function (resolve, reject) {
    var t0 = Date.now();
    (function wait() {
      /* A short settle after the title changes, so the messages have rendered. */
      if (showing()) return void setTimeout(resolve, 700);
      if (Date.now() - t0 > 7000) return reject(new Error('Modable opened ' + shown + ' but it did not finish loading.'));
      setTimeout(wait, 150);
    })();
  });
}`

/** Layer code that first opens the named target. The layer is embedded verbatim. */
export function withTarget(code: string, app: string, target: { kind: string; name: string }): string {
  const want = JSON.stringify({ kind: target.kind, name: target.name, app: app.toLowerCase() })
    .replace(/[<`]/g, ch => (ch === '<' ? '\\u003c' : '\\u0060'))
  return (
    `(function(){return (${OPEN_TARGET})(${want}).then(function(){` +
    LAYER_OPEN + code + LAYER_CLOSE +
    `});})();`
  )
}

/** The layer inside withTarget's wrapper, or the code itself when unwrapped. */
export function unwrapTarget(code: string): string {
  const a = code.indexOf(LAYER_OPEN)
  const b = code.lastIndexOf(LAYER_CLOSE)
  return a !== -1 && b > a ? code.slice(a + LAYER_OPEN.length, b) : code
}
