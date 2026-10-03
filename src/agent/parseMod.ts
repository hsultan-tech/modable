/**
 * Reading the model's reply.
 *
 * Split out of useModAgent so it can be tested without React or the store, and
 * because this is the last point at which a bad layer can be stopped: whatever
 * parseMod returns is what gets evaluated inside somebody's running Slack.
 */

/** Mid-stream: the javascript so far, fence markers stripped. Deliberately
 *  permissive — the closing fence has not arrived yet, and this only feeds the
 *  buffer the user watches fill. Never use it to decide what to inject. */
const OPEN_FENCE = /```(?:javascript|js)?\s*\n?([\s\S]*?)(?:```|$)/;

/** Finished reply: the fence must actually be closed. An unterminated fence is
 *  how a cut-off response looks, and the permissive form above accepts it —
 *  which is what let half-written code reach the application. */
const CLOSED_FENCE = /```(?:javascript|js)?\s*\n?([\s\S]*?)```/;

/** The Spotify path also writes stylesheets. A stylesheet is a different fence
 *  and must not go through the JavaScript compile check below — valid CSS is
 *  not valid JS, so checking it that way would reject every visual mod. */
const OPEN_CSS_FENCE = /```css\s*\n?([\s\S]*?)(?:```|$)/;
const CLOSED_CSS_FENCE = /```css\s*\n?([\s\S]*?)```/;

/** How a modification is expressed. css only ever comes from the Spicetify
 *  path; the CDP path is always js. */
export type ModKind = 'js' | 'css';

export interface ParsedMod {
  name: string;
  description: string;
  code: string;
  kind: ModKind;
  /** The data-modable values this layer claims it will tag its nodes with.
   *  Verification is scoped to these, so a leftover mark from an earlier layer
   *  cannot stand in as proof that this one worked. */
  marks: string[];
}

/**
 * The data-modable names a layer says it will leave behind.
 *
 * Read off the source rather than asked for separately, because the source is
 * the thing that actually runs. Covers the three ways the prompt and the models
 * in practice write the tag; the bare `[data-modable]` selector in the wipe line
 * has no value and so is correctly ignored.
 */
export function extractMarks(code: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /setAttribute\(\s*['"`]data-modable['"`]\s*,\s*['"`]([^'"`]+)['"`]/g,
    /data-modable\s*=\s*\\?['"`]([^'"`\\]+)/g,
    /\.dataset\.modable\s*=\s*['"`]([^'"`]+)['"`]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const v = m[1].trim();
      if (v) found.add(v);
    }
  }
  return [...found];
}

export function extractCode(raw: string, kind: ModKind = 'js'): string {
  const match = raw.match(kind === 'css' ? OPEN_CSS_FENCE : OPEN_FENCE);
  return match ? match[1] : '';
}

/**
 * Does this parse as JavaScript?
 *
 * Compiled, never called — `new Function` throws on a syntax error without
 * running a line of the body. A layer that cannot compile can only throw inside
 * the target application, so it is not worth injecting to find out.
 */
export function isSyntacticallyValid(code: string): boolean {
  try {
    new Function(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a finished response.
 *
 * The prompt asks for labelled lines plus a javascript block, which streams
 * legibly. Older replies came back as JSON with the code escaped onto one line,
 * so that shape is still accepted.
 *
 * Returns null for anything that is not a complete, compilable layer.
 */
export function parseMod(raw: string, expected: ModKind = 'js'): ParsedMod | null {
  /* A stylesheet has no compile check to pass — the bar it has to clear is that
     the fence actually closed, which is still the thing that separates a
     finished reply from one the model was cut off mid-way through. */
  if (expected === 'css') {
    const css = raw.match(CLOSED_CSS_FENCE);
    const text = css ? css[1].trim() : '';
    if (!text) return null;
    return {
      name: raw.match(/^\s*NAME:\s*(.+)$/m)?.[1].trim() || 'Untitled modification',
      description: raw.match(/^\s*DESCRIPTION:\s*(.+)$/m)?.[1].trim() || '',
      code: text,
      kind: 'css',
      marks: [],
    };
  }

  const json = raw.match(/```json\s*([\s\S]*?)\s*```/);
  if (json) {
    try {
      const parsed = JSON.parse(json[1]);
      const code = parsed.code || parsed.js;
      // Same bar as the fenced form: a JSON-wrapped layer that will not compile
      // is no safer for having been quoted.
      if (code && isSyntacticallyValid(code)) {
        return {
          name: parsed.name || 'Untitled layer',
          description: parsed.description || '',
          code,
          kind: 'js',
          marks: extractMarks(code),
        };
      }
      if (code) return null;
    } catch {
      // fall through to the labelled form
    }
  }

  const match = raw.match(CLOSED_FENCE);
  const code = match ? match[1].trim() : '';
  if (!code) return null;
  if (!isSyntacticallyValid(code)) return null;

  return {
    name: raw.match(/^\s*NAME:\s*(.+)$/m)?.[1].trim() || 'Untitled layer',
    description: raw.match(/^\s*DESCRIPTION:\s*(.+)$/m)?.[1].trim() || '',
    code,
    kind: 'js',
    marks: extractMarks(code),
  };
}
