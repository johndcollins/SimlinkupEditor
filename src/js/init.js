// ── Init ─────────────────────────────────────────────────────────────────────
// IIFE that runs after every other JS file is loaded. Pulls static data via
// IPC, hydrates INSTRUMENTS / SIM_SIGNALS, then either auto-loads the saved
// mapping directory or auto-detects the SimLinkup install on first launch.
//
// MUST be the last <script> tag in index.html — every other file must have
// declared its functions and globals before this fires.

// ── Safety disclaimer (first launch only) ──────────────────────────────────
// Shown when settings.disclaimerAcceptedAt is unset. Accept persists the
// timestamp + app version to settings.json so this never reappears for the
// user; refuse closes the app outright (the user must accept before they
// can use the tool).
//
// These handlers are defined at module scope (not inside the IIFE) so the
// inline onclick= attributes in index.html's modal markup can call them.

// Promise-based gate — init's IIFE awaits this before doing anything else.
// Resolves with `true` when the user accepts; never resolves on decline
// (the app quits before the promise can settle).
let _disclaimerResolve = null;

function showDisclaimerModal() {
  const overlay = document.getElementById('disclaimerOverlay');
  if (overlay) overlay.style.display = 'flex';
  return new Promise(resolve => { _disclaimerResolve = resolve; });
}

function updateDisclaimerAcceptButton() {
  const cb = document.getElementById('disclaimerCheckbox');
  const btn = document.getElementById('disclaimerAcceptBtn');
  if (cb && btn) btn.disabled = !cb.checked;
}

async function acceptDisclaimer() {
  const cb = document.getElementById('disclaimerCheckbox');
  if (!cb || !cb.checked) return;
  const overlay = document.getElementById('disclaimerOverlay');
  if (overlay) overlay.style.display = 'none';
  // Persist acceptance. Use ISO timestamp so future tooling can tell when
  // each user agreed; appVersion lets us re-prompt on a future build if
  // the disclaimer text changes materially.
  try {
    await window.api.saveSettings({
      disclaimerAcceptedAt: new Date().toISOString(),
      disclaimerAcceptedAppVersion: '1.0.0',
    });
  } catch {
    // Failing to persist is non-fatal — the user accepted, the app
    // proceeds. They'll see the modal again on next launch if the file
    // truly couldn't be written.
  }
  if (_disclaimerResolve) _disclaimerResolve(true);
}

async function declineDisclaimer() {
  // Close the app. We don't persist anything — the next launch shows the
  // modal again, which is correct: the user hasn't agreed to anything.
  try { await window.api.quitApp(); } catch {}
  // Belt-and-suspenders: if the IPC fails for any reason, also try to
  // close the window directly.
  try { window.close(); } catch {}
}

(async () => {
  // Disclaimer gate. Check settings BEFORE doing anything that probes the
  // user's filesystem (auto-detect, load static data, etc.) so the user
  // gets the modal immediately on first launch with nothing happening
  // behind it.
  let initialSettings = {};
  try { initialSettings = await window.api.loadSettings(); } catch {}
  if (!initialSettings.disclaimerAcceptedAt) {
    await showDisclaimerModal();
    // After accept, reload settings so the rest of init sees the freshly
    // persisted disclaimerAcceptedAt alongside any other fields.
    try { initialSettings = await window.api.loadSettings(); } catch {}
  }

  // Load static data — every renderer path reads INSTRUMENTS / SIM_SIGNALS.
  const data = await window.api.loadStaticData();
  if (data) {
    INSTRUMENTS = data.instruments || [];
    // Backfill digitPrefix on entries that don't have it. Older seeded copies
    // of instruments.json (in %APPDATA%) predate this field. The default —
    // strip dashes from `pn` — is correct for every gauge we currently know
    // about EXCEPT 10-0207_110, whose C# class emits port IDs with prefix
    // "100207" (the _110 suffix is in the class name and PN but not the IDs).
    //
    // Backfill manufacturer the same way for older seeds: derive from the
    // namespace segment of `cls` (SimLinkup.HardwareSupport.<Manufacturer>.…).
    // Falls back to "Unknown" if the cls doesn't match the expected shape.
    for (const inst of INSTRUMENTS) {
      if (!inst.digitPrefix) {
        inst.digitPrefix = inst.pn === '10-0207_110' ? '100207' : inst.pn.replace(/-/g, '');
      }
      if (!inst.manufacturer) {
        const m = inst.cls && inst.cls.match(/^SimLinkup\.HardwareSupport\.([^.]+)\./);
        inst.manufacturer = m ? m[1] : 'Unknown';
      }
    }
    SIM_SIGNALS = data.simSignals || {};
    DATA_SOURCES = data.sources || DATA_SOURCES;
    if (data.errors?.instruments) {
      toast('Could not load user override instruments.json: ' + data.errors.instruments + '. Using bundled defaults.');
    }
    for (const [key, err] of Object.entries(data.errors || {})) {
      if (key.startsWith('sim_')) {
        toast(`Could not load ${key.slice(4)} signals: ${err}. Using bundled defaults.`);
      }
    }
  }

  // Settings already loaded at the top of init for the disclaimer check;
  // reuse that read instead of round-tripping again.
  if (initialSettings.mappingDir) {
    await setDir(initialSettings.mappingDir, false);
    return;
  }
  const detected = await window.api.detectMappingDir();
  if (detected) await setDir(detected, true);
})();
