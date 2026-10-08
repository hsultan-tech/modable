# Modable

**Prompt new features into the apps you already use.**

Modable is Cursor for desktop apps.

Pick an app. Describe what you want. Modable reads the running interface and writes a new layer directly into it.

```
› turn this Notion page into a spatial canvas
› make me a Discord channel about AI agents
› add a floating clock to Slack
› turn this Discord channel into a Notion project
```

[![Modable demo: Notion Spatial Mode and Discord Ghost Channels](docs/assets/demo-thumbnail.jpg)](https://github.com/hsultan-tech/modable/releases/download/launch-demo/modable-demo.mp4)

<sub>▶ Watch the demo (80 s)</sub>

<br>

## Your apps aren't finished.

Apps ship with the features their developers chose to build. Modable lets you add your own.

You write a prompt. Modable inspects the live app, then either picks a tested built-in layer or writes a new one for exactly what's on screen, and injects it. It checks that the layer actually landed, and takes it back off if it didn't, or whenever you're done with it.

<br>

## What you can build

These ship with Modable and are tested against the real apps. They're a starting point.

**Notion Spatial Mode**<br>
Turns a page into a canvas of draggable section cards you can pan, zoom and connect. Exit Spatial puts the page back as it was.

**Discord Ghost Channels**<br>
Ask for a topic and get a new local channel filled with the server's matching messages, each linked to the original. Nothing is posted.

**Discord → Notion Project**<br>
Reads the channel on screen and lays it out in Notion as tasks, decisions, blockers and open questions, each linked back to its Discord message.

**Slack Command Center**<br>
Sorts a channel into decisions, action items, blockers and open questions.

**Discord Conversation Map**<br>
Untangles a busy channel into its separate conversations, joined by real replies.

### Or ask for something nobody built

If a request doesn't match a built-in layer, Modable generates a new one against the live interface. A clock in the header, a word count, a theme toggle, a button the app never had. Generated layers go through the same inject, verify and revert steps as the built-in ones.

<br>

## How it works

```
prompt → inspect → select or generate → inject → verify → revert
```

1. **Inspect.** Modable connects to the running app and reads its live interface: what's on screen, and where a new control can be anchored.
2. **Select or generate.** The request is matched against the built-in layers for that app. A confident match runs the hand-built layer. Anything else goes to the model, which writes a layer anchored to that reading of the interface.
3. **Inject.** The layer runs inside the app's window. For Electron apps, nothing on disk changes, and the installed app is never rewritten.
4. **Verify.** Modable checks that every element the layer claims to have placed is on the page. A partial layer counts as a failure and is reverted, never left half-applied.
5. **Revert.** Removing a layer takes off everything it added.

Layers are isolated, so multiple modifications can coexist in the same app. Re-running one replaces only that layer.

Several apps can be connected at once, each on its own session.

<br>

## Getting started

You need macOS, Node.js 18+, an [OpenAI API key](https://platform.openai.com/api-keys), and the apps you want to modify installed in `/Applications`.

```bash
git clone https://github.com/hsultan-tech/modable.git
cd modable
npm install
npm run electron:dev
```

This opens Modable and starts its local backend. Paste your OpenAI key when asked. It stays in the app's local storage and is sent only to OpenAI, through the local backend. You can change it later from the profile menu.

<br>

## Supported apps

Modable is built to modify running desktop apps. Generic modification currently targets apps it can reach over the Chrome DevTools Protocol, which in practice means Electron apps. Spotify isn't Electron, so it goes through a [Spicetify](https://spicetify.app) adapter.

| App | Status |
| --- | --- |
| Notion | Tested: Spatial Mode, Discord → Notion Project, generated layers |
| Discord | Tested: Ghost Channels, Conversation Map, generated layers |
| Slack | Tested: Command Center, generated layers |
| Spotify | Through Spicetify, which must be installed. The App Store build can't be patched. |
| VS Code, Figma, Obsidian, WhatsApp, Telegram | Detected if installed. Generated layers work only if the installed build is Electron. Not individually tested. |

Modable shows which of your installed apps it can reach. For any it can't, it says why.

<br>

## Development

```bash
npm test               # vitest, single run
npm run test:watch     # vitest, watch mode
npm run typecheck      # tsc --noEmit
npm run build          # web build into dist/
npm run electron:build # desktop build, packaged by electron-builder into release/
```

To run the UI in a browser instead of Electron:

```bash
npm run server   # backend on http://localhost:3456
npm run dev      # UI on http://localhost:5173
```

### Under the hood

**Sessions.** Each app gets its own Chrome DevTools Protocol port in the range 9222–9241. The session table is read from the OS (`lsof`) whenever it's needed, so an app that quits drops out without affecting the others. If an app is running without a debugging port, Modable quits it and relaunches it with one.

**Model.** Generated layers come from OpenAI (`gpt-4o` by default). The backend on port 3456 relays the request.

**Layer ownership.** Each generated layer is wrapped in a harness that gives it a stable id from its name. The harness narrows the layer's selectors to its own nodes, stamps everything it creates, and registers a teardown that removes only what it owns. Verification, rollback and repair all act on that id. Built-in layers clean up only their own prefix.

**Revert scope.** Revert removes the nodes a layer added. Edits a layer made to the app's own existing elements have nothing to restore from, so reloading the app clears those.

**Spotify.** Spicetify patches Spotify's bundle on disk. Modable writes its own `modable-*.js` extensions next to yours and runs `spicetify apply`. It never touches your theme or your other extensions.

### Troubleshooting

If the window never appears and you see `Cannot read properties of undefined (reading 'whenReady')`, your shell has `ELECTRON_RUN_AS_NODE` set (VS Code terminals do this). Run:

```bash
env -u ELECTRON_RUN_AS_NODE npm run electron:dev
```

### Layout

```
electron/         Electron main process and preload; starts the backend
server.js         Local backend: app discovery, sessions, probe, inject, verify, revert, model proxy
lib/              Backend modules: sessions, verify, handoff, Spicetify adapter
src/agent/        Routing, built-in layers (src/agent/layers/), layer ownership, agent loop
src/components/   UI
test/             Vitest suites
```
