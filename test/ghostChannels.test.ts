import { describe, it, expect } from 'vitest'
import { flagshipLayer, isFlagshipCode } from '../src/agent/flagship'
import { parseMod } from '../src/agent/parseMod'
import { configureGhostChannel, parseGhostReply, promptConfig, topicOf } from '../src/agent/ghostChannels'

const ASK = 'make me a channel with everything about AI agents and LLMs'

describe('Ghost Channels — routing', () => {
  it('answers channel-making requests for Discord only, and leaves the Conversation Map its own', () => {
    expect(flagshipLayer('Discord', ASK)?.prepare).toBeTypeOf('function')
    expect(flagshipLayer('Discord', 'create a ghost channel for interview prep')).not.toBeNull()
    expect(flagshipLayer('Slack', ASK)).toBeNull()
    expect(flagshipLayer('Discord', 'untangle this channel')?.prepare).toBeUndefined()
  })

  it('gives no prepare step to the flagships that existed before it', () => {
    expect(flagshipLayer('Notion', 'spatial mode')?.prepare).toBeUndefined()
    expect(flagshipLayer('Slack', 'turn this channel into a command center')?.prepare).toBeUndefined()
    expect(flagshipLayer('Discord', 'untangle this channel')?.prepare).toBeUndefined()
  })
})

describe('Ghost Channels — prepare', () => {
  it('writes the model’s reading into the layer and still parses as a flagship', async () => {
    const reply = '{"label":"ai-agents","topic":"AI agents and LLMs","concepts":[{"term":"agent","weight":3},{"term":"llm","weight":3},{"term":"mcp","weight":3},{"term":"tool `use`","weight":2}]}'
    const layer = await flagshipLayer('Discord', ASK)!.prepare!(async () => reply)
    expect(layer.code).toContain('"label":"ai-agents"')
    expect(layer.code).not.toContain('/*MODABLE_CONFIG*/null')
    const mod = parseMod(layer.reply)
    expect(mod?.name).toBe('Discord Ghost Channels')
    expect(mod?.code).toBe(layer.code) // a backtick in a concept cannot cut the fence
    expect(mod?.marks.sort()).toEqual(['discord-ghost-channel-section', 'discord-ghost-channel-style'])
    expect(isFlagshipCode(layer.code)).toBe(true)
  })

  it('falls back to the request’s own words when the model fails, and says so', async () => {
    const cfg = await configureGhostChannel(ASK, async () => { throw new Error('offline') })
    expect(cfg.understoodBy).toBe('prompt')
    expect(cfg.topic).toBe('AI agents and LLMs')
    expect(cfg.label).toBe('ai-agents-llms')
    expect(cfg.concepts.map(c => c.term)).toEqual(expect.arrayContaining(['ai', 'agents', 'agent', 'llms', 'llm']))
  })

  it('rejects unusable model answers', () => {
    expect(parseGhostReply('sure! here you go', ASK)).toBeNull()
    expect(parseGhostReply('{"label":"x","topic":"t","concepts":["a","b","c"]}', ASK)).toBeNull()
    expect(parseGhostReply('{"label":"ai-agents","topic":"AI","concepts":["agent","llm","mcp"]}', ASK)?.concepts).toHaveLength(3)
  })

  it('reads the topic out of common phrasings', () => {
    expect(topicOf('make me a channel with everything about Python algorithms and data structures')).toBe('Python algorithms and data structures')
    expect(topicOf('create a channel about interview prep')).toBe('interview prep')
    expect(promptConfig('create a channel about interview prep').label).toBe('interview-prep')
  })
})
