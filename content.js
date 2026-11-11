(() => {
  'use strict';

  if (globalThis.__frameNoteLoaded) return;
  globalThis.__frameNoteLoaded = true;

  const STORAGE_PREFIX = 'framenote:v1:video:';
  const ROOT_ID = 'framenote-root';
  let root, shadow, ui;
  let isOpen = false;
  let view = 'current';
  const expandedVideoIds = new Set();
  const saveShortcuts = new WeakMap();
  let activeVideoId = null;
  let activeRecord = null;
  let pinned = null;
  let editingId = null;
  let flashTimer = null;
  let routeSequence = 0;
  let renderSequence = 0;
  let libraryQuery = '';
  let previousFocus = null;
  const drafts = new Map();
  const editDrafts = new Map();
  function rememberDraft() {
    const input = shadow?.querySelector('[aria-label="Annotation text"]');
    const id = input?.dataset.videoId;
    if (id) drafts.set(id, { text: input.value, moment: id === activeVideoId ? (pinned && structuredClone(pinned)) : drafts.get(id)?.moment });
  }
  async function openSettings() {
    try { await chrome.runtime.sendMessage({ type: 'FRAMENOTE_SETTINGS' }); }
    catch (error) { reportError(error.message); }
  }
  async function updateBackupStatus() {
    if (!ui) return;
    try {
      const data = await chrome.storage.local.get(['framenote:backup:state', 'framenote:backup:settings']);
      const state = data['framenote:backup:state'] || {};
      const disabled = data['framenote:backup:settings']?.enabled !== true;
      ui.backupStatus.textContent = disabled ? 'Backups off' : state.error ? 'Check backups' : state.pending ? 'Backing up…' : state.lastSuccess ? 'Backed up' : 'Backup settings';
      ui.backupStatus.classList.toggle('attention', !disabled && !!state.error);
      ui.backupStatus.title = disabled ? 'Automatic file backups are disabled. Click to manage backups.' : state.error || (state.lastSuccess ? `Last file backup: ${new Date(state.lastSuccess).toLocaleString()}` : 'Automatic backups use your browser’s download location. Click for settings or Save As.');
    } catch { ui.backupStatus.textContent = 'Backup settings'; }
  }

  const frames = new Map();
  let selectedPlayerKey = null;
  let restoredTimestamp = false;
  let captureSequence = 0;

  function availablePlayers() {
    const result = [];
    const embeds = FrameNoteMedia.elements('iframe');
    for (const [frameId, entry] of frames) {
      if (!document.hidden && Date.now() - entry.seen > 15000) continue;
      const siblings = [...frames].filter(([id, value]) => id !== 0 && value.frameUrl === entry.frameUrl).sort((a, b) => a[0] - b[0]);
      const matchingEmbeds = embeds.filter(el => {
        try { return new URL(el.src, location.href).href === entry.frameUrl; } catch { return false; }
      });
      const embed = frameId === 0 ? null : matchingEmbeds[siblings.findIndex(([id]) => id === frameId)];
      for (const player of entry.players) {
        const frame = frameId === 0 ? 'top' : `embed:${embed?.id || (embed ? embeds.indexOf(embed) : siblings.findIndex(([id]) => id === frameId))}:${entry.frameUrl}`;
        result.push({ ...player, frameId, documentId: entry.documentId, frame,
          heading: (embed && FrameNoteMedia.heading(embed)) || player.heading,
          selectionKey: `${frameId}:${player.key}` });
      }
    }
    return result.sort((a, b) => Number(b.playing) - Number(a.playing) || Number(b.visible) - Number(a.visible) || b.area - a.area);
  }

  function infoFor(player) {
    if (!player) return null;
    const pageTitle = document.title.trim().slice(0, 10000) || location.hostname;
    const heading = player.heading || '';
    const youtube = FrameNoteMedia.youtubeId(location.href);
    if (youtube && player.frameId === 0 && player.kind === 'video') {
      const h1 = document.querySelector('ytd-watch-metadata h1, h1.ytd-watch-metadata, h1.ytd-reel-video-header-renderer');
      return { id: youtube, title: h1?.textContent?.trim() || heading || pageTitle.replace(/\s*[-–]\s*YouTube\s*$/, ''),
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(youtube)}`, pageTitle, heading: h1?.textContent?.trim() || heading };
    }
    const url = FrameNoteMedia.pageURL(location.href);
    const identity = { frame: player.frame, key: player.key, source: player.source };
    return { id: FrameNoteMedia.webId(url, identity), source: 'web', url, player: identity,
      title: heading && heading !== pageTitle ? `${heading} · ${pageTitle}`.slice(0, 10000) : pageTitle, pageTitle, heading };
  }

  function currentPlayer() {
    const players = availablePlayers();
    const chosen = players.find(p => p.selectionKey === selectedPlayerKey) || players[0];
    selectedPlayerKey = chosen?.selectionKey || null;
    return chosen;
  }

  function getVideoInfo() { return infoFor(currentPlayer()); }

  async function mediaCommand(player, action, seconds) {
    if (!player) throw new Error('No accessible player found. Start the video or audio, then try again.');
    const result = await chrome.runtime.sendMessage({ type: 'FRAMENOTE_MEDIA_COMMAND', frameId: player.frameId,
      documentId: player.documentId, key: player.key, action, seconds });
    if (!result?.ok) throw new Error(result?.error || 'The player did not respond.');
    return result.value;
  }

  function formatTime(time) {
    const n = Math.max(0, Math.floor(Number(time) || 0));
    const seconds = String(n % 60).padStart(2, '0');
    const minutes = String(Math.floor(n / 60) % 60).padStart(2, '0');
    const hours = Math.floor(n / 3600);
    return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
  }

  async function captureMoment() {
    const sequence = ++captureSequence;
    const id = getVideoInfo()?.id;
    try {
      const moment = await mediaCommand(currentPlayer(), 'capture');
      if (sequence !== captureSequence || id !== getVideoInfo()?.id) return false;
      pinned = moment;
      const draft = drafts.get(id);
      if (draft) draft.moment = structuredClone(moment);
      if (ui?.momentTime && ui?.momentCaption) {
        ui.momentTime.textContent = formatTime(pinned.seconds);
        ui.momentCaption.textContent = pinned.caption ? `CC: ${pinned.caption}` : 'No accessible subtitles at this moment';
      }
      return true;
    } catch (error) { reportError(error.message); return false; }
  }

  function emptyRecord(info) {
    const { id, ...metadata } = info;
    return { videoId: id, ...metadata, updatedAt: null, notes: [] };
  }

  async function loadCurrent() {
    const info = getVideoInfo();
    const id = info?.id || null;
    rememberDraft();
    ++captureSequence;
    const sequence = ++routeSequence;
    activeVideoId = id;
    pinned = drafts.get(id)?.moment || null;
    editingId = null;
    if (!info) {
      activeRecord = null;
      if (isOpen) render();
      return;
    }
    try {
      const result = await chrome.storage.local.get(STORAGE_PREFIX + id);
      if (sequence !== routeSequence) return;
      activeRecord = result[STORAGE_PREFIX + id] || emptyRecord(info);
      activeRecord.title = info.title || activeRecord.title;
      activeRecord.url = info.url;
    } catch (error) {
      if (sequence !== routeSequence) return;
      activeRecord = emptyRecord(info);
      reportError(`Storage unavailable: ${error.message}`);
    }
    if (isOpen) render();
  }

  async function saveRecord(record, baseline = activeRecord) {
    const result = await chrome.runtime.sendMessage({ type: 'FRAMENOTE_SAVE', record, baseline });
    if (!result?.ok) throw new Error(result?.error || 'FrameNote did not respond. Reload the extension.');
    if (activeVideoId === record.videoId) activeRecord = result.value;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function button(text, className, callback, title) {
    const el = element('button', className, text);
    el.type = 'button';
    if (title) el.title = title;
    el.addEventListener('click', callback);
    return el;
  }

  function clear(node) { node.replaceChildren(); }

  function flash(text, isError = false) {
    if (!ui) return;
    clearTimeout(flashTimer);
    ui.message.setAttribute('role', isError ? 'alert' : 'status');
    ui.message.textContent = text;
    ui.message.classList.toggle('error', isError);
    flashTimer = setTimeout(() => { if (ui) ui.message.textContent = ''; }, isError ? 12000 : 5000);
  }

  function reportError(text) { console.warn('FrameNote:', text); flash(text, true); }

  function createPanel() {
    root = document.createElement('div');
    root.id = ROOT_ID;
    // Do not allow website styling to affect the extension.
    root.style.cssText = 'all:initial;position:fixed;right:22px;top:78px;z-index:2147483646;display:none;width:min(420px,calc(100vw - 24px));max-height:calc(100vh - 96px);';
    shadow = root.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { color-scheme:dark; }
        *, *::before, *::after { box-sizing:border-box; }
        button, textarea, input, select { font:inherit; }
        select { width:100%; margin:7px 0 12px; padding:8px; color:#eaf0fb; background:#202c3e; border:1px solid #53698c; border-radius:8px; }
        button { cursor:pointer; transition:background .12s ease; }
        button:disabled { opacity:.55; cursor:default; }
        button:focus-visible,select:focus-visible,input:focus-visible { outline:2px solid #9bbaff; outline-offset:3px; }
        .header-actions {display:flex;align-items:center;gap:5px;}
        .settings {border:1px solid #425574;border-radius:7px;background:#27354b;color:#c7d5e8;padding:5px 8px;font-size:15px;}
        .backup-status {border:0;background:none;color:#a7c4b5;padding:0;text-align:left;font:inherit;}
        .backup-status.attention {color:#f3c884;}
        .search {width:100%;margin:15px 0 3px;border:1px solid #425574;border-radius:8px;background:#101827;color:#eaf0fb;padding:9px 10px;}
        .draft-hint {margin:7px 0;color:#9fadc4;font-size:10px;}
        @media (prefers-reduced-motion:reduce) {button{transition:none;}}
        .panel { display:flex; flex-direction:column; width:100%; max-height:calc(100vh - 96px);
          background:#151b29; color:#eaf0fb; border:1px solid #33415a;
          border-radius:16px; overflow:hidden; box-shadow:0 18px 65px #0009;
          font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
        .header { display:flex; align-items:center; gap:10px; padding:13px 14px; background:#1c2537;
          border-bottom:1px solid #33415a; cursor:move; user-select:none; }
        .mark { display:grid;place-items:center;background:#537cec;color:white;width:29px;height:29px;border-radius:9px;
          font-size:18px;font-weight:800; }
        .brand {flex:1;min-width:0;} .brand strong {display:block;font-size:14px;letter-spacing:.1px;}
        .brand small {display:block;font-size:10px;color:#9caec8;}
        .close {border:0;background:transparent;color:#c7d5e8;font-size:24px;line-height:1;padding:3px 5px;border-radius:7px;}
        .close:hover {background:#35435b;}
        .tabs {display:flex;gap:4px;padding:9px 12px 0;background:#151b29;}
        .tab {flex:1;border:0;border-radius:8px 8px 0 0;padding:9px;color:#aab9d2;background:transparent;font-weight:650;}
        .tab.selected {background:#28354b;color:#f4f8ff;}
        .body {overflow:auto;overscroll-behavior:contain;padding:14px;min-height:80px;min-width:0;}
        .video-title {font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .url {color:#8db1ff;font-size:11px;text-decoration:none;overflow-wrap:anywhere;}
        .subtle {color:#9fadc4;font-size:11px;}
        .card {border:1px solid #37465e;border-radius:11px;background:#202c3e;padding:12px;margin-top:11px;}
        .section-head {display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px;}
        .section-head b {font-size:12px;}
        .timestamp {font-variant-numeric:tabular-nums;font-weight:800;letter-spacing:.2px;color:#a8c3ff;
          background:#314467;border:0;border-radius:7px;padding:4px 8px;}
        .timestamp:hover,.linkbutton:hover {color:#fff;background:#4a679b;}
        .caption {border-left:2px solid #749aff;padding-left:9px;margin:8px 0;color:#c1d0e6;font-size:11px;
          white-space:pre-wrap;overflow-wrap:anywhere;}
        .text {white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;color:#f0f5ff;margin:7px 0 10px;}
        textarea {width:100%;min-height:94px;resize:vertical;background:#101827;color:#f4f7ff;border:1px solid #42536d;
          border-radius:9px;padding:10px;outline:none;}
        textarea:focus {border-color:#7199f6;box-shadow:0 0 0 2px #729af633;}
        .row {display:flex;gap:7px;align-items:center;flex-wrap:wrap;}
        .spacer {flex:1;}
        .primary {border:0;border-radius:8px;padding:8px 11px;background:#567cef;color:white;font-weight:700;}
        .primary:hover {background:#6e94ff;}
        .secondary,.linkbutton {border:1px solid #425574;border-radius:8px;padding:7px 9px;
          background:#27354b;color:#d5e2f6;}
        .secondary:hover {background:#384d6d;}
        .linkbutton {border:0;font-size:11px;}
        .danger {color:#ffb1b1;}
        .toolbar {display:flex;flex-wrap:wrap;gap:7px;margin-top:13px;}
        .heading {font-weight:800;margin:18px 0 5px;display:flex;justify-content:space-between;align-items:center;}
        .empty {border:1px dashed #45546d;border-radius:9px;padding:18px 10px;text-align:center;
          color:#aabbd2;margin-top:11px;font-size:12px;}
        .message {min-height:18px;padding:0 14px 7px;color:#91e4bb;font-size:11px;}
        .message.error {color:#ffb0b0;}
        .footer {padding:9px 14px;border-top:1px solid #344159;display:flex;justify-content:space-between;
          color:#96a6c0;font-size:10px;gap:8px;}
        .library-item {padding:11px 0;border-bottom:1px solid #334158;}
        .library-item:last-child {border:0;}
        .library-header {display:flex;align-items:center;gap:7px;min-width:0;}
        .library-toggle {display:flex;align-items:center;gap:9px;min-width:0;flex:1;border:0;
          background:transparent;color:#e9f0ff;text-align:left;padding:4px 3px;border-radius:7px;}
        .library-toggle:hover {background:#29374c;}
        .library-toggle:focus-visible {outline:2px solid #729aff;outline-offset:2px;}
        .library-arrow {font-size:15px;flex:none;color:#a5bfff;display:inline-block;width:14px;line-height:1;}
        .library-name {font-size:13px;font-weight:700;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          color:#e9f0ff;min-width:0;}
        .library-count {font-variant-numeric:tabular-nums;flex:none;white-space:nowrap;}
        .library-notes {margin:10px 0 5px 20px;padding:0 0 0 10px;border-left:1px solid #475b7b;}
        .library-note {padding:9px 8px;margin-bottom:7px;background:#202c3e;border-radius:8px;
          overflow-wrap:anywhere;}
        .library-note .text {margin:6px 0;}
        .library-note .caption {margin:7px 0 2px;}
        .mutedbutton {background:none;border:0;color:#9ebcff;font-size:11px;padding:4px 0;}
        .mutedbutton:hover {text-decoration:underline;}
      </style>
      <div class="panel" role="region" aria-label="FrameNote annotations">
        <div class="header" id="drag-handle">
          <div class="mark">⌑</div>
          <div class="brand"><strong>FrameNote</strong><small>Personal media annotations</small></div>
          <div class="header-actions"><button class="settings" id="settings" title="Backups, import and help" aria-label="Backups and settings">⚙</button><button class="close" id="close" title="Close annotation window" aria-label="Close">×</button></div>
        </div>
        <div class="tabs" role="tablist" aria-label="Annotation views">
          <button class="tab selected" id="tab-current" role="tab" aria-controls="body" aria-selected="true">Current player</button>
          <button class="tab" id="tab-library" role="tab" aria-controls="body" aria-selected="false" tabindex="-1">Library</button>
        </div>
        <div class="body" id="body" role="tabpanel" aria-labelledby="tab-current"></div>
        <div class="message" id="message" role="status"></div>
        <div class="footer"><button id="backup-status" class="backup-status">Backup settings</button><span>Local notes · Alt / Option + Shift + N</span></div>
      </div>
    `;
    (document.body || document.documentElement).appendChild(root);
    ui = {
      body: shadow.getElementById('body'),
      backupStatus: shadow.getElementById('backup-status'),
      message: shadow.getElementById('message'),
      tabCurrent: shadow.getElementById('tab-current'),
      tabLibrary: shadow.getElementById('tab-library'),
      momentTime: null,
      momentCaption: null
    };
    shadow.getElementById('close').addEventListener('click', toggle);
    ui.tabCurrent.addEventListener('click', () => { view = 'current'; render(); });
    ui.tabLibrary.addEventListener('click', () => { view = 'library'; render(); });
    shadow.getElementById('settings').addEventListener('click', openSettings);
    ui.backupStatus.addEventListener('click', openSettings);
    updateBackupStatus();
    setupDrag(shadow.getElementById('drag-handle'));
  }

  function setupDrag(handle) {
    let drag = null;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = root.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const left = Math.max(0, Math.min(innerWidth - root.offsetWidth, drag.left + event.clientX - drag.x));
      const top = Math.max(0, Math.min(innerHeight - Math.min(root.offsetHeight, innerHeight - 16) - 8, drag.top + event.clientY - drag.y));
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.right = 'auto';
    });
    const end = () => { drag = null; };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  async function toggle() {
    if (!root) createPanel();
    rememberDraft();
    if (!isOpen) previousFocus = document.activeElement;
    isOpen = !isOpen;
    root.style.display = isOpen ? 'block' : 'none';
    if (isOpen) {
      if (activeVideoId !== getVideoInfo()?.id) await loadCurrent();
      else await render();
      (shadow.querySelector('textarea,input') || shadow.getElementById('close')).focus({ preventScroll: true });
      updateBackupStatus();
    } else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  async function render() {
    if (!isOpen || !ui) return;
    rememberDraft();
    const sequence = ++renderSequence;
    ui.tabCurrent.classList.toggle('selected', view === 'current');
    ui.tabLibrary.classList.toggle('selected', view === 'library');
    ui.tabCurrent.setAttribute('aria-selected', String(view === 'current'));
    ui.tabLibrary.setAttribute('aria-selected', String(view === 'library'));
    ui.tabCurrent.tabIndex = view === 'current' ? 0 : -1;
    ui.tabLibrary.tabIndex = view === 'library' ? 0 : -1;
    ui.body.setAttribute('aria-labelledby', view === 'current' ? 'tab-current' : 'tab-library');
    clear(ui.body);
    ui.momentTime = null;
    ui.momentCaption = null;
    if (view === 'library') await renderLibrary(sequence);
    else renderCurrent();
  }

  function renderCurrent() {
    renderPlayerSelector();
    if (!activeRecord || !activeVideoId) {
      ui.body.append(element('div', 'empty', 'No accessible video or audio player found yet. Start playback, then try again. Library is always available.'));
      return;
    }
    const info = getVideoInfo();
    const title = element('div', 'video-title', info?.title || activeRecord.title);
    title.title = title.textContent;
    ui.body.append(title);
    if (info?.pageTitle && info?.heading && info.pageTitle !== info.heading) ui.body.append(element('div', 'subtle', `Tab: ${info.pageTitle}`));
    const url = element('a', 'url', activeRecord.url);
    url.href = activeRecord.url;
    url.target = '_blank';
    url.rel = 'noopener noreferrer';
    ui.body.append(url);

    const form = element('div', 'card');
    const head = element('div', 'section-head');
    head.append(element('b', '', 'New annotation'));
    const time = element('span', 'timestamp', '00:00');
    head.append(time);
    form.append(head);
    const noteInput = document.createElement('textarea');
    noteInput.placeholder = 'What do you want to note at this moment?';
    noteInput.setAttribute('aria-label', 'Annotation text');
    noteInput.dataset.videoId = activeVideoId;
    noteInput.value = drafts.get(activeVideoId)?.text || '';
    noteInput.addEventListener('input', rememberDraft);
    const caption = element('div', 'caption', '');
    ui.momentTime = time;
    ui.momentCaption = caption;
    form.append(noteInput, caption);
    const controls = element('div', 'row');
    controls.append(button('Capture current moment', 'secondary', captureMoment, 'Update the timestamp and visible subtitles'));
    controls.append(element('span', 'spacer'));
    const saveBtn = button('Save note', 'primary', async () => {
      const content = noteInput.value.trim();
      if (!content) { flash('Write a note before saving.', true); noteInput.focus(); return; }
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      if (!pinned && !await captureMoment()) { saveBtn.disabled = false; saveBtn.textContent = 'Save note'; return; }
      if (!activeRecord || activeVideoId !== noteInput.dataset.videoId) { saveBtn.disabled = false; saveBtn.textContent = 'Save note'; reportError('Player changed. Your draft is kept for the previous player.'); return; }
      const record = structuredClone(activeRecord);
      const infoNow = getVideoInfo();
      if (!infoNow || infoNow.id !== record.videoId) { saveBtn.disabled = false; saveBtn.textContent = 'Save note'; flash('Player changed. Your unfinished note is kept for the previous player.', true); return; }
      const { id: ignoredId, ...metadata } = infoNow;
      Object.assign(record, metadata);
      const now = new Date().toISOString();
      record.notes.push({
        id: crypto.randomUUID(),
        timeSeconds: pinned.seconds,
        caption: pinned.caption,
        text: content,
        createdAt: now,
        updatedAt: now
      });
      record.updatedAt = now;
      saveBtn.disabled = true;
      try {
        await saveRecord(record);
        if (activeVideoId === record.videoId) { noteInput.value = ''; pinned = null; }
        drafts.delete(record.videoId);
        render();
        flash('Annotation saved.');
      } catch (error) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save note';
        reportError(`Could not save: ${error.message}`);
      }
    });
    controls.append(saveBtn);
    saveShortcuts.set(noteInput, saveBtn);
    form.append(controls, element('div', 'draft-hint', '⌘/Ctrl + Enter to save · Drafts stay in this tab until you refresh.'));
    ui.body.append(form);
    if (pinned) { time.textContent = formatTime(pinned.seconds); caption.textContent = pinned.caption ? `CC: ${pinned.caption}` : 'No accessible subtitles at this moment'; }
    else captureMoment();

    const heading = element('div', 'heading');
    heading.append(element('span', '', `Saved notes (${activeRecord.notes.length})`));
    const actions = element('div', 'row');
    actions.append(button('Markdown', 'mutedbutton', () => exportMarkdown(activeRecord)));
    actions.append(button('JSON', 'mutedbutton', () => exportJSON(activeRecord)));
    heading.append(actions);
    ui.body.append(heading);

    const notes = [...activeRecord.notes].sort((a, b) => a.timeSeconds - b.timeSeconds || a.createdAt.localeCompare(b.createdAt));
    if (notes.length === 0) {
      ui.body.append(element('div', 'empty', 'No notes yet. Pause playback, capture the moment and write your first annotation.'));
    }
    for (const note of notes) ui.body.append(renderNote(note));
  }

  function renderPlayerSelector() {
    const players = availablePlayers();
    if (players.length < 2) return;
    const label = element('label', 'subtle', 'Player to annotate');
    label.htmlFor = 'player-select';
    const select = element('select');
    select.id = 'player-select';
    select.setAttribute('aria-label', 'Player to annotate');
    players.forEach((player, i) => {
      const option = element('option', '', `${player.kind === 'audio' ? 'Audio' : 'Video'} ${i + 1}: ${player.label || player.heading || 'Untitled player'}${player.frameId ? ' (embedded)' : ''}`);
      option.value = player.selectionKey;
      option.selected = player.selectionKey === selectedPlayerKey;
      select.append(option);
    });
    select.addEventListener('change', async () => {
      rememberDraft();
      selectedPlayerKey = select.value;
      await loadCurrent();
    });
    ui.body.append(label, select);
  }

  async function seekTo(timeSeconds, id = activeVideoId) {
    const player = availablePlayers().find(p => infoFor(p)?.id === id);
    try { await mediaCommand(player, 'seek', timeSeconds); }
    catch (error) { reportError(error.message); }
  }

  function renderNote(note) {
    const card = element('div', 'card');
    const heading = element('div', 'section-head');
    heading.append(button(formatTime(note.timeSeconds), 'timestamp', () => seekTo(note.timeSeconds), 'Jump to this moment in the player'));
    const tools = element('div', 'row');
    tools.append(button('Edit', 'linkbutton', () => { editingId = note.id; render(); }));
    tools.append(button('Delete', 'linkbutton danger', async () => {
      if (!confirm(`Delete the annotation at ${formatTime(note.timeSeconds)}?`)) return;
      const record = structuredClone(activeRecord);
      record.notes = record.notes.filter(item => item.id !== note.id);
      record.updatedAt = new Date().toISOString();
      try { await saveRecord(record); render(); flash('Annotation deleted.'); }
      catch (error) { reportError(`Could not delete: ${error.message}`); }
    }));
    heading.append(tools);
    card.append(heading);
    if (editingId === note.id) {
      const input = document.createElement('textarea');
      const editKey = `${activeVideoId}:${note.id}`;
      input.value = editDrafts.get(editKey) ?? note.text;
      input.addEventListener('input', () => editDrafts.set(editKey, input.value));
      input.setAttribute('aria-label', 'Edit annotation');
      card.append(input);
      const editActions = element('div', 'row');
      editActions.append(button('Cancel', 'secondary', () => { editDrafts.delete(editKey); editingId = null; render(); }));
      const updateBtn = button('Save changes', 'primary', async () => {
        if (!input.value.trim()) { flash('Annotation cannot be empty.', true); return; }
        if (updateBtn.disabled) return;
        updateBtn.disabled = true;
        const record = structuredClone(activeRecord);
        const changed = record.notes.find(item => item.id === note.id);
        if (!changed) { updateBtn.disabled = false; reportError('This note was changed in another tab. Reopen it to continue.'); return; }
        changed.text = input.value.trim();
        changed.updatedAt = new Date().toISOString();
        record.updatedAt = changed.updatedAt;
        try { await saveRecord(record); editDrafts.delete(editKey); editingId = null; render(); flash('Changes saved.'); }
        catch (error) { updateBtn.disabled = false; reportError(`Could not update: ${error.message}`); }
      });
      editActions.append(updateBtn);
      saveShortcuts.set(input, updateBtn);
      card.append(editActions);
    } else {
      card.append(element('div', 'text', note.text));
    }
    if (note.caption) card.append(element('div', 'caption', `CC: ${note.caption}`));
    return card;
  }

  async function readLibrary() {
    const result = await chrome.storage.local.get(null);
    return Object.entries(result)
      .filter(([key, value]) => key.startsWith(STORAGE_PREFIX) && value && Array.isArray(value.notes))
      .map(([, value]) => value)
      .filter(record => record.notes.length > 0)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  async function renderLibrary(sequence) {
    const body = ui.body;
    body.append(element('div', 'video-title', 'Annotated media'));
    body.append(element('div', 'subtle', 'Notes are stored in this browser. Manage separate file backups and restore JSON below.'));
    try {
      const records = await readLibrary();
      if (!isOpen || view !== 'library' || sequence !== renderSequence) return;
      const toolbar = element('div', 'toolbar');
      toolbar.append(button('Backups & import', 'secondary', openSettings));
      toolbar.append(button('Export all as JSON', 'secondary', () => exportJSON(records, 'framenote-all-videos')));
      toolbar.append(button('Export all as Markdown', 'secondary', () => exportLibraryMarkdown(records)));
      body.append(toolbar);
      if (!records.length) {
        body.append(element('div', 'empty', 'No saved annotations yet.'));
        return;
      }
      const total = records.reduce((sum, rec) => sum + rec.notes.length, 0);
      const search = element('input', 'search');
      search.type = 'search';
      search.placeholder = 'Search titles, notes and subtitles…';
      search.setAttribute('aria-label', 'Search library');
      search.value = libraryQuery;
      const count = element('div', 'heading', `${records.length} media items · ${total} annotations`);
      count.setAttribute('aria-live', 'polite');
      const noResults = element('div', 'empty', 'No matching notes. Try a different search.');
      noResults.hidden = true;
      body.append(search, count, noResults);
      const searchable = [];
      function filter() {
        libraryQuery = search.value;
        const query = libraryQuery.trim().toLocaleLowerCase();
        let visible = 0;
        for (const entry of searchable) {
          const matches = !query || entry.text.includes(query);
          entry.item.hidden = !matches;
          if (matches) visible++;
          const expanded = !!query || expandedVideoIds.has(entry.id);
          entry.notes.hidden = !expanded;
          entry.toggle.setAttribute('aria-expanded', String(expanded));
          entry.arrow.textContent = expanded ? '▾' : '▸';
        }
        noResults.hidden = visible !== 0;
        count.textContent = query ? `${visible} of ${records.length} media items` : `${records.length} media items · ${total} annotations`;
      }
      search.addEventListener('input', filter);
      for (const record of records) {
        const item = element('div', 'library-item');
        const header = element('div', 'library-header');
        const toggle = button('', 'library-toggle', () => {
          if (expandedVideoIds.has(record.videoId)) expandedVideoIds.delete(record.videoId);
          else expandedVideoIds.add(record.videoId);
          // Updating this item in place preserves scrolling and other open videos.
          const expanded = expandedVideoIds.has(record.videoId);
          toggle.setAttribute('aria-expanded', String(expanded));
          arrow.textContent = expanded ? '▾' : '▸';
          notesContainer.hidden = !expanded;
        }, 'Show or hide annotations');
        const open = expandedVideoIds.has(record.videoId);
        toggle.setAttribute('aria-expanded', String(open));
        const arrow = element('span', 'library-arrow', open ? '▾' : '▸');
        arrow.setAttribute('aria-hidden', 'true');
        const title = element('span', 'library-name', record.title || record.videoId);
        title.title = title.textContent;
        toggle.append(arrow, title);
        header.append(toggle, element('span', 'subtle library-count', `${record.notes.length} ${record.notes.length === 1 ? 'note' : 'notes'}`));
        item.append(header);

        const notesContainer = element('div', 'library-notes');
        notesContainer.hidden = !open;
        const notes = [...record.notes].sort((a, b) =>
          a.timeSeconds - b.timeSeconds || (a.createdAt || '').localeCompare(b.createdAt || ''));
        for (const note of notes) {
          const noteItem = element('div', 'library-note');
          const goToMoment = button(formatTime(note.timeSeconds), 'timestamp', () => {
            if (availablePlayers().some(p => infoFor(p)?.id === record.videoId)) seekTo(note.timeSeconds, record.videoId);
            else window.open(FrameNoteMedia.timestampURL(record, note.timeSeconds), '_blank', 'noopener,noreferrer');
          }, 'Open this timestamp in the video');
          noteItem.append(goToMoment, element('div', 'text', note.text));
          if (note.caption) noteItem.append(element('div', 'caption', `CC: ${note.caption}`));
          notesContainer.append(noteItem);
        }
        item.append(notesContainer);
        const actions = element('div', 'row');
        actions.append(button('Open page', 'mutedbutton', () => window.open(record.url, '_blank', 'noopener,noreferrer')));
        actions.append(button('Export notes', 'mutedbutton', () => exportMarkdown(record)));
        item.append(actions);
        body.append(item);
        searchable.push({ item, notes: notesContainer, toggle, arrow, id: record.videoId,
          text: [record.title, record.pageTitle, record.heading, record.url, ...record.notes.flatMap(n => [n.text, n.caption])].join(' ').toLocaleLowerCase() });
      }
      filter();
    } catch (error) { reportError(`Could not load library: ${error.message}`); }
  }

  function safeFilename(text) {
    return (text || 'video').replace(/[\\/:*?"<>|\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 75) || 'video';
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function noteMarkdown(record) {
    const lines = [`# ${record.title || record.videoId}`, '', `Page: ${record.url}`, ''];
    if (record.pageTitle) lines.push(`Tab title: ${record.pageTitle}`, '');
    if (record.heading) lines.push(`Player heading: ${record.heading}`, '');
    const notes = [...record.notes].sort((a, b) => a.timeSeconds - b.timeSeconds);
    for (const note of notes) {
      const time = formatTime(note.timeSeconds);
      const link = FrameNoteMedia.timestampURL(record, note.timeSeconds);
      lines.push(`## [${time}](${link})`, '', note.text, '');
      if (note.caption) lines.push(`> Subtitles: ${note.caption.replace(/\n/g, ' ')}`, '');
    }
    return lines.join('\n');
  }

  function exportMarkdown(record) {
    download(`${safeFilename(record.title)}-annotations.md`, noteMarkdown(record), 'text/markdown;charset=utf-8');
  }

  function exportLibraryMarkdown(records) {
    download('framenote-library.md', records.map(noteMarkdown).join('\n\n---\n\n'), 'text/markdown;charset=utf-8');
  }

  function exportJSON(object, base) {
    const label = base || `${safeFilename(object.title)}-annotations`;
    download(`${label}.json`, JSON.stringify(object, null, 2), 'application/json;charset=utf-8');
  }

  function routeChanged() {
    const info = getVideoInfo();
    if ((info?.id || null) !== activeVideoId) loadCurrent();
    if (!restoredTimestamp) {
      const target = new URL(location.href).searchParams.get('framenote')?.match(/^(web:[a-f0-9]{16}):(\d+(?:\.\d+)?)$/);
      const player = target && availablePlayers().find(p => infoFor(p)?.id === target[1]);
      if (player) {
        restoredTimestamp = true;
        selectedPlayerKey = player.selectionKey;
        loadCurrent();
        seekTo(Number(target[2]), target[1]);
      }
    }
  }

  globalThis.__frameNoteHandleKey = (event) => {
    if (event.type !== 'keydown' || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); toggle(); return; }
    const active = shadow?.activeElement;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && [ui?.tabCurrent, ui?.tabLibrary].includes(active)) {
      event.preventDefault();
      const target = event.key === 'Home' ? ui.tabCurrent : event.key === 'End' ? ui.tabLibrary : active === ui.tabCurrent ? ui.tabLibrary : ui.tabCurrent;
      target.click(); target.focus();
    }
  };

  globalThis.__frameNoteHandleSaveShortcut = (event) => {
    const active = shadow?.activeElement;
    const saveButton = active && saveShortcuts.get(active);
    if (saveButton) {
      event.preventDefault();
      saveButton.click();
    }
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'FRAMENOTE_TOGGLE') toggle();
    if (message?.type === 'FRAMENOTE_MEDIA_UPDATE') {
      const previousCount = availablePlayers().length;
      frames.set(message.frameId, { ...message, seen: Date.now() });
      const count = availablePlayers().length;
      routeChanged();
      // Update selector options without replacing a draft or stealing focus.
      if (isOpen && view === 'current' && count !== previousCount && activeRecord) {
        const existing = shadow.getElementById('player-select');
        if (existing) { existing.previousElementSibling?.remove(); existing.remove(); }
        const marker = ui.body.firstChild;
        renderPlayerSelector();
        const added = shadow.getElementById('player-select');
        if (added && marker) { ui.body.insertBefore(added.previousElementSibling, marker); ui.body.insertBefore(added, marker); }
      }
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes['framenote:backup:state'] || changes['framenote:backup:settings']) updateBackupStatus();
    const changed = changes[STORAGE_PREFIX + activeVideoId];
    if (changed?.newValue) activeRecord = changed.newValue;
    if (isOpen && view === 'library' && Object.keys(changes).some(key => key.startsWith(STORAGE_PREFIX))) render();
  });

  window.addEventListener('resize', () => {
    if (!root || !isOpen) return;
    const rect = root.getBoundingClientRect();
    if (root.style.left) root.style.left = `${Math.max(0, Math.min(innerWidth - root.offsetWidth, rect.left))}px`;
    root.style.top = `${Math.max(8, Math.min(innerHeight - Math.min(root.offsetHeight, innerHeight - 16) - 8, rect.top))}px`;
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(routeChanged, 2500); });
  document.addEventListener('yt-navigate-finish', routeChanged);
  window.addEventListener('popstate', routeChanged);
  // Handle SPA routes, changing players, and frames removed since their last update.
  setInterval(routeChanged, 1300);
  loadCurrent();
})();
