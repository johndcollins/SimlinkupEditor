// ── Auto-update pill ─────────────────────────────────────────────────────────
//
// Surfaces the editor's auto-update status in the titlebar's right cluster.
// State machine matches main.js's update-status contract:
//
//   idle        — no update activity. Hidden in dev, shown as "Up to date"
//                 in packaged builds after the first check completes.
//   checking    — initial network round-trip. Brief; usually invisible.
//   available   — release found, download starting. Pill turns blue.
//   downloading — download in progress with a percentage. Pill stays blue.
//   ready       — download complete; "Restart and install" button appears.
//                 Pill turns green to signal the action.
//   error       — network failure or auth issue. Pill turns amber with a
//                 "Retry" action.
//
// Renders once on DOMContentLoaded then subscribes to push updates from the
// main process. No polling.

(function initUpdatePill() {
  if (!window.api || !window.api.update) return; // dev-only / preload missing

  const pill = document.getElementById('updatePill');
  const text = document.getElementById('updatePillText');
  const actionBtn = document.getElementById('updatePillAction');
  if (!pill || !text || !actionBtn) return;

  function applyStatus(status) {
    if (!status) return;
    const { state, message, error } = status;

    // Hide entirely in dev — main.js sets state='idle' with the
    // "disabled in dev" message and there's nothing the user can do
    // about it. Showing the pill would just be noise during development.
    const devMessage = message && message.toLowerCase().includes('dev');
    if (devMessage) {
      pill.style.display = 'none';
      return;
    }

    pill.style.display = '';
    pill.classList.remove(
      'update-pill-idle',
      'update-pill-checking',
      'update-pill-available',
      'update-pill-downloading',
      'update-pill-ready',
      'update-pill-error',
    );
    pill.classList.add(`update-pill-${state}`);

    text.textContent = message || state;
    pill.title = error ? `Update error: ${error}` : (message || 'Auto-update status');

    // Drive the inner action button per state.
    if (state === 'ready') {
      actionBtn.style.display = '';
      actionBtn.textContent = 'Restart and install';
      actionBtn.onclick = () => {
        // requestSafeClose checks for unsaved profile edits and shows
        // the same Save / Discard / Cancel modal used by window-close.
        // When the profile is clean it short-circuits straight to
        // window.api.update.install().
        if (typeof requestSafeClose === 'function') {
          requestSafeClose('install');
        } else {
          // Belt-and-suspenders fallback if close-confirm.js failed
          // to load — preserve the original prompt-and-install flow
          // so the install path is never silently broken.
          const ok = confirm('Restart the editor now to install the update?\n\nUnsaved profile changes will be lost.');
          if (ok) window.api.update.install();
        }
      };
    } else if (state === 'error') {
      actionBtn.style.display = '';
      actionBtn.textContent = 'Retry';
      actionBtn.onclick = () => window.api.update.check();
    } else {
      actionBtn.style.display = 'none';
      actionBtn.onclick = null;
    }
  }

  // Initial paint from the current snapshot. The renderer may load before
  // main.js has fired its first `update-not-available` / `update-available`
  // event, so getStatus() returns whatever main has so far ('idle' on first
  // call, 'checking' once the timer fires).
  window.api.update.getStatus().then(applyStatus).catch(() => {});

  // Subscribe to push events for state transitions.
  window.api.update.onStatus(applyStatus);
})();
