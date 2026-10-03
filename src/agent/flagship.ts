/**
 * Hand-built layers for requests Modable knows how to answer outright.
 *
 * A flagship layer takes the place of the model's reply and nothing else: the
 * application is still probed first, and the layer still goes through inject,
 * verify and revert exactly like a generated one. It exists because some mods
 * are too large and too carefully tuned to a live DOM to regenerate per run.
 */
import notionSpatial from './layers/notionSpatial.js?raw'
import slackCommandCenter from './layers/slackCommandCenter.js?raw'
import discordConversationMap from './layers/discordConversationMap.js?raw'
import discordGhostChannels from './layers/discordGhostChannels.js?raw'
import notionDiscordProject from './layers/notionDiscordProject.js?raw'
import { configureGhostChannel, type Ask } from './ghostChannels'
import { prepareDiscordNotionProject, type HandoffContext, type HandoffResult } from './discordProject'
import {
  matchCapability, namedTarget, withTarget, unwrapTarget,
  type CapabilityId, type CapabilityMatch,
} from './capabilities'

interface Flagship {
  app: string
  /** The capability this layer carries out. Which requests mean it is decided
   *  in capabilities.ts, never here. */
  capability: CapabilityId
  name: string
  description: string
  code: string
  /** A flagship that needs to know what was asked for. Its code ends in
   *  CONFIG_SLOT, which prepare() fills with this function's answer. Only
   *  Ghost Channels has one; every other flagship is injected as written. */
  configure?: (prompt: string, ask: Ask) => Promise<unknown>
  /** A cross-app flagship: it reads the app the request was made in and
   *  writes into another one. Its code is the destination's layer, with a
   *  CONFIG_SLOT like a configurable flagship, and it is never aimed at a
   *  named target — a named channel is where it reads from, not where it
   *  writes. handoff() returns the config and the destination window. */
  handoff?: (ask: Ask, ctx: HandoffContext) => Promise<HandoffResult>
}

// Where a configurable layer receives its settings: its last line is
// `})(` + CONFIG_SLOT + `);`, and prepare() writes the config in place of it.
const CONFIG_SLOT = '/*MODABLE_CONFIG*/null'

const FLAGSHIPS: Flagship[] = [
  {
    app: 'notion',
    capability: 'notion.spatial-mode',
    name: 'Notion Spatial Mode',
    description:
      'Adds a Spatial control beside Share. It turns the current page into a canvas of draggable ' +
      'section cards with pan, zoom, fit and connections, and Exit Spatial puts the page back untouched.',
    code: notionSpatial,
  },
  {
    app: 'slack',
    capability: 'slack.command-center',
    name: 'Slack Command Center',
    description:
      'Adds a Command Center control to the channel header. It sorts the messages Slack has loaded ' +
      'in the current channel into decisions, action items, blockers and open questions by phrase ' +
      'rules, each linked back to its message, and Back to Messages returns the channel untouched.',
    code: slackCommandCenter,
  },
  {
    app: 'discord',
    capability: 'discord.conversation-map',
    name: 'Discord Conversation Map',
    description:
      'Adds a Conversation Map control to the channel header. It lays the messages Discord has loaded ' +
      'in the current channel out as separate conversations, joined by their real replies and split by ' +
      'silences and changes of vocabulary, with pan, zoom and fit; each message jumps back to itself, ' +
      'and Back to Chat returns the channel untouched.',
    code: discordConversationMap,
  },
  {
    app: 'discord',
    capability: 'discord.ghost-channel',
    name: 'Discord Ghost Channels',
    description:
      'Adds a GENERATED section to the channel list with a local channel for the topic you asked about. ' +
      'Opening it reads the server\'s matching channels through Discord\'s own navigation and shows the real ' +
      'messages on that topic, each with its source channel and a link to the original. Nothing is posted ' +
      'or changed on the server; Remove takes the channel away.',
    code: discordGhostChannels,
    configure: configureGhostChannel,
  },
  {
    app: 'discord',
    capability: 'crossapp.discord-to-notion-project',
    name: 'Discord → Notion Project',
    description:
      'Reads the Discord channel or Ghost Channel on screen and lays its real messages out in Notion as a ' +
      'project — overview, tasks, decisions, blockers, open questions and resources — each linked back to ' +
      'the Discord message it came from. Nothing is written to Notion or Discord; Remove takes it away.',
    code: notionDiscordProject,
    handoff: (ask, ctx) => prepareDiscordNotionProject(ask, ctx),
  },
]

function replyFor(f: Flagship, code: string) {
  return `NAME: ${f.name}\nDESCRIPTION: ${f.description}\n\`\`\`javascript\n${code}\n\`\`\``
}

/** Does this code come from a configurable flagship, whatever it was configured with? */
function fillsSlot(f: Flagship, code: string): boolean {
  const parts = f.code.trim().split(CONFIG_SLOT)
  return parts.length === 2 && code.length > parts[0].length + parts[1].length &&
    code.startsWith(parts[0]) && code.endsWith(parts[1])
}

/**
 * Is this layer one of the hand-built ones?
 *
 * A flagship that fails to verify must not be handed to the model to "repair":
 * the rewrite request no longer names the flagship, so the model writes some
 * other layer under a new name — which is how Command Center came back as
 * "Slack Dark Mode Toggle". Failing honestly is the correct outcome.
 */
export function isFlagshipCode(code: string | undefined | null): boolean {
  // A flagship sent to a named channel or page is still that flagship.
  const c = unwrapTarget(String(code || '').trim()).trim()
  return !!c && FLAGSHIPS.some(f => f.code.trim() === c || ((!!f.configure || !!f.handoff) && fillsSlot(f, c)))
}

/** The reply a flagship stands in for, in the form parseMod reads. */
export interface FlagshipReply {
  reply: string
  code: string
  /** Present only on a configurable or cross-app flagship: the layer as it
   *  should be injected, with what was asked for written into it. A cross-app
   *  layer also names the window it must go to, which is not the one probed. */
  prepare?: (ask: Ask, ctx?: Omit<HandoffContext, 'channel'>) => Promise<{ reply: string; code: string; targetId?: string }>
}

/**
 * The flagship for a request, by the local route alone. The agent uses
 * flagshipFor with the full route (which may ask the model); this is the
 * synchronous form for callers that cannot wait on one.
 */
export function flagshipLayer(
  appName: string | undefined | null,
  prompt: string | undefined | null
): FlagshipReply | null {
  const match = matchCapability(appName, prompt)
  return match ? flagshipFor(match, prompt) : null
}

/** The layer that carries out a routed capability, aimed at its target. */
export function flagshipFor(
  match: Pick<CapabilityMatch, 'capabilityId' | 'parameters'>,
  prompt: string | undefined | null
): FlagshipReply | null {
  const hit = FLAGSHIPS.find(f => f.capability === match.capabilityId)
  if (!hit) return null
  const text = String(prompt || '')
  const code = hit.code.trim()
  const fill = (config: unknown) =>
    // Written as a JSON literal into the call's argument and only ever read
    // as data. < and ` are escaped so nothing in it can close the reply's
    // code fence (parseMod reads the layer back out of that fence).
    code.replace(CONFIG_SLOT, () => JSON.stringify(config).replace(/[<`]/g, ch => (ch === '<' ? '\\u003c' : '\\u0060')))
  const handoff = hit.handoff
  if (handoff) {
    // Nothing to inject until the source has been read and the destination
    // found, so there is no unprepared code to offer.
    return {
      code: '',
      reply: '',
      prepare: async (ask, ctx) => {
        const out = await handoff(ask, { ...ctx, channel: match.parameters.channel })
        const filled = fill(out.config)
        return {
          code: filled,
          reply: `NAME: ${hit.name}\nDESCRIPTION: ${out.description}\n\`\`\`javascript\n${filled}\n\`\`\``,
          targetId: out.targetId,
        }
      },
    }
  }
  // A request that names a channel or page opens it first; otherwise the
  // layer runs on whatever is on screen, as it always has.
  const target = namedTarget(match)
  const aim = (c: string) => (target ? withTarget(c, hit.app, target) : c)
  const out: FlagshipReply = { code: aim(code), reply: replyFor(hit, aim(code)) }
  const configure = hit.configure
  if (configure) {
    out.prepare = async ask => {
      const filled = aim(fill(await configure(text, ask)))
      return { code: filled, reply: replyFor(hit, filled) }
    }
  }
  return out
}
