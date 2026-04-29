// ── AMI 90002620-01 — F-16 Cabin Pressure Altimeter ─────────────────────────
//
// Source: lightningstools/src/SimLinkup/HardwareSupport/AMI/
//         AMI9000262001HardwareSupportModule.cs UpdateCabinPressureAltitudeOutputValues().
//
// Single-channel linear pass-through. The C# computes a pointer angle
// internally (cabinAlt / 50000 × 300°) but the final output voltage is
// just `((degrees / 300) × 20) − 10`, which collapses to a straight
// linear map: 0 ft → -10 V, 50000 ft → +10 V. Inputs above 50000 are
// clamped to +10 V; inputs below 0 are clamped to -10 V.
//
// Editor breakpoints sample the linear map at 5000-ft intervals so the
// user can correct individual altitude bands for hardware drift without
// affecting other bands. Matches the editor pattern used for the Simtek
// 10-1078 cabin altimeter.

GAUGE_CALIBRATION_DEFAULTS['9000262001'] = Object.freeze({
  channels: [
    {
      id: '9000262001_Cabin_Pressure_Altitude_To_Instrument',
      kind: 'piecewise',
      breakpoints: [
        { input:     0, volts: -10.00 },
        { input:  5000, volts:  -8.00 },
        { input: 10000, volts:  -6.00 },
        { input: 15000, volts:  -4.00 },
        { input: 20000, volts:  -2.00 },
        { input: 25000, volts:   0.00 },  // electrical zero (midpoint)
        { input: 30000, volts:   2.00 },
        { input: 35000, volts:   4.00 },
        { input: 40000, volts:   6.00 },
        { input: 45000, volts:   8.00 },
        { input: 50000, volts:  10.00 },  // full scale
      ],
      zeroTrim: 0,
      gainTrim: 1,
    },
  ],
});
