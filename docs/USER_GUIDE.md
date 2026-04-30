# SimLinkup Profile Editor — User Guide

This guide walks you through using the editor end-to-end: from a fresh
install to a fully calibrated gauge driven by the live shared-memory
bridge. It assumes you've built a sim pit before — you know what a gauge
is, you've wired up a DAC channel — but you've never opened a SimLinkup
`.config` file in a text editor and you don't want to start now.

If you're an experienced SimLinkup user looking for "what files does this
write," skip to [Appendix A: What gets written to disk](#appendix-a--what-gets-written-to-disk).

---

## Table of contents

1. [Before you start](#1--before-you-start)
2. [Install and first launch](#2--install-and-first-launch)
3. [Concepts in 90 seconds](#3--concepts-in-90-seconds)
4. [Building your first profile](#4--building-your-first-profile)
   - 4.1 [Pick your `Content\Mapping` folder](#41--pick-your-contentmapping-folder)
   - 4.2 [Create the profile](#42--create-the-profile)
   - 4.3 [Hardware tab — declare your output drivers](#43--hardware-tab--declare-your-output-drivers)
   - 4.4 [Hardware Config tab — fill in driver details](#44--hardware-config-tab--fill-in-driver-details)
   - 4.5 [SimSupport tab — pick your sim](#45--simsupport-tab--pick-your-sim)
   - 4.6 [Instruments tab — pick your gauges](#46--instruments-tab--pick-your-gauges)
   - 4.7 [Signal Mappings tab — wire it up](#47--signal-mappings-tab--wire-it-up)
   - 4.8 [Save and set as default](#48--save-and-set-as-default)
5. [The Calibration tab](#5--the-calibration-tab)
6. [Live calibration walkthrough](#6--live-calibration-walkthrough)
7. [Troubleshooting](#7--troubleshooting)
8. [Appendix A: What gets written to disk](#appendix-a--what-gets-written-to-disk)
9. [Appendix B: Glossary](#appendix-b--glossary)

---

## 1 — Before you start

You'll need:

- **A working SimLinkup install — the patched build.** This editor
  authors per-gauge calibration files using a schema the upstream
  `lightningstools` SimLinkup build doesn't yet read. Until those
  patches land upstream, install the patched build from
  [github.com/johndcollins/lightningstools/releases](https://github.com/johndcollins/lightningstools/releases)
  (`SimLinkupSetup.msi`). See the **Compatibility** section in the
  [README](../README.md) for what's different and why.
- **SimLinkup installed somewhere unprotected** — `C:\SimLinkup\` or
  `C:\Tools\SimLinkup\`, not under `C:\Program Files\`. Windows blocks
  writes to Program Files unless an app is running as administrator,
  and you don't want to launch the editor as admin every time you save.
  If you've already installed it under Program Files, the simplest fix
  is to uninstall and reinstall to a non-protected folder.
- **Your hardware wired up the way you intend to use it at flight time.**
  Live calibration drives your real DAC channels through your real gauges
  through SimLinkup — same code path as production. If your wiring is
  wrong, the editor will show you wrong values; it won't make a
  miswired board work.
- **Falcon BMS installed** if you want to use live calibration. The
  bridge synthesises BMS shared-memory state, so BMS doesn't need to be
  *running* — but the BMS install registers the shared-memory format
  the bridge writes into.

### Important safety note

Calibration values control the voltages your editor sends to your
gauges. Wrong values can drive needles past mechanical stops, exceed a
gauge's voltage envelope, or burn out coils in ways that aren't always
immediately visible. The first-launch disclaimer in the editor is not
boilerplate — read it. Test new calibration settings at low input
levels first whenever you can.

---

## 2 — Install and first launch

The simplest path:

1. Download **SimLinkup Profile Editor Setup X.Y.Z.exe** from the
   [GitHub releases page](https://github.com/johndcollins/SimlinkupEditor/releases).
2. Run it. It installs into Program Files (the editor itself doesn't
   need to write there — only your *SimLinkup* install needs to be
   in an unprotected folder, see above).
3. Launch from the Start Menu.

On first launch you'll see a **safety disclaimer modal**. Read it,
tick the acknowledgment box, and click **I understand and accept**.
Your acceptance is saved in `%APPDATA%\simlinkup-profile-editor\settings.json`,
so the prompt only appears once per machine.

If you see a Windows SmartScreen warning ("Windows protected your PC"),
that's normal for unsigned open-source apps. Click **More info** then
**Run anyway**.

---

## 3 — Concepts in 90 seconds

Just enough vocabulary to make the rest of the guide make sense:

- **Profile** — one folder under SimLinkup's `Content\Mapping\`
  directory. A profile is a complete description of one cockpit
  configuration: which gauges you have, what hardware drives them, and
  which sim signals feed each one. You can have many profiles (e.g. one
  for testing, one for flying) and switch between them by selecting
  one as the default.
- **Gauge / instrument** — a physical instrument in your pit (RPM
  tachometer, altimeter, fuel quantity, etc.). Each gauge type has a
  matching **HSM** (Hardware Support Module) inside SimLinkup that knows
  how to drive it.
- **Driver / output driver** — the electronics board that physically
  drives the gauge. AnalogDevices DAC boards, Henk SDI cards, Teensy
  microcontrollers, ArduinoSeat, etc. Each driver has its own `.config`
  file describing per-board settings (DAC precision, COM ports,
  calibration tables for the board itself).
- **Signal mapping** — one wire in the chain. Two stages:
  1. *Sim source* (e.g. `F4_RPM`) → *gauge HSM input port* (e.g.
     `100207_RPM_From_Sim`)
  2. *Gauge HSM output port* (e.g. `100207_RPM_To_Instrument`) →
     *driver channel* (e.g. `AnalogDevices DAC board 0, channel 11`)
  The editor builds both stages for you.
- **Calibration** — the per-gauge transform that turns "sim says RPM is
  at 75%" into "DAC channel 11 outputs +2.188 volts." Each gauge ships
  with a default transform extracted from the SimLinkup C# source code;
  you tune the breakpoint voltages so the needle reads correctly on
  *your* physical gauge.

That's it. Everything else in the editor is one of these four things.

---

## 4 — Building your first profile

A worked example: F-16 RPM tachometer (Simtek 10-0207) driven by an
AnalogDevices DAC board, fed from Falcon BMS.

### 4.1 — Pick your `Content\Mapping` folder

Top of the editor, click **Auto-detect**. The editor scans the registry
and Program Files for an installed SimLinkup and finds your
`Content\Mapping` folder automatically. If it can't (you installed
somewhere unusual), click **Change directory** and point at it
manually.

If the folder turns out to be read-only — for instance, you installed
SimLinkup under Program Files after all — you'll see a red banner
saying so. Move SimLinkup to a non-protected folder before continuing;
the editor cannot save there.

Existing profiles in subfolders show up automatically in the left
sidebar.

### 4.2 — Create the profile

In the sidebar, type a name (e.g. `MyPit`) and click **+ Create
profile**. An empty profile appears in the editor. **Don't save yet** —
you'd just be writing an empty profile. We'll fill it in across the
next several tabs.

### 4.3 — Hardware tab — declare your output drivers

Go to the **Hardware** tab. You'll see a catalog of every output driver
the editor knows about. For each driver you have physically installed,
click **+ Add**. For our example: click **+ Add** next to
**AnalogDevices DAC**.

For drivers with multiple devices on the same board family:

- **AnalogDevices DAC** — set the count of DAC boards (`+`/`−` buttons).
  Most pit builders have one or two.
- **HenkSDI / HenkQuadSinCos / Niclas Morin DTS** — set the **address**
  of each device (these are addressed devices on a serial bus).

Other drivers (PHCC, ArduinoSeat, Teensy variants) are single-instance —
you either declare them or you don't.

### 4.4 — Hardware Config tab — fill in driver details

Switch to the **Hardware Config** tab. One collapsible card per driver
you declared. Open the AnalogDevices card.

For our example, the defaults are usually fine — leave them alone unless
you have a specific reason to change. The fields are:

- **DACPrecision** — `SixteenBit` for the modern AD536x boards, `FourteenBit`
  for older AD537x. Match this to your physical hardware.
- **OffsetDAC0/1/2** — board-level voltage trim. `0x2000` is the centre
  default; only change if you've measured a board offset you need to
  cancel.
- **40-channel calibration table** — per-channel offset, gain, and the
  two `DataValueA`/`DataValueB` slots used by the AD537x's two-stage
  attenuator. `0x8000` (centre) for offset and DataValueA/B, `0xFFFF`
  for gain are the lossless defaults.

Other drivers' Hardware Config cards have similarly dense field sets;
the **Reset to defaults** button on each card pulls the C# class's
internal fallbacks if you get lost.

> **Per-channel calibration here vs. in the Calibration tab.** The
> calibration table on the AnalogDevices card is *board-level* —
> per-DAC-channel offset/gain that applies to whatever signal happens
> to be on that channel. The **Calibration tab** holds *gauge-level*
> calibration — per-gauge transforms that convert sim values to
> voltages. Both layers are real and both matter; the gauge-level
> transform is what you'll spend most of your time tuning.

### 4.5 — SimSupport tab — pick your sim

**SimSupport** tab. Click **+ Add** next to **Falcon BMS** (today the
only supported sim source).

You can also click **View signals** to inspect the catalog of BMS
signals available for mapping (`F4_RPM`, `F4_AIRSPEED__INDICATED`, etc.),
or **Import…** to replace the catalog with a custom one.

### 4.6 — Instruments tab — pick your gauges

**Instruments** tab. Filter by manufacturer or category if you like.
Find **Simtek 10-0207 (Tachometer RPM)** and click **+ Add**.

Repeat for every gauge in your physical pit. Don't worry about ordering
or categorisation — the editor groups by manufacturer automatically
elsewhere.

The **Active** tab is a read-only summary of what you've declared.
Useful for confirming the list at a glance.

### 4.7 — Signal Mappings tab — wire it up

This is where the profile actually becomes a profile. Switch to the
**Signal Mappings** tab. One collapsible card per declared instrument.
Click the **Simtek 10-0207** card to expand it.

For each gauge you'll see two sections:

- **Inputs** — pick the BMS signal that drives each gauge input. For
  10-0207's `100207_RPM_From_Sim` input, pick `F4_RPM` from the
  dropdown.
- **Outputs** — pick which driver channel each gauge output connects
  to. For `100207_RPM_To_Instrument`, pick **AnalogDevices DAC, board
  0, channel 11** (or whichever channel you've physically wired the
  gauge to).

Resolver pairs (sin/cos for synchro-driven dials) appear as a single
selector: you pick one **(board, channel pair)** and the editor wires
both windings.

Watch for the **issue badges** in the tab title:

- `⚠ N broken` — N mappings reference signals that aren't in your
  current sim catalog (probably from an imported catalog that lost a
  signal).
- `✗ N` — N DAC channel conflicts (two gauges trying to drive the same
  output).
- `! N incomplete` — N gauges that have inputs or outputs not yet
  wired.

You want all three at zero before saving for production, but during
authoring it's fine to have some incomplete and come back to them.

### 4.8 — Save and set as default

Click **Save** in the top right. The editor writes the full set of
files into `Content\Mapping\MyPit\`. See
[Appendix A](#appendix-a--what-gets-written-to-disk) for the
complete list.

Click **Set as default** to write `default.profile`, telling SimLinkup
to load `MyPit` when it next starts.

You now have a working profile. The next two sections cover tuning the
calibration so the gauge actually reads correctly.

---

## 5 — The Calibration tab

The Calibration tab is the editor's authoring surface for the
**per-gauge transform** — the function that turns "sim value at X" into
"DAC voltage at Y." Each gauge ships with default breakpoints
extracted directly from the SimLinkup C# source, so out-of-the-box
your gauges should be roughly in the right range. Tuning is for
correcting the per-gauge variation that calibration is supposed to
absorb.

### Pattern types

Different gauges use different transform shapes:

- **Piecewise** (the most common) — a list of (input, volts)
  breakpoints. The transform interpolates linearly between adjacent
  rows. Suitable for any analog gauge with a non-linear scale (RPM,
  airspeed, altitude, fuel quantity). Editable inline as a table; SVG
  preview shows the curve.
- **Linear** — single input range and output voltage range. Used for
  gauges with linear scales. Simple two-point editor.
- **Resolver** — for synchro/resolver-driven dials (HSI compass card,
  ADI ball axes). Maps a sim angle to sin/cos voltage pair on a
  resolver pair output. Includes a dial preview and a scrub slider so
  you can sweep the curve and watch the dial move.
- **Multi-turn resolver** — for gauges where the dial revolves more
  than once across the input range (e.g. altimeters, where 0–50,000 ft
  takes ~50 revolutions). Editor exposes units-per-revolution and peak
  voltage; preview shows revolution count.
- **Digital invert** — single boolean for OFF flag inputs (e.g.
  "needle parked when DC bus is down"). Just a polarity switch.
- **Cross-coupled** — for two-pointer gauges where one needle's
  position depends on the other (e.g. altimeter with both ten-thousands
  and units pointers driven from the same sim input). Stub editor for
  now; the underlying transform is fully wired but the UI is
  pattern-specific work in progress.

The editor shows the appropriate editor type per channel automatically
based on the gauge's HSM source.

### Breakpoint editor (piecewise)

Most gauges. Each row is one (input, volts) pair. Editing rules:

- **Inputs strictly ascending.** The editor flags a non-monotonic table
  in amber but still saves; SimLinkup's runtime will pick the first
  matching segment in source order.
- **Volts within ±10V.** The DAC clamps anyway, but the editor warns
  if you go outside.
- **Add row** inserts after the selected row; **Remove row** deletes.
- **Reset to defaults** wipes any edits and reloads the C# source's
  breakpoints. (This destroys your tuning — confirm twice before using
  it.)

The card header is colour-coded:

- **Neutral grey** — defaults, no user edits yet.
- **Blue** — user has edited values.
- **Amber** — there's a validation warning (non-monotonic, out-of-range,
  etc.).

### When does a calibration file get written?

The editor's save logic for per-gauge calibration files is conservative:

- Until you've **opened a gauge's Calibration card** in the editor, the
  file is written `createOnly:true` — the editor only writes it if it
  doesn't already exist on disk. This protects any hand-edits you may
  have made before the editor knew about that gauge.
- Once you've **touched the card** (changed any field), the editor
  becomes the canonical authoring surface and subsequent saves
  overwrite the file from in-memory state.
- **Reset to defaults** sets a one-time "force overwrite" flag that
  rewrites the file with the default breakpoints on the next save.

If you want to confirm a file got written, check
`Content\Mapping\<ProfileName>\Simtek<digits>HardwareSupportModule.config`
after saving.

---

## 6 — Live calibration walkthrough

This is the feature that makes calibration a hands-on hardware
process instead of a guess-and-flight cycle. The editor synthesises
Falcon BMS shared-memory state, SimLinkup picks it up exactly the way
it would in flight, and your real gauges respond. You scrub a slider
and watch the needle.

### Setup checklist

- **SimLinkup must be running.** The editor doesn't drive your gauges
  directly — SimLinkup does. Live calibration just feeds SimLinkup the
  sim values it'd normally get from BMS.
- **Falcon BMS must NOT be running.** The bridge will refuse to start
  if BMS is alive, because both writing to the same shared memory at
  once would fight each other. Close BMS first.
- **The gauge must be fully wired on the Signal Mappings tab.** Live
  calibration needs the full chain end-to-end:
  - Each gauge **input** wired to a sim source (e.g. an `F4_*` signal).
    This is what the bridge writes to shared memory.
  - Each gauge **output** wired to a driver channel (DAC, SDI, Teensy,
    etc.). This is what physically drives the needle.

  If either end is missing, the gauge's calibration card shows
  *"Live calibration unavailable"* with a hint about what's missing —
  the **Start live calibration** button only appears when both ends
  are wired.
- **The profile you're calibrating must be the active SimLinkup
  profile** — i.e. the one set as default, or the one you've manually
  loaded into SimLinkup. Otherwise the DAC channel for the gauge under
  calibration won't be wired and the needle won't move.
- **Save your profile in the editor first.** SimLinkup reads from
  disk; if you haven't saved, your wiring isn't in place.

### The walkthrough

We'll calibrate the RPM tachometer (Simtek 10-0207).

1. **Save the profile** (top-right Save button) so SimLinkup has the
   current wiring on disk.
2. **Start SimLinkup.** Confirm in SimLinkup's UI that it's loaded
   your profile.
3. In the editor, switch to the **Calibration** tab and click the
   **Simtek 10-0207** card to expand it.
4. Click **Start live calibration** at the bottom of the card.

   The editor spawns the calibration bridge process. You'll see a
   pulsing badge appear next to the gauge name confirming the bridge
   is alive. If Falcon BMS is running, you'll get an error message
   here instead — close BMS and try again.
5. **Slider initial values come from real shared memory.** The bridge
   reads the existing shared-memory state on session open, so each
   slider starts at whatever value SimLinkup is currently driving the
   gauge from. (For RPM that's typically 0 with no aircraft loaded.)
6. **Drag the RPM slider.** The gauge needle should sweep through its
   range in real time. Range comes from the gauge's own breakpoint
   table — for 10-0207, 0–110%.
7. **Note where the needle reads wrong.** Common issues: needle reads
   high or low at a specific RPM, doesn't reach 100, doesn't sit at 0
   when input is 0.
8. **Tune the breakpoint table** in the same card. For example: if the
   needle reads "85" when the slider is at 80, increase the
   breakpoint volts at input=80 slightly (e.g. 3.750 → 3.500). The
   gauge responds within milliseconds — SimLinkup hot-reloads the
   per-gauge config file via FileSystemWatcher when the editor saves.

   > **Tip.** Click **Save** between breakpoint edits. SimLinkup
   > picks up changes when the file changes, not when memory changes
   > in the editor.
9. **Iterate.** Sweep the slider through several values, find the
   worst offender, edit one breakpoint, save, sweep again. After 5–10
   minutes you should have the gauge tracking accurately across its
   full range.
10. When you're happy, **Stop live calibration**. The bridge shuts down
    cleanly. Falcon BMS can now be started normally — your tuned
    breakpoints are already saved.

### What's "honest" about this calibration

The bridge writes into the same `FalconSharedMemoryArea` /
`FalconSharedMemoryArea2` regions that BMS writes during a flight.
SimLinkup's read path is identical in calibration and flight modes —
there's no "calibration mode" code in SimLinkup that diverges from
production. So if your gauge tracks accurately at calibration time,
it'll track accurately at flight time. Same data, same code, same
output.

The bridge implements 48 of the most common F4 signals (RPM, airspeed,
altitude, fuel quantities, pitch/roll, etc.). If your gauge's input
signal isn't supported by the bridge yet, the slider won't appear in
the live calibration section — see
[bridge/SimLinkupCalibrationBridge/Sims/Falcon/FalconBridge.cs](../bridge/SimLinkupCalibrationBridge/Sims/Falcon/FalconBridge.cs)
for the full list. Adding a signal is a small C# patch.

---

## 7 — Troubleshooting

### "This folder is read-only" banner after picking the directory

Your SimLinkup install is under Program Files (or another UAC-protected
location). The editor cannot save there without admin rights. Best
fix: uninstall SimLinkup and reinstall to `C:\SimLinkup\` or another
non-protected folder.

### Saved a profile but SimLinkup isn't picking it up

Three things to check:

1. Does `Content\Mapping\<ProfileName>\` actually contain files? If
   not, the editor save failed silently — check the editor toast
   notifications.
2. Is `<ProfileName>` set as the default? Use **Set as default** in
   the editor sidebar, or pick the profile manually inside SimLinkup.
3. Restart SimLinkup. Profile changes are picked up on SimLinkup
   start — gauge calibration files hot-reload, but the profile
   itself doesn't.

### "Live calibration unavailable" on a gauge card

The card needs **both ends of the chain wired** on the Signal Mappings
tab before live calibration can start:

- **Inputs** — every gauge input must be wired to a sim source (e.g.
  an `F4_*` Falcon BMS signal). The bridge writes these into shared
  memory.
- **Outputs** — every gauge output (or at least one) must be wired to
  a driver channel (DAC, SDI, Teensy, etc.). This is what physically
  drives the needle.

The card's hint text tells you which side is missing. After fixing the
wiring on the Signal Mappings tab, the card refreshes immediately —
you don't need to switch tabs or reopen the editor.

### "Live calibration cannot start: Falcon BMS is running"

The bridge refused because BMS is alive. Close Falcon BMS (and
anything else writing to `FalconSharedMemoryArea*`) and click **Start
live calibration** again.

### Slider moves but the gauge doesn't

- **Did you save the profile after adding the gauge?** SimLinkup
  reads wiring from disk, not from the editor.
- **Is the gauge's mapping wired to a DAC channel?** Open the Signal
  Mappings tab, expand the gauge card, and check the output channel
  is set to a real driver/board/channel.
- **Is SimLinkup actually running and showing the profile loaded?**
  The bridge writes to shared memory, but SimLinkup is what reads it
  and drives your DAC.
- **Is the input signal supported by the bridge?** If the slider
  appears in the editor but doesn't move the gauge, SimLinkup *is*
  receiving the signal — the wiring is wrong somewhere downstream.
  If the slider doesn't appear at all, the bridge doesn't know that
  signal yet.

### A breakpoint edit didn't take effect

Saved? The on-disk file is what SimLinkup reads. Editor in-memory
state alone doesn't drive the gauge.

### "Validation: non-monotonic breakpoints" warning

Your input column has a row where the input value is ≤ the row above.
The editor still saves the file, but SimLinkup's runtime will pick the
first matching segment in source order, which is probably not what you
want. Fix the rows so input is strictly ascending.

### Reset to defaults wiped my tuning

That's what it does, by design. There's no undo for a reset. The
button has a confirmation prompt; if you're cautious, save a backup
copy of the gauge's `.config` file before resetting.

---

## Appendix A — What gets written to disk

For a profile named `MyPit` with N gauges and one or more declared
drivers, **Save** writes:

```
<MappingDir>/MyPit/
  Simtek<digits><name>.mapping              ← one per Simtek gauge
  AMI<digits><name>.mapping                 ← one per AMI gauge
  ... (one per declared gauge, per manufacturer)
  HardwareSupportModule.registry            ← lists declared gauge + driver HSMs
  SimSupportModule.registry                 ← lists declared sim sources
  AnalogDevicesHardwareSupportModule.config ← if AnalogDevices declared
  henksdi.config                            ← if HenkSDI declared
  HenkieQuadSinCosHardwareSupportModule.config       ← if declared
  PhccHardwareSupportModule.config                   ← if declared
  ArduinoSeatHardwareSupportModule.config            ← if declared
  TeensyEWMUHardwareSupportModule.config             ← if declared
  TeensyRWRHardwareSupportModule.config              ← if declared
  TeensyVectorDrawingHardwareSupportModule.config    ← if declared
  DTSCardHardwareSupportModule.config                ← if declared
  Simtek<digits>HardwareSupportModule.config         ← per-gauge calibration
  AMI<digits>HardwareSupportModule.config            ← per-gauge calibration
  ... (one per gauge with calibration support)
```

Stale `.mapping` files (gauges removed since last save) are swept
before writing. You'll never end up with orphan files for gauges that
are no longer in the profile.

`Set as default` writes `<MappingDir>/default.profile` (a tiny pointer
file SimLinkup reads at startup).

---

## Appendix B — Glossary

- **HSM** — Hardware Support Module. The C# class inside SimLinkup
  that knows how to talk to one specific gauge type or output board.
- **Driver / output driver** — the electronics board (DAC, SDI, Teensy,
  etc.) that physically drives one or more gauges. Each driver has its
  own HSM.
- **Mapping** — one signal-to-port wire. The `.mapping` files contain
  one or more per gauge.
- **Profile** — a complete cockpit configuration: gauges + drivers +
  sim sources + all wiring + per-gauge calibration. One folder under
  `Content\Mapping\`.
- **Channel** — one output line on a driver. Identified by `(driver,
  board index, channel number)`. Two gauges can't share a channel.
- **Resolver pair** — sin/cos channel pair driving one synchro winding.
  Routed as a unit in the Signal Mappings tab.
- **Breakpoint** — one (input, volts) row in a piecewise transform.
  The editor interpolates linearly between adjacent breakpoints.
- **Stage 1 / Stage 2** — the two halves of a signal mapping. Stage 1
  is sim → gauge HSM input; Stage 2 is gauge HSM output → driver
  channel.
- **Bridge** — the small C# helper process the editor spawns for live
  calibration. Synthesises Falcon BMS shared memory state from editor
  slider values.
- **`createOnly`** — file-write semantics: write only if the file
  doesn't already exist. Used for per-gauge calibration files until
  the user has touched the editor for that gauge.
