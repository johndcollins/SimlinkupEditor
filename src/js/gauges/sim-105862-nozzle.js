// ── Simtek 10-5862 — F-16 Nozzle Position Indicator ──────────────────────────
//
// Source: PL20-5862 Table 1.
// Companion HSM: Simtek105862HardwareSupportModule.cs
//
// Single resolver pair driving the dial via sin/cos × 10 V. Input
// nozzle %open 0..100 maps to reference angle 0..225° linearly
// (45° per 20% increment). Drive type: single DC synchro.
//
// The breakpoint encoding is monotonic — for inputs in [0..100],
// reference angles [0..225] are already monotonic so no wrap
// adjustment is needed.

GAUGE_CALIBRATION_DEFAULTS['10-5862'] = Object.freeze({
  channels: [
    {
      id: '105862_Nozzle_Position_SIN_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'sin',
      partnerChannel: '105862_Nozzle_Position_COS_To_Instrument',
      inputMin: 0,
      inputMax: 100,
      breakpoints: [
        { input:   0, angle:   0 },
        { input:  20, angle:  45 },
        { input:  40, angle:  90 },
        { input:  60, angle: 135 },
        { input:  80, angle: 180 },
        { input: 100, angle: 225 },
      ],
      peakVolts: 10,
      zeroTrim: 0,
      gainTrim: 1,
    },
    {
      id: '105862_Nozzle_Position_COS_To_Instrument',
      kind: 'piecewise_resolver',
      role: 'cos',
      partnerChannel: '105862_Nozzle_Position_SIN_To_Instrument',
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
