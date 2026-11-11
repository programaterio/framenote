# FrameNote 1.6.5 — Browser downloads and manual Save As

## License

This release includes the custom FrameNote Personal Noncommercial License: personal noncommercial use and private modifications are permitted; commercial/business use and redistribution are prohibited, subject to GitHub’s required public-repository rights. User annotations are outside the software license. Previous MIT grants are not revoked. Prior ZIPs are retained unchanged.

## Automatic-backup preference fix

Changing the checkbox now persists immediately, without a separate Save settings button. Controls are disabled while loading/saving, and a failed write restores the prior checkbox state and reports the error. The saved preference is preserved across an extension reload and a newly opened options page. Enabling backups schedules the first backup after the preference is stored; download failures do not undo the saved choice.

## Options layout

Restored the earlier single-column layout, gradient welcome card, colors and typography from 1.6.1. Text is shorter throughout, with backup details and help kept expandable. The immediate-save checkbox fix is retained; automatic backups stay off by default and saved choices persist. Backup and import behavior are unchanged.

## Backup behavior

- Automatic backups are unchecked/off by default. Explicitly saved existing choices are preserved; manual Save As remains available.

- Automatic backups use `FrameNote/` beneath the browser’s configured download location. No File System Access API, Brave flag or companion app is required.
- A full current JSON file updates after saved changes. On first use, preexisting files are preserved through a numbered name; later changes replace that installation’s current filename.
- Monthly snapshots are tracked using completed downloads and the extension’s own matching download records. Existing monthly files are never overwritten. If both history and extension tracking disappear, an extra numbered monthly file can be created. This version cannot scan arbitrary directory contents.
- **Save backup as…** opens the browser Save As dialog for each manual backup, so users can choose a separate folder. The automatic location remains unchanged. Manual cancellation and errors are kept separate from automatic backup status, and an open dialog does not block note saves.
- Status confirms download completion rather than assuming a requested file was saved. Pending automatic downloads survive worker restart; edits made during a download are included in the next current update. Failed automatic downloads retry after five minutes.
- The old folder chooser, permission explanations, reconnect/restore-folder flow and Brave API setup have been replaced by clear Downloads/Save As guidance. JSON importing remains available for restoration.

Draft preservation, searchable Library, captions, player selection, keyboard accessibility and safe concurrent note/import writes are retained. Existing note storage keys and backup JSON formats are unchanged.

## Update and migration

The workspace source is updated. Keep the existing installed folder and extension ID, reload FrameNote, approve the new downloads permission if prompted, refresh media tabs, and close/reopen settings. Do not uninstall merely to update.

Previous direct-folder backups remain untouched. Their folder handles are no longer used or loaded. Old grants can be revoked in browser controls; the Brave API flag can remain disabled. Automatic backups now go to the browser download location, not the previously selected folder. Import an old JSON backup if needed.

Changing the browser download location affects other browser downloads too. Manual Save As does not change it. Backup files and monthly snapshots are not automatically deleted. A new empty installation does not create automatic backups until notes are saved/imported, and first-use numbering protects earlier current files.

## Validation and packaging

`node --test tests/backup.test.cjs` covers validation, merges/concurrent saves, current-file updates and safe naming, monthly rollover/history recovery, download failures/retries, worker restart, Save As cancellation and queue independence.

`node tests/browser-smoke.cjs` uses a separate Brave profile and temporary download locations. It checks actual automatic downloads/overwrites, unchanged monthly contents, a real manual download requested with `saveAs:true` (CDP selects its destination instead of an OS dialog), cancellation isolation, imports and media/draft/search/keyboard/timestamp functions. Native Save As UI interaction and live-site player compatibility still need a manual release pass.

`python3 scripts/package.py` creates `release/framenote-1.6.5.zip`, with manifest.json at its root. Runtime files do not include the legacy `backup-folder.js` adapter, tests, profiles, older archives or release working material. Nothing is published automatically. The publisher supplies their support details and public privacy-policy URL before store submission; see STORE_LISTING.md.
