// ── Simtek 10-1089-02 — F-16 Fuel Quantity Indicator (v2) ───────────────────
//
// Source: Simtek 10-1089 spec sheet (Dropbox/Viper Pit/Gauges/Simtek/) and
// Simtek10108902HardwareSupportModule.cs:UpdateOutputValues() lines 296-307.
// Same dial family as 10-0294 — the inner needles on the dial face are
// labelled SEL LBS×100, scale 0..40 (= 0..4000 lbs displayed each), with
// a TOTAL LBS counter window in the lower half. Three independent
// input/output channels:
//
//   1. Total Fuel  → Counter (4-digit totalizer wheels). Scale 0..20100 lbs
//      mapped linearly to -10..+10 V. The 20100 max is hardcoded in the
//      C# (vs 10-0294's editable 9900 max — different aircraft variant).
//
//   2. Aft/Left fuel  → AL pointer
//   3. Fore/Right fuel → FR pointer
//      Both pointers share the same linear math `value / 100 / 42 * 20 - 10`,
//      identical to 10-0294. Spec test points 0..4200 lbs → -10..+10 V are
//      reused verbatim.
//
// Spec sheet itself (sheets 3-4) shows only the case configuration, dial
// face, and pin designations — no calibration data table. The default
// breakpoint values below come from the C# linear formula evaluated at
// representative lbs values, matching the 10-0294 spec table for the
// pointers (same gauge mechanism, same scale) and synthesising 11 points
// for the counter across the larger 0..20100 range.
//
// No legacy bare-property field on this gauge — the counter denominator
// is hardcoded in the C# (no LoadConfig path), so there's nothing to
// round-trip à la 10-0294's MaxPoundsTotalFuel.

GAUGE_CALIBRATION_DEFAULTS['10-1089-02'] = Object.freeze({
  channels: [
    // ── Counter (totalizer wheels), 0..20100 lbs ─────────────────────────
    // Synthetic linear breakpoints across the C# range. Bigger steps at
    // the top end since the C# math is purely linear; users can re-densify
    // by adding rows wherever their hardware drifts.
    {
      id: '10108902_Counter_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:     0, volts: -10.00 },
        { input:  2010, volts:  -8.00 },
        { input:  4020, volts:  -6.00 },
        { input:  6030, volts:  -4.00 },
        { input:  8040, volts:  -2.00 },
        { input: 10050, volts:   0.00 },  // electrical zero (midpoint)
        { input: 12060, volts:   2.00 },
        { input: 14070, volts:   4.00 },
        { input: 16080, volts:   6.00 },
        { input: 18090, volts:   8.00 },
        { input: 20100, volts:  10.00 },  // full scale (C# hardcoded)
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Aft/Left pointer ─────────────────────────────────────────────────
    // Same as 10-0294 AL: 0..4200 lbs → -10..+10 V linear, electrical
    // zero at 2100 lbs (≈ half-tank). Spec test points reused.
    {
      id: '10108902_AL_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:    0, volts: -10.00 },
        { input:  500, volts:  -7.62 },
        { input: 1000, volts:  -5.24 },
        { input: 1500, volts:  -2.86 },
        { input: 2100, volts:   0.00 },
        { input: 2500, volts:   1.90 },
        { input: 3000, volts:   4.29 },
        { input: 3500, volts:   6.67 },
        { input: 4200, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Fore/Right pointer ──────────────────────────────────────────────
    // Independent piecewise channel so the user can correct each pointer
    // separately for hardware drift.
    {
      id: '10108902_FR_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:    0, volts: -10.00 },
        { input:  500, volts:  -7.62 },
        { input: 1000, volts:  -5.24 },
        { input: 1500, volts:  -2.86 },
        { input: 2100, volts:   0.00 },
        { input: 2500, volts:   1.90 },
        { input: 3000, volts:   4.29 },
        { input: 3500, volts:   6.67 },
        { input: 4200, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
