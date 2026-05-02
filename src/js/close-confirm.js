// ── Close / quit confirmation ──────────────────────────────────────────────
// Intercepts window-close and auto-update install requests when the active
// profile has unsaved edits. Surfaces a 3-button modal (Save / Discard /
// Cancel) and dispatches based on the user's choice.
//
// Hooks two paths:
//   1. main.js sends 'app:close-requested' on every BrowserWindow close
//      attempt (X button, Alt+F4, OS shutdown). The renderer answers
//      via window.api.close.confirm('quit'|'cancel').
//   2. update-pill.js calls confirmCloseFor('install') before triggering
//      autoUpdater.quitAndInstall, so the same prompt covers updates.
//
// Dirty state union (chain edits + per-gauge calibration edits) lives in
// state.js as isProfileDirty(). When the profile is clean, the close /
// install paths short-circuit straight to confirm('quit') without
// showing the modal.

// Pending close action — set when the modal opens, consumed by the
// button handlers. One of: 'close' (window close), 'install' (auto-
// update install). Tracking the source lets the post-action callback
// route correctly: 'close' → window.api.close.confirm('quit'),
// 'install' → window.api.update.install().
let _pendingCloseAction = null;

function _showUnsavedModal(actionLabel) {
  const overlay = document.getElementById('unsavedOverlay');
  const msg = document.getElementById('unsavedMessage');
  if (!overlay || !msg) return false;
  // Re-word the message per action so "Discard and continue" is
  // unambiguous about WHAT it'll do next.
  msg.innerHTML = actionLabel === 'install'
    ? '<p>The active profile has unsaved changes. Restarting now to install the update will discard them. What would you like to do?</p>'
    : '<p>The active profile has unsaved changes. Closing now will discard them. What would you like to do?</p>';
  overlay.style.display = 'flex';
  return true;
}

function _hideUnsavedModal() {
  const overlay = document.getElementById('unsavedOverlay');
  if (overlay) overlay.style.display = 'none';
}

// Entry point reused by both close paths. Returns true once the action
// has been dispatched (either immediately when clean or after the
// user clicks through the modal). The caller doesn't await — the
// modal-button handlers do the dispatch directly.
function requestSafeClose(action) {
  const dirty = (typeof isProfileDirty === 'function') && isProfileDirty();
  if (!dirty) {
    _dispatchCloseAction(action);
    return;
  }
  _pendingCloseAction = action;
  _showUnsavedModal(action);
}

function _dispatchCloseAction(action) {
  if (action === 'install') {
    if (window.api?.update?.install) window.api.update.install();
  } else {
    // Default ('close') → tell main to release the window-close veto.
    if (window.api?.close?.confirm) window.api.close.confirm('quit');
  }
}

// ── Modal button handlers (called from inline onclick=) ──────────────────

async function onUnsavedSave() {
  // Save-and-continue: run the existing saveProfile flow, then proceed
  // with the pending close. saveProfile clears the dirty flag itself
  // on success; on failure it toasts the error and we cancel the
  // close so the user can fix things.
  try {
    if (typeof saveProfile === 'function') await saveProfile();
  } catch (e) {
    toast('Save failed: ' + (e.message || e));
    onUnsavedCancel();
    return;
  }
  // saveProfile clears _chainDirty and _gaugeDirty on success. If the
  // dirty flag is still set, treat as failure and stay open so the
  // user can address it.
  if (typeof isProfileDirty === 'function' && isProfileDirty()) {
    onUnsavedCancel();
    return;
  }
  _hideUnsavedModal();
  const action = _pendingCloseAction;
  _pendingCloseAction = null;
  _dispatchCloseAction(action || 'close');
}

function onUnsavedDiscard() {
  _hideUnsavedModal();
  const action = _pendingCloseAction;
  _pendingCloseAction = null;
  _dispatchCloseAction(action || 'close');
}

function onUnsavedCancel() {
  _hideUnsavedModal();
  // Cancel the pending close. For 'close' action, we tell main to
  // drop the close veto path (it doesn't release any state — main
  // just doesn't call mainWindow.close() again). For 'install', we
  // simply don't trigger the install — auto-update sticks at 'ready'
  // and the pill button stays clickable.
  if (_pendingCloseAction === 'close') {
    if (window.api?.close?.confirm) window.api.close.confirm('cancel');
  }
  _pendingCloseAction = null;
}

// ── IPC wiring ──────────────────────────────────────────────────────────

if (window.api?.close?.onCloseRequested) {
  window.api.close.onCloseRequested(() => requestSafeClose('close'));
}
