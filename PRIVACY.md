# FrameNote privacy policy

Effective November 11, 2026. The bundled readable policy is [privacy.html](privacy.html).

FrameNote processes media information locally to provide timestamped annotations. It stores saved comments, playback times, accessible captions, page URLs, tab titles, nearby headings and player identities in browser extension storage. Player identities may include media-source paths, but omit media-source query parameters and temporary blob URLs. Website access discovers players and presents the annotation window; it is not used to maintain a browsing-history log.

FrameNote has no backend, accounts, analytics, advertising or server uploads. It does not sell or share data. Media descriptions are relayed locally between permitted frames and the extension. Page URLs, notes and captions can contain private information.

Unfinished drafts remain in tab memory until the document reloads. Settings, saved notes and backup tracking remain in the browser profile. Automatic backups use ordinary browser downloads in a FrameNote subfolder of the configured download location. A current JSON file is updated after changes; monthly snapshots are preserved. Manual backup uses the browser’s Save As dialog for a destination chosen for that single file. FrameNote monitors download completion and queries its own monthly backup records in browser download history. It does not read arbitrary folder contents, request direct folder permission, use a companion app or require a Brave API flag. Earlier folder handles are no longer used; any old browser grants can be revoked through browser controls.

Users can edit/delete saved notes, export/import their library, disable automatic downloads, change the browser’s download location, select a manual Save As destination, revoke extension permissions or uninstall. Uninstalling removes extension storage/tracking; completed backup files remain. Deleting a note updates the current automatic backup when enabled, but existing monthly snapshots and manual exports retain their contents. No backup files are automatically deleted. Monthly duplicates can be created if download history and extension tracking are lost; existing monthly files are not overwritten. First-use current-file naming preserves preexisting files.

Backups are readable JSON. The browser maintains download metadata; files and browser data can be accessed by software with the relevant permissions on the computer. If another application syncs a backup location, its settings apply.

Permissions: `storage` saves notes/preferences/tracking; `alarms` checks month rollover, missing downloads and retries; `downloads` initiates/monitors backups and queries matching download records; website access discovers media and renders annotations. No cloud service permissions or direct filesystem folder grants are required.
