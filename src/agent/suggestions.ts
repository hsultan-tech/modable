/**
 * Opening moves, per mechanism.
 *
 * These were module-private to the run view. The index offers them too now, so
 * they live here rather than being duplicated — the bar they had to clear is
 * expensive enough that a second, drifting copy would be a real hazard.
 *
 * Every Spotify entry was applied to the real client, restarted, and measured
 * in the live DOM before being offered. That bar exists because the previous
 * list did not clear it: "hide the friend activity panel" targeted a panel the
 * client does not have, and "hide the now playing side panel" hid something
 * closed by default, so both were indistinguishable from a mod that failed. A
 * suggestion that does nothing reads as the product being broken on first
 * contact.
 */

/** Anything reached over the debugger. */
export const CDP_SUGGESTIONS = [
  'add a dark mode toggle',
  'add a floating clock to the header',
  'count the words on screen',
]

/** Spotify differs in kind, not just wording: one of the two things it can be
 *  asked for is a stylesheet, which none of the CDP suggestions describes. */
export const SPOTIFY_SUGGESTIONS = [
  'make the now playing bar accent green',
  'add a top bar button that skips 30 seconds forward',
  'add a copy track name button to the top bar',
]

export function suggestionsFor(channel?: 'cdp' | 'spicetify'): string[] {
  return channel === 'spicetify' ? SPOTIFY_SUGGESTIONS : CDP_SUGGESTIONS
}
