/*
 * Discord → Notion Project: the read half. Runs inside Discord and only reads.
 *
 * Called as (this)(want, openTarget): want = { channel?: string } is what the
 * request named; openTarget is the sidebar opener from capabilities.ts, used
 * only when the request names a real channel that is not already on screen.
 *
 * Which source, in order:
 *   1. a named Ghost Channel   — window.__modableGhostChannels, by label
 *   2. a named real channel    — opened through Discord's own sidebar
 *   3. the open Ghost Channel  — [data-modable="discord-ghost-channel-view"]
 *                                and its selected row .dgc-row.dgc-on[data-ghost]
 *   4. the visible channel     — /channels/<guild>/<channel>
 *
 * Anchors (checked live against the Discord renderer):
 *   li[id="chat-messages-<channel>-<message>"]   one rendered message
 *   #message-username-<id> [data-text]           author (absent on continuations)
 *   #message-timestamp-<id>[datetime]            ISO timestamp
 *   #message-content-<id>                        the text
 *   #message-reply-context-<id>                  what it replies to
 *   document.title "#channel | Server"           channel and server names
 * A Ghost Channel's results already carry each real message's id, channel,
 * author and time, read the same way — they are used as plain data.
 *
 * Nothing is clicked except a sidebar channel the request named; nothing is
 * written, posted or tagged.
 */
(function (want, openTarget) {
  want = want || {};
  var MAX = 150;

  function norm(s) {
    return String(s || '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9À-￿]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function parts() { return location.pathname.split('/'); }
  function guildId() { var g = parts()[2] || ''; return g === '@me' || /^\d+$/.test(g) ? g : ''; }
  function channelId() { var c = parts()[3] || ''; return /^\d+$/.test(c) ? c : ''; }
  function names() {
    var t = document.title || '';
    var m = t.match(/^(.*?)\s+\|\s+(.*)$/);
    var ch = (m ? m[1] : t).replace(/^#/, '').trim();
    return { channel: ch, server: m ? m[2].trim() : (guildId() === '@me' ? 'Direct Messages' : '') };
  }

  function cleanText(node) {
    if (!node) return '';
    var c = node.cloneNode(true);
    c.querySelectorAll('time').forEach(function (x) { (x.closest('[class^="timestamp"]') || x).remove(); });
    c.querySelectorAll('[aria-hidden="true"]').forEach(function (x) { x.remove(); });
    return (c.innerText || c.textContent || '').replace(/ /g, ' ').replace(/[​-‍⁠﻿]/g, '')
      .replace(/\s*\(edited\)\s*$/, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function ghostRegistry() { var r = window.__modableGhostChannels; return r && r.channels ? r : null; }
  function ghostByLabel(label) {
    var r = ghostRegistry(), g = guildId();
    if (!r) return null;
    return r.channels.filter(function (c) { return c.guild === g && norm(c.label) === norm(label); })[0] || null;
  }
  function openGhost() {
    var r = ghostRegistry();
    if (!r || !document.querySelector('[data-modable="discord-ghost-channel-view"]')) return null;
    var row = document.querySelector('.dgc-row.dgc-on[data-ghost]');
    var id = row && row.getAttribute('data-ghost');
    return (id && r.channels.filter(function (c) { return c.id === id; })[0]) || null;
  }

  // A Ghost Channel reads its sources when opened; wait for it to finish.
  async function ghostResults(ch) {
    var t0 = Date.now();
    while (!ch.results && Date.now() - t0 < 30000) await sleep(300);
    return ch.results;
  }

  function linksIn(text) {
    var out = [];
    String(text || '').replace(/https?:\/\/[^\s<>()"']+/g, function (u) {
      u = u.replace(/[.,;:!?)\]]+$/, '');
      if (out.indexOf(u) < 0) out.push(u);
      return u;
    });
    return out.map(function (u) { return { url: u, title: '' }; });
  }

  async function fromGhost(ch) {
    var results = await ghostResults(ch);
    if (!results) return { ok: false, reason: 'The Ghost Channel #' + ch.label + ' has not finished reading its sources. Open it, wait for its messages, then ask again.' };
    var n = names();
    var messages = results.map(function (r) { return r.m; }).filter(function (m) { return m && m.id && m.text; })
      .sort(function (a, b) { return a.t - b.t; }).slice(-MAX)
      .map(function (m) {
        return {
          id: String(m.id), channelId: String(m.channel), channelName: String(m.source || ''),
          author: String(m.author || 'Unknown'), bot: !!m.bot,
          timestamp: m.t ? new Date(m.t).toISOString() : '',
          text: String(m.text).slice(0, 1200),
          replyTo: m.replyName ? { author: String(m.replyName), messageId: '', text: String(m.replyText || '').slice(0, 200) } : null,
          links: linksIn(String(m.text)),
        };
      });
    return {
      ok: true,
      source: {
        app: 'discord', kind: 'ghost', serverId: ch.guild, serverName: n.server,
        channelId: '', channelName: ch.label, ghostLabel: ch.label, topic: ch.topic || '',
      },
      messages: messages,
    };
  }

  function insideReply(el) { return !!(el.closest && el.closest('[id^="message-reply-context-"]')); }

  function readRendered(cid) {
    var out = [];
    var prev = null;
    var n = names();
    document.querySelectorAll('li[id^="chat-messages-' + cid + '-"]').forEach(function (li) {
      var id = li.id.split('-').pop();
      if (!/^\d+$/.test(id)) return;
      var userEl = document.getElementById('message-username-' + id);
      var named = userEl && userEl.querySelector('[data-text]');
      var author = named ? named.getAttribute('data-text') : '';
      var bot = !!(userEl && userEl.parentElement && /\bAPP\b/.test(userEl.parentElement.innerText || ''));
      if (!author && prev) { author = prev.author; bot = prev.bot; }
      var stamp = document.getElementById('message-timestamp-' + id);
      var at = stamp ? Date.parse(stamp.getAttribute('datetime')) : NaN;
      var iso = !isNaN(at) ? new Date(at).toISOString() : (prev ? prev.timestamp : '');

      var content = null;
      li.querySelectorAll('[id="message-content-' + id + '"]').forEach(function (el) { if (!content && !insideReply(el)) content = el; });
      var text = cleanText(content);

      var links = [];
      li.querySelectorAll('a[href^="http"]').forEach(function (a) {
        if (insideReply(a)) return;
        var href = a.getAttribute('href');
        if (/^https:\/\/(?:cdn\.discordapp\.com\/(?:avatars|emojis|clan-badges|role-icons)|discord\.com\/channels\/)/.test(href)) return;
        if (links.some(function (l) { return l.url === href; })) return;
        var title = (a.textContent || '').replace(/\s+/g, ' ').trim();
        links.push({ url: href, title: title && title !== href ? title.slice(0, 160) : '' });
      });

      var rc = document.getElementById('message-reply-context-' + id);
      var replyTo = null;
      if (rc) {
        var rn = rc.querySelector('[data-text]');
        var rcont = rc.querySelector('[id^="message-content-"]');
        replyTo = {
          author: rn ? rn.getAttribute('data-text').replace(/^@/, '') : '',
          messageId: rcont ? rcont.id.replace('message-content-', '') : '',
          text: rcont ? cleanText(rcont).slice(0, 200) : '',
        };
      }

      var msg = {
        id: id, channelId: cid, channelName: n.channel, author: author || 'Unknown', bot: bot,
        timestamp: iso, text: text.slice(0, 1200), replyTo: replyTo, links: links.slice(0, 6),
      };
      prev = msg;
      if (msg.text || msg.links.length) out.push(msg);
    });
    return out.slice(-MAX);
  }

  async function settled(cid) {
    var sel = 'li[id^="chat-messages-' + cid + '-"]';
    var last = -1, stable = 0, t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      var n = document.querySelectorAll(sel).length;
      if (n > 0 && n === last) stable++; else stable = 0;
      last = n;
      if (stable >= 2) return n;
      await sleep(200);
    }
    return last;
  }

  async function fromChannel() {
    var g = guildId(), c = channelId();
    if (!g || !c) return { ok: false, reason: 'Discord is not showing a text channel. Open the channel to turn into a project, then ask again.' };
    await settled(c);
    var n = names();
    return {
      ok: true,
      source: { app: 'discord', kind: 'channel', serverId: g, serverName: n.server, channelId: c, channelName: n.channel },
      messages: readRendered(c),
    };
  }

  /*
   * A channel inside a collapsed category is not in the sidebar's DOM at all,
   * so the sidebar opener cannot click it. Discord hands its channel list a
   * model of the whole server (guildChannels) as a prop; read it as plain data
   * — no methods called — to find the channel's id, then go there through
   * Discord's own router (history + popstate), as message links do. The same
   * read Ghost Channels uses.
   */
  function channelIdByName(name) {
    var ul = document.querySelector('nav[aria-label$="(server)"] ul[aria-label="Channels"]');
    var fk = ul && Object.keys(ul).filter(function (k) { return k.indexOf('__reactFiber') === 0; })[0];
    var gc = null;
    for (var f = fk && ul[fk], i = 0; f && i < 40 && !gc; f = f.return, i++) {
      var p = f.memoizedProps;
      if (p && p.guildChannels && p.guildChannels.categories) gc = p.guildChannels;
    }
    if (!gc) return '';
    var hit = '';
    Object.keys(gc.categories).forEach(function (k) {
      var chs = gc.categories[k] && gc.categories[k].channels;
      if (!chs || hit) return;
      Object.keys(chs).forEach(function (id) {
        var rec = chs[id] && chs[id].record;
        if (hit || !rec || (rec.type !== 0 && rec.type !== 5) || !rec.name || rec.name === '___hidden___') return;
        if (norm(rec.name) === norm(name) && /^\d+$/.test(String(rec.id))) hit = String(rec.id);
      });
    });
    return hit;
  }

  async function openNamed(name) {
    try {
      await openTarget({ kind: 'channel', name: name, app: 'discord' });
      return;
    } catch (e) {
      var id = channelIdByName(name);
      if (!id) throw e;
      history.pushState(history.state, '', '/channels/' + guildId() + '/' + id);
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      var t0 = Date.now();
      while (Date.now() - t0 < 7000) {
        if (channelId() === id && norm(names().channel) === norm(name)) { await sleep(700); return; }
        await sleep(150);
      }
      throw new Error('Modable opened #' + name + ' but it did not finish loading.');
    }
  }

  async function main() {
    if (!guildId()) return { ok: false, reason: 'Discord is not showing a server or conversation.' };
    if (want.channel) {
      var named = ghostByLabel(want.channel);
      if (named) return fromGhost(named);
      if (norm(names().channel) !== norm(want.channel)) await openNamed(want.channel);
      return fromChannel();
    }
    var ghost = openGhost();
    if (ghost) return fromGhost(ghost);
    return fromChannel();
  }

  return main().catch(function (e) { return { ok: false, reason: (e && e.message) || String(e) }; });
})
