// Runs in each permitted frame; only the top frame renders the annotation panel.
(() => {
  'use strict';
  if (globalThis.__frameNoteMediaLoaded) return;
  globalThis.__frameNoteMediaLoaded = true;
  let players = new Map();
  function scan() {
    const media = FrameNoteMedia.elements('video,audio');
    players = new Map(media.map((node, index) => {
      const key = node.id && media.filter(m => m.id === node.id).length === 1 ? `${node.tagName.toLowerCase()}:id:${node.id}` : `${node.tagName.toLowerCase()}:index:${index}`;
      return [key, node];
    }));
    return [...players].map(([key, node]) => {
      const rect = node.getBoundingClientRect();
      let source = '';
      try {
        const url = new URL(node.currentSrc || node.getAttribute('src') || node.querySelector('source')?.src || '', location.href);
        if (/^https?:$/.test(url.protocol) && (node.currentSrc || node.getAttribute('src') || node.querySelector('source'))) source = url.origin + url.pathname;
      } catch { /* blob streams intentionally use the page and element identity */ }
      return { key, source, kind: node.tagName.toLowerCase(), heading: FrameNoteMedia.heading(node),
        label: (node.getAttribute('aria-label') || node.title || '').slice(0, 1000),
        playing: !node.paused && !node.ended, visible: node.getClientRects().length > 0,
        area: Math.max(0, Math.min(rect.right, innerWidth) - Math.max(0, rect.left)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top)) };
    });
  }
  function captions(node) {
    const lines = [];
    for (const track of node.textTracks || []) {
      if (track.mode === 'disabled' || !['captions', 'subtitles'].includes(track.kind)) continue;
      for (const cue of track.activeCues || []) {
        const text = typeof cue.getCueAsHTML === 'function' ? cue.getCueAsHTML().textContent : cue.text;
        if (text?.trim()) lines.push(text.trim());
      }
    }
    if (!lines.length) {
      // Known DOM caption renderers, scoped to this player's nearest container.
      const selector = '.ytp-caption-segment,.vjs-text-track-cue,.plyr__caption,.jw-text-track-cue,.vp-captions .captions-text';
      let parent = node.parentElement;
      while (parent) {
        const nodes = [...parent.querySelectorAll(selector)].filter(el => el.getClientRects().length > 0);
        if (nodes.length) { lines.push(...nodes.map(el => el.textContent.trim()).filter(Boolean)); break; }
        if (parent.querySelectorAll('video,audio').length > 1) break;
        parent = parent.parentElement;
      }
    }
    return [...new Set(lines)].join(' ').replace(/\s+/g, ' ').trim().slice(0, 200000);
  }
  async function announce() {
    const items = scan();
    // Avoid waking the service worker on pages without players.
    if (!items.length && !announce.hadPlayers) return;
    announce.hadPlayers = items.length > 0;
    try { await chrome.runtime.sendMessage({ type: 'FRAMENOTE_MEDIA_ANNOUNCE', players: items, frameUrl: location.href }); }
    catch { /* extension reload or a top frame which is not yet ready */ }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'FRAMENOTE_MEDIA_LOCAL') return;
    try {
      scan();
      const node = players.get(message.key);
      if (!node?.isConnected) throw new Error('This player is no longer available. Choose a player again.');
      if (message.action === 'seek') {
        const seconds = Number(message.seconds);
        if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid timestamp.');
        const seek = () => {
          node.currentTime = seconds;
          node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        if (node.readyState === 0) node.addEventListener('loadedmetadata', seek, { once: true });
        else seek();
      } else if (message.action !== 'capture') throw new Error('Unknown player action.');
      respond({ ok: true, value: { seconds: Math.round((Number(node.currentTime) || 0) * 10) / 10, caption: captions(node) } });
    } catch (error) { respond({ ok: false, error: error.message }); }
  });
  for (const event of ['play', 'pause', 'loadedmetadata', 'emptied']) document.addEventListener(event, announce, true);
  setInterval(announce, 2000);
  announce();
})();
