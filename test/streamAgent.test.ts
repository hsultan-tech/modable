import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../src/api';

/** A fake /api/agent response that emits the given SSE frames. */
function sseResponse(frames: string[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(new TextEncoder().encode(f));
      controller.close();
    },
  });
  return { ok: true, body } as unknown as Response;
}

const delta = (c: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: c }, finish_reason: null }] })}\n\n`;
const finish = (reason: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason } ] })}\n\n`;

afterEach(() => vi.unstubAllGlobals());

describe('streamAgent — truncation', () => {
  it('throws when the model stops because it ran out of room', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse([delta('(function(){ var a'), finish('length')]),
    ));

    await expect(
      api.streamAgent({ apiKey: 'k', messages: [{ role: 'user', content: 'hi' }] }, () => {}),
    ).rejects.toThrow(/length limit/);
  });

  it('completes normally when the model finished on its own', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse([delta('(function(){})();'), finish('stop'), 'data: [DONE]\n\n']),
    ));

    let out = '';
    await api.streamAgent(
      { apiKey: 'k', messages: [{ role: 'user', content: 'hi' }] },
      p => { out += p; },
    );
    expect(out).toBe('(function(){})();');
  });
});

describe('injectCode — quotes the pin back to the server', () => {
  it('sends the targetId it was given', async () => {
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, verified: true }) }) as unknown as Response);
    vi.stubGlobal('fetch', spy);

    await api.injectCode('(function(){})();', 'MAIN');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/inject');
    expect(JSON.parse(init.body as string).targetId).toBe('MAIN');
  });
});
