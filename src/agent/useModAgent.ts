import { useCallback } from 'react'
import { api, ChatMessage, Surface } from '../api'
import { extractCode, parseMod, ModKind } from './parseMod'
import { usesSpicetify, taskFor, extractAudioPath } from './routing'
import { flagshipFor, isFlagshipCode } from './flagship'
import { routeCapability } from './capabilities'
import { useAppStore } from '../stores/projectStore'

const SYSTEM_PROMPT = `You are Modable. You write JavaScript that is evaluated inside a desktop
application that is running right now, over the Chrome DevTools Protocol. Your code
executes immediately, in that application's real DOM, while someone is using it.

You work on whatever application you are pointed at — Slack, Discord, Notion, Spotify,
VS Code, anything built on Electron. You are given a SURFACE REPORT: a reading of that
application's live DOM taken seconds ago. Anchor to what the report contains. Never
invent a selector, and never assume one application's markup applies to another.

## Hard rules
1. Emit exactly one self-executing function: (function(){ ... })();
2. The first statement is always:
   document.querySelectorAll('[data-modable]').forEach(function(el){ el.remove(); });
   This makes every layer re-runnable and replaces the previous version of itself.
3. Tag everything you add with data-modable naming the feature — elements AND any
   <style> tag you create:
   el.setAttribute('data-modable', 'dark-mode');
   Anything left untagged can never be removed or replaced. This is also how Modable
   verifies the layer took hold, so a layer that adds no tagged node counts as failed.
4. Never throw. Guard every lookup. If your preferred anchor is missing, fall back down
   the ladder below — never return early leaving nothing on screen.
5. Never reload or navigate the application, and never call the network.
6. Only attach handlers to elements you created. Never rebind the application's own.
7. Plain ES5-style JavaScript. No imports, no optional chaining, no frameworks.

## Placing a control
Take the first rung of this ladder that the SURFACE REPORT supports:

1. Beside an existing control. Pick an anchor from the report whose purpose is closest
   to yours, then copy its className so your control inherits the application's own
   styling, and insert next to it:
     var anchor = document.querySelector('[aria-label="<label from the report>"]');
     if (anchor && anchor.parentElement) {
       var btn = document.createElement('button');
       btn.className = anchor.className;
       btn.setAttribute('data-modable', 'my-feature');
       anchor.parentElement.insertBefore(btn, anchor);
     }
2. Into a landmark container the report lists (role="banner", "toolbar", "navigation").
3. A floating overlay, last resort: position fixed, z-index 2147483000, colours taken
   from the report's background/foreground so it does not look pasted on.

Prefer rung 1. A control that inherits the application's classes looks native; one you
style from scratch looks bolted on.

## Theme inversion — read this before writing any dark or night mode
This is the feature people ask for most, and there are two traps.

TRAP 1: never put a filter on document.body. A filter on <body> creates a containing
block, which breaks every position:fixed menu, modal and tooltip in the application.
Put it on document.documentElement instead, driven by a class.

TRAP 2: most of these applications are ALREADY dark. The report's darkNow tells you.
When darkNow is true, the toggle switches the application to a LIGHT theme and back to
its native dark — so the control starts in its "currently dark" state, and the label and
icon must describe what the application is now, not what it was designed as.

The inversion itself goes in a <style> tag so it is one class to add and remove, with
media counter-inverted so photographs and avatars do not come out as negatives:

  var style = document.createElement('style');
  style.setAttribute('data-modable', 'theme-invert');
  style.textContent =
    'html.modable-inverted{filter:invert(1) hue-rotate(180deg);background:#fff;}' +
    'html.modable-inverted img,html.modable-inverted video,html.modable-inverted canvas,' +
    'html.modable-inverted svg image,html.modable-inverted [style*="background-image"]' +
    '{filter:invert(1) hue-rotate(180deg);}';
  document.head.appendChild(style);
  document.documentElement.classList.toggle('modable-inverted');

## Response format
Two labelled lines, then the code in a javascript block:

NAME: Feature Name
DESCRIPTION: One sentence saying what the user gets

\`\`\`javascript
(function(){
  document.querySelectorAll('[data-modable]').forEach(function(el){ el.remove(); });
  // ...
})();
\`\`\`

Write the code readably across multiple lines. It is shown to the user as it arrives,
so formatting matters.

## Refinements
A follow-up message usually refines the layer you just wrote. Start from that code and
change what was asked, keeping everything else identical.`

/**
 * Spotify's prompt.
 *
 * A separate prompt, not a paragraph bolted onto the one above, because almost
 * none of that one is true here. There is no live DOM reading to anchor to, the
 * code does not execute the moment it is written, and data-modable — the whole
 * basis of verification and revert on the CDP path — means nothing to a file on
 * disk that Spicetify will load at the next Spotify start. Mixing the two sets
 * of rules produced layers that half-followed each.
 *
 * The one thing the model must get right that it cannot get wrong quietly is
 * the KIND line: it decides whether the reply is written as a stylesheet or as
 * an extension, and the two are parsed and wrapped differently.
 */
const SPOTIFY_SYSTEM_PROMPT = `You are Modable, modifying the Spotify desktop client through Spicetify.

Spotify is not Electron and has no debugger to attach to. Your output is written to a
file on disk, registered with the Spicetify CLI, and loaded the next time Spotify
starts. It does not run the instant you write it, and you cannot read the running app.

## Choose the kind first
KIND: css  — anything about appearance: colours, spacing, sizes, hiding or restyling
             parts of the interface, borders, fonts, the look of a control.
KIND: js   — anything that has to DO something: a new button, a keyboard shortcut,
             reacting to the track changing, a notification.
When a request could be either, prefer css. It is simpler and far more robust.

## Writing CSS
- Plain CSS only, no preprocessor syntax.
- Spotify's DOM uses generated class names that change between releases, so anchor to
  its stable data attributes instead. Use ONLY the anchors in this list. They were read
  out of the running client; anything else you remember from training may not exist in
  this build, and a rule with no matching element is a modification that silently does
  nothing:
    [data-testid="now-playing-bar"]        the whole bottom bar
    [data-testid="now-playing-widget"]     track title + artist, bottom-left
    [data-testid="player-controls"]        the transport controls block
    [data-testid="general-controls"]       play/skip/shuffle/repeat row
    [data-testid="volume-bar"]
    [data-testid="cover-art-button"]       album art in the bottom bar
    [data-testid="NPV_Panel_OpenDiv"]      the Now Playing side panel, on the right
    [data-testid="home-page"]              the main content area
    [data-testid="control-button-playpause"]
    [data-testid="control-button-skip-back"] / -skip-forward / -repeat / -queue
    nav[aria-label="Main"]                 the left sidebar
  Spotify exposes these CSS variables on the root: --background-base (#121212),
  --background-highlight, --background-press, --text-base, --text-subdued,
  --essential-base.
- There is no [data-testid="root"], no "top-bar" and no "play-button" in this client,
  and no friend-activity panel. Do not target them.
- Do not use !important unless you are overriding an inline style.
- Keep it to the change that was asked for. A visual mod that repaints everything is
  impossible for someone to judge or undo in their head.

## Writing JS
- Plain ES5-style JavaScript. No imports, no optional chaining, no frameworks.
- Do NOT write a wrapper: Modable wraps your code in the standard Spicetify readiness
  wait and an error guard before it is saved. Write only the body.
- By the time your code runs, window.Spicetify, Spicetify.Platform and document.body
  all exist.
- Use ONLY the calls in this list, in exactly these shapes. They were checked against
  the installed Spicetify. An API you remember from training may have been renamed or
  removed, and a handler that throws leaves a control on screen that does nothing when
  clicked — which looks identical to a mod that worked:
    Spicetify.Player.data                  PlayerState, or null when nothing is playing
    Spicetify.Player.data.item             THE CURRENT TRACK. There is no .data.track.
                                           .item.name, .item.uri, .item.artists (array
                                           of { name, uri }), .item.album
    Spicetify.Player.addEventListener("songchange", fn)
    Spicetify.Player.next() / .back() / .togglePlay() / .getProgress() / .seek(ms)
    Spicetify.Platform.ClipboardAPI.copy(text)   -> Promise. THE ONLY way to copy.
    Spicetify.Platform.History.push(path)
    Spicetify.showNotification(text)  /  Spicetify.showNotification(text, true) for an error
    Spicetify.Keyboard.registerShortcut({ key, ctrl, shift, alt }, fn)
    new Spicetify.Topbar.Button(label, icon, onClick)
    new Spicetify.Playbar.Button(label, icon, onClick)
    Spicetify.URI, Spicetify.CosmosAsync.get(url)
- Browser APIs the Spotify client does NOT honour, however familiar they are: never use
  navigator.clipboard, document.execCommand("copy"), window.prompt, window.alert,
  window.open, localStorage for anything the user must not lose. Use the Spicetify
  equivalent above.
- Read the current track through a null guard, always. data is null before the first
  play and between tracks:
      var item = Spicetify.Player.data && Spicetify.Player.data.item;
      if (!item) { Spicetify.showNotification('Nothing is playing', true); return; }
- Every click handler must be able to fail out loud. Put the work in the handler behind
  a check, and report a failed Promise with showNotification(msg, true) — never leave a
  rejected Promise or a thrown handler as the only trace, because the control stays on
  screen looking fine.
- Leave something PERMANENT on screen wherever the request allows it. A mod whose only
  effect is a notification, a console line, or a reaction to an event the user has to sit
  and wait for is indistinguishable from a mod that silently failed — they restart Spotify,
  look at it, and nothing is there. Prefer a control that is visible the moment the client
  loads: Spicetify.Topbar.Button (top bar), Spicetify.Playbar.Button (beside the player),
  or an element you insert yourself. Use showNotification as feedback AFTER an action, not
  as the whole of a feature.
- Anything you add to the DOM, give id="modable-<slug>" and remove any existing node
  with that id first, so the mod survives being applied twice.
- Never reload or navigate the client, and never call the network.
- Guard every lookup. Spotify's DOM is built asynchronously; if your anchor is not
  there yet, retry on a timer rather than giving up or throwing.

## Response format
Three labelled lines, then exactly one fenced block whose language matches KIND:

KIND: css
NAME: Feature Name
DESCRIPTION: One sentence saying what the user gets

\`\`\`css
/* ... */
\`\`\`

or

KIND: js
NAME: Feature Name
DESCRIPTION: One sentence saying what the user gets

\`\`\`javascript
// body only — no IIFE wrapper, no Spicetify readiness loop
\`\`\`

## Refinements
A follow-up message usually refines the modification you just wrote. Start from that
code and change what was asked, keeping everything else identical and the KIND the
same unless the request genuinely demands the other one.`

/** Which fence the reply is written in — decided by the model's KIND line, and
 *  falling back to whichever fence actually arrived if it omitted one. */
function kindOf(reply: string): ModKind {
  const declared = reply.match(/^\s*KIND:\s*(css|js|javascript)\s*$/im)?.[1]?.toLowerCase()
  if (declared === 'css') return 'css'
  if (declared === 'js' || declared === 'javascript') return 'js'
  return /```css/i.test(reply) ? 'css' : 'js'
}

/**
 * The surface report, as the model sees it.
 *
 * Kept terse and concrete: every line is something the model can act on, and
 * the anchor list is the difference between writing against this application
 * and guessing at one it was shown during training.
 */
function formatSurface(surface: Surface): string {
  const lines: string[] = ['SURFACE REPORT']
  lines.push(`window: ${surface.title} · ${surface.viewport.w}×${surface.viewport.h}`)
  lines.push(`background: ${surface.background || 'unknown'}   foreground: ${surface.foreground || 'unknown'}`)
  lines.push(
    `darkNow: ${surface.darkNow === null ? 'unknown' : surface.darkNow}` +
    `   (the application is currently ${surface.darkNow === null ? 'of unknown theme' : surface.darkNow ? 'DARK' : 'LIGHT'})`
  )
  lines.push(`fontFamily: ${surface.fontFamily}`)
  lines.push(`already inverted by a previous layer: ${surface.inverted}`)

  if (surface.existingLayers.length) {
    lines.push(`layers currently on this application: ${surface.existingLayers.join(', ')}`)
  }

  if (surface.anchors.length) {
    lines.push('', 'ANCHOR CANDIDATES — existing controls you can sit beside:')
    for (const a of surface.anchors) {
      const [x, y, w, h] = a.rect
      lines.push(
        `- "${a.label}" <${a.tag}> at ${x},${y} ${w}×${h}` +
        (a.cls ? `\n    class: ${a.cls}` : '') +
        (a.parentCls ? `\n    parent class: ${a.parentCls}` : '')
      )
    }
  } else {
    lines.push('', 'No labelled controls found — use a floating overlay.')
  }

  if (surface.landmarks.length) {
    lines.push('', 'LANDMARK CONTAINERS:')
    for (const l of surface.landmarks) {
      const [x, y, w, h] = l.rect
      lines.push(`- role="${l.role}" at ${x},${y} ${w}×${h}${l.cls ? ` class: ${l.cls}` : ''}`)
    }
  }

  return lines.join('\n')
}

export function useModAgent() {
  const {
    selectedApp, apiKey, messages,
    addMessage, updateLastMessage, setAgentWorking, setDraftCode,
  } = useAppStore()

  /**
   * Run one turn against the model.
   *
   * Reads the running application first, so the request the model answers
   * carries the DOM it is actually writing into.
   */
  const run = useCallback(async (
    instruction: string,
    history: ChatMessage[],
    pinnedTargetId?: string,
  ): Promise<{ content: string; targetId?: string }> => {
    const viaSpicetify = usesSpicetify(selectedApp?.name)

    setAgentWorking(true, {
      type: 'thinking',
      description: viaSpicetify
        ? 'reading the spicetify setup'
        : `reading ${selectedApp?.name.toLowerCase() ?? 'the application'}`,
      timestamp: Date.now(),
    })

    /* Spotify's branch. There is no window to probe — no debugger exists to ask
       — so what stands in for the surface report is the state of the user's own
       Spicetify install. It matters for the same reason the DOM reading does on
       the other path: it is the difference between writing against this setup
       and guessing, and it is where a missing Spicetify is caught before the
       model is asked to write something that could never be applied. */
    if (viaSpicetify) {
      let setup = ''
      try {
        const status = await api.spicetifyStatus()
        if (!status.installed) {
          throw new Error(
            status.reason || 'Spicetify is not available, so Spotify cannot be modified.',
          )
        }
        if (status.appStoreBuild) {
          throw new Error(
            'This is the App Store build of Spotify, which is sandboxed and cannot be ' +
            'patched. Install the desktop build from spotify.com to modify it.',
          )
        }
        setup =
          `SPICETIFY SETUP\n` +
          `version: ${status.version}\n` +
          `spotify: ${status.spotifyPath}\n` +
          `active theme: ${status.theme || 'none'} (the user's — never write to it)\n` +
          `their own extensions: ${(status.userExtensions || []).join(', ') || 'none'}\n` +
          `modifications Modable has already applied: ` +
          `${(status.mods || []).map(m => `${m.name} [${m.kind}]`).join(', ') || 'none'}`
      } catch (err) {
        setAgentWorking(false)
        throw err instanceof Error ? err : new Error('Could not read the Spicetify setup.')
      }

      setAgentWorking(true, {
        type: 'generating',
        description: 'writing a spicetify modification',
        timestamp: Date.now(),
      })

      const spotifyChat: ChatMessage[] = [
        { role: 'system', content: SPOTIFY_SYSTEM_PROMPT },
        ...history.slice(-6),
        { role: 'user', content: `${setup}\n\nRequest: ${instruction}` },
      ]

      let reply = ''
      setDraftCode('')
      await api.streamAgent({ apiKey: apiKey as string, messages: spotifyChat }, piece => {
        reply += piece
        setDraftCode(extractCode(reply, kindOf(reply)))
      })

      return { content: reply, targetId: undefined }
    }

    // A failed probe is not fatal — the model can still write a floating
    // overlay — but it is the difference between a native-looking control and
    // a guess, so it is worth saying when it is missing.
    let report = ''
    // The window this layer is being written against. It travels with the layer
    // so the write lands in the same window that was read, never another one.
    let targetId: string | undefined
    let probe: Awaited<ReturnType<typeof api.probeSurface>> | null = null
    try {
      probe = await api.probeSurface(pinnedTargetId)
    } catch {
      probe = null
    }
    /* Every app Modable launches shares one debug port. When another app holds
       it, the read and the write both land in that app's window — a Slack layer
       went into Notion, failed, and was "repaired" into something unrelated.
       Stop before writing anything, and say which app is in the way. */
    const owner = probe?.success ? probe.owner : null
    if (owner && selectedApp?.path && owner !== selectedApp.path) {
      const holder = owner.split('/').pop()?.replace(/\.app$/, '') || owner
      setAgentWorking(false)
      throw new Error(
        `Modable is connected to ${holder}, not ${selectedApp.name} — ${holder} is holding the debug port. ` +
        `Quit ${holder}, then launch ${selectedApp.name} from Modable and send this again.`,
      )
    }
    try {
      if (!probe) throw new Error('probe failed')
      if (probe.success && probe.surface) {
        report = formatSurface(probe.surface)
        targetId = probe.targetId
      } else {
        report = `SURFACE REPORT unavailable (${probe.error || 'the application did not answer'}). ` +
          `Write defensively and prefer a floating overlay.`
      }
    } catch (err) {
      report = `SURFACE REPORT unavailable (${err instanceof Error ? err.message : 'probe failed'}). ` +
        `Write defensively and prefer a floating overlay.`
    }

    setAgentWorking(true, {
      type: 'generating',
      description: `writing a layer for ${selectedApp?.name.toLowerCase() ?? 'the application'}`,
      timestamp: Date.now(),
    })

    // One short call through the same agent route, for the steps below that
    // need the model to read the request rather than write a layer.
    const ask = async (messages: ChatMessage[]) => {
      let out = ''
      await api.streamAgent({ apiKey: apiKey as string, messages }, piece => { out += piece })
      return out
    }

    // A request Modable has a hand-built layer for skips generation, but not the
    // read above: the layer still lands in the window that was just probed (or,
    // when the request names a channel or page, opens that first).
    const route = await routeCapability(selectedApp?.name, instruction, ask)
    const flagship = route ? flagshipFor(route, instruction) : null
    if (flagship) {
      // Only a configurable flagship (Ghost Channels) or a cross-app one has
      // prepare(): one call through the same agent route turns the request
      // into its settings. Every other flagship takes the branch exactly as
      // before. A cross-app layer is written into another app's window, so it
      // names that window instead of the one probed here.
      const layer = flagship.prepare
        ? await flagship.prepare(ask, {
            targetId,
            onStage: description => setAgentWorking(true, { type: 'generating', description, timestamp: Date.now() }),
          })
        : flagship
      setDraftCode(layer.code)
      return { content: layer.reply, targetId: ('targetId' in layer && layer.targetId) || targetId }
    }

    const chat: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-6),
      {
        role: 'user',
        content: `Target application: ${selectedApp?.name ?? 'unknown'}\n\n${report}\n\nRequest: ${instruction}`,
      },
    ]

    let content = ''
    setDraftCode('')
    await api.streamAgent({ apiKey: apiKey as string, messages: chat }, piece => {
      content += piece
      setDraftCode(extractCode(content))
    })

    return { content, targetId }
  }, [selectedApp, apiKey, setAgentWorking, setDraftCode])

  const generateMod = useCallback(async (userMessage: string) => {
    if (!selectedApp || !apiKey) return

    addMessage({ role: 'user', content: userMessage })
    addMessage({ role: 'assistant', content: '' })

    /* Importing audio is not a modification, and sending it to the model as one
       is how Modable shipped a top bar button that announced "2 MP3 file(s)
       uploaded" and moved nothing: an extension running inside Spotify cannot
       read a dropped file off disk or write into ~/Music. Only the Node side
       can, so this turn never reaches the model at all. */
    const filePath = extractAudioPath(userMessage)
    if (taskFor(selectedApp.name, userMessage, filePath) === 'spicetify-local-import') {
      setAgentWorking(true)
      try {
        if (!filePath) {
          updateLastMessage(
            'Point me at the file and I will put it in Spotify. Drag the MP3 into this box — ' +
              'that drops its path in as text — or type the full path, then send it again.'
          )
          return
        }
        const result = await api.localImport(filePath)
        if (!result.success) {
          updateLastMessage(`Could not import that file: ${result.error}`)
          return
        }
        const status = await api.localImportStatus()
        updateLastMessage(
          `Copied ${result.copied?.destination.split('/').pop()} into ${status.importsDir}. ` +
            'Your original is untouched.\n\nRestart Spotify, then use the folder button in the ' +
            'top bar to open Local Files. If the track is not listed, turn on Settings → ' +
            'Local Files → My Music; that is the source Spotify scans and Modable cannot set it for you.'
        )
      } catch (err) {
        updateLastMessage(`Could not import that file: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setAgentWorking(false)
      }
      return
    }

    // The transcript as the model should see it, captured before this turn.
    const history: ChatMessage[] = []
    for (const msg of messages) {
      if (msg.role === 'user') {
        history.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant' && msg.modPreview) {
        history.push({
          role: 'assistant',
          content: `Previous layer "${msg.modPreview.name}":\n\`\`\`javascript\n${msg.modPreview.code}\n\`\`\``,
        })
      }
    }

    try {
      const { content, targetId } = await run(userMessage, history)
      const channel = usesSpicetify(selectedApp.name) ? 'spicetify' : 'cdp'
      const mod = parseMod(content, channel === 'spicetify' ? kindOf(content) : 'js')

      if (mod) {
        setDraftCode(mod.code)
        // the layer block below carries the name and description, so the
        // line above it only needs to say the work is done
        updateLastMessage(
          channel === 'spicetify'
            ? `Built a ${mod.kind === 'css' ? 'visual' : 'behaviour'} modification for ${selectedApp.name}.`
            : `Built a layer for ${selectedApp.name}.`,
          { ...mod, targetId, channel },
        )
      } else {
        setDraftCode('')
        /* parseMod rejects anything cut off mid-write or that will not compile.
           Saying so beats letting it through to throw inside the application. */
        updateLastMessage(
          content
            ? 'The model did not return a complete, runnable layer. Run it again.'
            : 'The model returned nothing.',
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setDraftCode('')
      updateLastMessage(message)
    } finally {
      setAgentWorking(false)
    }
  }, [selectedApp, apiKey, messages, addMessage, updateLastMessage, setAgentWorking, setDraftCode, run])

  /**
   * Rewrite a layer that ran but did not take.
   *
   * The application is re-read first, so the second attempt answers the DOM as
   * it stands now rather than the reading that produced the miss.
   */
  const repairLayer = useCallback(async (
    failed: { name: string; code: string; targetId?: string },
    problem: string,
  ): Promise<{ name: string; description: string; code: string; targetId?: string; marks?: string[] } | null> => {
    if (!selectedApp || !apiKey) return null
    // A hand-built layer that did not take is reported as such, not rewritten
    // by the model into some other layer under a different name.
    if (isFlagshipCode(failed.code)) return null

    const history: ChatMessage[] = [{
      role: 'assistant',
      content: `Layer "${failed.name}":\n\`\`\`javascript\n${failed.code}\n\`\`\``,
    }]

    try {
      const { content, targetId } = await run(
        `That layer ran without throwing, but ${problem}. The anchor it chose was ` +
        `probably not present. Re-read the surface report above and rewrite it against ` +
        `an anchor genuinely listed there, falling back to a floating overlay if nothing ` +
        `suitable exists. Make sure every element it adds carries a data-modable attribute.`,
        history,
        failed.targetId,
      )

      const mod = parseMod(content)
      if (mod) {
        const repaired = { ...mod, targetId }
        setDraftCode(mod.code)
        updateLastMessage(`Reworked the layer for ${selectedApp.name}.`, repaired)
        return repaired
      }
      return null
    } catch (error) {
      updateLastMessage(error instanceof Error ? error.message : 'The rewrite failed.')
      return null
    } finally {
      setAgentWorking(false)
    }
  }, [selectedApp, apiKey, run, setDraftCode, updateLastMessage, setAgentWorking])

  return { generateMod, repairLayer }
}
