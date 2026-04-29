// ── Simtek 10-0294 — F-16 Fuel Quantity Indicator ───────────────────────────
//
// Source: Simtek 10-0294 spec sheet (Dropbox/Viper Pit/Gauges/Simtek/),
// Calibration Data Tables 1 (counter) and 2 (AL & FR pointers) on sheets
// 2 and 3. Three independent input/output channels:
//
//   1. Total Fuel  → Counter (4-digit totalizer wheels)
//      Range 0..9900 lbs displayed; 11 spec test points.
//
//   2. Aft/Left fuel  → AL pointer
//   3. Fore/Right fuel → FR pointer
//      Both pointers share the same calibration table per the spec
//      ("AL & FR POINTERS" label on Table 2). Dial face shows 0..42 in
//      "LBS x 100" units, so test points 0..42 correspond to 0..4200 lbs.
//      Each is rendered as its own piecewise channel so the user can
//      compensate for the two pointers drifting independently.
//
// Note: legacy on-disk Simtek100294HardwareSupportModule.config files in
// the wild carry a bare <MaxPoundsTotalFuel>NNNN</MaxPoundsTotalFuel>
// field at the document root. The C# uses it as the linear-rescale
// denominator: counter_volts = (input / MaxPoundsTotalFuel) * 20 - 10.
// It's a one-axis stretch knob — its job (input value that maps to +10 V)
// is fully subsumed by the editor's piecewise table (just edit the last
// breakpoint's input). Newer SimLinkup builds bypass it when <Channels>
// is present. We round-trip it as entry.legacyMaxPoundsTotalFuel so
// existing user installs running older SimLinkup keep working, the same
// pattern 10-0285 uses for its four legacy baro fields.

GAUGE_CALIBRATION_DEFAULTS['10-0294'] = Object.freeze({
  channels: [
    // ── Counter (totalizer wheels) ──────────────────────────────────────
    {
      id: '100294_Counter_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:    0, volts: -10.00 },
        { input: 1000, volts:  -7.98 },
        { input: 2000, volts:  -5.96 },
        { input: 3000, volts:  -3.94 },
        { input: 4000, volts:  -1.92 },
        { input: 5000, volts:   0.11 },  // electrical zero ≠ midpoint
        { input: 6000, volts:   2.12 },
        { input: 7000, volts:   4.14 },
        { input: 8000, volts:   6.16 },
        { input: 9900, volts:  10.00 },  // spec sheet's full-scale at 9900
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Aft/Left pointer ────────────────────────────────────────────────
    // Spec Table 2 inputs are in "× 100 lbs" units; breakpoints below
    // are converted to raw lbs to match the C# AnalogSignal.State
    // (0..42000 lbs range). Same table is used for FR below.
    {
      id: '100294_AL_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:    0, volts: -10.00 },
        { input:  500, volts:  -7.62 },
        { input: 1000, volts:  -5.24 },
        { input: 1500, volts:  -2.86 },
        { input: 2100, volts:   0.00 },  // electrical zero (≈ half-tank)
        { input: 2500, volts:   1.90 },
        { input: 3000, volts:   4.29 },
        { input: 3500, volts:   6.67 },
        { input: 4200, volts:  10.00 },  // spec full-scale (4200 lbs displayed)
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Fore/Right pointer ─────────────────────────────────────────────
    // Same spec table as AL; rendered separately so the user can
    // calibrate the two pointers' drift independently.
    {
      id: '100294_FR_To_Instrument',
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
