# SimLinkup Profile Editor

A desktop app for creating and managing SimLinkup mapping profiles. Author
the wiring between sim signals and your cockpit instruments, configure
output-driver hardware (DACs, Henk SDI boards, ArduinoSeat, etc.), and
calibrate per-gauge transforms — all without hand-editing XML.

---

## Why this exists

SimLinkup itself has a runtime UI (gauge previews, status indicators,
etc.), but **all configuration** — signal mappings, hardware driver
settings, per-gauge calibration — has to be done by hand-editing XML
files in `Content\Mapping`. That's painful: hundreds of lines of XML
per profile, easy to typo, no way to see at a glance what's wired up
vs broken.

The fix could have been to bolt a configuration editor into SimLinkup
itself, but doing so would force every simulator session to pay for
authoring UI overhead the pilot never uses at flight time — when
SimLinkup is running alongside Falcon BMS (or DCS, or any other
demanding simulator) on the same machine, every CPU cycle and GC pause
counts.

This editor is the separate authoring tool. You run it on the ground
to build or tune your profile, save the resulting `.mapping` and
`.config` files to your SimLinkup `Content\Mapping` directory, then
close the editor and don't launch it again until the next time you
want to change something. SimLinkup picks up the files on its own —
the editor is never part of the flight-time process tree.

---

## For most users: just download the installer

If you don't want to build anything, just grab the prebuilt installer:

1. Go to https://github.com/johndcollins/SimlinkupEditor/releases
2. Download the latest `SimLinkup Profile Editor Setup X.Y.Z.exe`
3. Run it. The installer extracts the editor and the calibration bridge
   into Program Files; live calibration works out of the box.

> **Where to install SimLinkup itself.** SimLinkup keeps your profile,
> mapping, and calibration files inside its own `Content\Mapping`
> folder — and the editor needs to write to that folder every time you
> save. If you install SimLinkup under `C:\Program Files\` (or any
> other UAC-protected location), Windows will block writes from
> anything that isn't running as administrator. To avoid running the
> editor as admin every time, install SimLinkup somewhere unprotected
> like `C:\SimLinkup\` or `C:\Tools\SimLinkup\`. The editor's titlebar
> shows a red "This folder is read-only" banner if it detects a
> protected location after you pick a directory.

The rest of this README is for contributors building from source.

---

## Requirements (building from source)

- **Node.js** (v18 or newer) — https://nodejs.org
  Download the LTS installer and run it. Just click through the defaults.
- **.NET SDK** (v6 or newer) — https://dotnet.microsoft.com/download
  Required to compile the calibration bridge (`bridge/SimLinkupCalibrationBridge`).
  The Visual Studio "Build Tools for Visual Studio" installer also works
  if you'd rather build through VS.

---

## Setup (do this once)

1. **Clone or unzip** this repo anywhere on your PC (e.g. `C:\SimLinkupEditor`)
2. **Open a terminal** in that folder:
   - In Windows Explorer, click the address bar, type `cmd`, press Enter
3. Run:
   ```
   npm install
   ```
   This downloads Electron (~100MB). Takes a minute or two.

`npm install` only handles the JS/Electron dependencies. The C# calibration
bridge is built automatically the first time you run `npm start` or
`npm run make` — see below.

---

## Run the app (development mode)

```
npm start
```

`npm start` runs `prestart` first, which compiles the bridge via
`dotnet build`. After that the editor window opens. The bridge build is
incremental, so subsequent launches are near-instant.

On first launch you'll see a safety disclaimer modal — read it, tick the
acknowledgment box, and click **I understand and accept**. Your acceptance
is saved to `%APPDATA%\simlinkup-profile-editor\settings.json`, so this
appears only once per machine. (See the **Disclaimer** section at the end
of this README for the full text.)

---

## Build a Windows installer

```
npm run make
```

Creates `dist\SimLinkup Profile Editor Setup.exe` — a normal Windows installer
you can run on any PC. Double-click it, install, and it appears in your Start Menu.

> **Note:** The first build takes a few minutes as it downloads the Windows build tools.
> Subsequent builds are fast.

---

## Usage

The editor has six tabs that line up with the order you'd build a profile in:

1. **Pick your `Content\Mapping` folder** — click **Auto-detect** (finds an
   installed SimLinkup) or **Change directory** to point at your `Content\Mapping`
   folder manually. Existing profiles in subfolders load automatically.
2. **Click an existing profile** in the sidebar, or type a name and click
   **+ Create profile** to start a new one.
3. **Hardware tab** — declare each output driver you have installed:
   AnalogDevices DAC, Henk SDI board, Henkie QuadSinCos, PHCC, ArduinoSeat,
   Teensy EWMU / RWR / VectorDrawing, Niclas Morin DTS. For drivers with
   multiple devices (DAC boards, SDI cards), set the count or addresses on
   the card.
4. **Hardware Config tab** — deep editor for each declared driver's `.config`
   file. AnalogDevices: per-board DAC precision, board-level offsets, full
   40-channel calibration table. HenkSDI: per-device identity, power-down
   behavior, stator angles, movement limits, eight output-channel configs
   (with PWM calibration breakpoints), update-rate control. HenkQuadSinCos,
   PHCC, ArduinoSeat, the three Teensy variants, and Niclas Morin DTS each
   have their own structured editor matching their C# config schema. The
   editor is the canonical authoring surface for these files; saves
   overwrite the on-disk file with the in-memory state.
5. **SimSupport tab** — declare the sim source (Falcon BMS today). **View
   signals** opens that sim's signal catalog JSON in your default editor;
   **Import…** lets you replace it with a custom catalog from disk.
6. **Instruments tab** — pick each gauge in your cockpit. Filter by
   manufacturer (Simtek, AMI, Astronautics, Gould, Henk, Henkie, Lilbern,
   Malwin, Westin) or by category (flight, engine, fuel, navigation,
   electrical).
7. **Active tab** — list view of declared instruments. Easy to see what's
   in this profile at a glance.
8. **Signal Mappings tab** — for each gauge, pick the BMS signal that drives
   each input, and the driver/board/channel each output connects to. Cards
   are collapsed by default — click a header to expand. Resolver pairs
   (sin/cos) are routed as a unit. Tab title shows issue badges
   (`⚠ broken`, `✗ conflicts`, `! incomplete`).
9. **Calibration tab** — per-gauge transform editors for the 32 gauges with
   calibration support. Each gauge gets a card with one or more channel
   editors:
   - **Piecewise** — editable input → volts breakpoint table with live SVG
     preview, add/remove rows, per-channel zero/gain trim.
   - **Resolver pair** (sin/cos) — angle-table editor with dial preview,
     scrub-slider for testing the curve, per-winding trim.
   - **Multi-turn resolver** — units-per-revolution + peak voltage, scrub
     slider showing how many revolutions the synchro takes across the
     input range.
   - **Digital invert** — single boolean for OFF flag inputs.
   See the per-gauge breakdown below for what each gauge offers.
10. **Live calibration** (inside each Calibration card) — drives the
    physical gauge from sliders in the editor for hands-on hardware
    tuning. Click **Start live calibration** on a gauge card and the
    editor spawns a small bridge process that writes synthetic Falcon
    BMS values into shared memory. SimLinkup, watching the same memory,
    drives the DAC channel for that gauge. Drag the slider to sweep
    through the input range; tune the breakpoint voltages until the
    physical needle lands on each labelled mark. Refuses to start while
    Falcon BMS is actually running (its writes would fight yours). See
    the **Live calibration architecture** section below for details.
11. **Save to disk** — writes everything into your SimLinkup
    `Content\Mapping\<ProfileName>\` folder, ready for SimLinkup to load.
12. **Set as default** — writes `default.profile` so SimLinkup loads this
    profile next time it starts.

The tab headers show issue badges if anything's wrong. The sidebar shows a
`⚠ N` badge per profile if it has any broken mappings.

---

## Live calibration architecture

When you click **Start live calibration** on a gauge card, the editor
spawns a small C# helper process (`SimLinkupCalibrationBridge.exe`,
sources in `bridge/`). The bridge:

- Refuses to start if Falcon BMS is already running — both can't write
  to the same shared memory at once.
- Reads the current shared memory state on session open, so each slider
  starts at whatever the gauge is being driven from right now (rather
  than a synthetic baseline).
- Receives signal-value updates from the editor over a JSON-on-stdio
  protocol and stamps them into the canonical Falcon BMS memory areas
  (`FalconSharedMemoryArea`, `FalconSharedMemoryArea2`).
- SimLinkup, running separately and already wired to read those areas,
  picks up the values and drives whatever DAC channels your profile
  declares — same code path it uses with the real sim.

This means **your calibration is honest**: the gauge sees the same data
flow at calibration time that it'll see at flight time. No second
"calibration mode" code path that diverges from production. See
`bridge/SimLinkupCalibrationBridge/Sims/Falcon/FalconBridge.cs` for the
F4 signal-id → struct field mapping.

---

## What gets written to disk

For a profile named `MyProfile` with N gauges and a few declared drivers,
the app writes:

```
Content/Mapping/MyProfile/
  Simtek<digits><name>.mapping              ← one per gauge in the profile
  HardwareSupportModule.registry            ← lists declared gauge + driver HSMs
  SimSupportModule.registry                 ← lists declared sim sources
  AnalogDevicesHardwareSupportModule.config ← only if AnalogDevices is declared
  henksdi.config                            ← only if HenkSDI is declared
  HenkieQuadSinCosHardwareSupportModule.config       (only if declared)
  PhccHardwareSupportModule.config                   (only if declared)
  ArduinoSeatHardwareSupportModule.config            (only if declared)
  TeensyEWMUHardwareSupportModule.config             (only if declared)
  TeensyRWRHardwareSupportModule.config              (only if declared)
  TeensyVectorDrawingHardwareSupportModule.config    (only if declared)
  DTSCardHardwareSupportModule.config                (only if declared)
  Simtek<digits>HardwareSupportModule.config         (per gauge with calibration)
  AMI<digits>HardwareSupportModule.config            (per gauge with calibration)
  ...etc per manufacturer
```

These files are ready to use with SimLinkup immediately — no manual XML
editing needed. Removed gauges' `.mapping` files are swept on save, so the
on-disk layout always matches what you see in the editor.

Per-gauge calibration files use `createOnly:true` semantics until you open
that gauge's calibration card — protecting any hand-edits you may have done
before the editor knew about that gauge. Once you've used the Calibration
tab for a gauge, the editor becomes the canonical authoring surface and
subsequent saves overwrite the file from in-memory state.

---

## Hot-reload

Every gauge HSM that supports the new calibration schema watches its config
file with a `FileSystemWatcher`. Editing a `.config` file while SimLinkup is
running picks up the new values without a restart — useful for iterative
tuning against real hardware.

---

## Customizing the data files

The editor loads two kinds of static data at startup, both as JSON in
`%APPDATA%\simlinkup-profile-editor\`:

- `instruments.json` — the gauge catalog.
- `sim-falcon4-signals.json` — Falcon BMS sim signals.

Click **Data folder** in the titlebar to open that folder in Explorer, or
click **View signals** on a SimSupport card to open the JSON in your default
editor. Click **Import…** on a SimSupport card to replace its signals JSON
with one from disk (the editor validates the file shape, then prompts to
clear any existing mappings that reference signals no longer in the new
catalog).

To revert any of these files to the bundled default, delete it from
`%APPDATA%` and relaunch — the editor re-seeds it from `src/data/`.

---

## Supported instruments

37 instruments across 9 manufacturers. **32** have full calibration support
in the Calibration tab; the other 5 (Henk family) use their existing
per-device config schemas via the Hardware Config tab.

### Simtek (19 — all calibratable)

| P/N | Instrument |
|-----|------------|
| 10-0194 | Mach / airspeed indicator |
| 10-0207 | Tachometer (RPM) |
| 10-0207_110 | Tachometer (RPM) v2 |
| 10-0216 | FTIT indicator |
| 10-0285 | Altimeter |
| 10-0294 | Fuel quantity indicator |
| 10-0295 | Fuel flow indicator |
| 10-0335-01 | Standby ADI |
| 10-0581-02 | Vertical velocity indicator |
| 10-0582-01 | Angle of attack indicator |
| 10-1078 | Cabin pressure altimeter |
| 10-1079 | Standby compass |
| 10-1081 | Altimeter v2 |
| 10-1082 | Airspeed / Mach indicator |
| 10-1084 | Standby ADI v2 |
| 10-1088 | Nozzle position indicator |
| 10-1089-02 | Fuel quantity indicator v2 |
| 10-1090 | EPU fuel quantity indicator |
| 10-1091 | Engine oil pressure indicator |

### AMI (4 — all calibratable)

| P/N | Instrument |
|-----|------------|
| 90002620-01 | Cabin pressure altimeter |
| 9001580-01  | Horizontal situation indicator (HSI) |
| 9001584     | Fuel quantity indicator |
| 9002780-02  | Attitude director indicator (ADI) |

### Astronautics (1 — calibratable)

| P/N | Instrument |
|-----|------------|
| 12871 | Attitude director indicator (ADI) |

### Gould (1 — calibratable)

| P/N | Instrument |
|-----|------------|
| HS070D5134-1 | Standby compass |

### Lilbern (2 — all calibratable)

| P/N | Instrument |
|-----|------------|
| 3239 | F-16A fuel flow indicator |
| 3321 | Tachometer (RPM) |

### Malwin (4 — all calibratable)

| P/N | Instrument |
|-----|------------|
| 1956-2 | FTIT indicator |
| 1956-3 | Liquid oxygen quantity indicator |
| 19581  | Hydraulic pressure indicator |
| 246102 | Cabin pressure altimeter |

### Westin (1 — calibratable)

| P/N | Instrument |
|-----|------------|
| 521993 | EPU fuel quantity indicator |

### Henk family (5 — Hardware Config tab only)

These use their own deeply-structured device configs (stator base angles,
output channel modes, baro fields, calibration tables) edited via the
Hardware Config tab, not the unified Calibration tab.

| P/N | Instrument |
|-----|------------|
| HenkF16ADISupportBoard | F-16 ADI support board |
| HenkieF16Altimeter     | F-16 altimeter |
| HenkieF16FuelFlow      | F-16 fuel flow indicator |
| Henk_F16_HSI_Board1    | F-16 HSI board 1 |
| Henk_F16_HSI_Board2    | F-16 HSI board 2 |

---

## Disclaimer

> **Important — please read.**
>
> SimLinkup Profile Editor lets you edit calibration data and signal
> wiring for a wide range of cockpit instruments. Some of those instruments
> are decades old and the project does not own a sample of every gauge, so
> behavior on hardware we have not personally tested cannot be guaranteed.
>
> Editing calibration values incorrectly — including breakpoint voltages,
> trim values, output ranges, or wiring — can damage your instruments.
> Voltages outside a gauge's design envelope can burn out coils, drive
> needles past mechanical stops, or stress electronic components in ways
> that are not always visible immediately.
>
> **By using this software you acknowledge:**
>
> - You are using this tool **at your own risk**.
> - The authors and contributors are **not liable** for any damage to your
>   instruments, hardware, or aircraft components, whether partial or
>   complete, recoverable or permanent.
> - You are responsible for verifying calibration values against your
>   specific gauge's documentation before applying them.
> - You should test new calibration settings at low signal levels first
>   whenever practical.
>
> The application displays this disclaimer on first launch and requires
> explicit acceptance before it can be used. Acceptance is recorded in
> `%APPDATA%\simlinkup-profile-editor\settings.json` so the prompt only
> appears once per machine.
