// ── Util ─────────────────────────────────────────────────────────────────────
// Small helpers used across the renderer. No state, no dependencies on other
// renderer files (other than the global `toast` DOM element in index.html).

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setSelectValue(selectEl, value) {
  if (!selectEl) return;
  for (const opt of selectEl.options) {
    if (opt.value === (value ?? '')) { opt.selected = true; return; }
  }
}

// ── Numeric / boolean coercion helpers ──
// Used by every driver's parser/backfill to coerce raw XML text into typed
// values, falling back to a default when the input is missing or malformed.

function adClamp(raw, max, dflt) {
  if (raw == null || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.round(n), 0), max);
}

function intClamp(raw, min, max, dflt) {
  if (raw == null || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.round(n), min), max);
}

// Float clamp — used for HenkSDI calibration <Input> values which are 0..1
// real numbers ("0.000000000001" appears in samples to force step transitions).
function floatClamp(raw, min, max, dflt) {
  if (raw == null || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}

// Bool coercion — case-insensitive 'true'/'false'.
function boolFromText(raw, dflt) {
  if (raw == null) return dflt;
  const s = String(raw).trim().toLowerCase();
  if (s === 'true')  return true;
  if (s === 'false') return false;
  return dflt;
}

// ── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
