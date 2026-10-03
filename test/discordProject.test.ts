import { describe, it, expect, vi } from 'vitest'
import { routeCapability, matchCapability } from '../src/agent/capabilities'
import { flagshipFor, flagshipLayer, isFlagshipCode } from '../src/agent/flagship'
import { parseMod } from '../src/agent/parseMod'
import {
  parseProject, conversationText, prepareDiscordNotionProject, sourceScript,
  type Extraction, type HandoffDeps,
} from '../src/agent/discordProject'
import { createRequire } from 'module'
const { pickNotionDocument } = createRequire(import.meta.url)('../lib/handoff.js')

const ID = 'crossapp.discord-to-notion-project' as const

const msg = (i: number, author: string, text: string, links: string[] = []) => ({
  id: `15550000000000000${String(i).padStart(2, '0')}`,
  channelId: '470889390588035082',
  channelName: 'modable-launch',
  author,
  bot: false,
  timestamp: new Date(Date.UTC(2026, 9, 2, 14, i)).toISOString(),
  text,
  replyTo: null,
  links: links.map(url => ({ url, title: '' })),
})

const extraction: Extraction = {
  ok: true,
  source: {
    app: 'discord', kind: 'channel', serverId: '267624335836053506', serverName: 'Modable',
    channelId: '470889390588035082', channelName: 'modable-launch',
  },
  messages: [
    msg(1, 'Sara', '@Hamad can you fix auth tonight?'),
    msg(2, 'Hamad', "on it. I'll write the release notes too"),
    msg(3, 'Sara', 'We should probably maybe launch Friday?'),
    msg(4, 'Lee', "Let's ship Friday."),
    msg(5, 'Lee', "We can't deploy because credentials are missing."),
    msg(6, 'Sara', 'Spec is here https://example.com/spec'),
  ],
}

const good = JSON.stringify({ title: 'Launch', overview: '', tasks: [{ text: 'Fix auth', owner: 'Hamad', sources: ['m1'] }] })

describe('routing — Discord → Notion Project', () => {
  it.each([
    'turn this into a Notion project',
    'make a Notion project from this Discord channel',
    'turn this Ghost Channel into a project',
    'send this discussion to Notion',
    'make #modable-launch into a Notion project',
    'make a project from this channel',
    'export this conversation to notion',
    'can you convert this channel into a project?',
  ])('"%s" resolves to the cross-app workflow', prompt => {
    expect(matchCapability('Discord', prompt)?.capabilityId).toBe(ID)
  })

  it('takes a named channel, and is Discord-only', () => {
    expect(matchCapability('Discord', 'make #modable-launch into a Notion project')?.parameters.channel).toBe('modable-launch')
    expect(matchCapability('Slack', 'turn this into a Notion project')).toBeNull()
    expect(matchCapability('Notion', 'turn this into a Notion project')).toBeNull()
  })

  it('does not take requests that belong to the existing Discord flagships', () => {
    expect(matchCapability('Discord', 'untangle this channel')?.capabilityId).toBe('discord.conversation-map')
    expect(matchCapability('Discord', 'create a conversation map')?.capabilityId).toBe('discord.conversation-map')
    expect(matchCapability('Discord', 'make me a channel about project management')?.capabilityId).toBe('discord.ghost-channel')
    expect(matchCapability('Discord', 'make a ghost channel with everything about rust')?.capabilityId).toBe('discord.ghost-channel')
  })

  it('leaves everything else to generic generation', async () => {
    expect(matchCapability('Discord', 'add a dark mode toggle')).toBeNull()
    const ask = vi.fn(async () => '{"capabilityId":"none","confidence":0.1,"parameters":{}}')
    expect(await routeCapability('Discord', 'hide the member list', ask)).toBeNull()
  })
})

describe('parseProject — only what the messages support', () => {
  const reply = JSON.stringify({
    title: 'Modable launch',
    overview: 'Getting the launch out.',
    tasks: [
      { text: 'Fix auth', owner: 'Hamad', due: 'tonight', sources: ['m1'] },
      { text: 'Write the release notes', owner: 'Hamad', sources: ['m2'] },
      { text: 'Fix auth for the beta', owner: 'Priya', due: 'Monday', sources: ['m1'] },
      { text: 'Book a venue', sources: ['m1'] },
      { text: 'Invented task', sources: [] },
      { text: 'Another invented task', sources: ['m99'] },
    ],
    decisions: [{ text: 'Ship Friday', sources: ['m4'] }],
    blockers: [{ text: 'Deploy blocked: credentials are missing', sources: ['m5'] }],
    questions: [{ text: 'Launch Friday?', sources: ['m3'] }],
    resources: [
      { title: 'Spec', url: 'https://example.com/spec', sources: ['m6'] },
      { title: 'Made-up doc', url: 'https://example.com/fake', sources: ['m6'] },
    ],
  })

  it('keeps supported items with real source references', () => {
    const r = parseProject(reply, extraction)
    if (!r.ok) throw new Error('expected a project')
    const p = r.payload
    expect(p.tasks.map(t => t.text)).toEqual(['Fix auth', 'Write the release notes', 'Fix auth for the beta'])
    expect(p.tasks[0]).toMatchObject({ owner: 'Hamad', dueDate: 'tonight' })
    expect(p.tasks[0].sources[0]).toEqual({
      app: 'discord', serverId: '267624335836053506', channelId: '470889390588035082',
      channelName: 'modable-launch', messageId: extraction.messages![0].id, author: 'Sara',
      timestamp: extraction.messages![0].timestamp,
    })
    // "I'll write…" — the author committing themselves is a real owner.
    expect(p.tasks[1].owner).toBe('Hamad')
    expect(p.decisions[0].sources[0].messageId).toBe(extraction.messages![3].id)
    expect(p.origin).toMatchObject({ channelName: 'modable-launch', messageCount: 6, lastMessageId: extraction.messages![5].id })
  })

  it('drops sourceless items, and owners, deadlines and links the messages do not contain', () => {
    const r = parseProject(reply, extraction)
    if (!r.ok) throw new Error('expected a project')
    const beta = r.payload.tasks[2]
    expect(beta.owner).toBeUndefined()
    expect(beta.dueDate).toBeUndefined()
    // Cites a real message, but that message is not about venues.
    expect(r.payload.tasks.some(t => /venue/i.test(t.text))).toBe(false)
    expect(r.payload.tasks.some(t => /invented/i.test(t.text))).toBe(false)
    expect(r.payload.resources.find(x => x.title === 'Made-up doc')?.url).toBeUndefined()
    expect(r.payload.resources.find(x => x.title === 'Spec')?.url).toBe('https://example.com/spec')
    expect(r.dropped).toBeGreaterThanOrEqual(5)
  })

  it('does not turn a bare acknowledgement into a decision (seen live: "Ok" → "Max will start with SQL")', () => {
    const x: Extraction = { ...extraction, messages: [...extraction.messages!, msg(7, 'Max', 'Ok')] }
    const r = parseProject(JSON.stringify({
      title: 't',
      decisions: [{ text: 'Max will start learning data analytics with SQL', sources: ['m7'] }],
      questions: [{ text: 'Launch Friday?', sources: ['m3'] }],
    }), x)
    if (!r.ok) throw new Error('expected a project')
    expect(r.payload.decisions).toEqual([])
    expect(r.payload.questions).toHaveLength(1)
  })

  it('rejects malformed replies and reports empty projects', () => {
    expect(parseProject('not json', extraction)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(parseProject('[1,2]', extraction)).toMatchObject({ ok: false, reason: 'malformed' })
    expect(parseProject('{"title":"x","tasks":[],"decisions":[]}', extraction)).toMatchObject({ ok: false, reason: 'empty' })
    expect(parseProject('{"tasks":[{"text":"no source here"}]}', extraction)).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('labels messages for the model without exposing their real ids', () => {
    const t = conversationText(extraction)
    expect(t).toContain('[m1]')
    expect(t).toContain('@Hamad can you fix auth tonight?')
    expect(t).not.toContain(extraction.messages![0].id)
  })
})

describe('handoff ordering — fail safely at every stage', () => {
  it('never opens Notion when Discord cannot be read', async () => {
    const notion = vi.fn()
    const deps: HandoffDeps = {
      read: async () => ({ success: true, result: { ok: false, reason: 'Discord is not showing a text channel.' } }),
      notion,
    }
    await expect(prepareDiscordNotionProject(async () => good, { targetId: 't' }, deps)).rejects.toThrow(/not showing a text channel/)
    expect(notion).not.toHaveBeenCalled()
  })

  it('never opens Notion for an empty or malformed project', async () => {
    const notion = vi.fn()
    const deps: HandoffDeps = { read: async () => ({ success: true, result: extraction }), notion }
    await expect(prepareDiscordNotionProject(async () => '{"tasks":[]}', { targetId: 't' }, deps)).rejects.toThrow(/none of them describe project work/)
    await expect(prepareDiscordNotionProject(async () => 'sorry', { targetId: 't' }, deps)).rejects.toThrow(/usable project/)
    expect(notion).not.toHaveBeenCalled()
  })

  it('keeps the project when Notion cannot be reached, and names the Notion window when it can', async () => {
    const read = async () => ({ success: true, result: extraction })
    await expect(prepareDiscordNotionProject(async () => good, { targetId: 't' }, {
      read, notion: async () => ({ success: false, error: 'Notion is open but is not showing a page.' }),
    })).rejects.toThrow(/saved in Modable/)

    const out = await prepareDiscordNotionProject(async () => good, { targetId: 't' }, {
      read, notion: async () => ({ success: true, targetId: 'NOTION1', title: 'Roadmap' }),
    })
    expect(out.targetId).toBe('NOTION1')
    expect(out.config.payload.tasks[0].text).toBe('Fix auth')
    expect(out.description).toMatch(/Roadmap/)
  })

  it('treats "this Discord channel" as the app, not a channel name', async () => {
    let code = ''
    await prepareDiscordNotionProject(async () => good, { targetId: 't', channel: 'discord' }, {
      read: async (_t, c) => { code = c; return { success: true, result: extraction } },
      notion: async () => ({ success: true, targetId: 'N' }),
    })
    expect(code).toContain(')({}, function (want)')
    expect(sourceScript('modable-launch')).toContain('({"channel":"modable-launch"}, function (want)')
  })
})

describe('the Notion layer', () => {
  it('has nothing to inject until prepared', () => {
    const f = flagshipLayer('Discord', 'turn this into a Notion project')!
    expect(f.code).toBe('')
    expect(f.prepare).toBeTypeOf('function')
  })

  it('names the window it must go to, parses like any layer, and is recognised as a flagship', async () => {
    vi.resetModules()
    vi.doMock('../src/agent/discordProject', async orig => ({
      ...(await orig<typeof import('../src/agent/discordProject')>()),
      prepareDiscordNotionProject: async () => ({
        config: { payload: { id: 'p', title: 'T', origin: {} }, destination: { title: 'Roadmap' } },
        targetId: 'NOTION1',
        description: 'T: 1 task',
      }),
    }))
    const fl = await import('../src/agent/flagship')
    const out = await fl.flagshipFor({ capabilityId: ID, parameters: {} }, 'turn this into a Notion project')!
      .prepare!(async () => '', { targetId: 'DISCORD1' })
    expect(out.targetId).toBe('NOTION1')
    const mod = parseMod(out.reply)
    expect(mod?.name).toBe('Discord → Notion Project')
    expect(mod?.marks.sort()).toEqual([
      'discord-notion-project-style', 'discord-notion-project-switch', 'discord-notion-project-view',
    ])
    expect(fl.isFlagshipCode(out.code)).toBe(true)
    expect(out.code).toContain('"title":"T"')
    vi.doUnmock('../src/agent/discordProject')
  })

  it('is never mistaken for model output by repair, and model output never for it', () => {
    expect(isFlagshipCode('(function(){ /* some generated layer */ })();')).toBe(false)
    expect(flagshipFor({ capabilityId: ID, parameters: {} }, 'x')).not.toBeNull()
  })
})

describe('pickNotionDocument — the real page, never a utility window', () => {
  const page = (id: string, url: string) => ({ id, type: 'page', url, webSocketDebuggerUrl: 'ws://x/' + id })
  const pages = [
    page('blank', 'https://app.notion.com/blank?x=1'),
    page('doc', 'https://app.notion.com/p/Modable-3eb8'),
    page('tabs', 'file:///Applications/Notion.app/Contents/Resources/app.asar/.webpack/renderer/tabs/index.html'),
  ]
  it('picks the visible document window', () => {
    const described = {
      blank: { visible: false, w: 0, h: 0, frame: false, topbar: false },
      doc: { visible: true, w: 1320, h: 823, frame: true, topbar: true },
      tabs: { visible: true, w: 1320, h: 36, frame: false, topbar: false },
    }
    expect(pickNotionDocument(pages, described)?.page.id).toBe('doc')
  })
  it('still finds the page when another window covers it (macOS reports it hidden)', () => {
    const described = { doc: { visible: false, focus: true, w: 1320, h: 823, frame: true, topbar: true } }
    expect(pickNotionDocument(pages, described)?.page.id).toBe('doc')
  })
  it('prefers a visible window, then the focused tab, over a larger hidden one', () => {
    const two = [...pages, page('doc2', 'https://app.notion.com/p/Other-1')]
    expect(pickNotionDocument(two, {
      doc: { visible: false, focus: false, w: 1800, h: 1000, frame: true, topbar: true },
      doc2: { visible: false, focus: true, w: 1200, h: 800, frame: true, topbar: true },
    })?.page.id).toBe('doc2')
    expect(pickNotionDocument(two, {
      doc: { visible: true, focus: false, w: 1000, h: 700, frame: true, topbar: true },
      doc2: { visible: false, focus: true, w: 1200, h: 800, frame: true, topbar: true },
    })?.page.id).toBe('doc')
  })
  it('refuses when no document is showing', () => {
    expect(pickNotionDocument(pages, { blank: { visible: true, w: 1320, h: 823, frame: true, topbar: true } })).toBeNull()
    expect(pickNotionDocument(pages, { doc: { visible: true, w: 1320, h: 823, frame: false, topbar: false } })).toBeNull()
    expect(pickNotionDocument(pages, { doc: { visible: true, w: 400, h: 300, frame: true, topbar: true } })).toBeNull()
  })
})
