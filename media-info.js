// Shared identity/link helpers. The web prefix keeps existing YouTube storage IDs intact.
(() => {
  'use strict';
  function safeURL(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only ordinary HTTP/HTTPS page links are supported.');
    return url;
  }
  function pageURL(value) {
    const url = safeURL(value);
    url.searchParams.delete('framenote');
    return url.href;
  }
  function hash(value) {
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < value.length; i++) {
      const n = value.charCodeAt(i);
      a = Math.imul(a ^ n, 0x01000193);
      b = Math.imul(b ^ n, 0x85ebca6b);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  function webId(url, player) { return 'web:' + hash(JSON.stringify([pageURL(url), player.frame, player.key, player.source])); }
  function youtubeId(value) {
    const url = safeURL(value);
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    const id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|live)\/([A-Za-z0-9_-]+)/)?.[1];
    return id && /^[A-Za-z0-9_-]{6,100}$/.test(id) ? id : null;
  }
  function timestampURL(record, seconds) {
    const url = safeURL(record.url);
    if (record.source === 'web') {
      url.searchParams.set('framenote', `${record.videoId}:${Math.max(0, Number(seconds) || 0)}`);
    } else url.searchParams.set('t', `${Math.floor(Math.max(0, Number(seconds) || 0))}s`);
    return url.href;
  }
  function heading(node) {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim().slice(0, 10000);
    for (let parent = node?.parentElement; parent; parent = parent.parentElement || parent.getRootNode()?.host) {
      const headings = [...parent.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],figcaption,legend')];
      const caption = parent.matches('figure,fieldset') && headings.find(h => h.matches('figcaption,legend'));
      if (caption) return clean(caption.textContent);
      const before = headings.filter(h => !(h.closest('#framenote-root')) && (h.compareDocumentPosition(node) & 4));
      if (before.length) return clean(before.at(-1).textContent);
      if (parent === document.body || parent === document.documentElement) break;
    }
    return clean(document.querySelector('h1,[role="heading"][aria-level="1"]')?.textContent);
  }
  function elements(selector, root = document) {
    const found = [...root.querySelectorAll(selector)];
    // Custom players often put their media element inside an open shadow root.
    for (const node of root.querySelectorAll('*')) if (node.shadowRoot) found.push(...elements(selector, node.shadowRoot));
    return found;
  }
  globalThis.FrameNoteMedia = { safeURL, pageURL, hash, webId, youtubeId, timestampURL, heading, elements };
})();
