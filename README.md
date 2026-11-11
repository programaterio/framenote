# FrameNote — Browser Media Annotations

Version **1.6.5**. FrameNote is a private Chrome/Brave extension for timestamped notes beside website video and audio players. No accounts, analytics or backend. This version uses normal browser downloads for backups; no File System Access API flag or companion app is needed.

## Install or update

For a new installation, use **Code → Download ZIP** on GitHub and extract it into a permanent folder. You can also use a packaged release ZIP when one is available. Open `chrome://extensions` or `brave://extensions`, enable Developer mode, choose Load unpacked, and select the folder containing `manifest.json`.

For an existing installation, download the new source ZIP and replace the extension files inside the same installed folder. Keep that folder path and extension ID, click **Reload** on FrameNote, approve new permissions if prompted, and refresh media tabs. Close and reopen FrameNote’s settings page. Do not uninstall merely to update; existing annotation storage and JSON formats are unchanged.

## Annotating

- Open a page with a video/audio player and click the toolbar icon or **Alt / Option + Shift + N**. A draggable panel opens.
- Select the player when several are available, including accessible embeds. FrameNote saves the page URL, tab title and nearby player heading when available.
- **Capture current moment** fixes the timestamp and accessible captions while you write. Click **Save note** or press **Ctrl/Cmd + Enter**. Page shortcuts are blocked while the panel has keyboard focus.
- Click timestamps to seek. Edit or delete notes. Unfinished drafts survive panel closing/reopening and view/player changes within that document; a document reload loses memory-only drafts.
- Library search covers titles, page URLs, headings, comments and captions. Matching items expand to show chronological notes. JSON and Markdown exports are also available there.
- On non-YouTube sites, timestamp links need FrameNote installed and allowed on the destination page to select/seek the matching player.
- Escape closes the panel and arrow/Home/End keys navigate its view tabs. The gear button and footer backup status open **Backups, import & help**.

## Automatic backups: browser download location

Automatic backups are off by default. Enable the checkbox in settings to opt in; changes save immediately. An explicitly saved choice from an existing installation is preserved. After a saved note, edit, deletion or import, FrameNote downloads the entire library into a **FrameNote** subfolder of the browser’s configured download location. A minute alarm handles new months, missed changes and retries while the browser runs.

- **Current file:** starts as `FrameNote/framenote-current.json`. On this installation’s first download, the browser chooses an unused name if that file already exists, such as `framenote-current (1).json`. Later changes overwrite that installation’s current filename. Existing backups from older installs are preserved on first use.
- **Monthly file:** `FrameNote/framenote-YYYY-MM.json`, created on the first active run of the month, using the computer’s local timezone. Existing monthly snapshots are never overwritten. No daily snapshots or per-edit files are produced.

FrameNote remembers completed monthly downloads and looks for its own matching entries in browser download history. It does **not** inspect directory contents. If both extension tracking and the relevant history are lost, for example after a reinstall and cleared history, an extra numbered monthly snapshot may be created. When history is missing but extension tracking remains, FrameNote keeps the recorded snapshot rather than repeatedly creating copies. Reported missing downloads can be recreated; history’s file-existence information can lag behind actual moves/removals.

Change the base automatic destination in browser **Settings → Downloads → Location**. That setting affects other browser downloads too. FrameNote cannot redirect future downloads by following a folder moved in Finder. A new browser download location takes effect on the next requested current backup; manual Save As below does not change it. Browser policies and other download-managing extensions can affect file placement and prompts.

The status page reports successful backups only after the browser confirms download completion. Failed automatic downloads retry after at least five minutes, or when you choose **Update automatic backup now**. Edits made while a backup downloads are included in a following current-file update. Browser sleep/shutdown delays checks. A fresh installation with no notes does not write empty automatic backups; deliberately deleting all notes from an established library does update its current file to reflect that change.

## Manual backups: choose a location each time

Open **Library → Backups & import → Save backup as…**. The browser’s normal Save As dialog lets you choose the folder and filename for that one complete JSON backup. No ongoing folder access is granted. Manual backups work even when automatic backups are disabled, and can go anywhere the browser permits.

Cancelling Save As leaves automatic settings and status unchanged. An open manual dialog does not block annotation saves. Manual and automatic download completion are reported separately.

## Restore and portability

Select a JSON file under **Restore or combine annotations**, review the counts, then click **Import annotations**. Existing notes remain. Missing IDs are added; exact duplicates are skipped; conflicting notes with the same ID keep the current local text/captions/timing. Current and monthly snapshots, older library exports and single-item JSON exports are accepted up to 20 MB. Invalid files are rejected before note writes. Markdown is for reading, not restoration.

Uninstalling removes the browser’s notes/settings/tracking, but completed backup files remain on disk. After reinstalling, import a JSON backup to restore your library; FrameNote cannot scan an arbitrary folder automatically. Current-file first-use numbering protects files left by earlier installations.

## Migrating from direct-folder versions

Previously selected folder handles are no longer loaded or used. The old folder-access setup and Brave flag instructions have been removed from the active options page. Old direct-folder files remain untouched; the new automatic destination is the browser’s download location. Import an old backup if its notes are not already in browser storage. You may revoke old folder permissions through browser controls and leave Brave’s File System Access API disabled. FrameNote does not itself revoke grants made to older versions.

The legacy direct-folder adapter is no longer loaded or included in the source upload or release package.

## Supported players and limits

FrameNote supports accessible HTML video/audio elements, open shadow roots and permitted HTTP/HTTPS iframe embeds. Closed, canvas-only, restricted or sandboxed players can be inaccessible. Browser internal pages and local files are unsupported. Nearby headings are best-effort guesses. YouTube retains its earlier note IDs; ordinary website identity uses the page URL, frame/element and media-source path. Changes to website structure or URLs can produce a new item.

Captions come from active text tracks or supported visible caption renderers. Enable captions when needed. FrameNote does not transcribe audio or download transcripts. Native fullscreen can hide the panel; live timelines, redirects and unseekable media can limit timestamp navigation.

Automatic and manual full-library backups are limited to 20 MB so they can be restored. Larger libraries need per-item exports. Monthly files and explicit manual backups accumulate; FrameNote never automatically deletes files.

## Privacy and permissions

The extension uses `storage` for notes/settings, `alarms` for backup checks, and `downloads` to initiate and monitor backup downloads and recover its own monthly download records. It uses website access to discover players and render the panel. It does not request general read/write permission to a folder, use a native helper, or send notes to a server. Files and download records remain local to the browser/computer; other applications may sync a chosen download location according to their own settings.

Read the bundled [privacy policy](privacy.html), also linked from settings.

## Verification and release package

Run `node --test tests/backup.test.cjs` for validation, merge/concurrent saves, safe current filenames, monthly rollover/history recovery, download failures, restart recovery, Save As cancellation and queue independence.

Run `node tests/browser-smoke.cjs` for an isolated Brave check. `FRAMENOTE_BROWSER` can select another Chromium executable. The harness uses temporary profile/download folders, verifies actual automatic overwrites and monthly preservation, and requests a real manual `saveAs:true` download while CDP chooses the test destination instead of showing an OS dialog. It also checks imports, captions, video/audio/iframes, drafts, search, keyboard isolation and timestamp restore. The automatic-backup checkbox is tested by turning it off, restarting the entire isolated browser with the same profile, and reopening Options to verify it remains off. The native Save As dialog and live websites still need a manual release pass. The profile and screenshots are retained under `/private/tmp/framenote-browser-*`.

Run `python3 scripts/package.py` for a checked runtime-only ZIP with `manifest.json` at its root. Release notes and draft publication material are in `release/`. Nothing is published automatically.

## License

Source-available under the [FrameNote Personal Noncommercial License](LICENSE). Personal, noncommercial use and private modifications are allowed. Commercial/business use and redistribution of original or modified copies are prohibited, except for public-repository rights required by GitHub’s Terms of Service. Your own annotations are not restricted. Earlier MIT permissions are not revoked. See LICENSE for the full terms.
