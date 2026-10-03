/**
 * Understanding a Ghost Channel request before the layer is injected.
 *
 * The Discord layer cannot reach the model — it runs inside Discord, and the
 * key never goes there. So the one thing the model is good for here happens
 * on Modable's side, once: it reads "make me a channel with everything about
 * AI agents and LLMs" and answers with a channel name and the concepts a
 * message on that topic would actually contain (MCP, tool use, Claude…). The
 * layer then matches those concepts against real messages. The model never
 * sees a Discord message and never writes one.
 *
 * Without a usable answer the request's own words stand in, and the config
 * says so (understoodBy: 'prompt'), so the channel can tell the user.
 */
import type { ChatMessage } from '../api'

export interface GhostConcept {
  term: string
  weight: number
}

export interface GhostConfig {
  prompt: string
  label: string
  topic: string
  concepts: GhostConcept[]
  understoodBy: 'model' | 'prompt'
}

export type Ask = (messages: ChatMessage[]) => Promise<string>

const SYSTEM = `You set up a local "ghost channel" in Discord: a feed of real messages, gathered from the user's server, about one topic.
Read the user's request and answer with JSON only, no prose, no code fence:
{"label": "...", "topic": "...", "concepts": [{"term": "...", "weight": 3}]}

label: the channel name, lowercase kebab-case, 2 to 24 characters, like a real Discord channel ("ai-agents", "interview-prep").
topic: the topic in a few plain words ("AI agents and LLMs").
concepts: 15 to 35 lowercase words or short phrases (1 to 3 words) that a Discord message about this topic would literally contain — the topic's own words, synonyms, abbreviations, product and library names, techniques. Prefer singular forms. weight 3 = unmistakably on topic, 2 = usually on topic, 1 = only supporting.
Avoid words that are common in unrelated conversations ("model" alone, "data", "code", "help").`

const STOP = new Set(
  ('a an the and or of to in on for with about everything all anything stuff things thing me my make create build give ' +
    'channel channels ghost please new some any related regarding that this those these from into just like want need ' +
    'is are be can could would should i we you it its').split(' '),
)

const kebab = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '')

/** "make me a channel with everything about AI agents and LLMs" → "AI agents and LLMs" */
export function topicOf(prompt: string): string {
  const t = prompt
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(
      /^(?:please\s+)?(?:can you\s+)?(?:make|create|build|give|set up|start)\s+(?:me\s+|us\s+)?(?:a\s+|an\s+)?(?:new\s+)?(?:ghost\s+)?channel\s*(?:with|for|about|on|of|that has|containing)?\s*/i,
      '',
    )
    .replace(/^(?:everything|all|anything|stuff|messages|posts)\s+(?:about|on|related to|regarding|around)\s+/i, '')
    .replace(/^(?:about|on|related to|regarding)\s+/i, '')
  return t || prompt.trim()
}

/** The request's own words, when the model could not be asked or answered badly. */
export function promptConfig(prompt: string): GhostConfig {
  const topic = topicOf(prompt)
  const words = (topic.toLowerCase().match(/[a-z0-9+#.]+/g) || []).filter(w => w.length > 1 && !STOP.has(w))
  const terms = new Set<string>()
  words.forEach(w => {
    terms.add(w)
    if (w.length > 3 && w.endsWith('s')) terms.add(w.slice(0, -1)) // llms → llm
  })
  const label = kebab(words.slice(0, 3).join(' ')) || 'generated'
  return {
    prompt,
    label,
    topic,
    concepts: [...terms].map(term => ({ term, weight: 2 })),
    understoodBy: 'prompt',
  }
}

/** The model's answer, checked and trimmed; null when it is not usable. */
export function parseGhostReply(text: string, prompt: string): GhostConfig | null {
  const m = String(text || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  let raw: { label?: unknown; topic?: unknown; concepts?: unknown }
  try {
    raw = JSON.parse(m[0])
  } catch {
    return null
  }
  const label = kebab(String(raw.label || ''))
  const topic = String(raw.topic || '').trim().slice(0, 60)
  if (!label || label.length < 2 || !topic || !Array.isArray(raw.concepts)) return null
  const seen = new Set<string>()
  const concepts: GhostConcept[] = []
  for (const c of raw.concepts as unknown[]) {
    const term = String(typeof c === 'string' ? c : (c as GhostConcept)?.term ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
    if (!term || term.length > 32 || term.split(' ').length > 3 || seen.has(term)) continue
    const w = Math.round(Number(typeof c === 'string' ? 2 : (c as GhostConcept)?.weight ?? 2))
    seen.add(term)
    concepts.push({ term, weight: w >= 1 && w <= 3 ? w : 2 })
    if (concepts.length >= 40) break
  }
  if (concepts.length < 3) return null
  return { prompt, label, topic, concepts, understoodBy: 'model' }
}

export async function configureGhostChannel(prompt: string, ask: Ask): Promise<GhostConfig> {
  try {
    const reply = await ask([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt },
    ])
    return parseGhostReply(reply, prompt) ?? promptConfig(prompt)
  } catch {
    return promptConfig(prompt)
  }
}
