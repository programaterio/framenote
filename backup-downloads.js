// Backups use ordinary browser downloads. No directory handles or native helper.
(() => {
  'use strict';
  const STATE = 'framenote:backup:state';
  const MANUAL = 'framenote:backup:manual';
  const SETTINGS = 'framenote:backup:settings';
  const POLICY = 'browser-downloads-v1';
  const PREFIX = 'FrameNote/';
  let choosingManualFile = false;
  const month = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const leaf = path => String(path || '').split(/[\\/]/).at(-1);
  const parent = path => String(path || '').replace(/[\\/][^\\/]*$/, '');
  const save = state => chrome.storage.local.set({ [STATE]: state });
  async function payload() {
    const videos = FrameNoteData.videos(await chrome.storage.local.get(null));
    const text = JSON.stringify({ format: 'framenote-backup', version: 1, exportedAt: new Date().toISOString(), videos }, null, 2);
    if (new TextEncoder().encode(text).length > FrameNoteData.MAX_BYTES) throw new Error('Backup exceeds the 20 MB restore limit. Export individual items from the annotation panel.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(videos)));
    return { videos, url: `data:application/json;charset=utf-8,${encodeURIComponent(text)}`,
      fingerprint: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
  }
  async function reconcile(state) {
    if (!state.pending) return state;
    const pending = state.pending;
    const [item] = await chrome.downloads.search({ id: pending.id });
    if (item?.state === 'in_progress') return state;
    state = { ...state, pending: null };
    if (item?.state !== 'complete' || item.exists === false || item.byExtensionId !== chrome.runtime.id) {
      state.error = `Backup did not finish: ${item?.error || 'download missing or interrupted'}. It will retry automatically.`;
      await save(state);
      return state;
    }
    state.error = null;
    if (pending.kind === 'current') {
      const name = leaf(item.filename);
      state = { ...state, currentId: item.id, fingerprint: pending.fingerprint,
        currentName: /^framenote-current(?: \(\d+\))?\.json$/.test(name) ? name : pending.name,
        lastSuccess: new Date().toISOString(), lastFilename: item.filename };
    } else {
      state.months = { ...state.months, [`${pending.period}|${parent(item.filename)}`]: { id: item.id, filename: item.filename } };
      state.monthlyFilename = item.filename;
    }
    await save(state);
    return state;
  }
  async function start(state, data, kind, name, period) {
    state = { ...state, lastAttempt: new Date().toISOString(), error: null };
    await save(state);
    try {
      const id = await chrome.downloads.download({ url: data.url, filename: PREFIX + name,
        // First use preserves files from older installs. Later writes replace this install's current file.
        conflictAction: kind === 'current' && state.currentName ? 'overwrite' : 'uniquify', saveAs: false });
      state.pending = { id, kind, name, period, fingerprint: data.fingerprint };
      await save(state);
      return { pending: true, id };
    } catch (error) {
      await save({ ...state, pending: null, error: error.message });
      throw error;
    }
  }
  async function automatic(force = false) {
    const stored = await chrome.storage.local.get(null);
    let state = stored[STATE];
    if (state?.policy !== POLICY) { state = { policy: POLICY, months: {}, pending: null }; await save(state); }
    state = await reconcile(state);
    if (state.pending) return { pending: true };
    if (!force && stored[SETTINGS]?.enabled !== true) return { skipped: true };
    if (!force && state.error && Date.now() - Date.parse(state.lastAttempt) < 5 * 60 * 1000) return { skipped: true };
    try {
      const data = await payload();
      // A new empty installation must not replace an earlier library's files.
      if (!state.currentName && !data.videos.some(v => v.notes.length)) return { skipped: true };
      const [current] = state.currentId ? await chrome.downloads.search({ id: state.currentId }) : [];
      if (force || data.fingerprint !== state.fingerprint || !state.currentName || current?.exists === false) {
        return start(state, data, 'current', state.currentName || 'framenote-current.json');
      }
      const period = month();
      const folder = parent(state.lastFilename);
      const key = `${period}|${folder}`;
      const known = state.months?.[key];
      if (known) {
        const [item] = await chrome.downloads.search({ id: known.id });
        // Missing history alone does not prove that a snapshot file was removed.
        if (!item || (item.state === 'complete' && item.exists !== false)) return { skipped: true };
      }
      // Recover this extension's snapshot records when browser download history survives reinstall.
      const matches = await chrome.downloads.search({ filenameRegex: `framenote-${period}( \\([0-9]+\\))?\\.json$`, state: 'complete', exists: true, limit: 100 });
      const found = matches.find(item => item.byExtensionId === chrome.runtime.id && parent(item.filename) === folder && item.exists !== false);
      if (found) {
        await save({ ...state, error: null, monthlyFilename: found.filename,
          months: { ...state.months, [key]: { id: found.id, filename: found.filename } } });
        return { skipped: true };
      }
      return start(state, data, 'monthly', `framenote-${period}.json`, period);
    } catch (error) {
      // start() already persists a download error; this also covers serialization/search failures.
      const latest = (await chrome.storage.local.get(STATE))[STATE] || state;
      await save({ ...latest, error: error.message, lastAttempt: new Date().toISOString() });
      throw error;
    }
  }
  async function reconcileManual() {
    const data = await chrome.storage.local.get(MANUAL);
    let state = data[MANUAL];
    if (!state?.pending) return;
    const [item] = await chrome.downloads.search({ id: state.pending });
    if (item?.state === 'in_progress') return;
    const success = item?.state === 'complete' && item.exists !== false && item.byExtensionId === chrome.runtime.id;
    state = { ...state, pending: null, error: success ? null : `Manual backup did not finish: ${item?.error || 'download interrupted'}.` };
    if (success) Object.assign(state, { lastSuccess: new Date().toISOString(), filename: item.filename });
    await chrome.storage.local.set({ [MANUAL]: state });
  }
  async function manual() {
    if (choosingManualFile) return { choosing: true };
    choosingManualFile = true;
    try {
      const data = await payload();
      const id = await chrome.downloads.download({ url: data.url, filename: `framenote-backup-${new Date().toISOString().slice(0, 10)}.json`, saveAs: true, conflictAction: 'uniquify' });
      const previous = (await chrome.storage.local.get(MANUAL))[MANUAL] || {};
      await chrome.storage.local.set({ [MANUAL]: { ...previous, pending: id, error: null } });
      await reconcileManual();
      return { pending: true, id };
    } catch (error) {
      if (/cancel/i.test(error.message)) return { cancelled: true };
      const previous = (await chrome.storage.local.get(MANUAL))[MANUAL] || {};
      await chrome.storage.local.set({ [MANUAL]: { ...previous, error: error.message } });
      throw error;
    } finally { choosingManualFile = false; }
  }
  async function changed(delta) {
    const stored = await chrome.storage.local.get([STATE, MANUAL]);
    const state = stored[STATE];
    if (stored[MANUAL]?.pending === delta.id) await reconcileManual();
    if (state?.policy !== POLICY) return;
    if (state.pending?.id === delta.id || state.currentId === delta.id || Object.values(state.months || {}).some(item => item.id === delta.id)) await automatic();
  }
  globalThis.FrameNoteDownloads = { automatic, manual, changed, month };
})();
