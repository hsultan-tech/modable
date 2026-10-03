import { describe, it, expect, vi } from 'vitest'
import {
  CAPABILITIES, matchCapability, routeCapability, parseClassification, unwrapTarget,
} from '../src/agent/capabilities'
import { flagshipFor, flagshipLayer, isFlagshipCode } from '../src/agent/flagship'
import { parseMod } from '../src/agent/parseMod'

const PHRASINGS: [string, string, string[]][] = [
  ['Discord', 'discord.conversation-map', [
    'untangle this channel',
    'create a conversation map',
    'map the conversations in here',
    'show me the discussions happening in this channel',
    'make a conversation map for #algos-and-data-structs',
  ]],
  ['Slack', 'slack.command-center', [
    'turn this channel into a command center',
    'organize this channel into decisions and action items',
    'make #launch operational',
    'show blockers, decisions and tasks from this channel',
  ]],
  ['Notion', 'notion.spatial-mode', [
    'turn this page into a spatial canvas',
    'make this page spatial',
    'give me a canvas view',
    'turn this document into draggable cards',
  ]],
  ['Discord', 'discord.ghost-channel', [
    'make me a channel about AI agents',
    'create a generated channel for interview prep',
    'collect everything about LLMs into one channel',
  ]],
]

/** Requests every flagship app gets that are not a flagship. */
const GENERIC = [
  'add a dark mode toggle',
  'add a floating clock to the header',
  'count the words on screen',
  'hide the member list',
  'make the sidebar darker',
  'make the channel list narrower',
  'add a button that copies the channel name',
]

describe('capability routing — many phrasings, one capability', () => {
  for (const [app, id, asks] of PHRASINGS) {
    for (const ask of asks) {
      it(`${app}: "${ask}" → ${id}`, async () => {
        expect(matchCapability(app, ask)?.capabilityId).toBe(id)
        // The full route agrees without needing the model.
        const noModel = vi.fn()
        expect((await routeCapability(app, ask, noModel))?.capabilityId).toBe(id)
        expect(noModel).not.toHaveBeenCalled()
      })
    }
  }

  it('routes a capability only on its own app', () => {
    expect(matchCapability('Slack', 'untangle this channel')).toBeNull()
    expect(matchCapability('Discord', 'turn this page into a spatial canvas')).toBeNull()
    expect(matchCapability('VS Code', 'turn this channel into a command center')).toBeNull()
  })

  it('every registered example routes to its own capability', () => {
    for (const cap of CAPABILITIES) {
      for (const ex of cap.examples) expect(matchCapability(cap.app, ex)?.capabilityId).toBe(cap.id)
    }
  })
})

describe('capability routing — targets', () => {
  it('reads a named channel, and leaves it absent for the visible one', () => {
    expect(matchCapability('Discord', 'create a conversation map for #career-advice')?.parameters)
      .toEqual({ channel: 'career-advice' })
    expect(matchCapability('Discord', 'create a conversation map')?.parameters).toEqual({})
    expect(matchCapability('Discord', 'untangle this channel')?.parameters).toEqual({})
    expect(matchCapability('Slack', 'make #launch operational')?.parameters).toEqual({ channel: 'launch' })
    expect(matchCapability('Slack', 'turn the design-review channel into a command center')?.parameters)
      .toEqual({ channel: 'design-review' })
  })

  it('reads a named page, and leaves it absent for the visible one', () => {
    expect(matchCapability('Notion', 'turn "Q3 Roadmap" into a spatial canvas')?.parameters)
      .toEqual({ page: 'Q3 Roadmap' })
    expect(matchCapability('Notion', 'make this page spatial')?.parameters).toEqual({})
  })

  it('reads a generated channel’s topic and sources', () => {
    expect(matchCapability('Discord', 'make me a channel about AI agents')?.parameters)
      .toEqual({ topic: 'AI agents' })
    expect(matchCapability('Discord', 'make a ghost channel about rust from #help, #showcase')?.parameters)
      .toEqual({ topic: 'rust', sourceChannels: ['help', 'showcase'] })
  })

  it('runs the visible-surface layer verbatim when no target is named', () => {
    const plain = flagshipLayer('Discord', 'untangle this channel')!
    const named = flagshipLayer('Discord', 'create a conversation map for #career-advice')!
    expect(named.code).not.toBe(plain.code)
    expect(named.code).toContain('"name":"career-advice"')
    // The layer itself is embedded unchanged, and is still recognised as a flagship.
    expect(unwrapTarget(named.code)).toBe(plain.code)
    expect(isFlagshipCode(named.code)).toBe(true)
    expect(parseMod(named.reply)?.name).toBe('Discord Conversation Map')
    expect(parseMod(named.reply)?.marks.sort()).toEqual(parseMod(plain.reply)?.marks.sort())
  })

  it('the open-target prelude is valid JavaScript', () => {
    const named = flagshipLayer('Slack', 'make #launch operational')!
    expect(() => new Function(named.code)).not.toThrow()
  })
})

describe('capability routing — unmatched requests fall through to generation', () => {
  for (const ask of GENERIC) {
    for (const app of ['Discord', 'Slack', 'Notion']) {
      it(`${app}: "${ask}" → generic`, async () => {
        expect(matchCapability(app, ask)).toBeNull()
        expect(flagshipLayer(app, ask)).toBeNull()
        const model = vi.fn(async () => '{"capabilityId":"none","confidence":0.95,"parameters":{}}')
        expect(await routeCapability(app, ask, model)).toBeNull()
      })
    }
  }

  it('apps with no capabilities never ask the model', async () => {
    const model = vi.fn()
    expect(await routeCapability('VS Code', 'untangle this channel', model)).toBeNull()
    expect(await routeCapability('Spotify', 'make the now playing bar accent green', model)).toBeNull()
    expect(model).not.toHaveBeenCalled()
  })
})

describe('capability routing — the model pass', () => {
  const answer = (o: object) => vi.fn(async () => JSON.stringify(o))

  it('routes a phrasing the local pass does not know when the model is confident', async () => {
    const model = answer({ capabilityId: 'discord.conversation-map', confidence: 0.9, parameters: { channel: 'career-advice' } })
    const r = await routeCapability('Discord', 'who is talking to whom over in career-advice?', model)
    expect(model).toHaveBeenCalledOnce()
    expect(r).toMatchObject({ capabilityId: 'discord.conversation-map', via: 'model', parameters: { channel: 'career-advice' } })
    expect(flagshipFor(r!, 'who is talking to whom')?.code).toContain('"name":"career-advice"')
  })

  it('falls back to generation when the model is not confident', async () => {
    const model = answer({ capabilityId: 'slack.command-center', confidence: 0.4, parameters: {} })
    expect(await routeCapability('Slack', 'what got decided?', model)).toBeNull()
  })

  it('ignores a capability belonging to another app', () => {
    expect(parseClassification('{"capabilityId":"notion.spatial-mode","confidence":1}', 'Slack'))
      .toEqual({ capabilityId: null, confidence: 1 })
  })

  it('keeps the local reading when the model cannot be reached or answers badly', async () => {
    const down = vi.fn(async () => { throw new Error('offline') })
    const garbled = vi.fn(async () => 'sure! here you go')
    // Scores between the threshold and SURE locally, so the model is asked.
    const ask = 'group the threads'
    const local = matchCapability('Discord', ask)
    expect(local?.capabilityId).toBe('discord.conversation-map')
    expect(local!.confidence).toBeLessThan(0.85)
    expect((await routeCapability('Discord', ask, down))?.capabilityId).toBe('discord.conversation-map')
    expect(down).toHaveBeenCalledOnce()
    expect((await routeCapability('Discord', ask, garbled))?.capabilityId).toBe('discord.conversation-map')
    expect(await routeCapability('Discord', 'add a dark mode toggle', down)).toBeNull()
  })

  it('a #channel the request spells out beats the model’s reading', async () => {
    const model = answer({ capabilityId: 'slack.command-center', confidence: 0.8, parameters: { channel: 'general' } })
    const r = await routeCapability('Slack', 'what are the open loops in #launch', model)
    expect(r?.parameters.channel).toBe('launch')
  })
})
