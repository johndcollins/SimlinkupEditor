// ── Driver defaults ──────────────────────────────────────────────────────────
// Per-driver schema constants and default-device factories. Read by the
// XML parsers (driver-parsers.js), the XML writers (save.js), and the
// Hardware Config tab UI (tab-hardware-config.js) for "Reset to defaults"
// and "+ Add device" buttons.

// ── AnalogDevices defaults ───────────────────────────────────────────────────
const AD_CHANNEL_DEFAULTS = Object.freeze({
  offset: 32768, gain: 65535, dataValueA: 32768, dataValueB: 32768,
});
const AD_DEVICE_DEFAULTS = Object.freeze({
  dacPrecision: 'SixteenBit', offsetDAC0: 8192, offsetDAC1: 8192, offsetDAC2: 8192,
});
function adDefaultDevice() {
  return {
    ...AD_DEVICE_DEFAULTS,
    channels: Array.from({ length: 40 }, () => ({ ...AD_CHANNEL_DEFAULTS })),
  };
}

// ── HenkSDI defaults ─────────────────────────────────────────────────────────
//
// HenkSDI's config has a much richer schema than AD — 9 top-level groups per
// device, plus 8 output channels with per-channel mode and optional breakpoint
// tables. See HenkSDIHardwareSupportModuleConfig.cs in the lightningstools repo.
//
// Defaults:
//   - Address/COMPort/etc. defaults match HenkADI's PITCH SDI sample (the
//     most-used real config).
//   - Stator base angles default to 0/120/240 (a balanced 3-phase distribution;
//     real configs override this per gauge mounting).
//   - Channels default to Digital mode with InitialValue=0 and no breakpoint
//     table. PWM channels need an explicit Mode change + breakpoints.
const HENKSDI_CHANNEL_NAMES = Object.freeze([
  'DIG_PWM_1', 'DIG_PWM_2', 'DIG_PWM_3', 'DIG_PWM_4',
  'DIG_PWM_5', 'DIG_PWM_6', 'DIG_PWM_7', 'PWM_OUT',
]);
const HENKSDI_CHANNEL_DEFAULTS = Object.freeze({
  mode: 'Digital', initialValue: 0,
});
const HENKSDI_DEVICE_DEFAULTS = Object.freeze({
  address: '0x30', comPort: '', connectionType: 'USB',
  diagnosticLEDMode: 'Heartbeat', initialIndicatorPosition: 512,
});
const HENKSDI_POWERDOWN_DEFAULTS = Object.freeze({ enabled: false, level: 'Half', delayMs: 512 });
const HENKSDI_STATOR_DEFAULTS    = Object.freeze({ s1: 0, s2: 120, s3: 240 });
const HENKSDI_LIMITS_DEFAULTS    = Object.freeze({ min: 0, max: 255 });
const HENKSDI_URC_DEFAULTS       = Object.freeze({
  mode: 'Limit', stepUpdateDelayMillis: 8, useShortestPath: false,
  limitThreshold: 0,
  smoothing: { minThreshold: 0, mode: 'Adaptive' },
});
const HENKSDI_DIAG_LED_VALUES = Object.freeze([
  'Off', 'On', 'Heartbeat', 'ToggleOnAcceptedCommand', 'OnDuringDOAPacketReception',
]);
const HENKSDI_URC_MODE_VALUES        = Object.freeze(['Limit', 'Smooth', 'Speed', 'Miscellaneous']);
const HENKSDI_URC_SMOOTHING_VALUES   = Object.freeze(['Adaptive', 'TwoSteps', 'FourSteps', 'EightSteps']);
const HENKSDI_CONNECTION_VALUES      = Object.freeze(['USB', 'PHCC']);
const HENKSDI_POWERDOWN_LEVEL_VALUES = Object.freeze(['Half', 'Full']);
const HENKSDI_CHANNEL_MODE_VALUES    = Object.freeze(['Digital', 'PWM']);

function henkSdiDefaultDevice() {
  const channels = {};
  for (const name of HENKSDI_CHANNEL_NAMES) {
    channels[name] = { ...HENKSDI_CHANNEL_DEFAULTS, calibration: [] };
  }
  return {
    ...HENKSDI_DEVICE_DEFAULTS,
    powerDown:        { ...HENKSDI_POWERDOWN_DEFAULTS },
    statorBaseAngles: { ...HENKSDI_STATOR_DEFAULTS },
    movementLimits:   { ...HENKSDI_LIMITS_DEFAULTS },
    channels,
    updateRateControl: {
      ...HENKSDI_URC_DEFAULTS,
      smoothing: { ...HENKSDI_URC_DEFAULTS.smoothing },
    },
  };
}

// ── ArduinoSeat defaults ─────────────────────────────────────────────────────
//
// Single-instance driver with a richer schema than any other "single"-shape
// driver: top-level board config (COMPort, MotorByte1..4, Force levels) plus
// a list of <SeatOutput> entries — one per simulator signal that drives the
// seat. The HSM publishes ~40 signals that map to F-16 BMS state; the editor
// can bulk-import the standard layout via "+ Add F-16 standard outputs".
const ARDSEAT_FORCE_VALUES = Object.freeze(['Manual', 'Off', 'Slight', 'Rumble', 'Medium', 'Hard']);
const ARDSEAT_PULSE_VALUES = Object.freeze(['Fixed', 'Progressive', 'CenterPeak']);

// Top-level board defaults. MotorByte1..4 default to powers of two — the
// sample uses 1/2/4/8 for a 4-motor wire protocol where each motor maps to
// one bit of the wire-format motor-bitmask byte.
const ARDSEAT_DEVICE_DEFAULTS = Object.freeze({
  comPort: '',
  motorByte1: 1, motorByte2: 2, motorByte3: 4, motorByte4: 8,
  forceSlight: 0, forceRumble: 0, forceMedium: 0, forceHard: 0,
});
const ARDSEAT_OUTPUT_DEFAULTS = Object.freeze({
  id: '',
  force: 'Manual',
  type: 'Fixed',
  motor1: false, motor2: false, motor3: false, motor4: false,
  motor1Speed: 0, motor2Speed: 0, motor3Speed: 0, motor4Speed: 0,
  min: 0, max: 0,
});

// Catalog of every signal the C# HSM publishes — keys for the bulk-import
// button. Mirrors the IDs in ArduinoSeatHardwareSupportModule.CreateSignals.
// kind tells the editor whether the signal is digital (boolean state) or
// analog (double state). Used as default-pickup metadata when bulk-importing
// — the editor seeds reasonable per-output defaults for each.
const ARDSEAT_STANDARD_OUTPUTS = Object.freeze([
  // Digital — actions
  { id: 'ArduinoSeat__IS_FIRING_GUN',       kind: 'digital', label: 'Gun firing' },
  { id: 'ArduinoSeat__IS_END_FLIGHT',       kind: 'digital', label: 'End of flight' },
  { id: 'ArduinoSeat__IS_EJECTING',         kind: 'digital', label: 'Ejecting' },
  { id: 'ArduinoSeat__IN_3D',               kind: 'digital', label: 'In 3D world' },
  { id: 'ArduinoSeat__IS_PAUSED',           kind: 'digital', label: 'Paused' },
  { id: 'ArduinoSeat__IS_FROZEN',           kind: 'digital', label: 'Frozen' },
  { id: 'ArduinoSeat__IS_OVER_G',           kind: 'digital', label: 'Over G' },
  { id: 'ArduinoSeat__IS_ON_GROUND',        kind: 'digital', label: 'On ground' },
  { id: 'ArduinoSeat__IS_EXIT_GAME',        kind: 'digital', label: 'Exit game' },
  { id: 'ArduinoSeat__SPEED_BRAKE__NOT_STOWED_FLAG', kind: 'digital', label: 'Speed brake open' },
  // Analog — ordnance counters
  { id: 'ArduinoSeat__AA_MISSILE_FIRED',    kind: 'analog',  label: 'AA missile fired' },
  { id: 'ArduinoSeat__AG_MISSILE_FIRED',    kind: 'analog',  label: 'AG missile fired' },
  { id: 'ArduinoSeat__BOMB_DROPPED',        kind: 'analog',  label: 'Bomb dropped' },
  { id: 'ArduinoSeat__FLARE_DROPPED',       kind: 'analog',  label: 'Flare dropped' },
  { id: 'ArduinoSeat__CHAFF_DROPPED',       kind: 'analog',  label: 'Chaff dropped' },
  { id: 'ArduinoSeat__BULLETS_FIRED',       kind: 'analog',  label: 'Bullets fired' },
  // Analog — external state
  { id: 'ArduinoSeat__COLLISION_COUNTER',   kind: 'analog',  label: 'Collisions' },
  { id: 'ArduinoSeat__GFORCE',              kind: 'analog',  label: 'G-force' },
  { id: 'ArduinoSeat__LAST_DAMAGE',         kind: 'analog',  label: 'Last damage' },
  { id: 'ArduinoSeat__DAMAGE_FORCE',        kind: 'analog',  label: 'Damage force' },
  { id: 'ArduinoSeat__WHEN_DAMAGE',         kind: 'analog',  label: 'When damage' },
  { id: 'ArduinoSeat__BUMP_INTENSITY',      kind: 'analog',  label: 'Bump intensity' },
  // Analog — engine
  { id: 'ArduinoSeat__NOZ_POS1__NOZZLE_PERCENT_OPEN', kind: 'analog', label: 'Nozzle 1 % open' },
  { id: 'ArduinoSeat__NOZ_POS2__NOZZLE_PERCENT_OPEN', kind: 'analog', label: 'Nozzle 2 % open' },
  { id: 'ArduinoSeat__RPM1__RPM_PERCENT',   kind: 'analog',  label: 'RPM 1 %' },
  { id: 'ArduinoSeat__RPM2__RPM_PERCENT',   kind: 'analog',  label: 'RPM 2 %' },
  { id: 'ArduinoSeat__FUEL_FLOW1__FUEL_FLOW_POUNDS_PER_HOUR', kind: 'analog', label: 'Fuel flow 1' },
  { id: 'ArduinoSeat__FUEL_FLOW2__FUEL_FLOW_POUNDS_PER_HOUR', kind: 'analog', label: 'Fuel flow 2' },
  // Analog — flight dynamics
  { id: 'ArduinoSeat__SPEED_BRAKE__POSITION',                  kind: 'analog', label: 'Speed brake position' },
  { id: 'ArduinoSeat__FLIGHT_DYNAMICS__CLIMBDIVE_ANGLE_DEGREES', kind: 'analog', label: 'Climb/dive angle (°)' },
  { id: 'ArduinoSeat__FLIGHT_DYNAMICS__SIDESLIP_ANGLE_DEGREES',  kind: 'analog', label: 'Sideslip angle (°)' },
  { id: 'ArduinoSeat__MAP__GROUND_SPEED_KNOTS',                  kind: 'analog', label: 'Ground speed (kt)' },
  { id: 'ArduinoSeat__AIRSPEED_MACH_INDICATOR__TRUE_AIRSPEED_KNOTS', kind: 'analog', label: 'True airspeed (kt)' },
  { id: 'ArduinoSeat__VVI__VERTICAL_VELOCITY_FPM',               kind: 'analog', label: 'Vertical velocity (fpm)' },
  { id: 'ArduinoSeat__AIRCRAFT__LEADING_EDGE_FLAPS_POSITION',    kind: 'analog', label: 'LE flaps position' },
  { id: 'ArduinoSeat__AIRCRAFT__TRAILING_EDGE_FLAPS_POSITION',   kind: 'analog', label: 'TE flaps position' },
  // Analog — gear
  { id: 'ArduinoSeat__GEAR_PANEL__GEAR_POSITION',       kind: 'analog', label: 'Gear position' },
  { id: 'ArduinoSeat__GEAR_PANEL__NOSE_GEAR_POSITION',  kind: 'analog', label: 'Nose gear position' },
  { id: 'ArduinoSeat__GEAR_PANEL__LEFT_GEAR_POSITION',  kind: 'analog', label: 'Left gear position' },
  { id: 'ArduinoSeat__GEAR_PANEL__RIGHT_GEAR_POSITION', kind: 'analog', label: 'Right gear position' },
]);

function arduinoSeatDefaultDevice() {
  return {
    ...ARDSEAT_DEVICE_DEFAULTS,
    seatOutputs: [],
  };
}
function arduinoSeatDefaultOutput(id = '') {
  return { ...ARDSEAT_OUTPUT_DEFAULTS, id };
}

// ── TeensyEWMU defaults ──────────────────────────────────────────────────────
//
// Single-instance driver. Schema is COMPort + an array of <Output> entries,
// each carrying ID (matching a TeensyEWMUCommunicationProtocolHeaders.InvertBits
// enum member) + Invert bool. The runtime ORs together the bit-mask values of
// IDs whose Invert is true, then sends that mask to the Teensy.
//
// Two on-disk shapes exist in the wild for the <DXOutputs> entries:
//   (a) Element form  — <Output><ID>...</ID><Invert>...</Invert></Output>
//                       (matches the C# class's [XmlArrayItem("Output")] decl)
//   (b) Attribute form — <DXOutput ID="..." Invert="..."/>
//                        (used by both bundled sample profiles, but doesn't
//                        match the C# schema — XmlSerializer silently drops
//                        unrecognised <DXOutput> elements at runtime, leaving
//                        DXOutputs as an empty array)
// The editor reads BOTH forms and always writes form (a). On first save of a
// previously-attribute-form profile, the file becomes correctly readable by
// SimLinkup at runtime.
const TEWMU_DEVICE_DEFAULTS = Object.freeze({ comPort: '' });
const TEWMU_OUTPUT_DEFAULTS = Object.freeze({ id: '', invert: false });

// Standard outputs catalog — every member of InvertBits in declaration order.
// Mirrors TeensyEWMUCommunicationProtocolHeaders.InvertBits in the C# source.
// Note: four pairs of IDs share the same bit value (EWPI_PRI/EWMU_MWS_MENU at
// 0x100000, EWPI_SEP/EWMU_JMR_MENU at 0x200000, EWPI_UNK/EWMU_RWR_MENU at
// 0x400000, EWPI_MD/EWMU_DISP_MENU at 0x800000). That's a quirk of the C#
// enum, not the editor — both names work, and inverting either inverts the
// shared bit.
const TEWMU_STANDARD_OUTPUTS = Object.freeze([
  'CMDS_O1', 'CMDS_O2', 'CMDS_CH', 'CMDS_FL',
  'CMDS_AND_EWMU_Jettison',
  'CMDS_PRGM_BIT', 'CMDS_PRGM_1', 'CMDS_PRGM_2', 'CMDS_PRGM_3', 'CMDS_PRGM_4',
  'CMDS_AND_EWMU_MWS', 'CMDS_AND_EWMU_JMR', 'CMDS_AND_EWMU_RWR',
  'EWMU_DISP',
  'CMDS_AND_EWMU_MODE_OFF', 'CMDS_AND_EWMU_MODE_STBY', 'CMDS_AND_EWMU_MODE_MAN',
  'CMDS_AND_EWMU_MODE_SEMI', 'CMDS_AND_EWMU_MODE_AUTO',
  'CMDS_MODE_BYP',
  'EWMU_MWS_MENU', 'EWMU_JMR_MENU', 'EWMU_RWR_MENU', 'EWMU_DISP_MENU',
  'EWPI_PRI', 'EWPI_SEP', 'EWPI_UNK', 'EWPI_MD',
  'EWMU_SET1', 'EWMU_SET2', 'EWMU_SET3', 'EWMU_SET4',
  'EWMU_NXT_UP', 'EWMU_NXT_DOWN', 'EWMU_RTN',
]);

function teensyEwmuDefaultDevice() {
  return { ...TEWMU_DEVICE_DEFAULTS, dxOutputs: [] };
}
function teensyEwmuDefaultOutput(id = '') {
  return { ...TEWMU_OUTPUT_DEFAULTS, id };
}

// ── TeensyRWR defaults ───────────────────────────────────────────────────────
//
// Single-instance driver. Vector-display calibration config: COMPort,
// rotation, test-pattern selector, X-axis and Y-axis calibration breakpoint
// tables, plus centering offsets (short, signed) and scaling factors (double).
//
// Calibration breakpoints are <Input>/<Output> double pairs — same shape as
// HenkSDI's calibration data, but stored under different parent elements.
const TRWR_DEVICE_DEFAULTS = Object.freeze({
  comPort: '',
  rotationDegrees: 0,
  testPattern: 0,
});
// Centering and Scaling have C#-side default values (OffsetX/Y=0; ScaleX/Y=1)
// even when the elements are absent from the file. Match those.
const TRWR_CENTERING_DEFAULTS = Object.freeze({ offsetX: 0, offsetY: 0 });
const TRWR_SCALING_DEFAULTS   = Object.freeze({ scaleX: 1, scaleY: 1 });
// Identity calibration — input maps unchanged to output across the 12-bit
// range. The bundled samples use this; we use it as the default when the
// user clicks "Reset to identity" or first imports a missing config.
const TRWR_IDENTITY_CALIBRATION = Object.freeze([
  Object.freeze({ input: 0,    output: 0 }),
  Object.freeze({ input: 4095, output: 4095 }),
]);

function teensyRwrDefaultDevice() {
  return {
    ...TRWR_DEVICE_DEFAULTS,
    centering: { ...TRWR_CENTERING_DEFAULTS },
    scaling:   { ...TRWR_SCALING_DEFAULTS },
    xAxisCalibration: TRWR_IDENTITY_CALIBRATION.map(p => ({ ...p })),
    yAxisCalibration: TRWR_IDENTITY_CALIBRATION.map(p => ({ ...p })),
  };
}

// ── TeensyVectorDrawing defaults ─────────────────────────────────────────────
//
// Single-instance driver. Schema mirrors TeensyRWR with one extra field —
// DeviceType — that selects between RWR/HUD/HMS rendering modes. Centering,
// scaling, and X/Y axis calibration breakpoint defaults are the same shape
// as TeensyRWR, so we reuse those default constants.
const TVD_DEVICE_TYPE_VALUES = Object.freeze(['RWR', 'HUD', 'HMS']);
const TVD_DEVICE_DEFAULTS = Object.freeze({
  comPort: '',
  deviceType: 'RWR',
  rotationDegrees: 0,
  testPattern: 0,
});

function teensyVectorDrawingDefaultDevice() {
  return {
    ...TVD_DEVICE_DEFAULTS,
    centering: { ...TRWR_CENTERING_DEFAULTS },
    scaling:   { ...TRWR_SCALING_DEFAULTS },
    xAxisCalibration: TRWR_IDENTITY_CALIBRATION.map(p => ({ ...p })),
    yAxisCalibration: TRWR_IDENTITY_CALIBRATION.map(p => ({ ...p })),
  };
}

// ── NiclasMorin DTS Card defaults ────────────────────────────────────────────
//
// Multi-device driver (root: <DTSCard>, [XmlRoot] override on the C# class).
// Each device carries a Serial (which doubles as the address — that's how the
// Mappings tab references it: Niclas_Morin_DTS_Card["A0000"]_...), an
// optional DeadZone sub-block (synchro angular range to avoid for mechanical
// stops), and a CalibrationData breakpoint table mapping sim values →
// synchro angles in degrees. Same CalibrationPoint shape as HenkSDI.
//
// State field is `address` (not `serial`) so the existing Mappings-tab driver-
// channel picker — which reads decl.devices[i].address for every address-
// shaped driver — works without any special-casing. The parser and writer
// translate at the XML boundary (<Serial>...</Serial> ↔ dev.address).
const NMDTS_DEVICE_DEFAULTS  = Object.freeze({ address: 'A0000' });
const NMDTS_DEADZONE_DEFAULTS = Object.freeze({ fromDegrees: 0, toDegrees: 0 });

function niclasMorinDtsDefaultDevice() {
  return {
    ...NMDTS_DEVICE_DEFAULTS,
    deadZone: { ...NMDTS_DEADZONE_DEFAULTS },
    calibrationData: [],
  };
}

// ── PHCC defaults ────────────────────────────────────────────────────────────
//
// Tiny single-instance schema. PhccHardwareSupportModule.config holds ONE
// field, PhccDeviceManagerConfigFilePath, which points at a sibling file
// (conventionally "phcc.config") that contains the actual motherboard +
// peripheral configuration. SimLinkup resolves the path as-is first, falling
// back to <profileDir>/<path> — see PhccHardwareSupportModule.cs:82. The
// editor's "Open device-manager config" button uses the same fallback logic.
const PHCC_DEVICE_DEFAULTS = Object.freeze({
  deviceManagerConfigFilePath: 'phcc.config',
});
function phccDefaultDevice() {
  return { ...PHCC_DEVICE_DEFAULTS };
}

// ── HenkQuadSinCos defaults ──────────────────────────────────────────────────
//
// Tiny schema (4 fields per device) — Address, COMPort, ConnectionType,
// DiagnosticLEDMode. The two enums are identical to HenkSDI's, so we reuse
// HENKSDI_CONNECTION_VALUES / HENKSDI_DIAG_LED_VALUES rather than redeclare.
const HENKQSC_DEVICE_DEFAULTS = Object.freeze({
  address: '0x53', comPort: '', connectionType: 'USB', diagnosticLEDMode: 'Heartbeat',
});
function henkQuadSinCosDefaultDevice() {
  return { ...HENKQSC_DEVICE_DEFAULTS };
}

// ── PoKeys defaults ──────────────────────────────────────────────────────────
//
// Multi-device address-shape driver. The "address" stores the PoKeys
// serial number as a string (matches HenkSDI/NiclasMorinDTS plumbing).
// Each device tracks declared digital pins and PWM channels separately;
// `digitalOutputs` and `pwmOutputs` start empty so a fresh PoKeys
// declaration writes an empty file (the user opens Hardware Config to
// add pins). PWMPeriodMicroseconds defaults to 20000 (20 ms — typical
// RC-servo period and reasonable for LED dimming). Per-pin invert
// defaults to true so SimLinkup's state=true means pin-sources-3.3V,
// counteracting the hardware's documented "uninverted output: 0=3.3V,
// 1=0V" behaviour.
const POKEYS_DEVICE_DEFAULTS = Object.freeze({
  address: '',
  name: '',
  pwmPeriodMicroseconds: 20000,
});
const POKEYS_DIGITAL_OUTPUT_DEFAULTS = Object.freeze({ pin: 1, invert: true });
const POKEYS_PWM_OUTPUT_DEFAULTS = Object.freeze({ channel: 1 });
function poKeysDefaultDevice() {
  return {
    ...POKEYS_DEVICE_DEFAULTS,
    digitalOutputs: [],
    pwmOutputs: [],
  };
}
function poKeysDefaultDigitalOutput() { return { ...POKEYS_DIGITAL_OUTPUT_DEFAULTS }; }
function poKeysDefaultPWMOutput()     { return { ...POKEYS_PWM_OUTPUT_DEFAULTS }; }
