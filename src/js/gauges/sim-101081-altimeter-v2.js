// ── Simtek 10-1081 — F-16 Altimeter v2 ───────────────────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/Simtek/
//         Simtek101081HardwareSupportModule.cs UpdateAltitudeOutputValues()
//         (lines 261–330).
//
// Three channels, two patterns:
//
//  1. Fine altitude (multi_resolver) — sin/cos pair driving a synchro that
//     wraps once per 1000 ft. At 80,000 ft the fine resolver has spun 80
//     full rotations. The C# does no clamp on the angle (sin/cos handle
//     negative angles and many-rotation angles cleanly); peak amplitude
//     is 10 V.
//
//  2. Coarse altitude (piecewise) — single voltage output. Piecewise-linear
//     with three segments:
//        -1000 ft → -10.00 V
//            0 ft →  -9.75 V    (transition out of below-sea-level slope)
//        80000 ft → +10.00 V    (top of useful range; clamps above)
//     C# extrapolates the line above 80000 ft in theory but Math.Min(10)
//     clamps it anyway.
//
// The barometric pressure input is wired but `UpdateBarometricPressureOutputValues`
// is empty (`//do nothing`) — there's no calibration entry for it.
//
// First gauge to ship in the 'multi_resolver' transform pattern.
// Self-registers into GAUGE_CALIBRATION_DEFAULTS at script-load time.

GAUGE_CALIBRATION_DEFAULTS['10-1081'] = Object.freeze({
  channels: [
    // ── Fine altitude (multi_resolver) ──────────────────────────────────
    {
      id: '101081_Altitude_Fine_SIN_To_Instrument',
      kind: 'multi_resolver',
      role: 'sin',
      partnerChannel: '101081_Altitude_Fine_COS_To_Instrument',
      unitsPerRevolution: 1000,
      peakVolts: 10,
      // inputMin/inputMax bound the editor's scrub slider only; not part
      // of the on-disk schema for multi_resolver. Match the C# signal
      // range (-1000..80000 ft).
      inputMin: -1000,
      inputMax: 80000,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '101081_Altitude_Fine_COS_To_Instrument',
      kind: 'multi_resolver',
      role: 'cos',
      partnerChannel: '101081_Altitude_Fine_SIN_To_Instrument',
      // No transform body on COS — SIN partner carries it.
      zeroTrim: 0,
      gainTrim: 1,
    },

    // ── Coarse altitude (piecewise single) ──────────────────────────────
    {
      id: '101081_Altitude_Coarse_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input: -1000, volts: -10.00 },
        { input:     0, volts:  -9.75 },
        { input: 80000, volts:  10.00 },
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
