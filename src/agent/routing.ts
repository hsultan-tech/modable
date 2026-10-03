/**
 * Which path an application's modifications take.
 *
 * Modable's original path attaches to a running Electron app over the Chrome
 * DevTools Protocol and evaluates a layer into its live DOM. That works for
 * Slack, Discord, VS Code and the rest because they are Electron and can be
 * launched with --remote-debugging-port.
 *
 * Spotify is not Electron. Its desktop client is CEF-based and exposes no
 * debugger to attach to, so the CDP path does not merely work less well there —
 * it has nothing to connect to at all. Spotify is modified by patching its
 * bundle on disk with Spicetify, which is a different shape of operation
 * entirely: write a file, register it, apply, restart.
 *
 * That is the whole reason this split exists. Keeping it in one small module,
 * rather than as a string comparison scattered through the agent and the
 * workspace, means there is one place to look to answer "why did this app go
 * down that path", and one place to change when a second non-Electron target
 * arrives.
 */

/** Applications whose modifications go through Spicetify rather than CDP. */
const SPICETIFY_APPS = ['spotify'];

export type ModChannel = 'cdp' | 'spicetify';

export function channelFor(appName: string | undefined | null): ModChannel {
  if (!appName) return 'cdp';
  return SPICETIFY_APPS.includes(appName.trim().toLowerCase()) ? 'spicetify' : 'cdp';
}

export function usesSpicetify(appName: string | undefined | null): boolean {
  return channelFor(appName) === 'spicetify';
}

/**
 * The kinds of work a Spotify request can be.
 *
 * Splitting local-file import out of the ordinary Spicetify path is not a
 * cosmetic distinction. A normal mod is "write code, patch the bundle, restart";
 * an import is "move a file the user owns into a folder Spotify scans, and touch
 * their audio never destructively". They share a target application and nothing
 * else — different inputs, different failure modes, different revert.
 */
export type ModTask = 'cdp' | 'spicetify' | 'spicetify-local-import'

/** An MP3 is the only thing the import path claims to handle, so it is the only
 *  attachment that can send a request down it. */
const IMPORTABLE = /\.mp3$/i

/**
 * Words that mean "put this audio into Spotify" rather than "change how Spotify
 * looks". Kept deliberately tight: "file" alone is not enough — someone asking
 * to hide a file name in the sidebar is asking for a normal mod, and a router
 * that grabs that request sends them somewhere they cannot get what they want.
 */
const IMPORT_PHRASES = [
  /\badd\b[^.]{0,40}\b(to|into)\b[^.]{0,20}\b(spotify|my (library|music))\b/i,
  /\bimport\b[^.]{0,40}\b(mp3|track|song|audio|file)\b/i,
  /\b(mp3|track|song)\b[^.]{0,30}\b(into|to)\b[^.]{0,20}\b(spotify|library)\b/i,
  /\bupload\b[^.]{0,30}\b(mp3|song|track)\b/i,
  /* "drag and drop my mp3s" reads like a feature request, and Modable used to
     treat it as one — the model wrote a top bar drop target that showed
     "2 MP3 file(s) uploaded" and moved nothing, because an extension running
     inside Spotify cannot read a dropped file off disk or write into ~/Music.
     The user is asking to get their files in. That is this path. */
  /\bdrag\b[^.]{0,30}\bdrop\b[^.]{0,40}\b(mp3|song|track|file|audio)s?\b/i,
  /\b(mp3|song|track)s?\b[^.]{0,30}\b(drag|drop)\b/i,
]

export function taskFor(
  appName: string | undefined | null,
  prompt: string | undefined | null,
  attachmentPath?: string | null
): ModTask {
  const channel = channelFor(appName)
  /* Only Spotify has a local-files concept. An mp3 pointed at Slack is not an
     import, it is a user who picked the wrong target, and quietly treating it
     as one would be worse than letting the normal path say so. */
  if (channel !== 'spicetify') return channel

  const text = String(prompt || '')
  const hasAudio = !!attachmentPath && IMPORTABLE.test(attachmentPath)
  const asksForImport = IMPORT_PHRASES.some(re => re.test(text))

  return hasAudio || asksForImport ? 'spicetify-local-import' : 'spicetify'
}

export function isLocalImport(
  appName: string | undefined | null,
  prompt: string | undefined | null,
  attachmentPath?: string | null
): boolean {
  return taskFor(appName, prompt, attachmentPath) === 'spicetify-local-import'
}

/**
 * The file the user meant, out of the sentence they typed.
 *
 * Modable has no file picker, and it does not need one: dropping a file onto a
 * text input in Chromium inserts its path as text, so the prompt box is already
 * a drop target. This reads the path back out.
 *
 * Returns null rather than guessing. A request with no file in it is a request
 * to be told what to do next, not a reason to import something arbitrary.
 */
export function extractAudioPath(
  text: string | undefined | null,
  home?: string
): string | null {
  const raw = String(text || '')

  /* Quoted first: a path with spaces is only recoverable when the user (or the
     drop) quoted it, and trying to parse one unquoted guesses at where it ends. */
  const quoted = raw.match(/["']([^"']*\.mp3)["']/i)
  if (quoted) return expandHome(quoted[1], home)

  const url = raw.match(/file:\/\/(\/[^\s"']*\.mp3)/i)
  if (url) return expandHome(decodeURIComponent(url[1]), home)

  const bare = raw.match(/(~?\/[^\s"']*\.mp3)/i)
  if (bare) return expandHome(bare[1], home)

  return null
}

function expandHome(p: string, home?: string): string {
  if (!p.startsWith('~')) return p
  /* process is not defined in the renderer, hence the injectable home — the
     tests pass one, and the Electron side passes the real one. */
  const resolved =
    home ||
    (typeof process !== 'undefined' && process.env ? process.env.HOME || '' : '')
  return resolved ? p.replace(/^~/, resolved) : p
}

/**
 * What to put in the prompt when someone drops a file on Modable.
 *
 * Dropping an MP3 on the window is the obvious way to hand Modable a file, and
 * it did not work at all: Electron's default is to navigate the window to the
 * dropped file, which throws the app away. The window has to refuse the drop
 * and read the path itself.
 *
 * Returns null for anything Modable cannot import — a PDF, or a drag out of a
 * browser, which carries a name but no path on disk. Nothing behind it means
 * nothing to import, and a message that claims otherwise is the failure this
 * whole feature keeps circling back to.
 */
export function importMessageForDrop(file: { name?: string; path?: string }): string | null {
  const p = String(file?.path || '')
  if (!p) return null
  if (!/\.mp3$/i.test(p)) return null
  /* Quoted, because a path with spaces is otherwise unrecoverable from free
     text — see extractAudioPath. */
  return `add "${p}" to spotify`
}
