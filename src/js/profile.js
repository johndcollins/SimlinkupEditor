// ── Profile management & directory ──────────────────────────────────────────
// Top-level handlers for picking the mapping directory, listing/loading
// profiles, and the per-profile actions (select, add, delete, set default,
// save). Wired into the titlebar/sidebar buttons via inline onclick=.

// ── Directory ───────────────────────────────────────────────────────────────
async function pickDir() {
  const dir = await window.api.pickProfileDir();
  if (!dir) return;
  await setDir(dir, true);
}

async function autoDetectDir() {
  const detected = await window.api.detectMappingDir();
  if (detected) {
    await setDir(detected, true);
    toast('Found SimLinkup install: ' + detected);
  } else {
    toast('Could not auto-detect SimLinkup. Pick the Content/Mapping folder manually.');
  }
}

async function setDir(dir, save) {
  mappingDir = dir;
  document.getElementById('dirLabel').textContent = dir;
  document.getElementById('dirBanner').style.display = 'none';
  document.getElementById('btnOpenFolder').disabled = false;

  // Show the read-only banner if the folder isn't writable (e.g. Program Files).
  const writable = await window.api.checkWritable(dir);
  const banner = document.getElementById('readOnlyBanner');
  if (writable && writable.writable) {
    banner.style.display = 'none';
  } else {
    document.getElementById('readOnlyPath').textContent = dir;
    banner.style.display = '';
  }

  // Show loading state in sidebar immediately
  document.getElementById('profileList').innerHTML =
    '<div style="padding:16px;text-align:center;color:var(--color-text-secondary);font-size:12px">Loading profiles…</div>';

  defaultProfile = await window.api.getDefaultProfile(dir);
  const names = await window.api.listProfiles(dir);

  // Initialise all profiles as stubs
  profiles = names.map(n => ({ name: n, instruments: [], chain: emptyChain(), drivers: {}, simSupports: [], driverConfigsRaw: {}, gaugeConfigs: {}, gaugeConfigsRaw: {}, loaded: false }));
  activeIdx = null;
  // Reset the editor pane — without this, the previously-selected profile's
  // title, default badge, and tab DOM stay visible until the user clicks
  // a profile in the new directory.
  clearEditor();
  renderSidebar(); // show names immediately with 0/0 briefly

  // Eager-load all profiles in parallel
  await Promise.all(profiles.map(async (p) => {
    try {
      const data = await window.api.loadProfile(mappingDir + '/' + p.name);
      if (data && !data.error) {
        applyLoadedChain(
          p, data.mappings,
          data.hsmRegistry, data.ssmRegistry, data.driverConfigs,
        );
        p.loaded = true;
      }
    } catch(e) {
      // leave as empty if load fails
    }
  }));

  renderSidebar(); // re-render with real counts
  if (save) await window.api.saveSettings({ mappingDir: dir });
}

async function openFolder() {
  if (mappingDir) await window.api.openFolder(mappingDir);
}

// ── Profile actions ─────────────────────────────────────────────────────────

async function selectProfile(i) {
  activeIdx = i;
  const p = profiles[i];
  // Fallback load — only needed for profiles created this session before saving
  if (!p.loaded && mappingDir) {
    try {
      const data = await window.api.loadProfile(mappingDir + '/' + p.name);
      if (data && !data.error) {
        applyLoadedChain(
          p, data.mappings,
          data.hsmRegistry, data.ssmRegistry, data.driverConfigs,
        );
        p.loaded = true;
        renderSidebar(); // update count now we have data
      }
    } catch(e) {}
  }
  document.getElementById('btnSave').disabled = false;
  document.getElementById('btnDelete').disabled = false;
  renderSidebar();
  renderEditor();
}

async function addProfile() {
  const inp = document.getElementById('newProfileName');
  const name = inp.value.trim();
  if (!name) return;
  if (profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    toast('A profile with that name already exists.');
    return;
  }
  profiles.push({ name, instruments: [], chain: emptyChain(), drivers: {}, simSupports: [], driverConfigsRaw: {}, gaugeConfigs: {}, gaugeConfigsRaw: {}, loaded: true });
  inp.value = '';
  await selectProfile(profiles.length - 1);
}

async function deleteProfile() {
  if (activeIdx === null) return;
  const p = profiles[activeIdx];
  if (!confirm(`Delete profile "${p.name}"? This will remove the folder from disk.`)) return;
  if (mappingDir) {
    const result = await window.api.deleteProfile(mappingDir + '/' + p.name);
    if (!result.success) { toast('Error: ' + result.error); return; }
  }
  profiles.splice(activeIdx, 1);
  activeIdx = null;
  document.getElementById('btnSave').disabled = true;
  document.getElementById('btnDelete').disabled = true;
  document.getElementById('editorTitle').textContent = 'Select a profile';
  document.getElementById('editorMeta').textContent = 'Create a new profile or select one from the list';
  document.getElementById('editorBody').innerHTML = '<div class="empty">Select or create a profile to get started.</div>';
  renderDefaultStatus();
  renderSidebar();
  toast('Profile deleted.');
}

async function setDefault() {
  if (activeIdx === null || !mappingDir) return;
  const p = profiles[activeIdx];
  await window.api.setDefaultProfile({ mappingDir, profileName: p.name });
  defaultProfile = p.name;
  renderSidebar();
  renderDefaultStatus();
  toast(`"${p.name}" is now the default profile.`);
}

async function saveProfile() {
  if (activeIdx === null) return;
  const p = profiles[activeIdx];
  if (!mappingDir) {
    toast('No directory selected. Pick your SimLinkup Content/Mapping folder first.');
    return;
  }
  const mappingFiles = generateMappingFiles(p);
  // hsmClasses (HardwareSupportModule.registry):
  //   gauge HSMs from p.instruments + driver HSMs from p.drivers (declared,
  //   not just edge-referenced — that's the new model since the user
  //   explicitly declares hardware in the Hardware tab).
  const hsmClassSet = new Set();
  for (const pn of p.instruments) {
    const inst = INSTRUMENTS.find(i => i.pn === pn);
    if (inst?.cls) hsmClassSet.add(inst.cls);
  }
  for (const driverId of Object.keys(p.drivers || {})) {
    const meta = DRIVER_META[driverId];
    if (meta?.cls) hsmClassSet.add(meta.cls);
  }
  const hsmClasses = [...hsmClassSet];
  // simSupportClasses (SimSupportModule.registry):
  //   class FQN + assembly per declared sim-support id.
  const simSupportClasses = (p.simSupports || []).map(id => {
    const ss = SIM_SUPPORTS.find(s => s.id === id);
    return ss ? { cls: ss.cls, assembly: ss.assembly } : null;
  }).filter(Boolean);
  const driverConfigs = generateDriverConfigs(p);
  const result = await window.api.saveProfile({
    profileDir: mappingDir,
    profileName: p.name,
    mappingFiles,
    hsmClasses,
    simSupportClasses,
    driverConfigs,
  });
  if (result.success) {
    p.loaded = true;
    toast('Profile saved to ' + result.path);
    document.getElementById('saveStatus').textContent = 'Saved ✓';
    document.getElementById('saveStatus').className = 'status-msg status-ok';
    setTimeout(() => { document.getElementById('saveStatus').textContent = ''; }, 3000);
    // Warn if the user wired AD devices beyond the configured count.
    if (result.adDeviceShortfall) {
      toast(`Profile wires AnalogDevices device ${result.adDeviceShortfall.required - 1} but ` +
            `AnalogDevicesHardwareSupportModule.config only has ${result.adDeviceShortfall.have} ` +
            `device${result.adDeviceShortfall.have === 1 ? '' : 's'}. SimLinkup will ignore ` +
            `unconfigured devices — extend the config (or delete it to regenerate from defaults).`);
    }
  } else {
    toast('Save failed: ' + result.error);
  }
}
