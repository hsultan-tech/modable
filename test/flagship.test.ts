import { describe, it, expect } from 'vitest'
import { flagshipLayer, isFlagshipCode } from '../src/agent/flagship'
import { parseMod } from '../src/agent/parseMod'

describe('flagshipLayer — Notion Spatial Mode', () => {
  it('answers the spatial request for Notion only', () => {
    expect(flagshipLayer('Notion', 'turn this page into a spatial canvas')).not.toBeNull()
    expect(flagshipLayer('Slack', 'turn this page into a spatial canvas')).toBeNull()
    expect(flagshipLayer('Notion', 'make the sidebar darker')).toBeNull()
  })

  it('parses like a model reply and claims only marks present right after injection', () => {
    const mod = parseMod(flagshipLayer('Notion', 'spatial mode')!.reply)
    expect(mod?.name).toBe('Notion Spatial Mode')
    expect(mod?.marks.sort()).toEqual(['notion-spatial-style', 'notion-spatial-toggle'])
  })
})

describe('flagshipLayer — Slack Command Center', () => {
  it('answers the command center request for Slack only', () => {
    expect(flagshipLayer('Slack', 'turn this channel into a command center')).not.toBeNull()
    expect(flagshipLayer('Notion', 'turn this channel into a command center')).toBeNull()
    expect(flagshipLayer('Slack', 'turn this page into a spatial canvas')).toBeNull()
  })

  it('parses like a model reply and claims only marks present right after injection', () => {
    const mod = parseMod(flagshipLayer('Slack', 'turn this channel into a command center')!.reply)
    expect(mod?.name).toBe('Slack Command Center')
    expect(mod?.marks.sort()).toEqual(['slack-command-center-style', 'slack-command-center-toggle'])
  })
})

describe('flagshipLayer — Discord Conversation Map', () => {
  it('answers the untangle request for Discord only', () => {
    expect(flagshipLayer('Discord', 'untangle this channel')).not.toBeNull()
    expect(flagshipLayer('Discord', 'show me a conversation map')).not.toBeNull()
    expect(flagshipLayer('Slack', 'untangle this channel')).toBeNull()
    expect(flagshipLayer('Discord', 'turn this channel into a command center')).toBeNull()
  })

  it('parses like a model reply and claims only marks present right after injection', () => {
    const mod = parseMod(flagshipLayer('Discord', 'untangle this channel')!.reply)
    expect(mod?.name).toBe('Discord Conversation Map')
    expect(mod?.marks.sort()).toEqual(['discord-conversation-map-style', 'discord-conversation-map-toggle'])
  })
})

describe('isFlagshipCode — failed flagships are not model-repaired', () => {
  it('recognises hand-built layers and nothing else', () => {
    expect(isFlagshipCode(flagshipLayer('Slack', 'command center')!.code)).toBe(true)
    expect(isFlagshipCode(flagshipLayer('Notion', 'spatial')!.code)).toBe(true)
    expect(isFlagshipCode(flagshipLayer('Discord', 'untangle this channel')!.code)).toBe(true)
    expect(isFlagshipCode('(function(){ return { ok: true } })()')).toBe(false)
    expect(isFlagshipCode('')).toBe(false)
  })
})
