// API client for Modable - works in both Electron and web modes

const API_BASE = '/api';

export interface App {
  name: string;
  path: string;
  icon: string;
  version: string;
  isElectron: boolean;
  hasMods?: boolean;
  modCount?: number;
  /** Which path modifies this app. Absent from older responses, all of which
   *  are CDP. */
  channel?: 'cdp' | 'spicetify';
  /** Whether that path is usable right now — not a synonym for isElectron. */
  reachable?: boolean;
  blockedBecause?: string | null;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/** One control the target app already draws, usable as an anchor. */
export interface SurfaceAnchor {
  label: string;
  tag: string;
  cls: string;
  parentCls: string;
  /** [x, y, width, height] in viewport pixels */
  rect: [number, number, number, number];
}

/** A reading of the target app's live DOM, taken just before generating. */
export interface Surface {
  title: string;
  url: string;
  viewport: { w: number; h: number };
  background: string | null;
  foreground: string | null;
  backgroundLuminance: number | null;
  /** Whether the app is already dark. null when nothing opaque was found. */
  darkNow: boolean | null;
  fontFamily: string;
  inverted: boolean;
  anchors: SurfaceAnchor[];
  landmarks: { role: string; cls: string; rect: [number, number, number, number] }[];
  existingLayers: string[];
}

export interface ProbeResult {
  success: boolean;
  error?: string;
  surface?: Surface;
  /** The exact CDP target this reading came from. Every write in the same run
   *  must quote it back, so a layer cannot land in a different window. */
  targetId?: string;
  /** The .app bundle listening on the debug port, when the OS could say. */
  owner?: string | null;
  page?: { title: string; url: string };
}

/** The destination window of a cross-app handoff. */
export interface HandoffTarget {
  success: boolean;
  error?: string;
  targetId?: string;
  title?: string;
  url?: string;
  dark?: boolean;
  port?: number;
}

export interface InjectResult {
  success: boolean;
  error?: string;
  /** Whether marks belonging to THIS layer are on the page — the real proof it
   *  took. A leftover mark from an earlier layer no longer satisfies it. */
  verified?: boolean;
  elements?: number;
  marks?: string[];
  /** Which of the layer's own claimed marks were found. */
  matched?: string[];
  /** What was already on the page before this layer ran. */
  before?: string[];
  result?: unknown;
}

export interface RevertResult {
  success: boolean;
  error?: string;
  reverted?: boolean;
  removed?: number;
  stripped?: string[];
  remaining?: number;
  note?: string;
}

/** The state of the Modable Imports folder and how Spotify reaches it. */
export interface LocalImportStatus {
  success: boolean;
  importsDir: string;
  musicLibrary: string;
  exists: boolean;
  /** The load-bearing fact: the folder is inside ~/Music, which Spotify's own
   *  "My Music" source already scans. Nothing is written to Spotify's config. */
  insideMusicLibrary: boolean;
  trackCount: number;
  tracks: string[];
  mechanism: string;
  error?: string;
}

export interface LocalImportResult {
  success: boolean;
  stage: 'detect' | 'copy' | 'write' | 'apply' | 'import' | 'done';
  error?: string;
  note?: string;
  copied?: {
    source: string;
    destination: string;
    bytes: number;
    /** Always true on success — the file the user supplied is copied, never moved. */
    originalIntact: boolean;
  };
  extension?: string;
  restartRequired?: boolean;
}

export interface LocalImportRevertResult {
  success: boolean;
  removedExtensions: string[];
  deletedTracks: string[];
  keptTracks: string[];
  keptBecause: string;
  untouched: string[];
  error?: string;
}

/** One modification Modable has written into Spotify through Spicetify. */
export interface SpicetifyMod {
  slug: string;
  file: string;
  name: string;
  kind: 'css' | 'js';
  description: string;
  appliedAt: number | null;
  /** On disk and listed in the config. A file present but unlisted is inert. */
  enabled: boolean;
}

/**
 * Spotify's route into Modable, and the state of the user's own setup.
 *
 * `installed: false` is the routing guard: without a working Spicetify there is
 * no way to modify Spotify at all, since it exposes no debugger for the CDP
 * path to attach to.
 */
export interface SpicetifyStatus {
  success: boolean;
  error?: string;
  installed: boolean;
  reason?: string;
  version?: string;
  configPath?: string;
  spotifyPath?: string;
  spotifyFound?: boolean;
  appStoreBuild?: boolean;
  /** The installed Spotify, and the version Spicetify's backup was taken from.
   *  Spotify updates itself, which strands the backup and makes every apply
   *  fail until a fresh one is taken. */
  spotifyVersion?: string | null;
  backupVersion?: string;
  backupMissing?: boolean;
  backupStale?: boolean;
  /** Repairable without the user doing anything — not the same as unusable. */
  needsBackup?: boolean;
  /** The user's own theme and custom apps. Modable never writes either. */
  theme?: string;
  customApps?: string[];
  extensions?: string[];
  userExtensions?: string[];
  modableExtensions?: string[];
  mods?: SpicetifyMod[];
}

export interface SpicetifyApplyResult {
  success: boolean;
  error?: string;
  /** Where it went wrong: detect, write, config or apply. */
  stage?: string;
  /** The CLI invocation that failed, and everything it printed. */
  command?: string;
  output?: string;
  verified?: boolean;
  slug?: string;
  file?: string;
  kind?: 'css' | 'js';
  note?: string;
  /** Set when Modable had to re-take Spicetify's backup before it could apply,
   *  because Spotify had updated itself underneath. */
  repairedBackup?: string | null;
  userExtensions?: string[];
}

export interface SpicetifyRevertResult {
  success: boolean;
  error?: string | null;
  reverted?: boolean;
  removed?: string[];
  /** Should always be empty after a full revert — the proof it was complete. */
  remainingModable?: string[];
  /** Should be unchanged by any revert — the proof it was not too broad. */
  userExtensions?: string[];
  theme?: string;
  customApps?: string[];
  note?: string;
  output?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** One frame of the model's SSE stream, or an error raised mid-stream. */
interface StreamFrame {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
  modableError?: string;
}

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electron !== undefined;

/**
 * The app the user has selected, which names the debugging session a call
 * belongs to. Imported lazily: the store touches localStorage as it loads,
 * and this module is also loaded where there is none (tests, the server's
 * type checks).
 */
async function selectedAppPath(): Promise<string | undefined> {
  const { useAppStore } = await import('./stores/projectStore');
  return useAppStore.getState().selectedApp?.path;
}

console.log('[API] Environment check - isElectron:', isElectron, 'window.electron:', typeof window !== 'undefined' ? window.electron : 'N/A');

export const api = {
  async getApps(): Promise<{ success: boolean; apps: App[] }> {
    console.log('[API] getApps() called, isElectron:', isElectron);
    if (isElectron) {
      // Use Electron IPC
      console.log('[API] Using Electron IPC');
      const result = await window.electron.getInstalledApps();
      return { success: result.success, apps: result.apps || [] };
    } else {
      // Use HTTP API
      console.log('[API] Using HTTP fetch to', `${API_BASE}/apps`);
      const res = await fetch(`${API_BASE}/apps`);
      const data = await res.json();
      console.log('[API] HTTP response:', data);
      return data;
    }
  },

  /**
   * Start the app under its own debugging session, or reuse the one it has.
   *
   * Always the server, never Electron IPC: sessions are resolved in one place
   * (lib/sessions.js). The IPC copy in electron/main.ts assumed one shared
   * port, so with Discord on it, selecting Notion read as "Discord is
   * connected" and every Notion layer was refused.
   */
  async launchWithDebugger(appPath: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const res = await fetch(`${API_BASE}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appPath }),
    });
    return res.json();
  },

  /** Whether the selected app's own session is up — not whether any app is. */
  async isDebuggerReady(appPath?: string): Promise<{ success: boolean; ready: boolean; pageCount: number }> {
    const app = appPath ?? await selectedAppPath()
    const res = await fetch(`${API_BASE}/debugger/status${app ? `?app=${encodeURIComponent(app)}` : ''}`);
    return res.json();
  },

  /**
   * Write a layer into the target app and report whether it took hold.
   *
   * Always the server, never Electron IPC. The IPC handler evaluated the code
   * but never read the result back, so it answered without `verified` — which
   * downstream is indistinguishable from "nothing appeared", and sent every
   * successful layer through a pointless repair and a second injection. There
   * is no fallback being given up here: probing and generating are HTTP-only,
   * so a layer cannot exist unless the server is already reachable.
   */
  async injectCode(code: string, targetId?: string, marks?: string[]): Promise<InjectResult> {
    const res = await fetch(`${API_BASE}/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, targetId, marks }),
    });
    return res.json();
  },

  /**
   * Take a failed layer back off the application.
   *
   * Removes the nodes the layer added and any modable-* class it left on
   * documentElement. It cannot undo changes a layer made to the application's
   * own elements — see revertScript in server.js.
   */
  async revertLayer(targetId?: string, marks?: string[]): Promise<RevertResult> {
    const res = await fetch(`${API_BASE}/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, marks }),
    });
    return res.json();
  },

  /**
   * Spotify's path, and only Spotify's.
   *
   * The three calls below never touch the CDP endpoints above: Spotify has no
   * debugger to attach to, so its modifications are files applied by the
   * Spicetify CLI. Everything else in Modable is unaffected by them.
   */
  async spicetifyStatus(): Promise<SpicetifyStatus> {
    const res = await fetch(`${API_BASE}/spicetify/status`);
    return res.json();
  },

  async spicetifyApply(mod: {
    name: string;
    description?: string;
    kind: 'css' | 'js';
    code: string;
  }): Promise<SpicetifyApplyResult> {
    const res = await fetch(`${API_BASE}/spicetify/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mod),
    });
    return res.json();
  },

  /** Omit the slug to remove every Modable modification, and nothing else. */
  async spicetifyRevert(slug?: string): Promise<SpicetifyRevertResult> {
    const res = await fetch(`${API_BASE}/spicetify/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
    return res.json();
  },

  /**
   * Local files: audio the user owns, not code Modable wrote.
   *
   * Kept beside the Spicetify calls because it is the same target application,
   * but it is a different operation with a different revert — see
   * lib/localImport.js.
   */
  async localImportStatus(): Promise<LocalImportStatus> {
    const res = await fetch(`${API_BASE}/spicetify/import/status`);
    return res.json();
  },

  async localImport(sourcePath: string): Promise<LocalImportResult> {
    const res = await fetch(`${API_BASE}/spicetify/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath }),
    });
    return res.json();
  },

  /** The imported audio stays unless removeImportedAudio is asked for: it is
   *  the user's music, sitting in their own Music library. */
  async localImportRevert(removeImportedAudio = false): Promise<LocalImportRevertResult> {
    const res = await fetch(`${API_BASE}/spicetify/import/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeImportedAudio }),
    });
    return res.json();
  },

  /**
   * Cross-app handoff (lib/handoff.js). handoffRead evaluates Modable's own
   * read-only extraction in the source window this run probed; handoffNotion
   * puts Notion on the handoff port and names its visible document window.
   */
  async handoffRead<T = unknown>(targetId: string, code: string): Promise<{ success: boolean; error?: string; result?: T }> {
    const res = await fetch(`${API_BASE}/handoff/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, code }),
    });
    return res.json();
  },

  async handoffNotion(): Promise<HandoffTarget> {
    const res = await fetch(`${API_BASE}/handoff/notion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    return res.json();
  },

  /**
   * Read the target app's live DOM so the model can write against it.
   *
   * Pass the targetId of an earlier reading to re-read that same window — what a
   * repair wants, so the second attempt answers the DOM the first one missed in.
   */
  async probeSurface(targetId?: string, appPath?: string): Promise<ProbeResult> {
    // Unpinned, the read goes to the named app's own session.
    const res = await fetch(`${API_BASE}/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, app: appPath ?? await selectedAppPath() }),
    });
    return res.json();
  },

  /**
   * Stream a completion through the local server.
   *
   * Never call the model from the renderer directly: there the request is at the
   * mercy of content blockers, extensions and CSP, all of which surface as an
   * unactionable "Connection error". The server reports why it failed.
   */
  async streamAgent(
    request: { apiKey: string; messages: ChatMessage[]; model?: string },
    onDelta: (piece: string) => void,
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      let message = `The agent service returned ${res.status}.`;
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        // no JSON body — keep the status-code message
      }
      throw new Error(message);
    }
    if (!res.body) throw new Error('The agent service returned an empty response.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      // Server-sent events arrive as frames separated by a blank line. The last
      // piece is usually a partial frame, so it stays in the buffer.
      const frames = pending.split('\n\n');
      pending = frames.pop() ?? '';

      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let parsed: StreamFrame;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue; // frame split mid-flight; the next read completes it
          }
          if (parsed.modableError) throw new Error(parsed.modableError);

          /* The model ran out of room mid-sentence. Nothing downstream can tell
             a truncated layer from a finished one by looking at the text — the
             code fence is simply never closed — so it has to be caught here,
             where the reason is actually reported. */
          if (parsed.choices?.[0]?.finish_reason === 'length') {
            throw new Error(
              'The model hit its length limit and the layer was cut off mid-write. ' +
              'Ask for something smaller, or run it again.',
            );
          }

          const piece = parsed.choices?.[0]?.delta?.content;
          if (piece) onDelta(piece);
        }
      }
    }
  },
};

