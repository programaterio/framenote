'use strict';
const $ = id => document.getElementById(id);
let importText = null;
let fileSequence = 0;
let latestAutomaticId = null;
let savedBackupEnabled = false;
function message(text, error = false) {
  $('message').setAttribute('role', error ? 'alert' : 'status');
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
async function send(type, fields = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...fields });
  if (!result?.ok) throw new Error(result?.error || 'FrameNote did not respond. Reload the extension and try again.');
  return result.value;
}
async function status() {
  const data = await chrome.storage.local.get(['framenote:backup:state','framenote:backup:manual']);
  const state = data['framenote:backup:state'] || {};
  const manual = data['framenote:backup:manual'] || {};
  const automatic = state.policy === 'browser-downloads-v1';
  let text = automatic && state.lastSuccess ? `Last saved ${new Date(state.lastSuccess).toLocaleString()}` : 'No automatic backup yet.';
  if (automatic && state.pending) text = 'Saving automatic backup…';
  if (automatic && state.error) text = state.error;
  $('backup-status').textContent = text;
  $('backup-details').hidden = !automatic || !state.lastFilename;
  $('backup-path').textContent = automatic ? [state.lastFilename, state.monthlyFilename && `Monthly: ${state.monthlyFilename}`].filter(Boolean).join('\n') : '';
  latestAutomaticId = automatic ? state.currentId ?? null : null;
  $('show-download').disabled = latestAutomaticId === null;
  let manualText = manual.lastSuccess ? `Last saved ${new Date(manual.lastSuccess).toLocaleString()}` : 'No manual backup yet.';
  if (manual.pending) manualText = 'Saving backup…';
  if (manual.error) manualText = manual.error;
  $('manual-status').textContent = manualText;
  $('manual-details').hidden = !manual.filename;
  $('manual-path').textContent = manual.filename || '';
}
async function initialize() {
  $('version').textContent = `Version ${chrome.runtime.getManifest().version}`;
  const data = await chrome.storage.local.get('framenote:backup:settings');
  savedBackupEnabled = data['framenote:backup:settings']?.enabled === true;
  $('enabled').checked = savedBackupEnabled;
  $('enabled').disabled = false;
  await status();
}
$('enabled').addEventListener('change', async () => {
  const control = $('enabled');
  const requested = control.checked;
  const previous = savedBackupEnabled;
  control.disabled = true;
  $('settings-hint').textContent = 'Saving…';
  try {
    // Persist the choice directly, without waiting behind a backup/download task.
    await chrome.storage.local.set({ 'framenote:backup:settings': { enabled: requested } });
    savedBackupEnabled = requested;
    message(requested ? 'Automatic backups enabled.' : 'Automatic backups disabled.');
  } catch (error) {
    control.checked = previous;
    savedBackupEnabled = previous;
    message(`Could not save your choice: ${error.message}`, true);
  } finally {
    control.disabled = false;
    $('settings-hint').textContent = 'Changes save automatically. Off by default.';
  }
});
$('backup-now').addEventListener('click', async () => {
  const control = $('backup-now'); control.disabled = true;
  try {
    const result = await send('FRAMENOTE_BACKUP_NOW');
    message(result.skipped ? 'Save or import notes first.' : 'Automatic backup started.');
    await status();
  } catch (error) { message(error.message,true); }
  finally { control.disabled = false; }
});
$('show-download').addEventListener('click', () => {
  if (latestAutomaticId !== null) {
    try { chrome.downloads.show(latestAutomaticId); }
    catch (error) { message(error.message,true); }
  }
});
$('export-library').addEventListener('click', async () => {
  const control = $('export-library'); control.disabled = true;
  message('Choose where to save your backup.');
  try {
    const result = await send('FRAMENOTE_MANUAL_BACKUP');
    message(result.cancelled ? 'Manual backup cancelled.' : 'Backup started.');
    await status();
  } catch (error) { message(error.message,true); }
  finally { control.disabled = false; }
});
$('import-file').addEventListener('change', async () => {
  const sequence = ++fileSequence;
  importText = null;
  $('import-button').disabled = true;
  $('import-preview').textContent = 'Reading file…';
  const file = $('import-file').files[0];
  if (!file) { $('import-preview').textContent = 'Choose a file to preview.'; return; }
  try {
    if (file.size > FrameNoteData.MAX_BYTES) throw new Error('Backup exceeds the 20 MB import limit.');
    const text = await file.text();
    const videos = FrameNoteData.parse(text);
    const { summary } = FrameNoteData.merge(await chrome.storage.local.get(null), videos);
    if (sequence !== fileSequence) return;
    importText = text;
    $('import-preview').textContent = `${videos.length} items · ${videos.reduce((n, v) => n + v.notes.length, 0)} notes\n${summary.added} to add · ${summary.duplicates} duplicates · ${summary.conflicts} conflicts kept`;
    $('import-button').disabled = false;
  } catch (error) {
    if (sequence === fileSequence) $('import-preview').textContent = `Cannot import: ${error.message}`;
  }
});
$('import-button').addEventListener('click', async () => {
  if (importText === null) return;
  $('import-button').disabled = true;
  $('import-file').disabled = true;
  try {
    const summary = await send('FRAMENOTE_IMPORT', { text: importText });
    message(`Imported ${summary.added} notes · ${summary.duplicates} duplicates skipped · ${summary.conflicts} conflicts kept.`);
    importText = null;
    $('import-file').value = '';
    $('import-preview').textContent = 'Choose a file to preview.';
  } catch (error) { message(`Import failed: ${error.message}`, true); $('import-button').disabled = false; }
  finally { $('import-file').disabled = false; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['framenote:backup:settings']) {
    savedBackupEnabled = changes['framenote:backup:settings'].newValue?.enabled === true;
    $('enabled').checked = savedBackupEnabled;
  }
  if (changes['framenote:backup:state'] || changes['framenote:backup:manual']) status().catch(error => message(error.message, true));
});
initialize().catch(error => message(error.message, true));
