import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
const { parseListeners, appName, PORT_MIN, PORT_MAX } = createRequire(import.meta.url)('../lib/sessions.js')

const LSOF = `COMMAND     PID        USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
Discord   89761 hamadsultan   31u  IPv4 0x6970e573ed94f17d      0t0  TCP 127.0.0.1:9222 (LISTEN)
Notion    41022 hamadsultan   40u  IPv4 0x1111111111111111      0t0  TCP 127.0.0.1:9223 (LISTEN)
Electron  89260 hamadsultan   25u  IPv6 0xe18284380a28be51      0t0  TCP *:3456 (LISTEN)
node      89182 hamadsultan   36u  IPv4 0xfdba4c28be0bd412      0t0  TCP 127.0.0.1:5174 (LISTEN)
Google    12345 hamadsultan   12u  IPv4 0x2222222222222222      0t0  TCP 127.0.0.1:9333 (LISTEN)
Discord   89761 hamadsultan   32u  IPv6 0x3333333333333333      0t0  TCP [::1]:9222 (LISTEN)`

describe('sessions — one table of app → debug port', () => {
  it('reads each app session in the range from the OS listener table', () => {
    const m = parseListeners(LSOF)
    expect([...m.entries()]).toEqual([[9222, '89761'], [9223, '41022']])
  })

  it('ignores ports outside the session range', () => {
    const m = parseListeners(LSOF)
    expect(m.has(3456)).toBe(false)
    expect(m.has(5174)).toBe(false)
    expect(m.has(9333)).toBe(false)
    expect(PORT_MIN).toBe(9222)
    expect(PORT_MAX).toBeGreaterThan(PORT_MIN)
  })

  it('names apps from their bundle path', () => {
    expect(appName('/Applications/Notion.app')).toBe('Notion')
    expect(appName('/Applications/Visual Studio Code.app')).toBe('Visual Studio Code')
  })

  it('treats an empty or failed lsof as no sessions', () => {
    expect(parseListeners('').size).toBe(0)
  })
})
