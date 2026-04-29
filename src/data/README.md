# Static data files

The editor loads several static data files at startup:
- `instruments.json` — gauge catalog
- `sim-<id>-signals.json` — one per supported sim (Falcon BMS today, future
  sims like DCS will add their own files)

All ship as bundled defaults in this folder. All can be overridden by the user
without recompiling the app.

## Override mechanism

On first launch, the editor copies every bundled JSON file from this folder
into the user's app-data folder:

```
%APPDATA%\simlinkup-profile-editor\
  instruments.json
  sim-falcon4-signals.json
```

These are the files the user actually edits. The seed copy is idempotent — once
a file exists in `%APPDATA%`, it is never overwritten by subsequent launches,
so user edits persist across app restarts and across upgrades. New sim files
shipped in a future build are seeded the first time the user launches that
build (existing files unchanged).

A one-time migration moves `f4-signals.json` (the legacy filename used in
earlier editor versions) to `sim-falcon4-signals.json` if the new file isn't
already present, so user edits to the old filename aren't lost.

At startup the editor reads from `%APPDATA%` first; only if a file is missing
or fails to parse does it fall back to the bundled default in this folder. A
parse failure also surfaces a toast warning.

The "Data folder" button in the titlebar opens `%APPDATA%\SimLinkup Profile
Editor\` in Windows Explorer.

**To revert to the bundled default**, delete the file from `%APPDATA%`. The
editor will re-seed it from the bundled copy on next launch.

**Editor upgrades and the seed file**: because the seed never overwrites an
existing user file, an upgraded editor that ships a new bundled default will
not be reflected in the user's `%APPDATA%` copy. Users who want the new
defaults must delete their `%APPDATA%` copy and re-launch (or merge by hand).

## `instruments.json`

Array of gauge HSMs the editor knows how to author profiles for. The catalog
covers Simtek and the other manufacturers represented in lightningstools'
`HardwareSupport/` tree (AMI, Astronautics, Gould, Henk, Henkie, Lilbern,
Malwin, Westin). Each entry:

```json
{
  "pn": "10-0207",
  "name": "Tachometer (RPM)",
  "cls": "SimLinkup.HardwareSupport.Simtek.Simtek100207HardwareSupportModule",
  "manufacturer": "Simtek",
  "cat": "engine",
  "analog_in":  ["RPM %"],            // free-text labels (legacy, catalog tab only)
  "analog_out": ["RPM output"],
  "digital_in":  [],
  "digital_out": [],
  "inputPorts": [
    { "port": "RPM_From_Sim", "label": "RPM (%)", "kind": "analog" }
  ],
  "outputGroups": [
    {
      "kind": "analog_single",
      "label": "RPM needle",
      "ports": [{ "role": "value", "port": "RPM_To_Instrument", "kind": "analog" }]
    }
  ],
  "digitPrefix": "100207"
}
```

Field meanings:

- `pn` — gauge part number. For numeric-prefix gauges (Simtek, AMI,
  Astronautics, Lilbern, Malwin, Westin) this is the user-visible PN, often
  with dashes (e.g. `10-0207`, `9001580-01`). For named-prefix gauges (Gould
  HS070D5134-1, the Henk/Henkie boards) this is the **raw named prefix**
  (`HS070D51341`, `HenkF16ADISupportBoard`, etc.) — *not* a friendlier dashed
  form — because the chain-model parser returns the prefix verbatim and looks
  it up against `INSTRUMENTS[i].pn`. The user-facing form lives in `name`.
- `cls` — full .NET class name. Written verbatim into
  `HardwareSupportModule.registry`.
- `manufacturer` — namespace segment from `cls`, used by the Instruments tab
  to group cards and to populate the manufacturer filter dropdown. The runtime
  in `src/index.html` derives this from `cls`'s namespace if missing
  (backfill), so older user copies of `instruments.json` without the field
  still get a usable group label.
- `cat` — category for the catalog tab filter: `flight`, `engine`, `fuel`,
  `attitude`.
- `analog_in` / `analog_out` / `digital_in` / `digital_out` — legacy free-text
  labels driving the catalog cards. Kept for that one UI; the structured fields
  below are the source of truth for everything else.
- `inputPorts` — every input port the gauge HSM exposes. `port` is the suffix
  after the digit prefix (matches the C# `Id = "100207_<suffix>"` literal
  exactly, or `Id = "HenkF16ADISupportBoard_<suffix>"` for named-prefix
  gauges). `kind` is `"analog"` or `"digital"`.
- `outputGroups` — output ports grouped by what they logically drive:
  - `analog_single` — one DAC channel drives one needle/scale.
  - `digital_single` — one boolean line drives one flag.
  - `resolver_pair` — sin and cos drive one dial together; routed independently
    but selected as a pair in the UI.
- `digitPrefix` — the prefix the gauge HSM uses in port IDs. For most numeric
  gauges this equals dashes-stripped `pn`. Two exceptions: Simtek 10-0207_110
  emits IDs prefixed `100207` (the `_110` suffix is in the class name and PN
  but not the IDs), and named-prefix gauges store the named prefix here for
  uniformity (e.g. `digitPrefix: "HenkieF16Altimeter"`).

### Hybrid Henk/Henkie boards

The `HenkieF16Altimeter`, `HenkieF16FuelFlow`, `Henk_F16_HSI_Board1`, and
`Henk_F16_HSI_Board2` modules expose two distinct ID shapes in their C#
source: non-addressed input ports (`HenkieF16Altimeter_Altitude_From_Sim`)
and addressed output ports (`HenkieF16Altimeter[0x32]__Indicator_Position`).
The catalog models the input side only — the addressed outputs are real
signals but the modules self-drive them over USB inside their own
`SignalChanged` handlers, and no shipping profile in lightningstools wires
them externally. The `HenkF16ADISupportBoard` is different: its outputs
target the HenkSDI driver via non-addressed `_To_SDI` ports, and those ARE
modeled in `outputGroups` because they're commonly wired in profiles like
Nigel.

## `sim-<id>-signals.json`

Source signals published by a sim's `SimSupportModule`. One file per declared
sim — `sim-falcon4-signals.json` for Falcon BMS, `sim-dcs-signals.json` for
DCS (when added), etc. The `<id>` matches the `id` field in the renderer's
`SIM_SUPPORTS` catalog. Two arrays:

```json
{
  "scalar":  [ /* one entry per published signal */ ],
  "indexed": [ /* templates — append [N] to the id */ ]
}
```

Each entry:

```json
{
  "id": "F4_ALTIMETER__INDICATED_ALTITUDE__MSL",
  "kind": "analog",
  "coll": "Instruments, Displays and Gauges",
  "sub": "Altimeter",
  "label": "Instruments, Displays and Gauges → Altimeter → Indicated Altitude (feet MSL)"
}
```

- `id` — used verbatim as the `<Source><Id>` value in generated mapping XML.
- `kind` — `"analog"`, `"digital"`, or `"text"` (matches the C# `typeof(...)`).
  Most gauges consume analog or digital signals; text is for displays driven by
  PHCC / Teensy boards that render strings (DED, MFD button labels).
- `coll` / `sub` — top-level and second-level grouping. The dropdown UI uses
  `coll` to drive `<optgroup>` headings, so the file is sorted by `(coll, sub)`
  to keep groups contiguous. Override files don't need to maintain that order
  — the runtime groups by `coll` regardless of file order — but it's friendlier
  to read if you keep similar entries together.
- `label` — pre-built display string. If you regenerate the file via the
  extractor (see below), this field is rebuilt as `"<coll> → <sub> → <friendly>"`
  from the C# `friendlyName` argument. If you hand-edit, set whatever string
  you want shown in the dropdown.

`indexed` entries are templates for signals whose C# registration loops over an
index variable `i` (DED lines, MFD OSB labels, RWR threats). The `id` and
`label` contain `[N]` placeholders; users address a specific element by
appending the bracketed index in the mapping file (e.g.
`F4_DED__LINES[3]` for the 4th DED line).

## Regenerating from upstream

`sim-falcon4-signals.json` is auto-generated from
`F4SimSupportModule.cs:CreateSimOutputsList()` in the lightningstools repo. To
regenerate after BMS adds or renames signals upstream:

```bash
node scripts/extract-f4-signals.mjs
```

The script defaults to `../lightningstools/src/F4Utils/SimSupport/F4SimSupportModule.cs`.
Pass an explicit path if it lives elsewhere.

Other sims' signal files are hand-authored or extracted via their own scripts;
the directory convention is `sim-<id>-signals.json` keyed to the matching
`SIM_SUPPORTS` entry in `src/index.html`.

`instruments.json` is maintained by hand against the per-manufacturer
sources under `lightningstools/src/SimLinkup/HardwareSupport/<Manufacturer>/`.
There is no extractor — the C# port shape varies too much across modules to
scrape reliably (some modules use string interpolation for IDs, some declare
ports in property bodies, some build them from enum loops). When adding or
renaming an entry, take the `Id = "..."` literals straight from the C#
source and verify the digit prefix matches what the runtime actually emits
(usually equals dashes-stripped `pn` but watch for special cases like
Simtek 10-0207_110).
