const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickProfileDir:   ()           => ipcRenderer.invoke('pick-profile-dir'),
  detectMappingDir: ()           => ipcRenderer.invoke('detect-mapping-dir'),
  checkWritable:    (dir)        => ipcRenderer.invoke('check-writable', dir),
  listProfiles:     (dir)        => ipcRenderer.invoke('list-profiles', dir),
  loadProfile:      (dir)        => ipcRenderer.invoke('load-profile', dir),
  saveProfile:      (args)       => ipcRenderer.invoke('save-profile', args),
  deleteProfile:    (dir)        => ipcRenderer.invoke('delete-profile', dir),
  openFolder:       (dir)        => ipcRenderer.invoke('open-folder', dir),
  setDefaultProfile:(args)       => ipcRenderer.invoke('set-default-profile', args),
  getDefaultProfile:(dir)        => ipcRenderer.invoke('get-default-profile', dir),
  loadSettings:     ()           => ipcRenderer.invoke('load-settings'),
  saveSettings:        (settings)  => ipcRenderer.invoke('save-settings', settings),
  quitApp:             ()          => ipcRenderer.invoke('quit-app'),
  loadStaticData:      ()          => ipcRenderer.invoke('load-static-data'),
  openUserDataFolder:  ()          => ipcRenderer.invoke('open-user-data-folder'),
  openSignalsFile:     (filename)  => ipcRenderer.invoke('open-signals-file', filename),
  importSignalsFile:   (filename)  => ipcRenderer.invoke('import-signals-file', filename),
  openDriverConfig:    (args)      => ipcRenderer.invoke('open-driver-config', args),
  // ── Live calibration bridge ────────────────────────────────────────────
  // Spawn-on-first-call C# helper that writes synthetic sim signal values
  // into the live sim's shared memory area. Used by the Calibration tab's
  // "Live calibration" mode — see bridge/SimLinkupCalibrationBridge/.
  bridge: {
    isSimRunning: (sim)            => ipcRenderer.invoke('bridge:isSimRunning', { sim }),
    startSession: (sim)            => ipcRenderer.invoke('bridge:startSession', { sim }),
    setSignals:   (sim, signals)   => ipcRenderer.invoke('bridge:setSignals', { sim, signals }),
    getSignals:   (sim, ids)       => ipcRenderer.invoke('bridge:getSignals', { sim, ids }),
    endSession:   (sim)            => ipcRenderer.invoke('bridge:endSession', { sim }),
  },
});
