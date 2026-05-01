# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install Electron and electron-builder (one-time, ~100MB).
- `npm start` — run the app in dev mode (`electron .`). No bundler/build step; edits to `src/*.html`, `main.js`, or `preload.js` take effect on app restart.
- `npm run make` — build the Windows NSIS installer to `dist/SimLinkup Profile Editor Setup.exe` (`electron-builder --win --x64`).
- `node scripts/extract-f4-signals.mjs` — regenerate `src/data/sim-falcon4-signals.json` from the SimLinkup C# source (see "Static data" below).

There is no test suite, no linter, and no transpilation. The renderer ships hand-written HTML/CSS/JS — no React, no bundler, no TypeScript.

## Architecture

Electron app in the standard 3-file split: a main process (`main.js`), a context-isolated preload bridge (`preload.js`), and the renderer page (`src/index.html`). The renderer loads its CSS from `src/styles/main.css` and its JS from a sequence of plain `<script>` tags in `src/js/` — see "Renderer file layout" below. There used to be a second standalone calibration page (`src/calibration.html`) but it was deleted once the in-editor Calibration tab fully replaced it; if you see git history references to it, that's why.

### Process boundary and IPC

`preload.js` exposes a single `window.api` object via `contextBridge.exposeInMainWorld`. Every renderer-side filesystem or shell action goes through one of these handlers, all defined in `main.js`:

- **Profile directory and listing**: `pickProfileDir`, `detectMappingDir` (registry + Program Files heuristics), `checkWritable`, `listProfiles`, `getDefaultProfile`, `setDefaultProfile`, `openFolder`.
- **Profile read/write**:
  - `loadProfile` reads all `*.mapping` files, both `.registry` files, and every known driver-config (`AnalogDevicesHardwareSupportModule.config`, `henksdi.config`, plus stubs for Phcc/ArduinoSeat/NiclasMorinDTS/Teensy×3/HenkQuadSinCos/PoKeys).
  - `saveProfile` accepts `{ profileDir, profileName, mappingFiles, hsmClasses, simSupportClasses, driverConfigs }`. It sweeps stale `*.mapping` files and writes per-gauge files; builds `HardwareSupportModule.registry` from `hsmClasses` (gauge HSMs + driver HSMs the profile declared); builds `SimSupportModule.registry` from `simSupportClasses`; writes each driver-config in `driverConfigs` (skipping ones with `createOnly: true` if the file already exists). The AD config is now `createOnly: false` because the Hardware Config tab is the canonical authoring surface — saves overwrite the on-disk file with the in-memory state. Returns `adDeviceShortfall: { have, required }` when an existing AD config has fewer `<Device>` blocks than the saved profile uses.
  - `deleteProfile` removes the profile dir.
- **Static data**: `loadStaticData` returns `{ instruments, simSignals: { simId: {scalar, indexed} }, sources, errors }`. `openUserDataFolder` opens `%APPDATA%\simlinkup-profile-editor\`. `openSignalsFile` opens a sim's signals JSON in the OS default editor; `importSignalsFile` is a file-pick → validate → copy-into-userData flow with the picker defaulted to the userData folder.
- **Driver configs**: `openDriverConfig` takes `{ profileDir, filename, defaultContent }`, ensures the file exists (writing `defaultContent` if missing), and opens it in the OS default editor. Used by the Hardware Config tab's "Open in OS editor" / "Open raw XML" buttons. For AD, the renderer renders the current in-memory state as the default content so a freshly-opened file matches what `saveProfile` would write; for other drivers, a minimal stub with the correct XML root element is written.
- **Settings**: `loadSettings` / `saveSettings` persist to `app.getPath('userData')/settings.json`. `saveSettings` MERGES the incoming partial object into the existing file rather than overwriting — callers pass only the fields they're updating (`{ mappingDir }`, `{ disclaimerAcceptedAt }`, etc.). Pre-merge behavior was lossy and would have wiped the disclaimer flag on every directory save. `quitApp` is wired up for the disclaimer modal's Decline button to close the app outright.

When you add a new IPC channel, register the handler in `main.js`, expose it on `window.api` in `preload.js`, and call it from the renderer — `contextIsolation: true` and `nodeIntegration: false` are non-negotiable.

### What the app produces on disk

For a profile named `MyProfile` with N gauges, declared SimSupports, and at least one stage-2 edge wired to AnalogDevices, `saveProfile` creates:

```
<mappingDir>/MyProfile/
  Simtek<digits><descriptor>.mapping  ← one per Simtek gauge; e.g. Simtek100207tachometerrpm.mapping.
                                         Empty <SignalMappings/> for declared-but-unwired gauges
                                         (the file's existence keeps them visible across reload).
  HardwareSupportModule.registry      ← <Module> per gauge HSM (from p.instruments) + per declared
                                         driver HSM (from p.drivers). Nothing hardcoded — Henk-only
                                         / PHCC-only / Teensy-only profiles produce a clean registry.
  SimSupportModule.registry           ← <Module> per declared sim-support id (from p.simSupports).
                                         Always-Falcon4 hardcoding is gone; an empty SSM is legal.
  AnalogDevicesHardwareSupportModule.config  ← authored from p.drivers.analogdevices when AD is declared.
                                         No longer createOnly: every save overwrites the file with the
                                         current in-memory state, because the Hardware Config tab is the
                                         canonical authoring surface for AD calibration. Hand-edits made
                                         outside the editor are lost on the next save in the editor.
                                         Without this file SimLinkup's
                                         `AnalogDevicesHardwareSupportModule.GetInstances()` registers no
                                         DAC HSMs and the entire AD pipeline is silent.
  henksdi.config                       ← authored from p.drivers.henksdi when HenkSDI is declared.
                                         Same createOnly:false contract as AD: edits in the Hardware
                                         Config tab overwrite the file on save. Includes per-device
                                         identity, power-down config, stator base angles, movement
                                         limits, 8 channel configs (with PWM calibration breakpoints
                                         when applicable), and update-rate control settings. The writer
                                         emits only the active <ModeSettings> sub-element (Limit or
                                         Smooth) and always writes the canonical <StatorBaseAnglesConfig>
                                         even when reading from samples that have <StatorBaseAngles>.
  HenkieQuadSinCosHardwareSupportModule.config  ← authored from p.drivers.henkquadsincos when
                                         HenkQuadSinCos is declared. Same createOnly:false contract.
                                         Tiny schema — 4 fields per device (Address, COMPort,
                                         ConnectionType, DiagnosticLEDMode). Root is <HenkieQuadSinCos>.
  PhccHardwareSupportModule.config     ← authored from p.drivers.phcc when PHCC is declared. Single
                                         field: <PhccDeviceManagerConfigFilePath> pointing to a
                                         sibling file (default "phcc.config") that holds the actual
                                         motherboard + Doa peripheral config. The editor doesn't
                                         author the pointed-at file — that's a separate, much larger
                                         schema in Phcc.dll. Root is <PhccHardwareSupportModuleConfig>.
  ArduinoSeatHardwareSupportModule.config  ← authored from p.drivers.arduinoseat when ArduinoSeat is
                                         declared. Top-level board fields (COMPort, MotorByte1..4,
                                         ForceSlight/Rumble/Medium/Hard) plus a <SeatOutputs> array
                                         of <Output> entries (each with ID, FORCE, TYPE, motor bits,
                                         per-motor speeds, MIN, MAX). Root is the class name
                                         <ArduinoSeatHardwareSupportModuleConfig>.
  TeensyEWMUHardwareSupportModule.config  ← authored from p.drivers.teensyewmu when TeensyEWMU is
                                         declared. COMPort + <DXOutputs>/<Output> entries (each ID
                                         + Invert bool). Root is <TeensyEWMUHardwareSupportModuleConfig>.
                                         Always emits canonical element form even if the on-disk
                                         file was previously in the broken attribute-form layout.
  TeensyRWRHardwareSupportModule.config  ← authored from p.drivers.teensyrwr when TeensyRWR is
                                         declared. Vector-display calibration: COMPort,
                                         RotationDegrees, TestPattern, X/Y axis calibration
                                         breakpoint tables (Input/Output double pairs), Centering
                                         (signed short offsets), Scaling (double factors). Root is
                                         <TeensyRWRHardwareSupportModuleConfig>.
  TeensyVectorDrawingHardwareSupportModule.config  ← authored from p.drivers.teensyvectordrawing
                                         when TeensyVectorDrawing is declared. TeensyRWR's schema
                                         plus a <DeviceType> enum (RWR/HUD/HMS) selecting between
                                         vector rendering modes. Root is
                                         <TeensyVectorDrawingHardwareSupportModuleConfig>.
  DTSCardHardwareSupportModule.config  ← authored from p.drivers.niclasmorindts when
                                         NiclasMorinDTS is declared. Multi-device. Each <Device>
                                         has <Serial>, optional <DeadZone>, and <CalibrationData>
                                         breakpoints. Root is <DTSCard>.
  PoKeysHardwareSupportModule.config   ← authored from p.drivers.pokeys_digital (which is
                                         shared by reference with p.drivers.pokeys_pwm) when
                                         either PoKeys driver is declared. Multi-device by
                                         serial. Each <Device> has <Serial>, optional <Name>,
                                         <PWMPeriodMicroseconds> (per-device since hardware
                                         shares the period across all 6 PWM channels), and
                                         lists <DigitalOutputs>/<Output>{<Pin>,<Invert>} and
                                         <PWMOutputs>/<Output>{<Channel>}. The PoKeys driver
                                         is split across two editor catalog ids
                                         (pokeys_digital, pokeys_pwm) so the kind-mismatch
                                         validator can key off a flat driver→kind map; both
                                         entries point at the same C# class FQN
                                         (SimLinkup.HardwareSupport.PoKeys.PoKeysHardwareSupportModule)
                                         and the registry-build code dedupes by class name
                                         so the <Module> appears once. Root is <PoKeys>.
```

Stale `*.mapping` files (gauges removed in this save) are swept before writing, so the on-disk layout always matches the in-memory `p.instruments` list. `setDefaultProfile` writes `<mappingDir>/default.profile`.

The XML writers in `main.js` and the renderer's `renderMappingXml` hardcode the SimLinkup assembly strings (`SimLinkup, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null` for HSMs; per-sim assembly from `SIM_SUPPORTS[].assembly` for the SSM registry, e.g. `F4Utils.SimSupport, Version=0.1.0.0, ...` for Falcon BMS). Match these formats exactly when emitting registry XML.

### Static data (loaded from JSON at startup)

The editor's reference data lives in `src/data/` as JSON, with a userData-override mechanism:

- `instruments.json` — the gauge catalog.
- `sim-<id>-signals.json` — one per supported sim (today: `sim-falcon4-signals.json`). New sims = drop a new file + append to `SIM_SUPPORTS` in `src/index.html`.

On first launch `main.js`'s `seedUserDataFiles()` copies every bundled JSON into `<userData>/` (idempotent — never overwrites existing files, so user edits persist across upgrades). A one-time migration moves the legacy `f4-signals.json` to `sim-falcon4-signals.json`. The `load-static-data` IPC reads `<userData>/<filename>` first and falls back to the bundled defaults if a file is missing or fails to parse. A "Data folder" button in the titlebar opens `%APPDATA%\simlinkup-profile-editor\` in Explorer.

**`sim-falcon4-signals.json` is auto-generated** from `F4SimSupportModule.cs:CreateSimOutputsList()` in the lightningstools repo — re-run `node scripts/extract-f4-signals.mjs` after BMS adds or renames signals upstream. Don't hand-edit the bundled file. The script defaults to `../lightningstools/src/F4Utils/SimSupport/F4SimSupportModule.cs`. Entries are sorted `(coll, sub)` so the file reads as contiguous category groups.

`instruments.json` is hand-maintained against the per-manufacturer C# sources
under `lightningstools/src/SimLinkup/HardwareSupport/<Manufacturer>/`. The
catalog covers Simtek and the other shipping manufacturers (AMI, Astronautics,
Gould, Henk, Henkie, Lilbern, Malwin, Westin). Each entry holds:
- `pn`, `name`, `cls` (full .NET class FQN, written verbatim into the registry), `manufacturer` (namespace segment from `cls`, used to group the Instruments tab and populate the manufacturer filter), `cat`.
- `digitPrefix` — the prefix the gauge HSM uses in port IDs. For most numeric-prefix gauges this equals dashes-stripped `pn`, but **10-0207_110 has digitPrefix `100207`** (its C# class emits port IDs without the `_110` suffix). Named-prefix gauges (Gould `HS070D51341`, the five Henk/Henkie boards) store the named prefix here verbatim. This is critical for round-trip correctness; the load/save logic uses this field, not the dash-stripped pn. The renderer also backfills `digitPrefix` and `manufacturer` if older seeded JSON files lack them.
- Legacy free-text label arrays (`analog_in`/`analog_out`/`digital_in`/`digital_out`) — only consumed by the catalog tab.
- Structured `inputPorts: [{ port, label, kind }]` and `outputGroups: [{ kind, label, ports: [{ role, port, kind }] }]`. Port suffixes match the C# `Id = "<prefix>_<suffix>"` literal exactly. For some Henk/Henkie modules with both non-addressed inputs and addressed (`[0x..]`) outputs, only the non-addressed inputs are modelled — the addressed outputs are real signals but self-driven over USB and never wired in shipping profiles.
- `outputGroups[].kind` is `'analog_single'`, `'digital_single'`, or `'resolver_pair'` (sin + cos drive one dial — routed independently but selected as a pair in the UI).
- For named-prefix gauges, `pn` is the raw named prefix (e.g. `"HenkF16ADISupportBoard"`, `"HS070D51341"`) — *not* a friendlier dashed form — because `parseGaugePort` returns the prefix verbatim and the chain model looks it up against `INSTRUMENTS[i].pn`. The user-facing form lives in `name`.

See `src/data/README.md` for the JSON schemas in full.

### Renderer: `src/index.html` — profile editor

Single-page editor with a sidebar (profile list + broken-mapping badge per profile) and a tabbed main pane.

**File layout.** `src/index.html` is now a thin shell — `<head>` pulls in `src/styles/main.css`, `<body>` carries the markup, then a sequence of plain `<script src="js/...">` tags loads the renderer code in dependency order. No bundler, no ES modules — each script declares its functions/`let`s in the global scope so the inline `onclick=` / `onchange=` handlers in the markup can call them by name. **Load order matters** (later files reference symbols from earlier ones; init.js's IIFE assumes everything else is loaded):

| Order | File | Contents |
|---|---|---|
| 1 | `js/state.js` | Top-level mutable lets (`profiles`, `activeIdx`, `INSTRUMENTS`, `SIM_SIGNALS`, …) |
| 2 | `js/util.js` | `escHtml`, `escXml`, `setSelectValue`, `toast`, numeric clamps (`adClamp`, `intClamp`, `floatClamp`, `boolFromText`) |
| 3 | `js/catalogs.js` | `DRIVER_PATTERNS`, `DRIVER_META`, `SIM_SUPPORTS`, `DRIVER_OPTIONS`, `DRIVER_HINTS` |
| 4 | `js/driver-defaults.js` | Per-driver `*_DEFAULTS` constants + `*DefaultDevice()` factories (AD, HenkSDI, HenkQuadSinCos, PHCC, ArduinoSeat, TeensyEWMU, TeensyRWR, TeensyVectorDrawing, NiclasMorinDTS, PoKeys) |
| 5 | `js/driver-parsers.js` | XML→state parsers (`parseDriverConfigs`, `parse*Config`) and backfills for all 9 output drivers |
| 6 | `js/calibration-defaults.js` | Empty `GAUGE_CALIBRATION_DEFAULTS` index map + helpers (`gaugeCalibrationDefaultsFor`, `cloneGaugeCalibrationDefault`, `gaugeCalibrationIsEdited`, `validatePiecewiseChannel`, `CALIBRATION_TRIM_DEFAULTS`). The map is intentionally **mutable** (not frozen) so per-gauge files can self-register at script-load time |
| 6a | `js/gauges/<file>.js` | One file per gauge — extracts the spec-sheet transform from the matching `*HardwareSupportModule.cs:UpdateOutputValues()` and assigns `GAUGE_CALIBRATION_DEFAULTS['<pn>'] = Object.freeze({...})`. Filename convention: `<manufacturer-prefix>-<digits>-<short>.js` (e.g. `sim-100207-rpm.js`). Listed inside the marked block in `index.html` between `calibration-defaults.js` and `gauge-config-io.js`. Adding a new gauge = one new file + one new `<script>` tag |
| 7 | `js/gauge-config-io.js` | Per-gauge `<ClassShortName>.config` round-trip — `gaugeConfigFilenameForPn`, `gaugePnForConfigFilename`, `renderGaugeConfigXml`, `parseGaugeConfigXml`, `parseGaugeConfigs` |
| 8 | `js/chain.js` | Two-stage chain model (`parseGaugePort`, `parseDestination`, `classifyMapping`, `buildInstrumentView`, `parseMappingsFromXml`, `applyLoadedChain`, edge mutation helpers, registry parsing, source-validity helpers, `computeProfileHealth`) |
| 9 | `js/save.js` | XML writers (`renderAnalogDevicesConfig`, `renderHenkSDIConfig`, …, `generateMappingFiles`, `renderMappingXml`) — also emits per-gauge configs into the `driverConfigs` IPC payload |
| 10 | `js/sidebar.js` | Page chrome (`renderSidebar`, `renderEditor`, `renderDefaultStatus`, `switchTab`) |
| 11 | `js/tab-instruments.js` | Instruments + Active tabs |
| 12 | `js/tab-mappings.js` | Signal Mappings tab — `renderMappings`, `renderInstrumentCard`, `renderInputRow`, `renderOutputGroup`, `renderOutputChannelRow`, `effectiveDriverHint`, `simSourceOptionsHtml`, `onSet*` handlers, `_channelConflicts`, `_suppressInvalidRowHint`, `buildChannelConflictMap`, `computeGaugeCompletion` |
| 13 | `js/tab-hardware.js` | Hardware tab (driver declaration + per-device count/address UI) |
| 14 | `js/tab-hardware-config.js` | Hardware Config tab — per-driver structured editors for all 9 drivers (`renderAnalogDevicesCardHtml`, `renderHenkSDICardHtml`, … plus all `setAd*`/`setSdi*`/`setArdSeat*`/`setTewmu*`/`setTrwr*`/`setTvd*`/`setNmdts*`/`setPhccPath`/`setQscField` handlers and `openDriverConfigFile` / `openPhccDeviceManagerFile`) |
| 15 | `js/tab-simsupport.js` | SimSupport tab |
| 16 | `js/tab-calibration.js` | Calibration tab — per-gauge transform editors (`renderCalibration`, `renderGaugeCalibrationCard`, `renderPiecewiseChannelEditor`, mutators `setCalibrationBreakpoint`/`addCalibrationBreakpoint`/`removeCalibrationBreakpoint`/`setCalibrationTrim`/`resetGaugeCalibration`, `setAllCalibrationCardsOpen`, `_calibrationOpen`) |
| 17 | `js/profile.js` | Directory + profile actions (`pickDir`, `autoDetectDir`, `setDir`, `selectProfile`, `addProfile`, `deleteProfile`, `setDefault`, `saveProfile`, `openFolder`) |
| 18 | `js/init.js` | IIFE that runs LAST: hydrates `INSTRUMENTS`/`SIM_SIGNALS` via `loadStaticData` and bootstraps the page |

`electron-builder`'s `build.files` array already includes `src/**/*` so the installer picks up everything under `src/styles/` and `src/js/` automatically.

**Conventions for adding code.** Default to editing the file the work fits into rather than introducing a new one. If a function is shared by multiple files, JS hoisting and call-time global resolution mean ordering between sibling files mostly doesn't matter — only `state.js` (must come first), `init.js` (must come last), and the parser/save dependency chain (defaults → parsers → chain/save) are load-order-sensitive. **Don't introduce a bundler or ES modules** — every function is reachable from inline `onclick=` markup, which only works against the global scope.

Tabs in declared order — this is the intended new-profile workflow:

1. **Hardware** — catalog of output drivers. `+ Add` declares a driver into `p.drivers`. AnalogDevices uses a count-based device list (`+`/`−` board buttons); HenkSDI/HenkQuadSinCos use editable address rows; other drivers are single-instance. Removing a driver while channels target it is refused with a toast.
2. **Hardware Config** — deep editor for per-driver `.config` files, one collapsible card per declared driver. **All ten driver ids** (PoKeys is split into two for the kind-mismatch validator but renders one combined card) have structured editors today (no stub cards remain).
   - **AnalogDevices**: per-device DACPrecision dropdown, board-level `OffsetDAC0/1/2` inputs, 40-row × 4-input table for per-channel `Offset`/`Gain`/`DataValueA`/`DataValueB`.
   - **HenkSDI**: per-device structured editor with six sections — Identity (Address, COMPort, ConnectionType, DiagnosticLEDMode, InitialIndicatorPosition), Power-down (Enabled, Level, DelayMs), Stator base angles (S1/S2/S3 in degrees), Movement limits (Min/Max byte), Output channels (DIG_PWM_1..7 + PWM_OUT, each with mode/InitialValue and a calibration breakpoint table when the channel is in PWM mode), and Update-rate control (Limit/Smooth/Speed/Misc with mode-conditional sub-block). PWM_OUT has no Mode dropdown — its `<Mode>` element is intentionally omitted on save to match all sample configs.
   - **HenkQuadSinCos**: per-device structured editor with a single Identity section (Address, COMPort, ConnectionType, DiagnosticLEDMode). The C# schema has no nested groups — just 4 flat fields, all reusing HenkSDI's enum value lists.
   - **PHCC**: single-instance, single-field editor for the device-manager config pointer (`PhccDeviceManagerConfigFilePath`, default `phcc.config`). PHCC's `.config` is a thin pointer to a sibling file containing the actual motherboard + Doa peripheral config — the editor doesn't yet structure-edit that nested file, so the card has an "Open device-manager config" button that resolves the path the same way SimLinkup does (absolute as-is, otherwise profile-dir-relative) and opens it in the OS editor, creating a minimal `<PhccDeviceManagerConfiguration>` stub if missing.
   - **ArduinoSeat**: single-instance editor with two top-level sections (Identity & motor-bit-mask bytes; Force levels) plus a list of `<Output>` entries. Each output card carries `ID`, `FORCE` (Manual/Off/Slight/Rumble/Medium/Hard), `TYPE` (Fixed/Progressive/CenterPeak), 4 motor-enable checkboxes, 4 per-motor speeds, and `MIN`/`MAX` doubles. The "+ Add F-16 standard outputs" button bulk-imports all 40 signals the C# HSM publishes (digital signals seeded with all motors enabled + Hard/Fixed; analog signals seeded with Manual/Fixed + no motors). Duplicate or empty `ID` fields are flagged with an inline warning badge. The matching upstream HSM bug fixes (5 patches; see `lightningstools/src/SimLinkup/HardwareSupport/ArduinoSeat/`) make every editor field actually take effect at runtime.
   - **TeensyEWMU**: single-instance editor with COMPort + a list of DX outputs (each carrying an `ID` and an `Invert` checkbox). The 35 IDs come from `TeensyEWMUCommunicationProtocolHeaders.InvertBits`; the "+ Add standard outputs" button bulk-imports them. **Both bundled samples are in the wrong on-disk format** (attribute-form `<DXOutput ID="..." Invert="..."/>` instead of element-form `<Output><ID>...</ID><Invert>...</Invert></Output>`); SimLinkup's XmlSerializer silently drops the unrecognised entries at runtime, leaving `DXOutputs` empty. The editor reads BOTH forms and always writes canonical element form, so opening + saving any bundled-sample profile in the editor migrates it to the working form.
   - **TeensyRWR**: single-instance vector-display editor with three sections: identity & orientation (COMPort, RotationDegrees float, TestPattern int), centering offsets (signed shorts), scaling factors (doubles), and X-axis + Y-axis calibration breakpoint tables (each `<Input>`/`<Output>` double pair, same shape as HenkSDI's calibration). Each calibration table has a "Reset to identity" button (0→0, 4095→4095). Defaults come from the C# class's field initialisers (Centering=0/0, Scaling=1/1, calibration=identity).
   - **TeensyVectorDrawing**: same shape as TeensyRWR plus a `DeviceType` dropdown (RWR/HUD/HMS) that selects between vector rendering modes. Reuses TeensyRWR's centering/scaling/calibration defaults and CSS.
   - **Niclas Morin DTS Card**: multi-device driver. Per-device editor: Serial (used as the device address), optional DeadZone (FromDegrees / ToDegrees doubles — synchro angular range to skip for mechanical-stop regions), and a CalibrationData breakpoint table mapping sim values → synchro angles in degrees. The DeadZone block is omitted on save when both values are zero (matches the bundled sample's first device which has no DeadZone). The on-disk XML uses `<Serial>` per the C# class; editor state stores it as `address` so the existing Mappings-tab driver-channel picker reads it through the same code path as HenkSDI/HenkQuadSinCos.
   - **PoKeys**: multi-device driver. Two driver ids in the catalog (`pokeys_digital` for digital pins, `pokeys_pwm` for PWM channels) wire to the same C# HSM and the same `.config` file — split solely so the kind-mismatch validator's flat `DRIVER_CHANNEL_KIND` map can score gauge ports correctly (digital flag → `pokeys_digital` is fine, digital flag → `pokeys_pwm` warns). Both ids share `decl.devices` by reference (the parser sets `out.pokeys_digital = out.pokeys_pwm = parsed`, and `toggleDriver` reuses the partner's array when adding the second id). The Hardware Config tab dedupes — only ONE PoKeys card appears regardless of which combination of ids is declared. Per-device editor: Identity (Serial as the device address, optional Name, PWM Period in microseconds), a list of digital-pin outputs (Pin 1..55 + Invert checkbox), a list of PWM channels (PWM1..PWM6, where PWM1=physical pin 17 … PWM6=physical pin 22 — labelled with both the PWM number and the physical pin so users wiring relays/RC servos pick the right output without referencing the manual). Pin and channel dropdowns disable already-used values. The save flow renders the `.config` once via `pokeys_digital`'s branch; `pokeys_pwm`'s branch is a deliberate no-op (DRIVER_META marks it `skipConfigFile: true` for documentation, even though the actual dedupe lives in `generateDriverConfigs`). The C# HSM (vendored alongside `lightningstools/src/SimLinkup/HardwareSupport/PoKeys/lib/PoKeysDevice_DLL.dll` v2025-11-04) is USB-only and addresses devices by serial — boards declared in config but not currently plugged in are logged and skipped, so a single missing PoKeys doesn't break unrelated outputs. Out-of-scope-for-v1 features documented inline in `PoKeysHardwareSupportModule.cs`: matrix LED, LCD, PoExtBus, PoNET, digital counters, encoders, analog inputs, Ethernet/network discovery.
   Empty state with a hint pointing back to the Hardware tab when no drivers are declared. The "Reset to defaults" button per device confirms then resets fields to the C# class's internal fallbacks (resets preserve the device's address so wired channels don't orphan).
3. **SimSupport** — catalog of sim-source modules. Today only Falcon BMS. "View signals" opens that sim's JSON in the OS editor; "Import…" file-picks a replacement, validates, and prompts to clear any newly-broken mappings across all profiles.
4. **Instruments** — gauge catalog (the original tab; 19 Simtek entries). `+ Add` puts a PN into `p.instruments`.
5. **Active** — list view of declared instruments.
6. **Signal mappings** — per-gauge cards (one per active instrument). Cards are collapsible `<details>`/`<summary>`, default-collapsed. The card header is colored by completion status (green/amber/red) and carries a `wired/total` pill plus a chevron. **Expand all / Collapse all** buttons sit at the top right. The tab title shows three issue badges when relevant: `⚠ N broken` (sources not in catalog), `✗ N` (DAC channel conflicts), `! N incomplete` (partially-wired gauges). The tab row is sticky to the top of the editor body.
7. **Calibration** — per-gauge transform editors (Layer 1 of SimLinkup's three-layer calibration model — see the `simlinkup_architecture` memory for the layered split). One collapsible `<details>` card per declared instrument, mirroring the Mappings tab card pattern. Pattern-aware editors per channel: today only the **piecewise breakpoint table** has an editor (10-0207 RPM is the proof-of-concept). Other declared gauges with no editor yet show a stub card. The schema can express all four transform patterns (linear, piecewise, resolver, multi-turn resolver) plus per-channel `ZeroTrimVolts`/`GainTrim`; `linear`/`resolver`/`multi_resolver` editors land in follow-up phases. **Saves emit `Simtek<digits>HardwareSupportModule.config` per gauge** with `createOnly:true` when the user hasn't touched the card (protects hand-edits made before discovering the editor) and `createOnly:false` once an entry exists in `p.gaugeConfigs[pn]` (Calibration tab is then the canonical authoring surface). "Reset to defaults" sets a `_gaugeResetPending` flag the save flow consumes to force a one-time overwrite. SimLinkup does NOT yet read these files for most gauges (only 10-0285 baro and 10-0294 fuel have C# `Load` implementations, and those use a different bare-property schema and are deliberately absent from `GAUGE_CALIBRATION_DEFAULTS`); the editor produces the files anyway and a SimLinkup-side patch consuming them is a separate workstream.

State lives in module-scope `let`s (`profiles`, `activeIdx`, `activeTab`, `INSTRUMENTS`, `SIM_SIGNALS`, …). Each profile in `profiles` carries:
- `name`, `loaded` — bookkeeping.
- `instruments: [pn]` — list of declared gauge PNs (drives the catalog/active tabs).
- `drivers: { [driverId]: { devices: [{...}] } }` — declared output-driver HSMs. Device shape varies per driver:
  - **AnalogDevices** (`count`-shape) — each device carries the full structured config: `{ dacPrecision: 'SixteenBit'|'FourteenBit', offsetDAC0/1/2: number, channels: [{offset, gain, dataValueA, dataValueB} × 40] }`. Defaults (filled in by `backfillAnalogDevicesDevices`): `Offset=0x8000`, `Gain=0xFFFF`, `DataValueA/B=0x8000`, `OffsetDAC0/1/2=0x2000`, `DACPrecision=SixteenBit`. Edited via the Hardware Config tab; serialised by `renderAnalogDevicesConfig`.
  - **HenkSDI** (`address`-shape) — each device carries the full HenkSDI config: `{ address, comPort, connectionType, diagnosticLEDMode, initialIndicatorPosition, powerDown: {enabled, level, delayMs}, statorBaseAngles: {s1, s2, s3}, movementLimits: {min, max}, channels: { DIG_PWM_1..7, PWM_OUT: {mode, initialValue, calibration: [{input, output}, ...]} }, updateRateControl: {mode, stepUpdateDelayMillis, useShortestPath, limitThreshold, smoothing: {minThreshold, mode}} }`. Defaults filled by `backfillHenkSDIDevices`. Both `limitThreshold` and `smoothing.*` are kept in state regardless of `mode`, so toggling Limit ↔ Smooth doesn't lose the user's tuning; the writer only emits the active one. Parser tolerates two known sample-file typos: `<StatorBaseAngles>` (canonical: `<StatorBaseAnglesConfig>`) and `xsi:type="SmoothModeSettings"` (canonical: `SmoothingModeSettings`) — both are emitted in canonical form on save.
  - **HenkQuadSinCos** (`address`-shape) — each device carries `{ address, comPort, connectionType, diagnosticLEDMode }`. Reuses `HENKSDI_CONNECTION_VALUES` / `HENKSDI_DIAG_LED_VALUES` for enum validation. Defaults filled by `backfillHenkQuadSinCosDevices`. Serialised by `renderHenkQuadSinCosConfig` (root: `<HenkieQuadSinCos>`, element order matches C# class declaration: Address, COMPort, ConnectionType, DiagnosticLEDMode).
  - **PHCC** (`single`-shape) — single-element `devices` array carrying `{ deviceManagerConfigFilePath: 'phcc.config' }` (defaults to that, matching the only sample profile). The C# class has no `[XmlRoot]` override so the root element name is the class name itself: `<PhccHardwareSupportModuleConfig>`. Serialised by `renderPhccConfig`. SimLinkup resolves the path the same way `openPhccDeviceManagerFile()` does (see `PhccHardwareSupportModule.cs:82`): try absolute as-is, fall back to profile-dir-relative.
  - **ArduinoSeat** (`single`-shape) — single-element `devices` array carrying `{ comPort, motorByte1..4, forceSlight, forceRumble, forceMedium, forceHard, seatOutputs: [...] }`. Each `seatOutput` is `{ id, force, type, motor1..4 (bool), motor1Speed..4Speed (byte), min, max (double) }`. Force enum: `Manual/Off/Slight/Rumble/Medium/Hard`. Type enum: `Fixed/Progressive/CenterPeak`. The C# class has no `[XmlRoot]` override; root element is `<ArduinoSeatHardwareSupportModuleConfig>`. Defaults filled by `backfillArduinoSeatDevices`. Serialised by `renderArduinoSeatConfig` (element order matches `[XmlElement]` declaration). Duplicate IDs are preserved verbatim on read AND write — the bundled sample has one (`GEAR_PANEL__GEAR_POSITION` × 2) and SimLinkup picks up only the first match at runtime.
  - **TeensyEWMU** (`single`-shape) — single-element `devices` array carrying `{ comPort, dxOutputs: [{id, invert}, ...] }`. Root is `<TeensyEWMUHardwareSupportModuleConfig>` (no `[XmlRoot]` override). Reads both element and attribute child shapes; always writes canonical element form `<Output><ID>...</ID><Invert>...</Invert></Output>` so the next save migrates the broken bundled-sample format to the working one.
  - **TeensyRWR** (`single`-shape) — single-element `devices` array carrying `{ comPort, rotationDegrees, testPattern, centering: {offsetX, offsetY}, scaling: {scaleX, scaleY}, xAxisCalibration: [{input, output}, ...], yAxisCalibration: [{input, output}, ...] }`. Root is `<TeensyRWRHardwareSupportModuleConfig>` (no `[XmlRoot]` override). Calibration breakpoints share the `Common.MacroProgramming.CalibrationPoint` C# class with HenkSDI; the writer emits element order matching the C# class declaration (COMPort, RotationDegrees, TestPattern, XAxisCalibrationData, YAxisCalibrationData, Centering, Scaling).
  - **TeensyVectorDrawing** (`single`-shape) — TeensyRWR's shape plus a `deviceType` field (`'RWR' | 'HUD' | 'HMS'`, default `'RWR'`). Reuses `TRWR_CENTERING_DEFAULTS` / `TRWR_SCALING_DEFAULTS` / `TRWR_IDENTITY_CALIBRATION` so the two drivers stay in sync. Root is `<TeensyVectorDrawingHardwareSupportModuleConfig>`. Element order: COMPort, DeviceType, RotationDegrees, TestPattern, XAxisCalibrationData, YAxisCalibrationData, Centering, Scaling. Unknown DeviceType values coerce to RWR on read.
  - **NiclasMorinDTS** (`address`-shape) — multi-device. Each device carries `{ address, deadZone: {fromDegrees, toDegrees}, calibrationData: [{input, output}, ...] }`. The XML uses `<Serial>` per device but state uses `address` so the existing Mappings-tab plumbing for `address`-shape drivers (HenkSDI/HenkQuadSinCos) just works. Root is `<DTSCard>` (the C# class has `[XmlRoot("DTSCard")]`). DeadZone block is omitted on save when both values are 0 to match the sample's "no dead zone needed" pattern.
  - **PoKeys** (`address`-shape, dual driver id) — multi-device, addressed by uint serial number stored as a string in `address`. Each device carries `{ address, name, pwmPeriodMicroseconds, digitalOutputs: [{pin, invert}], pwmOutputs: [{channel}] }`. Catalog splits into `pokeys_digital` (DRIVER_CHANNEL_KIND='digital') and `pokeys_pwm` (DRIVER_CHANNEL_KIND='analog'); the parser sets `out.pokeys_digital = out.pokeys_pwm = parsed` to share the devices array by reference, and `toggleDriver` (in tab-hardware.js) reuses the partner's array when the user adds the second id. Both ids share `cls`; the registry-build code in save.js dedupes <Module> entries by class FQN. The save flow renders `PoKeysHardwareSupportModule.config` once via `pokeys_digital`'s branch (`pokeys_pwm`'s branch is a deliberate no-op; DRIVER_META marks it `skipConfigFile: true` for documentation). Root element `<PoKeys>`. Per-device element order matches C# class declaration: Serial, Name, PWMPeriodMicroseconds, DigitalOutputs (`<Output>` with `<Pin>1..55</Pin>` and `<Invert>` bool), PWMOutputs (`<Output>` with `<Channel>1..6</Channel>` — 1-based, where PWM1=physical pin 17 … PWM6=physical pin 22; the C# HSM applies the DLL's reverse-channel-indexing internally so the editor and config stay human-readable). PWM period is per-device because the hardware shares one period across all 6 PWM channels; stored in microseconds so the file is portable across PoKeys55 (12 MHz clock) and PoKeys56/57 (25 MHz clock). Defaults filled by `backfillPoKeysDevices`.
- `simSupports: [simId]` — declared SimSupport modules.
- `chain: { edges, instruments }` — the **chain model** (see below). Source of truth for the Signal Mappings tab and the per-gauge `.mapping` file emit.
- `driverConfigsRaw: { filename: text }` — raw config file text from disk (Hardware-tab "On-disk config" view).
- `gaugeConfigs: { [pn]: { channels: [{ id, kind, breakpoints: [{input,volts}], zeroTrim, gainTrim }] } }` — per-gauge calibration state (Layer 1). Populated by `parseGaugeConfigs` on load (only for gauges in `GAUGE_CALIBRATION_DEFAULTS`); cloned from defaults the first time the user touches a field in the Calibration tab. Absent entry = "user hasn't touched this gauge"; the save flow uses that to choose between `createOnly:true` (protect on-disk hand-edits) and `createOnly:false` (overwrite from in-memory state).
- `gaugeConfigsRaw: { filename: text }` — round-trip cache for per-gauge `.config` files we loaded but don't yet have a calibration editor for. Re-emitted on save with `createOnly:true` so the file survives across edit cycles even before its editor lands.
- `_gaugeResetPending: Set<pn>` (transient) — set by `resetGaugeCalibration` so the next save overwrites the on-disk file with regenerated defaults. Consumed and cleared by `generateDriverConfigs`.

#### The chain model

A profile's `<SignalMapping>` rows describe a two-stage chain:
- **stage 1**: F4 source (`F4_*`) → gauge HSM input port (e.g. `100207_RPM_From_Sim`).
- **stage 2**: gauge HSM output port → output-driver input port (e.g. `AnalogDevices_AD536x/537x__DAC_OUTPUT[0][11]`, or `HenkSDI[0x32]__PWM_OUT`).

`parseMappingsFromXml(fileList, declaredPns)` returns `{ edges, instruments }`:
- `edges` is 1:1 with `<SignalMapping>` rows, classified into stage 1 / 2 / '1.5' / 'unknown'. Each edge carries raw `src`/`dst` strings (round-trip safe), parsed `srcGaugePn`/`srcGaugePort`, and parsed destination details (gauge or driver).
- `instruments` is a derived per-gauge view that groups inputs by port and stage-2 outputs against the gauge's `outputGroups` template. Resolver pairs end up as one group with two channel slots; analog/digital singles as one. Edges that don't match a known port template land in a per-instrument `raw` bucket.

`classifyMapping(src, dst, kind, prefixMap, declaredPns)` is the pure helper. `DRIVER_PATTERNS` is the regex+cls table for each output driver — add new drivers there. `parseGaugePort` recognises both numeric prefixes (Simtek/AMI/Astronautics) and named gauge HSMs (HenkF16ADISupportBoard, etc.). It also **self-heals malformed port IDs** — when an extracted port doesn't match any known port on the resolved instrument, it strips a leading `<segment>_` and re-checks. This rescues older saved profiles where the editor wrote `100207_110_RPM_From_Sim` instead of `100207_RPM_From_Sim`.

`declaredPns` lets the parser disambiguate digit-prefix collisions: 10-0207 and 10-0207_110 both emit IDs prefixed `100207_`, so when both classes are theoretically declared, the registry-derived set tells the parser which gauge an edge belongs to. Per-file context (filename → PN) further refines that.

`refreshInvalidEdgeFlags(p)` annotates every edge with `invalid: true` when its stage-1 source isn't in any declared sim's catalog. Run after load, after `toggleSimSupport`, and after a signals import. The Mappings tab renders `invalid` rows in amber and surfaces the count in the tab title and the sidebar badge.

When mutating `p.chain.edges` (toggling instruments, wiring/unwiring ports), call `rebuildInstrumentView(p)` afterwards so the per-instrument view stays in sync. Empty edges (both src and dst blank) get pruned by `pruneEmptyEdges`.

## Conventions specific to this project

- No bundler, no ES modules, no framework. Renderer JS is a sequence of plain `<script>` tags loading global functions/lets — every inline `onclick=` in the markup resolves against the global scope. Don't introduce a build step to "clean it up" unless explicitly asked.
- File paths in IPC arguments are joined with `'/'` from the renderer (e.g. `mappingDir + '/' + p.name`); `main.js` then uses `path.join`. This works on Windows because Node normalizes mixed separators — keep that pattern when adding new IPC calls rather than reinventing it.
- When adding or renaming a gauge instrument: update `src/data/instruments.json`, set the `manufacturer` field to match the C# namespace segment (`SimLinkup.HardwareSupport.<Manufacturer>.…`), and double-check that `digitPrefix` matches what the C# source's port IDs actually use — it equals dashes-stripped `pn` for most numeric-prefix gauges, equals `pn` for named-prefix gauges, but 10-0207_110 is the standing counterexample (`digitPrefix: "100207"`).
- When adding a new output driver: add a row to `DRIVER_PATTERNS` (regex + parser + class FQN) **and** to `DRIVER_META` (label + configFilename + deviceShape + defaultDevice). The parser, save flow, and Hardware tab UI all key off these tables. If the driver carries both analog and digital outputs (PoKeys is the precedent), split into two driver ids (`<driver>_digital` + `<driver>_pwm` or similar) so the kind-mismatch validator's flat `DRIVER_CHANNEL_KIND` map can score gauge ports correctly. Both ids point at the same C# class FQN; the registry-build code dedupes by class name. Wire shared state by reference (`parseDriverConfigs` returns the same parsed object under both keys; `toggleDriver` in tab-hardware.js reuses the partner's array via a `<DRIVER>_DRIVER_PARTNER` map; `renderHardwareConfig` dedupes the visible card so only one editor renders).
- When adding calibration support for a new gauge: drop a new file at `src/js/gauges/<manufacturer-prefix>-<digits>-<short>.js` (e.g. `sim-100207-rpm.js`) that re-extracts the breakpoints / linear range / resolver scale from the C# `UpdateOutputValues()` method and assigns `GAUGE_CALIBRATION_DEFAULTS['<pn>'] = Object.freeze({...})` at top level. Add a `<script src="js/gauges/<file>.js"></script>` line inside the marked "Gauge calibration defaults" block in `index.html` (sorted by manufacturer then by digit prefix). For the five transform `kind`s: today only `piecewise` has an editor in the Calibration tab and `cross_coupled` has a tailored stub — add a new branch to `renderGaugeCalibrationCard`'s pattern dispatch when building a `linear`/`resolver`/`multi_resolver` editor. The on-disk schema (`<Channels>` / `<Transform kind="...">` / `<Breakpoints>` / `<ZeroTrimVolts>` / `<GainTrim>`) is wired through the round-trip parser (`parseGaugeConfigXml`) and writer (`renderGaugeConfigXml`) and is kind-agnostic — don't change it without coordinating with future SimLinkup-side `Load` patches that will consume these files.
- When adding a new sim: drop a `sim-<id>-signals.json` file in `src/data/` and append a row to `SIM_SUPPORTS` (id, label, cls, assembly, signalsFile). The dropdown auto-discovers it.
