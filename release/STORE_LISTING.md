# Draft store listing — FrameNote 1.6.5

Name: FrameNote — Browser Media Annotations

Short description: Timestamped notes for browser video and audio players, with nearby headings, captions, a library and local JSON backups.

Category suggestion: Productivity / Tools

## Description

Remember the exact moment that mattered.

FrameNote adds a draggable notebook beside standard video and audio players on websites. Capture a playback timestamp, write a private comment, and save available captions, the page link, tab title and nearby heading.

- Choose between multiple players, including accessible embeds.
- Search your Library by title, comment, URL, heading or caption.
- Jump to timestamps, edit notes, and keep unfinished drafts while switching panel views/players in the same document.
- Export Markdown or JSON and import older FrameNote backups.
- Automatically download a current JSON backup and a snapshot for each active month to a FrameNote subfolder of the browser’s configured download location.
- Use **Save backup as…** to choose a separate folder and filename for a manual backup.

No accounts, ads, analytics or server uploads. No companion app or Brave file-access flag is required. Notes stay in the browser profile, with readable JSON backups stored on your computer. Uninstalling removes the browser copy; completed backup files remain and can be imported after reinstalling.

Shortcut: Alt / Option + Shift + N opens the panel; Ctrl/Cmd + Enter saves; Escape closes. Page shortcuts are blocked while the panel has focus.

FrameNote supports accessible HTML video/audio, open shadow roots and permitted embeds. Some closed, canvas-only, restricted or sandboxed players are inaccessible. It reads available captions, but does not transcribe audio or download full transcripts. Live timelines, redirects and unseekable players may limit navigation. Drafts do not survive a document reload.

Automatic backups use browser downloads and download records, not direct directory access. After reinstalling and losing download history, an extra numbered monthly file may be created. Existing monthly snapshots are not overwritten. Each manual backup asks for a Save As destination and grants no continuing folder access.

## Publisher fields

Supply support contact/URL, public privacy-policy URL and representative screenshots before publication. The bundled privacy policy describes the implementation and must be hosted by the publisher for the listing.

Permission justifications:

- Website access: find accessible media in HTTP/HTTPS tabs/frames, capture time/captions, display annotations.
- Storage: saved notes, preferences and backup tracking.
- Alarms: monthly/missing-download checks and retries.
- Downloads: initiate and monitor automatic/manual backups and recover matching monthly backup download records.

FrameNote processes website content and annotations locally; do not describe it as processing no user data merely because it has no server.

Official references: [User data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), [Program policies](https://developer.chrome.com/docs/webstore/program-policies/policies).

Software license: FrameNote Personal Noncommercial License. Personal, noncommercial use and private modifications only; no commercial/business use or redistribution, except GitHub-required platform rights. User annotations are not restricted by the software license.
