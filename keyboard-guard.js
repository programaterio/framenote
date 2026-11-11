(() => {
  'use strict';

  // Register before YouTube installs its own keyboard shortcuts. A content
  // script at document_start runs in the extension's isolated world, but the
  // capture listener still participates in the shared DOM event path.
  const panelHasFocus = () => document.activeElement?.id === 'framenote-root';

  function guard(event) {
    if (!panelHasFocus()) return;

    // Keep events away from YouTube's page-level shortcut listeners without
    // cancelling the browser's default text editing or keyboard behavior.
    event.stopImmediatePropagation();
    globalThis.__frameNoteHandleKey?.(event);

    // Handle our own shortcut here: stopping at window capture means a
    // textarea's keydown handler would never see Ctrl/Cmd+Enter.
    if (event.type === 'keydown' && event.key === 'Enter' &&
        (event.ctrlKey || event.metaKey) && !event.isComposing) {
      globalThis.__frameNoteHandleSaveShortcut?.(event);
    }
  }

  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(type, guard, true);
  }
})();
