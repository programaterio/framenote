importScripts('media-info.js', 'backup-data.js', 'backup-downloads.js');

const SETTINGS_KEY = 'framenote:backup:settings';
const ALARM = 'framenote:backup:check';
let queue = Promise.resolve();
function serialized(task) {
  const result = queue.then(task);
  queue = result.catch(error => console.warn('FrameNote:', error.message));
  return result;
}
async function initialize() {
  if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(details => { serialized(async () => {
  await initialize();
  if (details?.reason === 'install') await chrome.runtime.openOptionsPage();
  await FrameNoteDownloads.automatic();
}); });
chrome.runtime.onStartup.addListener(() => { serialized(async () => { await initialize(); await FrameNoteDownloads.automatic(); }); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) serialized(() => FrameNoteDownloads.automatic()); });
chrome.downloads.onChanged.addListener(delta => {
  if (delta.state || delta.error || delta.exists) serialized(() => FrameNoteDownloads.changed(delta));
});
// Back up changes immediately; the minute alarm also checks month rollover,
// missing files, and retries when the browser was closed or asleep.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (Object.keys(changes).some(key => key.startsWith(FrameNoteData.PREFIX)) || changes[SETTINGS_KEY]?.newValue?.enabled === true)) {
    serialized(() => FrameNoteDownloads.automatic());
  }
});

chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'FRAMENOTE_TOGGLE' }, { frameId: 0 }); }
  catch { await chrome.runtime.openOptionsPage(); }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Messages are relayed through the extension, so page scripts cannot spoof frame IDs.
  if (message?.type === 'FRAMENOTE_MEDIA_ANNOUNCE' && sender.tab?.id != null) {
    chrome.tabs.sendMessage(sender.tab.id, { type: 'FRAMENOTE_MEDIA_UPDATE',
      frameId: sender.frameId, documentId: sender.documentId, frameUrl: message.frameUrl, players: message.players }, { frameId: 0 }).catch(() => {});
    return;
  }
  if (message?.type === 'FRAMENOTE_MEDIA_COMMAND' && sender.tab?.id != null && sender.frameId === 0) {
    chrome.tabs.sendMessage(sender.tab.id, { type: 'FRAMENOTE_MEDIA_LOCAL', key: message.key,
      action: message.action, seconds: message.seconds }, { frameId: message.frameId, ...(message.documentId ? { documentId: message.documentId } : {}) })
      .then(respond, error => respond({ ok: false, error: 'Player unavailable: ' + error.message }));
    return true;
  }
  // A Save As dialog may remain open. Keep it outside the note-write queue.
  if (message?.type === 'FRAMENOTE_MANUAL_BACKUP' && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options.html')) {
    FrameNoteDownloads.manual().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
    return true;
  }
  const handlers = {
    FRAMENOTE_SETTINGS: () => chrome.runtime.openOptionsPage(),
    FRAMENOTE_SAVE: async () => {
      const record = FrameNoteData.record(message.record);
      const baseline = FrameNoteData.record(message.baseline);
      if (record.videoId !== baseline.videoId) throw new Error('Player changed while saving.');
      const key = FrameNoteData.PREFIX + record.videoId;
      const storage = await chrome.storage.local.get(key);
      const current = storage[key] || baseline;
      // Apply only this editor's changes, preserving notes added by another tab or import.
      const before = new Map(baseline.notes.map(n => [n.id, n]));
      const after = new Map(record.notes.map(n => [n.id, n]));
      const notes = new Map(current.notes.map(n => [n.id, n]));
      for (const id of before.keys()) if (!after.has(id)) notes.delete(id);
      for (const [id, note] of after) if (JSON.stringify(note) !== JSON.stringify(before.get(id))) notes.set(id, note);
      const saved = { ...record, notes: [...notes.values()] };
      await chrome.storage.local.set({ [key]: saved });
      return saved;
    }
  };
  // Import and settings changes are only accepted from our own extension page.
  if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options.html')) {
    Object.assign(handlers, {
      FRAMENOTE_BACKUP_NOW: () => FrameNoteDownloads.automatic(true),
      FRAMENOTE_BACKUP_SETTINGS: async () => {
        if (typeof message.enabled !== 'boolean') throw new Error('Invalid backup setting.');
        const config = { enabled: message.enabled };
        await chrome.storage.local.set({ [SETTINGS_KEY]: config });
        await initialize();
        return config;
      },
      FRAMENOTE_IMPORT: async () => {
        const incoming = FrameNoteData.parse(message.text);
        const { writes, summary } = FrameNoteData.merge(await chrome.storage.local.get(null), incoming);
        if (Object.keys(writes).length) await chrome.storage.local.set(writes);
        return summary;
      }
    });
  }
  if (!Object.hasOwn(handlers, message?.type)) return;
  serialized(handlers[message.type]).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
serialized(initialize);
