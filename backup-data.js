// Shared, dependency-free backup format and validation (worker + settings page).
(() => {
  'use strict';
  const PREFIX = 'framenote:v1:video:';
  const MAX_BYTES = 20 * 1024 * 1024;
  const fail = message => { throw new Error(message); };
  function string(value, label, max = 200000) {
    if (typeof value !== 'string' || value.length > max) fail(`Invalid ${label}.`);
    return value;
  }
  function date(value, fallback) {
    if (value == null) return fallback;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('Invalid date.');
    return new Date(value).toISOString();
  }
  function record(value) {
    if (!value || typeof value !== 'object') fail('Invalid video record.');
    const videoId = string(value.videoId, 'video ID', 100);
    const web = value.source === 'web';
    if (web ? !/^web:[a-f0-9]{16}$/.test(videoId) : !/^[A-Za-z0-9_-]{6,100}$/.test(videoId)) fail('Invalid media ID.');
    let metadata = {};
    if (web) {
      const url = FrameNoteMedia.pageURL(string(value.url, 'page URL', 20000));
      if (!value.player || typeof value.player !== 'object') fail('Missing player identity.');
      const player = { frame: string(value.player.frame, 'player frame', 20000),
        key: string(value.player.key, 'player key', 2000), source: string(value.player.source, 'player source', 20000) };
      if (videoId !== FrameNoteMedia.webId(url, player)) fail('Media ID does not match its page and player.');
      metadata = { source: 'web', url, player, pageTitle: string(value.pageTitle ?? '', 'tab title', 10000), heading: string(value.heading ?? '', 'heading', 10000) };
    } else {
      // Old YouTube backups retain canonical URLs and unchanged storage keys.
      if (value.pageTitle !== undefined) metadata.pageTitle = string(value.pageTitle, 'tab title', 10000);
      if (value.heading !== undefined) metadata.heading = string(value.heading, 'heading', 10000);
    }
    if (!Array.isArray(value.notes) || value.notes.length > 100000) fail('Invalid annotations.');
    const ids = new Set();
    const notes = value.notes.map(note => {
      if (!note || typeof note !== 'object') fail('Invalid annotation.');
      const id = string(note.id, 'annotation ID', 200);
      if (!id || ids.has(id)) fail('Missing or duplicate annotation ID.');
      ids.add(id);
      if (typeof note.timeSeconds !== 'number' || !Number.isFinite(note.timeSeconds) || note.timeSeconds < 0) fail('Invalid annotation timestamp.');
      const createdAt = date(note.createdAt, '1970-01-01T00:00:00.000Z');
      return { id, timeSeconds: note.timeSeconds, text: string(note.text, 'annotation text'),
        caption: string(note.caption ?? '', 'caption'), createdAt, updatedAt: date(note.updatedAt, createdAt) };
    });
    return { videoId, title: string(value.title ?? videoId, 'title', 10000),
      // Never trust imported URLs for links rendered inside YouTube.
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, ...metadata,
      updatedAt: date(value.updatedAt, notes.map(n => n.updatedAt).sort().at(-1) || null), notes };
  }
  function parse(text) {
    if (new TextEncoder().encode(text).length > MAX_BYTES) fail('Backup exceeds the 20 MB import limit.');
    let data;
    try { data = JSON.parse(text); } catch { fail('This file is not valid JSON.'); }
    if (data?.format === 'framenote-backup') {
      if (data.version !== 1 || !Array.isArray(data.videos)) fail('Unsupported FrameNote backup version.');
      data = data.videos;
    }
    const videos = Array.isArray(data) ? data : [data];
    if (videos.length > 10000) fail('Too many videos in backup.');
    const ids = new Set();
    return videos.map(value => {
      const result = record(value);
      if (ids.has(result.videoId)) fail('Duplicate video in backup.');
      ids.add(result.videoId);
      return result;
    });
  }
  function merge(storage, videos) {
    const writes = {};
    const summary = { added: 0, duplicates: 0, conflicts: 0, videos: videos.length };
    for (const incoming of videos) {
      const key = PREFIX + incoming.videoId;
      const existing = storage[key];
      if (!existing) {
        writes[key] = incoming;
        summary.added += incoming.notes.length;
        continue;
      }
      const notes = new Map(existing.notes.map(note => [note.id, note]));
      for (const note of incoming.notes) {
        const saved = notes.get(note.id);
        if (!saved) { notes.set(note.id, note); summary.added++; }
        else if (saved.text === note.text && (saved.caption || '') === note.caption && saved.timeSeconds === note.timeSeconds) summary.duplicates++;
        else summary.conflicts++;
      }
      if (notes.size !== existing.notes.length) {
        writes[key] = { ...existing, notes: [...notes.values()],
          updatedAt: [existing.updatedAt || '', incoming.updatedAt || ''].sort().at(-1) || null };
      }
    }
    return { writes, summary };
  }
  function videos(storage) {
    return Object.entries(storage).filter(([key, value]) => key.startsWith(PREFIX) && Array.isArray(value?.notes))
      .map(([, value]) => value).sort((a, b) => a.videoId.localeCompare(b.videoId));
  }
  globalThis.FrameNoteData = { PREFIX, MAX_BYTES, parse, record, merge, videos };
})();
