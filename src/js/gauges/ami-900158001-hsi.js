// ── AMI 9001580-01 — F-16 HSI ───────────────────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/AMI/
//         AMI900158001HardwareSupportModule.cs.
//
// The biggest non-Henk gauge in the catalog — a horizontal situation
// indicator with 11 distinct output channels:
//
//   1. Compass SIN/COS pair       (piecewise_resolver, identity)
//   2. Course SIN/COS pair        (piecewise_resolver, identity)
//   3. Course Deviation           (piecewise — linear, percent of limit)
//   4. DME × 100 SIN/COS pair     (multi_resolver, 10 digit-units/rev)
//   5. DME × 10 SIN/COS pair      (multi_resolver, 10 digit-units/rev)
//   6. DME × 1 SIN/COS pair       (multi_resolver, 10 digit-units/rev)
//   7. OFF flag                   (digital_invert, invert: false — pass-through)
//   8. FROM flag                  (digital_invert, invert: false)
//   9. TO flag                    (digital_invert, invert: false)
//  10. Deviation flag             (digital_invert, invert: false)
//  11. DME shutter                (digital_invert, invert: false)
//
// CROSS-COUPLED CHANNELS (no direct calibration UI):
//
//  A. Bearing SIN/COS — `sin/cos(-(magneticHeading − bearingToBeacon))`
//     The pointer always points at the beacon, so its resolver position
//     depends on BOTH the compass input AND the bearing-to-beacon input.
//     User calibrates by tuning the compass channel's piecewise table —
//     the bearing pointer's geometry takes care of itself.
//
//  B. Heading SIN/COS — `sin/cos(desiredHeading − magneticHeading)`
//     The heading-bug position is desired-vs-actual heading. Same shape:
//     calibrate via compass; bug follows.
//
// Both A and B are NOT exposed in GAUGE_CALIBRATION_DEFAULTS for this
// gauge — the calibration card omits them entirely (showing only the 11
// non-cross-coupled channels). A future "cross_coupled stub" UI surface
// could surface them as read-only display, but for Phase 1 we keep the
// surface minimal: calibrate the inputs, the cross-coupling math is
// gauge geometry.
//
// Note: the C# DME math splits the input distance (NM) into three
// digits via string formatting and renders each on its own digit drum.
// Each drum is a multi_resolver where 10 digit-positions = 1 revolution
// (i.e. unitsPerRevolution = 10 for each of x100/x10/x1 inputs).

GAUGE_CALIBRATION_DEFAULTS['9001580-01'] = Object.freeze({
  channels: [
    // ── Compass resolver pair (piecewise_resolver, identity 0..360°) ───
    {
      id: '900158001_Compass_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '900158001_Compass_COS_To_Instrument',
      inputMin: 0,
      inputMax: 360,
      breakpoints: [
        { input:   0, angle:   0 },
        { input:  30, angle:  30 },
        { input:  60, angle:  60 },
        { input:  90, angle:  90 },
        { input: 120, angle: 120 },
        { input: 150, angle: 150 },
        { input: 180, angle: 180 },
        { input: 210, angle: 210 },
        { input: 240, angle: 240 },
        { input: 270, angle: 270 },
        { input: 300, angle: 300 },
        { input: 330, angle: 330 },
        { input: 360, angle: 360 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '900158001_Compass_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '900158001_Compass_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Course resolver pair (piecewise_resolver, identity 0..360°) ────
    {
      id: '900158001_Course_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '900158001_Course_COS_To_Instrument',
      inputMin: 0,
      inputMax: 360,
      breakpoints: [
        { input:   0, angle:   0 },
        { input:  30, angle:  30 },
        { input:  60, angle:  60 },
        { input:  90, angle:  90 },
        { input: 120, angle: 120 },
        { input: 150, angle: 150 },
        { input: 180, angle: 180 },
        { input: 210, angle: 210 },
        { input: 240, angle: 240 },
        { input: 270, angle: 270 },
        { input: 300, angle: 300 },
        { input: 330, angle: 330 },
        { input: 360, angle: 360 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '900158001_Course_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '900158001_Course_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Course Deviation (piecewise linear, % of limit × 10 V) ─────────
    // The C# computes deviation as `degrees / limit_degrees × 10 V` so
    // input here is the deviation in degrees and the limit is a runtime
    // parameter (default 5°). Default table maps -5°..+5° → ±10 V.
    {
      id: '900158001_Course_Deviation_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -10, volts: -10.00 },
        { input:  -5, volts: -10.00 },   // typical limit (full deflection)
        { input:  -2, volts:  -4.00 },
        { input:   0, volts:   0.00 },
        { input:   2, volts:   4.00 },
        { input:   5, volts:  10.00 },
        { input:  10, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── DME × 100 digit drum (multi_resolver, 10 units/rev) ────────────
    {
      id: '900158001_DME_x100_SIN_To_Instrument',
      kind: 'multi_resolver',
      role: 'sin',
      partnerChannel: '900158001_DME_x100_COS_To_Instrument',
      unitsPerRevolution: 10,
      peakVolts: 10,
      inputMin: 0,
      inputMax: 9,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '900158001_DME_x100_COS_To_Instrument',
      kind: 'multi_resolver',
      role: 'cos',
      partnerChannel: '900158001_DME_x100_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── DME × 10 digit drum (multi_resolver, 10 units/rev) ─────────────
    {
      id: '900158001_DME_x10_SIN_To_Instrument',
      kind: 'multi_resolver',
      role: 'sin',
      partnerChannel: '900158001_DME_x10_COS_To_Instrument',
      unitsPerRevolution: 10,
      peakVolts: 10,
      inputMin: 0,
      inputMax: 9,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '900158001_DME_x10_COS_To_Instrument',
      kind: 'multi_resolver',
      role: 'cos',
      partnerChannel: '900158001_DME_x10_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── DME × 1 digit drum (multi_resolver, 10 units/rev) ──────────────
    {
      id: '900158001_DME_x1_SIN_To_Instrument',
      kind: 'multi_resolver',
      role: 'sin',
      partnerChannel: '900158001_DME_x1_COS_To_Instrument',
      unitsPerRevolution: 10,
      peakVolts: 10,
      inputMin: 0,
      inputMax: 9,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '900158001_DME_x1_COS_To_Instrument',
      kind: 'multi_resolver',
      role: 'cos',
      partnerChannel: '900158001_DME_x1_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── 5 digital flags (pass-through; invert: false) ───────────────────
    { id: '900158001_OFF_Flag_To_Instrument',       kind: 'digital_invert', invert: false },
    { id: '900158001_FROM_Flag_To_Instrument',      kind: 'digital_invert', invert: false },
    { id: '900158001_TO_Flag_To_Instrument',        kind: 'digital_invert', invert: false },
    { id: '900158001_Deviation_Flag_To_Instrument', kind: 'digital_invert', invert: false },
    { id: '900158001_DME_Shutter_To_Instrument',    kind: 'digital_invert', invert: false },
  ],
});
