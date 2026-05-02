// ── Catalogs ─────────────────────────────────────────────────────────────────
// Static lookup tables for drivers and sims. These are read-only and have
// no dependencies on other renderer files (the `defaultDevice` factories in
// DRIVER_META are resolved at call time, so driver-defaults.js can load
// after this file even though we reference adDefaultDevice etc. by name).

// Patterns identifying stage-2 output-driver destinations.
// The order matters: longest-match wins, and AnalogDevices is the only one
// whose prefix contains "_AD536x/537x__" so it doesn't conflict with the
// generic gauge-HSM detection.
// Each driver entry carries:
//   driver  — internal id used in chain edges (`dstDriver`) and `DRIVER_HINTS`.
//   re      — regex matched against destination IDs to detect this driver.
//   parse   — extracts { device, channel } from the regex match.
//   cls     — full .NET class FQN written into HardwareSupportModule.registry
//             when this driver is referenced by any edge in the saved profile.
//             Source of truth: the <Module> entries in sample profiles'
//             HardwareSupportModule.registry. AnalogDevices used to be
//             unconditionally registered, but Henk-only / PHCC-only / Teensy-only
//             profiles don't need it — the registry is now built from the set
//             of drivers actually used.
const DRIVER_PATTERNS = [
  // AnalogDevices_AD536x/537x__DAC_OUTPUT[0][11]
  { driver: 'analogdevices',
    re: /^AnalogDevices_AD536x\/537x__DAC_OUTPUT\[(\d+)\]\[(\d+)\]$/,
    parse: m => ({ device: Number(m[1]), channel: Number(m[2]) }),
    cls: 'SimLinkup.HardwareSupport.AnalogDevices.AnalogDevicesHardwareSupportModule' },
  // HenkSDI[0x32]__DIG_PWM_3 / __PWM_OUT / __Synchro_Position
  { driver: 'henksdi',
    re: /^HenkSDI\[(0x[0-9A-Fa-f]+)\]__(.+)$/,
    parse: m => ({ device: m[1], channel: m[2] }),
    cls: 'SimLinkup.HardwareSupport.Henk.SDI.HenkSDIHardwareSupportModule' },
  // HenkQuadSinCos[0x53]__<channel>
  { driver: 'henkquadsincos',
    re: /^HenkQuadSinCos\[(0x[0-9A-Fa-f]+)\]__(.+)$/,
    parse: m => ({ device: m[1], channel: m[2] }),
    cls: 'SimLinkup.HardwareSupport.Henk.QuadSinCos.HenkieQuadSinCosBoardHardwareSupportModule' },
  // Niclas_Morin_DTS_Card["A0000"]_Input_From_Sim
  { driver: 'niclasmorindts',
    re: /^Niclas_Morin_DTS_Card\["([^"]+)"\]_(.+)$/,
    parse: m => ({ device: m[1], channel: m[2] }),
    cls: 'SimLinkup.HardwareSupport.NiclasMorin.DTSCard.DTSCardHardwareSupportModule' },
  // Phcc[...] — exact form varies; capture device/channel by best-effort
  { driver: 'phcc',
    re: /^Phcc(?:\[([^\]]+)\])?__?(.+)$/,
    parse: m => ({ device: m[1] ?? null, channel: m[2] }),
    cls: 'SimLinkup.HardwareSupport.Phcc.PhccHardwareSupportModule' },
  // ArduinoSeat__<signal-name>
  { driver: 'arduinoseat',
    re: /^ArduinoSeat__(.+)$/,
    parse: m => ({ device: null, channel: m[1] }),
    cls: 'SimLinkup.HardwareSupport.ArduinoSeat.ArduinoSeatHardwareSupportModule' },
  // Teensy boards — different families, same shape
  { driver: 'teensyewmu',          re: /^TeensyEWMU(?:\[([^\]]+)\])?__?(.+)$/,
    parse: m => ({ device: m[1] ?? null, channel: m[2] }),
    cls: 'SimLinkup.HardwareSupport.TeensyEWMU.TeensyEWMUHardwareSupportModule' },
  { driver: 'teensyrwr',           re: /^TeensyRWR(?:\[([^\]]+)\])?__?(.+)$/,
    parse: m => ({ device: m[1] ?? null, channel: m[2] }),
    cls: 'SimLinkup.HardwareSupport.TeensyRWR.TeensyRWRHardwareSupportModule' },
  { driver: 'teensyvectordrawing', re: /^TeensyVectorDrawing(?:\[([^\]]+)\])?__?(.+)$/,
    parse: m => ({ device: m[1] ?? null, channel: m[2] }),
    cls: 'SimLinkup.HardwareSupport.TeensyVectorDrawing.TeensyVectorDrawingHardwareSupportModule' },
  // PoKeys output driver. Single C# HSM class
  // (PoKeysHardwareSupportModule) and a single editor driver id —
  // the board legitimately exposes three output kinds (digital pins,
  // PWM channels, PoExtBus relay bits), so the kind-mismatch validator
  // dispatches per-channel via a function in DRIVER_CHANNEL_KIND
  // rather than a flat driver -> kind lookup.
  // PoKeys[<serial>]__DIGITAL_PIN[<pin>] | __PWM[<n>] | __PoExtBus[<bit>]
  { driver: 'pokeys',
    re: /^PoKeys\[(\d+)\]__(DIGITAL_PIN|PWM|PoExtBus)\[(\d+)\]$/,
    parse: m => ({ device: m[1], channel: `${m[2]}[${m[3]}]` }),
    cls: 'SimLinkup.HardwareSupport.PoKeys.PoKeysHardwareSupportModule' },
];

// Per-driver display name + the on-disk config filename (when one exists).
// `configFilename` is what main.js's load-profile / save-profile handlers look
// for and what the Hardware tab surfaces. Some drivers don't have a config
// (or it's optional) — set it to null.
// Per-driver metadata used by the Hardware tab.
//   label            — user-visible name in the catalog grid.
//   configFilename   — what the driver's `.config` file is called on disk.
//   cls              — full .NET class FQN written into HardwareSupportModule.registry
//                       when the driver is declared (mirrors DRIVER_PATTERNS[i].cls).
//   deviceShape      — UI shape of the per-driver "Devices" sub-list:
//                        'count'   — N indistinguishable devices (AnalogDevices).
//                                    Add/remove buttons; index = position.
//                        'address' — each device has an editable address field
//                                    (HenkSDI, HenkQuadSinCos).
//                        'single'  — exactly one device, no UI for it
//                                    (Phcc, ArduinoSeat, Teensy*, NiclasMorinDTS).
//   defaultDevice    — factory returning a fresh device record on `+ Add device`.
//                      Shape varies by driver (matches what saveDriverConfig expects).
const DRIVER_META = {
  analogdevices: {
    label: 'AnalogDevices DAC (AD536x/537x)',
    configFilename: 'AnalogDevicesHardwareSupportModule.config',
    cls: 'SimLinkup.HardwareSupport.AnalogDevices.AnalogDevicesHardwareSupportModule',
    deviceShape: 'count',
    // Each AD device carries the full structured config (DACPrecision,
    // board-level OffsetDAC0..2, and 40 per-channel records). Edited via the
    // Hardware Config tab; written verbatim into AnalogDevicesHardwareSupportModule.config.
    defaultDevice: () => adDefaultDevice(),
  },
  henksdi: {
    label: 'Henk SDI board',
    configFilename: 'henksdi.config',
    cls: 'SimLinkup.HardwareSupport.Henk.SDI.HenkSDIHardwareSupportModule',
    deviceShape: 'address',
    // Each HenkSDI device carries the full structured config (identity,
    // power-down, stator base angles, movement limits, 8 output channels with
    // per-channel mode + breakpoint tables, update-rate control). Edited via
    // the Hardware Config tab; serialised by renderHenkSDIConfig.
    defaultDevice: () => henkSdiDefaultDevice(),
  },
  henkquadsincos: {
    label: 'Henk Quad SinCos',
    configFilename: 'HenkieQuadSinCosHardwareSupportModule.config',
    cls: 'SimLinkup.HardwareSupport.Henk.QuadSinCos.HenkieQuadSinCosBoardHardwareSupportModule',
    deviceShape: 'address',
    // Each Quad SinCos device carries 4 config fields (Address, COMPort,
    // ConnectionType, DiagnosticLEDMode). Edited via the Hardware Config tab;
    // serialised by renderHenkQuadSinCosConfig.
    defaultDevice: () => henkQuadSinCosDefaultDevice(),
  },
  phcc: {
    label: 'PHCC',
    configFilename: 'PhccHardwareSupportModule.config',
    cls: 'SimLinkup.HardwareSupport.Phcc.PhccHardwareSupportModule',
    deviceShape: 'single',
    // The single device carries one field — a path to the device-manager
    // config (motherboard + peripherals live there). Edited via the Hardware
    // Config tab; serialised by renderPhccConfig.
    defaultDevice: () => phccDefaultDevice(),
  },
  arduinoseat: {
    label: 'Arduino Seat',
    configFilename: 'ArduinoSeatHardwareSupportModule.config',
    cls: 'SimLinkup.HardwareSupport.ArduinoSeat.ArduinoSeatHardwareSupportModule',
    deviceShape: 'single',
    // Each ArduinoSeat config carries top-level board fields (COMPort,
    // MotorByte1..4, ForceSlight/Rumble/Medium/Hard) plus an array of
    // <SeatOutput> entries — one per signal that drives the seat motors.
    // Edited via the Hardware Config tab; serialised by renderArduinoSeatConfig.
    defaultDevice: () => arduinoSeatDefaultDevice(),
  },
  niclasmorindts: {
    label: 'Niclas Morin DTS Card',
    configFilename: 'DTSCardHardwareSupportModule.config',
    cls: 'SimLinkup.HardwareSupport.NiclasMorin.DTSCard.DTSCardHardwareSupportModule',
    // Multi-device driver, addressed by Serial. The on-disk XML uses
    // <Serial>...</Serial> per device but the editor's state field is
    // `address` (matching HenkSDI/HenkQuadSinCos) so the existing Mappings-
    // tab driver-channel picker plumbing reads it without special-casing.
    // Each device also carries a DeadZone sub-block + CalibrationData
    // breakpoint table — edited via the Hardware Config tab; serialised by
    // renderNiclasMorinDTSConfig.
    deviceShape: 'address',
    defaultDevice: () => niclasMorinDtsDefaultDevice(),
  },
  teensyewmu: {
    label: 'Teensy EWMU',
    configFilename: 'TeensyEWMUHardwareSupportModule.config',
    cls: 'SimLinkup.HardwareSupport.TeensyEWMU.TeensyEWMUHardwareSupportModule',
    deviceShape: 'single',
    // Each TeensyEWMU config carries a COMPort plus an array of <Output>
    // entries (id + invert bool). Edited via the Hardware Config tab;
    // serialised by renderTeensyEWMUConfig.
    defaultDevice: () => teensyEwmuDefaultDevice(),
  },
  teensyrwr: {
    label: 'Teensy RWR',
    configFilename: 'TeensyRWRHardwareSupportModule.config',
    cls: 'SimLinkup.HardwareSupport.TeensyRWR.TeensyRWRHardwareSupportModule',
    deviceShape: 'single',
    // Each TeensyRWR config carries identity (COMPort), display orientation
    // (RotationDegrees, TestPattern), calibration breakpoint tables for X/Y
    // axes, plus Centering/Scaling sub-blocks. Edited via the Hardware
    // Config tab; serialised by renderTeensyRWRConfig.
    defaultDevice: () => teensyRwrDefaultDevice(),
  },
  teensyvectordrawing: {
    label: 'Teensy Vector Drawing',
    configFilename: 'TeensyVectorDrawingHardwareSupportModule.config',
    cls: 'SimLinkup.HardwareSupport.TeensyVectorDrawing.TeensyVectorDrawingHardwareSupportModule',
    deviceShape: 'single',
    // Each TeensyVectorDrawing config carries identity (COMPort + DeviceType
    // RWR/HUD/HMS) plus the same display-orientation/centering/scaling/
    // calibration schema as TeensyRWR. Edited via the Hardware Config tab;
    // serialised by renderTeensyVectorDrawingConfig.
    defaultDevice: () => teensyVectorDrawingDefaultDevice(),
  },
  pokeys: {
    label: 'PoKeys',
    configFilename: 'PoKeysHardwareSupportModule.config',
    cls: 'SimLinkup.HardwareSupport.PoKeys.PoKeysHardwareSupportModule',
    // count-shape declaration: the Hardware tab shows just N boards
    // with +/− buttons (matching AnalogDevices). The board's
    // identity (serial number) lives on the Hardware Config card
    // alongside its name, PWM period, and output lists — that way
    // the user has ONE place to manage each board's full state
    // rather than entering the serial in the Hardware tab and
    // everything else in Hardware Config.
    //
    // Hybrid: even though declaration is count-shape, the Mappings
    // tab's Board dropdown surfaces each device's `address` (the
    // serial) as the option value because that's what the signal
    // ids and C# HSM lookup use. The Mappings dropdown population
    // logic in tab-mappings.js's effectiveDriverHint special-cases
    // PoKeys to pull `address` instead of the position index.
    deviceShape: 'count',
    // The board exposes both digital and analog kinds simultaneously;
    // the kind-mismatch validator dispatches per-channel via
    // DRIVER_CHANNEL_KIND.pokeys (see below).
    defaultDevice: () => poKeysDefaultDevice(),
  },
};

// Catalog of available SimSupport modules. Each entry's `signalsFile` points
// to a JSON file in src/data/ that publishes that sim's source signal list.
// Adding a new sim is a two-step edit: append an entry here, drop a matching
// signals JSON file alongside it. The editor's load-static-data handler reads
// every file referenced here at startup, with the same userData-override
// mechanism used for instruments.json.
const SIM_SUPPORTS = [
  {
    id: 'falcon4',
    label: 'Falcon BMS',
    cls: 'F4Utils.SimSupport.Falcon4SimSupportModule',
    // SimSupport modules are registered in SimSupportModule.registry with the
    // assembly "F4Utils.SimSupport, Version=0.1.0.0" rather than the
    // "SimLinkup, Version=1.0.0.0" used for HSMs. saveProfile knows this.
    assembly: 'F4Utils.SimSupport, Version=0.1.0.0, Culture=neutral, PublicKeyToken=null',
    signalsFile: 'sim-falcon4-signals.json',
  },
];

// ── Mappings-tab driver picker hints ─────────────────────────────────────────
// `DRIVER_OPTIONS` populates the driver dropdown next to each output port.
// `DRIVER_HINTS` enumerates known devices/channels per driver for the channel
// picker. Drivers without a hint entry render a freeform text input.

const DRIVER_OPTIONS = [
  { value: '', label: '— not wired —' },
  { value: 'analogdevices', label: 'AnalogDevices DAC (AD536x/537x)' },
  { value: 'henksdi',       label: 'Henk SDI board' },
  { value: 'henkquadsincos',label: 'Henk Quad SinCos' },
  { value: 'phcc',          label: 'PHCC' },
  { value: 'arduinoseat',   label: 'Arduino Seat' },
  { value: 'teensyewmu',    label: 'Teensy EWMU' },
  { value: 'teensyrwr',     label: 'Teensy RWR' },
  { value: 'teensyvectordrawing', label: 'Teensy Vector Drawing' },
  { value: 'pokeys',         label: 'PoKeys' },
];

// Per-driver hints used by the channel picker. `devices` is a default device
// enumeration (users frequently override); `channelCount` is how many channels
// the device exposes; `channelLabel` formats one.
const DRIVER_HINTS = {
  // Default device list when no AnalogDevicesHardwareSupportModule.config is
  // present in the profile. Ideally we'd enumerate actual USB-connected
  // boards, but that requires the AnalogDevices/LibUsbDotNet stack which
  // isn't reachable from Electron. 0..9 covers any realistic setup; if the
  // profile has a config, that overrides this list with the configured count.
  analogdevices:  { devices: [0,1,2,3,4,5,6,7,8,9], channelCount: 40,
                    formatChannel: c => String(c),
                    formatDestination: (d, c) => `AnalogDevices_AD536x/537x__DAC_OUTPUT[${d}][${c}]` },
  henksdi:        { devices: ['0x30', '0x32'], channelCount: 0,  // freeform channel name
                    channels: ['DIG_PWM_1','DIG_PWM_2','DIG_PWM_3','DIG_PWM_4',
                               'DIG_PWM_5','DIG_PWM_6','DIG_PWM_7','PWM_OUT','Synchro_Position'],
                    formatDestination: (d, c) => `HenkSDI[${d}]__${c}` },
  henkquadsincos: { devices: ['0x53'], channelCount: 0, channels: ['SIN_1','COS_1','SIN_2','COS_2','SIN_3','COS_3','SIN_4','COS_4'],
                    formatDestination: (d, c) => `HenkQuadSinCos[${d}]__${c}` },
  // PoKeys: single driver id, three output kinds. `devices` is a
  // placeholder; the real per-profile device list is overlaid by
  // effectiveDriverHint() in tab-mappings.js. The per-profile filter
  // there ALSO narrows `channels` to only what the user has declared
  // in Hardware Config — without that filter, the dropdown would show
  // all 141 possible outputs (55 GPIO + 6 PWM + 80 PoExtBus) which is
  // overwhelming and includes outputs the user hasn't wired. The
  // declared-only filter happens in tab-mappings.js because it needs
  // access to `p.drivers.pokeys.devices[].digitalOutputs|pwmOutputs|
  // extBusOutputs`.
  pokeys: { devices: [], channelCount: 0,
            channels: [],  // populated per-profile by effectiveDriverHint
            formatDestination: (d, c) => `PoKeys[${d}]__${c}` },
};

// Channel kind per driver, used by the Mappings tab to surface a
// "kind mismatch" warning when a digital gauge port (e.g. an OFF flag
// drive) gets wired to an analog driver channel (or vice versa). At
// runtime SimLinkup blows up with a cast exception when Source and
// Destination signal types disagree — this catches the misconfiguration
// at editor authoring time so the user sees a red row before saving a
// .mapping file that would crash the gauge.
//
// Values are either a string ('analog' | 'digital') for drivers whose
// channels are all the same kind, or a function (channelStr) => string
// for drivers like PoKeys that mix kinds. Use `getChannelKind(driver,
// channel)` below as the call site rather than indexing directly.
//
// Drivers omitted from this map (currently `phcc`) are treated as
// 'unknown' — channels span both kinds depending on the configured
// peripheral, so we don't warn on them.
const DRIVER_CHANNEL_KIND = {
  analogdevices:        'analog',  // DAC outputs
  henksdi:              'analog',  // PWM channels + synchro position
  henkquadsincos:       'analog',  // sin/cos resolver windings
  niclasmorindts:       'analog',  // synchro
  teensyrwr:            'analog',  // vector beam X/Y
  teensyvectordrawing:  'analog',  // vector beam X/Y
  arduinoseat:          'digital', // DX button bits
  teensyewmu:           'digital', // DX button bits
  // PoKeys mixes kinds: digital pins + PoExtBus relay bits = digital;
  // PWM channels = analog. Dispatch on the channel string format.
  pokeys: (channel) => {
    if (typeof channel === 'string' && channel.startsWith('PWM[')) return 'analog';
    return 'digital';
  },
};

// Resolve the kind for a (driver, channel) pair. Returns null when the
// driver isn't classified. Wrapper around DRIVER_CHANNEL_KIND that
// transparently handles both flat-string and per-channel-function
// entries — call sites should use this rather than indexing directly.
function getChannelKind(driver, channel) {
  const entry = DRIVER_CHANNEL_KIND[driver];
  if (entry == null) return null;
  if (typeof entry === 'function') return entry(channel);
  return entry;
}
