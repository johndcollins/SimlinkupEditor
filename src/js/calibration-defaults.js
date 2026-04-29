// ── Per-gauge calibration defaults — index + helpers ────────────────────────
//
// Spec-sheet defaults for each gauge HSM's transform layer. Mirrors the
// hardcoded if/else chains in lightningstools'
// src/SimLinkup/HardwareSupport/<Manufacturer>/*HardwareSupportModule.cs
// UpdateOutputValues() methods.
//
// **One file per gauge** lives in src/js/gauges/<file>.js — this file holds
// only the empty `GAUGE_CALIBRATION_DEFAULTS` index map (mutable, NOT frozen)
// and the helper functions. Each per-gauge file self-registers at script-load
// time:
//
//   GAUGE_CALIBRATION_DEFAULTS['10-0207'] = Object.freeze({ ... });
//
// Per-gauge files load AFTER this file in index.html (see the marked block in
// the script-tag list). The inner per-gauge entry IS frozen, so callers can
// safely treat the result of `gaugeCalibrationDefaultsFor(pn)` as immutable;
// only the outer map is mutable to allow registration.
//
// Adding a new gauge:
//   1. Create src/js/gauges/<manufacturer>-<digits>-<short>.js with the
//      breakpoints/transform extracted from the C# UpdateOutputValues().
//   2. Add a `<script src="js/gauges/<file>.js"></script>` tag inside the
//      "Gauge calibration defaults" block in index.html.
//   3. That's it — the Calibration tab auto-discovers the entry via
//      gaugeCalibrationDefaultsFor and renders a card for it.
//
// Schema for one entry (per-gauge file produces this shape):
//   <pn>: {
//     channels: [
//       { id: '<HSM-port-id>',
//         kind: 'piecewise' | 'linear' | 'resolver' | 'piecewise_resolver'
//             | 'digital_invert' | 'multi_resolver' | 'cross_coupled',
//         // pattern-specific fields:
//         breakpoints: [{ input, volts }, ...]    // piecewise
//         breakpoints: [{ input, angle }, ...]    // piecewise_resolver (deg)
//         inputMin, inputMax                       // linear, resolver
//         angleMinDegrees, angleMaxDegrees,
//         peakVolts, belowMinBehavior              // resolver
//         peakVolts                                // piecewise_resolver
//         unitsPerRevolution, peakVolts            // multi_resolver
//         role, partnerChannel                     // resolver, piecewise_resolver, multi_resolver
//         coupledTo: '<other-channel-id>'          // cross_coupled
//         invert: true|false                       // digital_invert
//         // (multi_resolver: schema reserved, no editor yet)
//         zeroTrim: <volts>,                       // analog kinds
//         gainTrim: <unitless multiplier> }        // analog kinds
//     ]
//   }
//
// A gauge without an entry here gets a stub "no calibration editor yet" card
// on the Calibration tab — but the on-disk profile is still produced cleanly
// (the chain still parses, the .mapping files still emit).

// Mutable index map — per-gauge files in src/js/gauges/ assign into this.
// Inner entries are frozen by their own files; the outer map stays open so
// new gauges can register without rebuilding the editor.
const GAUGE_CALIBRATION_DEFAULTS = {};

// Per-channel zero-trim and gain-trim defaults. Used by the piecewise editor
// to detect "user edited a trim field" vs "matches spec-sheet defaults".
const CALIBRATION_TRIM_DEFAULTS = Object.freeze({ zeroTrim: 0, gainTrim: 1 });

// Returns the spec-sheet default record for a gauge, or null if the editor
// doesn't yet know how to calibrate this gauge. The returned object is the
// frozen template — clone it (cloneGaugeCalibrationDefault) before mutating.
function gaugeCalibrationDefaultsFor(pn) {
  return GAUGE_CALIBRATION_DEFAULTS[pn] || null;
}

// Deep-clone a default record into a fresh, mutable object that can be edited
// in p.gaugeConfigs[pn]. Each breakpoint is its own {input, volts} object, so
// editing a row in one gauge doesn't bleed into the template or other gauges.
function cloneGaugeCalibrationDefault(pn) {
  const tpl = GAUGE_CALIBRATION_DEFAULTS[pn];
  if (!tpl) return null;
  return {
    channels: tpl.channels.map(ch => {
      const cloned = {
        id: ch.id,
        kind: ch.kind,
        // Carry both volts and angle on each breakpoint — only the kind's
        // expected attribute will be populated.
        breakpoints: (ch.breakpoints || []).map(bp => {
          const c = { input: bp.input };
          if (typeof bp.volts === 'number') c.volts = bp.volts;
          if (typeof bp.angle === 'number') c.angle = bp.angle;
          return c;
        }),
        zeroTrim: ch.zeroTrim ?? CALIBRATION_TRIM_DEFAULTS.zeroTrim,
        gainTrim: ch.gainTrim ?? CALIBRATION_TRIM_DEFAULTS.gainTrim,
      };
      // Linear-kind fields are optional — only carry them when the template
      // declares them. Saves us emitting them as "undefined" for non-linear
      // channels which would confuse the round-trip.
      if (typeof ch.inputMin === 'number') cloned.inputMin = ch.inputMin;
      if (typeof ch.inputMax === 'number') cloned.inputMax = ch.inputMax;
      // Resolver-kind fields. Same nullable convention. role/partnerChannel
      // identify a sin/cos pair on disk (sin carries the body; cos carries
      // just the pointer back). All carried verbatim from the template.
      if (typeof ch.angleMinDegrees === 'number') cloned.angleMinDegrees = ch.angleMinDegrees;
      if (typeof ch.angleMaxDegrees === 'number') cloned.angleMaxDegrees = ch.angleMaxDegrees;
      if (typeof ch.peakVolts === 'number') cloned.peakVolts = ch.peakVolts;
      if (ch.belowMinBehavior) cloned.belowMinBehavior = ch.belowMinBehavior;
      if (ch.role) cloned.role = ch.role;
      if (ch.partnerChannel) cloned.partnerChannel = ch.partnerChannel;
      // coupledTo: names another channel this one feeds into for
      // cross-coupling. Used by 10-0194 Mach (whose piecewise output
      // becomes a "reference voltage" that the C# combines with the
      // current airspeed output before writing to the DAC).
      if (ch.coupledTo) cloned.coupledTo = ch.coupledTo;
      // multi_resolver: single field beyond the resolver basics.
      if (typeof ch.unitsPerRevolution === 'number') cloned.unitsPerRevolution = ch.unitsPerRevolution;
      // digital_invert: single boolean field.
      if (typeof ch.invert === 'boolean') cloned.invert = ch.invert;
      return cloned;
    }),
  };
}

// Return true when a profile-level p.gaugeConfigs[pn] entry differs from the
// spec-sheet defaults — used to color the card header and surface the
// "N edited" badge on the tab title. Compares structurally (input/volts as
// numbers, trim fields with a small tolerance).
function gaugeCalibrationIsEdited(pn, entry) {
  const tpl = GAUGE_CALIBRATION_DEFAULTS[pn];
  if (!tpl || !entry || !Array.isArray(entry.channels)) return false;
  if (entry.channels.length !== tpl.channels.length) return true;
  const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
  for (let i = 0; i < tpl.channels.length; i++) {
    const t = tpl.channels[i];
    const e = entry.channels[i];
    if (!e || e.id !== t.id || e.kind !== t.kind) return true;
    if (!eq(e.zeroTrim ?? 0, t.zeroTrim ?? 0)) return true;
    if (!eq(e.gainTrim ?? 1, t.gainTrim ?? 1)) return true;
    const bps = e.breakpoints || [];
    if (bps.length !== (t.breakpoints || []).length) return true;
    for (let j = 0; j < bps.length; j++) {
      if (!eq(bps[j].input, t.breakpoints[j].input)) return true;
      // Compare whichever output attribute the template uses (volts for
      // piecewise, angle for piecewise_resolver). Both sides should agree
      // on which one is set — but if not, treat as edited.
      if (typeof t.breakpoints[j].volts === 'number') {
        if (!eq(bps[j].volts, t.breakpoints[j].volts)) return true;
      }
      if (typeof t.breakpoints[j].angle === 'number') {
        if (!eq(bps[j].angle, t.breakpoints[j].angle)) return true;
      }
    }
    // digital_invert: compare invert bool.
    if (typeof t.invert === 'boolean' || typeof e.invert === 'boolean') {
      if ((e.invert ?? t.invert ?? false) !== (t.invert ?? false)) return true;
    }
    // Linear: compare inputMin / inputMax. Nullable on both sides — only
    // flag edited when one is set and they differ. Templates without these
    // fields skip the check entirely (piecewise/etc.).
    if (typeof t.inputMin === 'number' || typeof e.inputMin === 'number') {
      if (!eq(e.inputMin ?? t.inputMin ?? 0, t.inputMin ?? 0)) return true;
    }
    if (typeof t.inputMax === 'number' || typeof e.inputMax === 'number') {
      if (!eq(e.inputMax ?? t.inputMax ?? 0, t.inputMax ?? 0)) return true;
    }
    // Resolver: angleMin/Max, peakVolts, belowMinBehavior. Same nullable
    // convention. role/partnerChannel are structural (set by the template
    // and not user-edited) so they're excluded from this check.
    if (typeof t.angleMinDegrees === 'number' || typeof e.angleMinDegrees === 'number') {
      if (!eq(e.angleMinDegrees ?? t.angleMinDegrees ?? 0, t.angleMinDegrees ?? 0)) return true;
    }
    if (typeof t.angleMaxDegrees === 'number' || typeof e.angleMaxDegrees === 'number') {
      if (!eq(e.angleMaxDegrees ?? t.angleMaxDegrees ?? 0, t.angleMaxDegrees ?? 0)) return true;
    }
    if (typeof t.peakVolts === 'number' || typeof e.peakVolts === 'number') {
      if (!eq(e.peakVolts ?? t.peakVolts ?? 10, t.peakVolts ?? 10)) return true;
    }
    if (t.belowMinBehavior || e.belowMinBehavior) {
      if ((e.belowMinBehavior || t.belowMinBehavior) !== (t.belowMinBehavior || '')) return true;
    }
    if (typeof t.unitsPerRevolution === 'number' || typeof e.unitsPerRevolution === 'number') {
      if (!eq(e.unitsPerRevolution ?? t.unitsPerRevolution ?? 1, t.unitsPerRevolution ?? 1)) return true;
    }
  }
  return false;
}

// Validate a piecewise channel for the warnings the UI surfaces. Returns
//   { ok, warnings: [string, ...] }
// Non-blocking — values still save; warnings are advisory.
function validatePiecewiseChannel(ch) {
  const warnings = [];
  const bps = (ch && ch.breakpoints) || [];
  if (bps.length < 2) {
    warnings.push('At least 2 breakpoints required.');
    return { ok: false, warnings };
  }
  for (let i = 1; i < bps.length; i++) {
    if (!(Number(bps[i].input) > Number(bps[i-1].input))) {
      warnings.push(`Inputs must be strictly ascending (row ${i+1} ≤ row ${i}).`);
      break;
    }
  }
  for (const bp of bps) {
    const v = Number(bp.volts);
    if (!Number.isFinite(v) || v < -10 || v > 10) {
      warnings.push('Volts outside ±10 V will be clamped by the gauge HSM.');
      break;
    }
  }
  return { ok: warnings.length === 0, warnings };
}
