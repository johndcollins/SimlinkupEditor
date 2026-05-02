// ── State ────────────────────────────────────────────────────────────────────
// Top-level mutable state. Loaded first so every other file can read these
// globals at call time.
//
// INSTRUMENTS and SIM_SIGNALS are loaded asynchronously from JSON files at
// startup (see init.js). The bundled defaults ship at src/data/instruments.json
// and src/data/sim-<id>-signals.json; users can override any of these by
// dropping a copy into their userData folder (see "Data folder" in the
// titlebar).
//
// instruments.json shape:  array of { pn, name, cls, cat, analog_in, analog_out,
//   digital_in, digital_out, inputPorts: [{port,label,kind}], outputGroups:
//   [{kind,label,ports:[{role,port,kind}]}], digitPrefix }.
//   outputGroups.kind: 'analog_single' | 'digital_single' | 'resolver_pair'.
//
// sim-<id>-signals.json:   { scalar: [{id,kind,coll,sub,label}],
//                            indexed: [...same shape; append [N] to id] }.
//
// SIM_SIGNALS is a map: { simId: { scalar: [...], indexed: [...] } }. The
// Mappings tab's source dropdown unions across declared sims (one per active
// SimSupport entry) and labels each <optgroup> with the sim name so signals
// from different sims stay distinguishable.
let INSTRUMENTS = [];
let SIM_SIGNALS = {};   // { simId: { scalar, indexed } }
let DATA_SOURCES = { instruments: 'unknown' };

let mappingDir = null;
let defaultProfile = null;
let profiles = [];       // [{ name, instruments:[pn], chain:{edges,instruments}, loaded }]
let activeIdx = null;
let activeTab = 'hardware';
let instSearch = '';
let instFilter = 'all';
let instMfrFilter = 'all';

// Mappings tab filter state. Same persistence model as the
// Instruments-tab filters above (module-scope let, persists across
// re-renders within a session, resets on page reload).
//   mapSearch       — substring match against card title (gauge name,
//                     gauge PN, direct group name).
//   mapStatusFilter — 'all' | 'complete' | 'partial' | 'none' | 'broken'.
//   mapTypeFilter   — 'all' | 'gauges' | 'direct'.
let mapSearch = '';
let mapStatusFilter = 'all';
let mapTypeFilter = 'all';

// Chain-dirty tracker. True when the active profile has unsaved
// non-calibration edits (signal mappings, declared instruments,
// declared drivers, hardware config, declared sim-support, direct
// groups). Calibration dirtiness is tracked separately via
// _gaugeDirty in tab-calibration.js — isProfileDirty() unions both.
//
// Cleared when:
//   - the user saves the profile (saveProfile)
//   - the user switches to a different profile (selectProfile)
//   - a profile is loaded from disk (applyLoadedChain)
//
// Used by:
//   - the close-confirmation flow (main.js sends 'app:check-dirty'
//     before before-quit; the renderer answers with isProfileDirty())
//   - the auto-update install-now button (skips the prompt when clean)
let _chainDirty = false;
function markChainDirty() { _chainDirty = true; }
function clearChainDirty() { _chainDirty = false; }
function isChainDirty() { return _chainDirty; }

// Union of chain-dirty + any-gauge-dirty. Returns true when the active
// profile has ANY unsaved state. Defensive against tab-calibration.js
// not yet being loaded (init order should make this moot, but the
// check costs nothing).
function isProfileDirty() {
  if (_chainDirty) return true;
  if (typeof _gaugeDirty !== 'undefined' && _gaugeDirty.size > 0) return true;
  return false;
}
