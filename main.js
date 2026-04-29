const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'SimLinkup Profile Editor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Copy the bundled static data files into the user's app-data folder if they
// aren't already there. Runs once at startup. Idempotent — never overwrites an
// existing file, so user edits are preserved across launches.
//
// Seeded files: instruments.json, plus every sim-*.json file present in the
// bundled src/data/ folder. New sims added in a future build automatically
// get seeded the first time the user launches that build.
//
// Migration: a previous editor version shipped `f4-signals.json` (no sim-
// prefix). If that legacy filename exists in userData but the new
// `sim-falcon4-signals.json` doesn't, copy the legacy file across so user
// edits to the old filename aren't lost. The legacy file is left in place;
// the editor only reads the new name.
function seedUserDataFiles() {
  const userDataDir = app.getPath('userData');
  const bundledDir = path.join(app.getAppPath(), 'src', 'data');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  // One-time migration of the legacy filename.
  const legacyF4 = path.join(userDataDir, 'f4-signals.json');
  const newF4 = path.join(userDataDir, 'sim-falcon4-signals.json');
  if (fs.existsSync(legacyF4) && !fs.existsSync(newF4)) {
    try {
      fs.copyFileSync(legacyF4, newF4);
      console.log('Migrated legacy f4-signals.json → sim-falcon4-signals.json');
    } catch (e) {
      console.warn('Could not migrate legacy f4-signals.json:', e.message);
    }
  }

  // Discover every static file we need to seed: instruments.json + every
  // sim-*.json shipped in the bundled data folder.
  const seedables = ['instruments.json'];
  try {
    for (const f of fs.readdirSync(bundledDir)) {
      if (/^sim-.*\.json$/.test(f)) seedables.push(f);
    }
  } catch (e) {
    console.warn('Could not enumerate bundled data dir:', e.message);
  }

  for (const filename of seedables) {
    const dst = path.join(userDataDir, filename);
    if (fs.existsSync(dst)) continue;
    const src = path.join(bundledDir, filename);
    try {
      fs.copyFileSync(src, dst);
    } catch (e) {
      // Non-fatal — load-static-data will fall through to the bundled copy.
      console.warn(`Could not seed ${filename}:`, e.message);
    }
  }
}

app.whenReady().then(() => {
  seedUserDataFiles();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── File I/O handlers ──────────────────────────────────────────────────────

// Pick the SimLinkup Content/Mapping directory
ipcMain.handle('pick-profile-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select SimLinkup Content/Mapping folder',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// Try to find the SimLinkup Content/Mapping folder.
//
// SimLinkup's MSI ProductCode is {CE7C181F-804E-424C-8456-DB2D6AFD0C20}, but the
// VS Setup Project leaves `InstallLocation` blank in the Uninstall registry key,
// so we can't rely on it. Strategy:
//   1. Read InstallLocation from the four Uninstall keys (works if non-empty).
//   2. Fall back to the standard install paths under Program Files / Program Files (x86).
// Returns the first candidate whose Content\Mapping subfolder actually exists, or null.
ipcMain.handle('detect-mapping-dir', async () => {
  if (process.platform !== 'win32') return null;
  const PRODUCT_CODE = '{CE7C181F-804E-424C-8456-DB2D6AFD0C20}';
  const subkeys = [
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCT_CODE}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCT_CODE}`,
    `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCT_CODE}`,
    `HKCU\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCT_CODE}`,
  ];
  const queryRegValue = (key, value) => new Promise(resolve => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      // reg.exe output: "    InstallLocation    REG_SZ    C:\\path\\to\\install\\"
      const match = stdout.match(new RegExp(`${value}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\s*$`, 'm'));
      resolve(match ? match[1].trim() : null);
    });
  });
  const candidates = [];
  for (const key of subkeys) {
    const installLocation = await queryRegValue(key, 'InstallLocation');
    if (installLocation) candidates.push(installLocation);
  }
  // Common install dirs. The VS Setup Project's MSI defaults to Program Files,
  // but users often relocate to C:\Tools to avoid UAC write blocks on Mapping/.
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf   = process.env['ProgramFiles']      || 'C:\\Program Files';
  candidates.push(
    'C:\\Tools\\SimLinkup',
    path.join(pf86, 'SimLinkup'),
    path.join(pf,   'SimLinkup'),
    path.join(pf86, 'lightning', 'SimLinkup'),
    path.join(pf,   'lightning', 'SimLinkup'),
  );
  for (const root of candidates) {
    const candidate = path.join(root, 'Content', 'Mapping');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
});

// Check whether a directory is writable by the current process.
// Used to warn the user when they pick a folder under Program Files that
// requires elevation. Returns { writable: boolean, error?: string }.
ipcMain.handle('check-writable', async (_, dir) => {
  if (!dir) return { writable: false, error: 'No directory' };
  try {
    const probe = path.join(dir, `.simlinkup-editor-write-test-${process.pid}`);
    fs.writeFileSync(probe, '', 'utf8');
    fs.unlinkSync(probe);
    return { writable: true };
  } catch (e) {
    return { writable: false, error: e.message };
  }
});

// List profile folders inside the selected mapping directory
ipcMain.handle('list-profiles', async (_, mappingDir) => {
  if (!mappingDir || !fs.existsSync(mappingDir)) return [];
  try {
    return fs.readdirSync(mappingDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
});

// Load all .mapping files from a profile directory
ipcMain.handle('load-profile', async (_, profileDir) => {
  if (!profileDir || !fs.existsSync(profileDir)) return null;
  try {
    const files = fs.readdirSync(profileDir).filter(f => f.endsWith('.mapping'));
    const mappings = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(profileDir, file), 'utf8');
      mappings.push({ file, content });
    }

    let hsmRegistry = null;
    const hsmPath = path.join(profileDir, 'HardwareSupportModule.registry');
    if (fs.existsSync(hsmPath)) {
      hsmRegistry = fs.readFileSync(hsmPath, 'utf8');
    }

    let ssmRegistry = null;
    const ssmPath = path.join(profileDir, 'SimSupportModule.registry');
    if (fs.existsSync(ssmPath)) {
      ssmRegistry = fs.readFileSync(ssmPath, 'utf8');
    }

    // Output-driver configs that the renderer needs to know about so it can
    // populate channel pickers with the user's actual board count / addresses
    // and surface the raw XML in the Hardware tab. Filenames intentionally
    // mirror the .config files SimLinkup expects each driver's HSM class to
    // produce/consume — see DRIVER_PATTERNS in src/index.html.
    const driverConfigFilenames = [
      'AnalogDevicesHardwareSupportModule.config',
      'henksdi.config',
      'ArduinoSeatHardwareSupportModule.config',
      'DTSCardHardwareSupportModule.config',          // NiclasMorin DTS
      'PhccHardwareSupportModule.config',
      'TeensyEWMUHardwareSupportModule.config',
      'TeensyRWRHardwareSupportModule.config',
      'TeensyVectorDrawingHardwareSupportModule.config',
      'HenkieQuadSinCosHardwareSupportModule.config',
    ];
    const driverConfigs = {};
    for (const cfg of driverConfigFilenames) {
      const cfgPath = path.join(profileDir, cfg);
      if (fs.existsSync(cfgPath)) {
        try { driverConfigs[cfg] = fs.readFileSync(cfgPath, 'utf8'); } catch {}
      }
    }

    // Per-gauge calibration configs (Layer 1 — gauge HSM transforms). One
    // file per gauge HSM that has a `.config` next to its `.mapping` file,
    // following the naming convention <ClassShortName>.config (e.g.
    // Simtek100207HardwareSupportModule.config). The renderer uses
    // gaugePnForConfigFilename to map each filename back to a catalog PN.
    // We pick up every file matching *HardwareSupportModule.config that we
    // haven't already pulled in via the output-driver list above.
    try {
      const allFiles = fs.readdirSync(profileDir);
      for (const f of allFiles) {
        if (driverConfigs[f]) continue;
        if (!/HardwareSupportModule\.config$/i.test(f)) continue;
        try { driverConfigs[f] = fs.readFileSync(path.join(profileDir, f), 'utf8'); } catch {}
      }
    } catch {}

    return { mappings, hsmRegistry, ssmRegistry, driverConfigs };
  } catch (e) {
    return { error: e.message };
  }
});

// Save a profile — write per-gauge .mapping files plus the two registry files
// plus any output-driver configs the editor knows how to author.
//
// `mappingFiles`       — [{ filename, content }] — one per gauge that has edges.
//                          Stale .mapping files in the dir are swept so removed
//                          gauges don't leave cruft.
// `hsmClasses`         — array of full .NET class names written into
//                          HardwareSupportModule.registry. Includes both gauge
//                          HSMs and output-driver HSMs.
// `simSupportClasses`  — array of { cls, assembly } pairs written into
//                          SimSupportModule.registry. Each carries its own
//                          assembly because SimSupport modules can come from
//                          different assemblies (Falcon4 → F4Utils.SimSupport).
//                          May be empty: profile saves with no <Module> entries
//                          in the SSM registry, which is unusual but legal.
// `driverConfigs`      — { filename: { content, createOnly } } — output-driver
//                          configs (currently only AnalogDevicesHardwareSupportModule.config).
//                          `createOnly: true` means we never overwrite an existing
//                          file, protecting user calibration trim.
ipcMain.handle('save-profile', async (_, { profileDir, profileName, mappingFiles, hsmClasses, simSupportClasses, driverConfigs }) => {
  try {
    const dir = path.join(profileDir, profileName);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Sweep stale .mapping files. Anything currently in the dir that isn't in
    // mappingFiles gets removed so we don't accumulate cruft.
    const wantedNames = new Set((mappingFiles || []).map(f => f.filename));
    for (const existing of fs.readdirSync(dir)) {
      if (existing.endsWith('.mapping') && !wantedNames.has(existing)) {
        try { fs.unlinkSync(path.join(dir, existing)); } catch {}
      }
    }

    // Write each per-gauge .mapping file.
    for (const { filename, content } of (mappingFiles || [])) {
      fs.writeFileSync(path.join(dir, filename), content, 'utf8');
    }

    // Write HardwareSupportModule.registry. The class list comes entirely from
    // the renderer — gauge HSMs plus any output-driver HSMs the profile uses.
    // Nothing is hardcoded here so Henk-only / PHCC-only / Teensy-only profiles
    // produce a clean registry without spurious AnalogDevices entries.
    const hsmModules = hsmClasses.map(cls =>
      `    <Module>${cls}, SimLinkup, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null</Module>`
    ).join('\n');
    const hsmXml = `<?xml version="1.0"?>
<HardwareSupportModuleRegistry xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <HardwareSupportModules>
${hsmModules}
  </HardwareSupportModules>
</HardwareSupportModuleRegistry>`;
    fs.writeFileSync(path.join(dir, 'HardwareSupportModule.registry'), hsmXml, 'utf8');

    // Write SimSupportModule.registry from the renderer-supplied list. Empty
    // list is legal but uncommon — most profiles have at least Falcon BMS.
    const ssmModules = (simSupportClasses || []).map(({ cls, assembly }) =>
      `    <Module>${cls}, ${assembly}</Module>`
    ).join('\n');
    const ssmXml = `<?xml version="1.0"?>
<SimSupportModuleRegistry xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <SimSupportModules>
${ssmModules}
  </SimSupportModules>
</SimSupportModuleRegistry>`;
    fs.writeFileSync(path.join(dir, 'SimSupportModule.registry'), ssmXml, 'utf8');

    // Write driver configs. createOnly means: skip if file already exists, so
    // users don't lose hand-tuned Gain/Offset trim values across saves.
    let adDeviceShortfall = null;
    for (const [filename, { content, createOnly }] of Object.entries(driverConfigs || {})) {
      const cfgPath = path.join(dir, filename);
      const exists = fs.existsSync(cfgPath);

      // Special case for AD config: detect if the existing file has fewer
      // <Device> blocks than the new content needs, and surface a warning.
      if (filename === 'AnalogDevicesHardwareSupportModule.config' && exists) {
        try {
          const existing = fs.readFileSync(cfgPath, 'utf8');
          const existingDevices = (existing.match(/<Device>/g) || []).length;
          const requiredDevices = (content.match(/<Device>/g) || []).length;
          if (existingDevices < requiredDevices) {
            adDeviceShortfall = { have: existingDevices, required: requiredDevices };
          }
        } catch {}
      }

      if (createOnly && exists) continue;
      fs.writeFileSync(cfgPath, content, 'utf8');
    }

    return { success: true, path: dir, adDeviceShortfall };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Delete a profile directory
ipcMain.handle('delete-profile', async (_, profileDir) => {
  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Open a folder in Windows Explorer
ipcMain.handle('open-folder', async (_, folderPath) => {
  shell.openPath(folderPath);
});

// Set a profile as the default (write default.profile)
ipcMain.handle('set-default-profile', async (_, { mappingDir, profileName }) => {
  try {
    fs.writeFileSync(path.join(mappingDir, 'default.profile'), profileName, 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Read the current default profile name
ipcMain.handle('get-default-profile', async (_, mappingDir) => {
  try {
    const p = path.join(mappingDir, 'default.profile');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
  } catch {
    return null;
  }
});

// Persist app settings (last used directory etc.)
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

ipcMain.handle('load-settings', async () => {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch {}
  return {};
});

// Quit the application. Invoked by the disclaimer modal's Refuse button:
// the user has to accept the safety disclaimer before they can use the
// tool, so refusal closes the window rather than leaving the app running
// in a half-disabled state.
ipcMain.handle('quit-app', async () => {
  app.quit();
});

// Merges the incoming partial settings into the existing settings.json on
// disk. Renderer callers pass only the fields they want to update (e.g.
// `{ mappingDir: '...' }` or `{ disclaimerAcceptedAt: '...' }`); we read
// the current file, layer the new fields on top, and write the result.
// Pre-merge behavior (full overwrite) was lossy whenever a caller updated
// one field — the disclaimer-acceptance flag would have been wiped on the
// next setDir save.
ipcMain.handle('save-settings', async (_, partialSettings) => {
  try {
    let existing = {};
    if (fs.existsSync(SETTINGS_PATH)) {
      try { existing = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) || {}; } catch {}
    }
    const merged = { ...existing, ...(partialSettings || {}) };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Static data (instruments + per-sim signals) ─────────────────────────────
//
// Bundled defaults ship at <appPath>/src/data/. Per-sim signal files follow
// the convention sim-<id>-signals.json (e.g. sim-falcon4-signals.json). Users
// can override any of these by dropping a copy into <userData>/<filename>.
// Returns the loaded data plus a `sources` map indicating which files
// resolved to user overrides vs the bundled defaults.
const USER_DATA_DIR = app.getPath('userData');
const BUNDLED_DATA_DIR = path.join(app.getAppPath(), 'src', 'data');

function loadJsonWithOverride(filename) {
  const userPath = path.join(USER_DATA_DIR, filename);
  if (fs.existsSync(userPath)) {
    try {
      return { data: JSON.parse(fs.readFileSync(userPath, 'utf8')), source: 'user' };
    } catch (e) {
      return { data: null, source: 'user-error', error: e.message };
    }
  }
  const bundledPath = path.join(BUNDLED_DATA_DIR, filename);
  if (!fs.existsSync(bundledPath)) {
    return { data: null, source: 'missing', error: 'file not found' };
  }
  try {
    return { data: JSON.parse(fs.readFileSync(bundledPath, 'utf8')), source: 'bundled' };
  } catch (e) {
    return { data: null, source: 'bundled-error', error: e.message };
  }
}

// Discover every sim-*-signals.json file in the bundled data dir and load
// each one (with userData override). Returns:
//   { <simId>: { scalar: [...], indexed: [...], source: 'user'|'bundled', error?, filename } }
function loadAllSimSignals() {
  const out = {};
  let bundledFiles = [];
  try { bundledFiles = fs.readdirSync(BUNDLED_DATA_DIR); } catch {}
  for (const filename of bundledFiles) {
    const m = filename.match(/^sim-(.+)-signals\.json$/);
    if (!m) continue;
    const simId = m[1];
    const loaded = loadJsonWithOverride(filename);
    out[simId] = {
      scalar: loaded.data?.scalar ?? [],
      indexed: loaded.data?.indexed ?? [],
      source: loaded.source,
      filename,
      ...(loaded.error ? { error: loaded.error } : {}),
    };
  }
  return out;
}

ipcMain.handle('load-static-data', async () => {
  const instruments = loadJsonWithOverride('instruments.json');
  const simSignals = loadAllSimSignals();
  // Aggregate sources / errors for the renderer's toast hookup.
  const sources = { instruments: instruments.source };
  const errors = {};
  if (instruments.error) errors.instruments = instruments.error;
  for (const [simId, info] of Object.entries(simSignals)) {
    sources[`sim_${simId}`] = info.source;
    if (info.error) errors[`sim_${simId}`] = info.error;
  }
  return {
    instruments: instruments.data,
    simSignals,                 // { simId: { scalar, indexed, source, filename } }
    sources,
    errors,
    userDataDir: USER_DATA_DIR,
  };
});

ipcMain.handle('open-user-data-folder', async () => {
  if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  shell.openPath(USER_DATA_DIR);
});

// Open a signals JSON file in the OS default editor (whatever's associated
// with .json on the user's machine — typically VS Code, Notepad++, or similar).
// We prefer the user's override copy in userData if it exists; otherwise we
// open the bundled copy. The user is expected to know that editing the
// bundled file inside the install dir requires admin and will be lost on
// reinstall — we still let them try, but the override copy is the right
// target for sustained edits.
ipcMain.handle('open-signals-file', async (_, filename) => {
  if (!filename || /[\\/]/.test(filename)) {
    return { success: false, error: 'Invalid filename' };
  }
  const userPath = path.join(USER_DATA_DIR, filename);
  const target = fs.existsSync(userPath) ? userPath : path.join(BUNDLED_DATA_DIR, filename);
  if (!fs.existsSync(target)) {
    return { success: false, error: `File not found: ${target}` };
  }
  try {
    const result = await shell.openPath(target);
    if (result) return { success: false, error: result };
    return { success: true, target };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Import a signals JSON file: prompt the user for a source file, validate it
// parses as { scalar: [...], indexed: [...] }, then copy it into userData
// under the requested name. Returns { success, scalarCount, indexedCount } on
// success or { cancelled: true } if the user cancelled the picker.
ipcMain.handle('import-signals-file', async (_, filename) => {
  if (!filename || /[\\/]/.test(filename)) {
    return { success: false, error: 'Invalid filename' };
  }
  // Default the picker's location to the user's data folder where the
  // existing copy of `filename` lives — that's the most likely place a user
  // is editing a signals file from. Falls back to userData root if the
  // specific file isn't there yet.
  const existing = path.join(USER_DATA_DIR, filename);
  const defaultPath = fs.existsSync(existing) ? existing : USER_DATA_DIR;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Import ${filename}`,
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
    defaultPath,
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { cancelled: true };
  }
  const srcPath = result.filePaths[0];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  } catch (e) {
    return { success: false, error: `Could not parse ${path.basename(srcPath)} as JSON: ${e.message}` };
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.scalar)) {
    return { success: false, error: `${path.basename(srcPath)} is not a valid signals file (expected { scalar: [...], indexed: [...] })` };
  }
  const dst = path.join(USER_DATA_DIR, filename);
  try {
    if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    fs.writeFileSync(dst, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  } catch (e) {
    return { success: false, error: `Could not write ${dst}: ${e.message}` };
  }
  return {
    success: true,
    scalarCount: parsed.scalar.length,
    indexedCount: Array.isArray(parsed.indexed) ? parsed.indexed.length : 0,
  };
});

// Open a driver-config file in the OS default editor. The renderer passes the
// resolved path components (profileDir + filename) so this handler stays thin
// and doesn't need to mirror DRIVER_META. If the file doesn't exist, it's
// created with the supplied `defaultContent` first (the renderer authors the
// content using the same XML helpers it uses in generateDriverConfigs, so the
// initial file is a valid skeleton — not an empty file).
ipcMain.handle('open-driver-config', async (_, { profileDir, filename, defaultContent }) => {
  if (!profileDir || !filename) return { success: false, error: 'Missing profileDir or filename' };
  if (/[\\/]/.test(filename)) return { success: false, error: 'Invalid filename' };
  try {
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
    const target = path.join(profileDir, filename);
    if (!fs.existsSync(target)) {
      const content = typeof defaultContent === 'string' && defaultContent
        ? defaultContent
        : `<?xml version="1.0"?>\n<!-- ${filename} — created by SimLinkup Profile Editor -->\n`;
      fs.writeFileSync(target, content, 'utf8');
    }
    const result = await shell.openPath(target);
    if (result) return { success: false, error: result, target };
    return { success: true, target };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Calibration bridge (Falcon BMS shared memory + future sims) ─────────────
//
// Lazily-spawned long-running C# helper at:
//   bridge/SimLinkupCalibrationBridge/bin/x86/Release/net48/SimLinkupCalibrationBridge.exe
// (in dev — the x86 segment is there because the bridge csproj sets
// <PlatformTarget>x86</PlatformTarget> to match the vendored F4SharedMem).
// When packaged, electron-builder copies it into the installer's
// resources/bridge/ folder via the `extraResources` config in package.json.
//
// Protocol: JSON-per-line over stdio. Each request gets a unique id; the
// response carries the same id. Errors come back as { ok: false, error }.
//
// IPC handlers exposed to the renderer:
//   bridge:isSimRunning  ({ sim })                   → { ok, running?, error? }
//   bridge:startSession  ({ sim })                   → { ok, error? }
//   bridge:setSignals    ({ sim, signals })          → { ok, unknown?, error? }
//   bridge:getSignals    ({ sim, ids })              → { ok, values?, unknown?, error? }
//   bridge:endSession    ({ sim })                   → { ok, error? }
//
// We hold ONE bridge process per app session. App quit kills it.

let _bridgeProc = null;
let _bridgeReadBuffer = '';
let _bridgeNextId = 0;
const _bridgePending = new Map();   // id (string) → { resolve, reject, timer }

function bridgeExePath() {
  // Two possible locations: packaged (resources/bridge/...) and dev
  // (repo-relative). Try packaged first since `app.isPackaged` is the
  // cheap check. Dev path includes the x86 segment because the bridge
  // csproj's <PlatformTarget>x86</PlatformTarget> emits to
  // bin/x86/Release/net48/ rather than the AnyCPU bin/Release/net48/.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bridge', 'SimLinkupCalibrationBridge.exe');
  }
  return path.join(__dirname, 'bridge', 'SimLinkupCalibrationBridge', 'bin', 'x86', 'Release', 'net48', 'SimLinkupCalibrationBridge.exe');
}

function ensureBridge() {
  if (_bridgeProc && !_bridgeProc.killed) return _bridgeProc;
  const exe = bridgeExePath();
  if (!fs.existsSync(exe)) {
    throw new Error(`Calibration bridge not found at ${exe}. Build the bridge solution (bridge/SimLinkupCalibrationBridge.sln) before using live calibration.`);
  }
  _bridgeProc = spawn(exe, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  _bridgeProc.stdout.setEncoding('utf8');
  _bridgeProc.stderr.setEncoding('utf8');

  _bridgeProc.stdout.on('data', (chunk) => {
    _bridgeReadBuffer += chunk;
    // Process whole lines only; partial lines wait for the next chunk.
    let nl;
    while ((nl = _bridgeReadBuffer.indexOf('\n')) >= 0) {
      const line = _bridgeReadBuffer.slice(0, nl).trim();
      _bridgeReadBuffer = _bridgeReadBuffer.slice(nl + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        const pending = _bridgePending.get(obj.id);
        if (pending) {
          clearTimeout(pending.timer);
          _bridgePending.delete(obj.id);
          pending.resolve(obj);
        }
        // Unknown id → orphan response; ignore.
      } catch {
        // Unparseable line; ignore (could be debug noise from the C# side
        // if we ever add Console.WriteLine for diagnostics).
      }
    }
  });

  _bridgeProc.stderr.on('data', (chunk) => {
    // Surface bridge stderr to the main process console for debugging.
    // Don't propagate to the renderer; bridge errors should already come
    // back as { ok:false, error } in the JSON channel.
    console.error('[bridge stderr]', chunk.toString().trim());
  });

  _bridgeProc.on('exit', (code, signal) => {
    // Reject every pending request — bridge died.
    for (const [, pending] of _bridgePending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Calibration bridge exited (code=${code} signal=${signal}).`));
    }
    _bridgePending.clear();
    _bridgeProc = null;
  });

  return _bridgeProc;
}

// Send one command, await one response. Times out after 5s — bridge work
// is sub-millisecond on Windows (memory writes, process check); a longer
// wait means the bridge is hung and we should surface that to the user.
function bridgeRequest(cmd, extras) {
  return new Promise((resolve, reject) => {
    let proc;
    try { proc = ensureBridge(); } catch (e) { return reject(e); }
    const id = String(++_bridgeNextId);
    const payload = JSON.stringify({ id, cmd, ...(extras || {}) }) + '\n';
    const timer = setTimeout(() => {
      _bridgePending.delete(id);
      reject(new Error(`Calibration bridge timed out after 5s on command '${cmd}'.`));
    }, 5000);
    _bridgePending.set(id, { resolve, reject, timer });
    try {
      proc.stdin.write(payload, 'utf8');
    } catch (e) {
      clearTimeout(timer);
      _bridgePending.delete(id);
      reject(e);
    }
  });
}

ipcMain.handle('bridge:isSimRunning', async (_, { sim }) => {
  try { return await bridgeRequest('isSimRunning', { sim }); }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('bridge:startSession', async (_, { sim }) => {
  try { return await bridgeRequest('startSession', { sim }); }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('bridge:setSignals', async (_, { sim, signals }) => {
  try { return await bridgeRequest('setSignals', { sim, signals }); }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('bridge:getSignals', async (_, { sim, ids }) => {
  try { return await bridgeRequest('getSignals', { sim, ids }); }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('bridge:endSession', async (_, { sim }) => {
  try { return await bridgeRequest('endSession', { sim }); }
  catch (e) { return { ok: false, error: e.message }; }
});

// Tear down the bridge cleanly on app quit. Best-effort: send shutdown,
// give the process a moment to exit, then kill if it doesn't.
app.on('before-quit', () => {
  if (!_bridgeProc) return;
  try { _bridgeProc.stdin.write(JSON.stringify({ id: 'shutdown', cmd: 'shutdown' }) + '\n'); } catch {}
  setTimeout(() => { try { _bridgeProc?.kill(); } catch {} }, 500);
});

