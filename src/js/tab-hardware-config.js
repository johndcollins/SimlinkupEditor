// ── Hardware Config tab ──────────────────────────────────────────────────────
//
// Deeper editor for per-driver .config files. One collapsible card per
// declared driver. Today only the AnalogDevices card has a structured editor;
// other drivers get a stub card with an "Open raw XML" button so users can
// hand-edit their config (creating it from a default if missing).
//
// Renders into #pane-hardwareconfig. Re-runs on every renderEditor() call,
// which keeps it in sync with the Hardware tab when the user adds/removes
// a driver.
function renderHardwareConfig() {
  const pane = document.getElementById('pane-hardwareconfig');
  if (!pane) return;
  const p = profiles[activeIdx];
  const declaredIds = Object.keys(p.drivers || {}).sort((a, b) =>
    DRIVER_META[a].label.localeCompare(DRIVER_META[b].label));

  if (declaredIds.length === 0) {
    pane.innerHTML = `
      <div class="empty">
        No drivers declared yet. Go to the
        <a href="#" onclick="switchTab('hardware', document.querySelector('.tab-btn:nth-child(1)')); return false;">Hardware</a>
        tab and click <strong>+ Add</strong> on a driver to give it a config card here.
      </div>`;
    return;
  }

  // PoKeys is split across two driver ids (pokeys_digital, pokeys_pwm)
  // for kind-mismatch validator purposes, but maps to ONE physical card
  // and ONE config file. Render the config card under pokeys_digital
  // when both are declared (or whichever single id is declared if only
  // one is) so the user sees a single coherent editor instead of two
  // duplicates with shared state.
  if (declaredIds.includes('pokeys_pwm') && declaredIds.includes('pokeys_digital')) {
    declaredIds.splice(declaredIds.indexOf('pokeys_pwm'), 1);
  }

  pane.innerHTML = `
    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
      Per-driver hardware configuration. The AnalogDevices card has a structured
      editor (board-level calibration plus 40-channel grid). Other drivers
      currently expose their raw <code>.config</code> XML for manual editing —
      structured editors will land in a future update.
    </div>
    <div id="hwconfigCards"></div>`;
  const container = document.getElementById('hwconfigCards');
  for (const id of declaredIds) {
    container.appendChild(renderHardwareConfigCard(id));
  }
}

function renderHardwareConfigCard(driverId) {
  const p = profiles[activeIdx];
  const meta = DRIVER_META[driverId];
  const decl = p.drivers[driverId];
  const card = document.createElement('details');
  card.className = 'hwconfig-card';
  // Default-collapsed; persist the per-(profile, driver) open state across
  // re-renders (toggling another field re-renders the whole tab).
  if (_hwconfigOpen.has(`${p.name}|${driverId}`)) card.open = true;
  card.addEventListener('toggle', () => {
    const key = `${p.name}|${driverId}`;
    if (card.open) _hwconfigOpen.add(key); else _hwconfigOpen.delete(key);
  });

  if (driverId === 'analogdevices') {
    card.innerHTML = renderAnalogDevicesCardHtml(decl);
  } else if (driverId === 'henksdi') {
    card.innerHTML = renderHenkSDICardHtml(decl);
  } else if (driverId === 'henkquadsincos') {
    card.innerHTML = renderHenkQuadSinCosCardHtml(decl);
  } else if (driverId === 'phcc') {
    card.innerHTML = renderPhccCardHtml(decl);
  } else if (driverId === 'arduinoseat') {
    card.innerHTML = renderArduinoSeatCardHtml(decl);
  } else if (driverId === 'teensyewmu') {
    card.innerHTML = renderTeensyEWMUCardHtml(decl);
  } else if (driverId === 'teensyrwr') {
    card.innerHTML = renderTeensyRWRCardHtml(decl);
  } else if (driverId === 'teensyvectordrawing') {
    card.innerHTML = renderTeensyVectorDrawingCardHtml(decl);
  } else if (driverId === 'niclasmorindts') {
    card.innerHTML = renderNiclasMorinDTSCardHtml(decl);
  } else if (driverId === 'pokeys_digital' || driverId === 'pokeys_pwm') {
    // Both PoKeys driver ids render the same card body — they share
    // `decl` by reference (see parseDriverConfigs / toggleDriver).
    card.innerHTML = renderPoKeysCardHtml(decl);
  } else {
    card.innerHTML = renderStubDriverCardHtml(driverId, decl);
  }
  return card;
}

// Persist which Hardware Config cards are open across re-renders. Cleared
// when switching profiles isn't strictly necessary — the keys are namespaced
// by profile name — but stays small in practice.
const _hwconfigOpen = new Set();

// AD card content. Header carries the device count + a brief health summary;
// body has board-level calibration + 40-channel table per device.
function renderAnalogDevicesCardHtml(decl) {
  const meta = DRIVER_META.analogdevices;
  const devices = decl?.devices || [];
  const n = devices.length;
  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">${n} ${n === 1 ? 'device' : 'devices'} · 40 channels each</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('analogdevices')">Open in OS editor</button>
    </summary>`;

  const deviceSections = devices.map((dev, idx) => renderAnalogDevicesDeviceHtml(dev, idx, n)).join('');
  return header + `<div class="hwconfig-card-body">${deviceSections}</div>`;
}

function renderAnalogDevicesDeviceHtml(dev, idx, total) {
  const heading = total > 1
    ? `<div class="hwconfig-device-head">
         <div class="hwconfig-device-title">Card #${idx}</div>
         <button class="btn-sm" onclick="resetAnalogDevicesDevice(${idx})">Reset to defaults</button>
       </div>`
    : `<div class="hwconfig-device-head">
         <div class="hwconfig-device-title">Card #0</div>
         <button class="btn-sm" onclick="resetAnalogDevicesDevice(${idx})">Reset to defaults</button>
       </div>`;

  const precOpts = ['SixteenBit', 'FourteenBit'].map(v =>
    `<option value="${v}" ${dev.dacPrecision === v ? 'selected' : ''}>${v}</option>`).join('');

  const boardCal = `
    <div class="hwconfig-board-grid">
      <label>DAC precision
        <select onchange="setAdField(${idx}, 'dacPrecision', this.value)">${precOpts}</select>
      </label>
      <label>OffsetDAC0
        <input type="number" min="0" max="16383" value="${dev.offsetDAC0}"
               onchange="setAdNumber(${idx}, 'offsetDAC0', this.value, 16383)"/>
      </label>
      <label>OffsetDAC1
        <input type="number" min="0" max="16383" value="${dev.offsetDAC1}"
               onchange="setAdNumber(${idx}, 'offsetDAC1', this.value, 16383)"/>
      </label>
      <label>OffsetDAC2
        <input type="number" min="0" max="16383" value="${dev.offsetDAC2}"
               onchange="setAdNumber(${idx}, 'offsetDAC2', this.value, 16383)"/>
      </label>
    </div>`;

  // 40-row table. Header sticks within the scrollable wrapper.
  const headerRow = `
    <div class="hwconfig-channel-row hwconfig-channel-header">
      <div>#</div><div>Offset</div><div>Gain</div><div>DataValueA</div><div>DataValueB</div>
    </div>`;
  const rows = dev.channels.map((ch, c) => `
    <div class="hwconfig-channel-row">
      <div class="hwconfig-channel-idx">DAC${c}</div>
      <input type="number" min="0" max="65535" value="${ch.offset}"
             onchange="setAdChannel(${idx}, ${c}, 'offset', this.value)"/>
      <input type="number" min="0" max="65535" value="${ch.gain}"
             onchange="setAdChannel(${idx}, ${c}, 'gain', this.value)"/>
      <input type="number" min="0" max="65535" value="${ch.dataValueA}"
             onchange="setAdChannel(${idx}, ${c}, 'dataValueA', this.value)"/>
      <input type="number" min="0" max="65535" value="${ch.dataValueB}"
             onchange="setAdChannel(${idx}, ${c}, 'dataValueB', this.value)"/>
    </div>`).join('');

  return `
    <div class="hwconfig-device-section">
      ${heading}
      <div class="hwconfig-section-label">Board calibration</div>
      ${boardCal}
      <div class="hwconfig-section-label">Per-channel calibration</div>
      <div class="hwconfig-channel-table">${headerRow}${rows}</div>
    </div>`;
}

function renderStubDriverCardHtml(driverId, decl) {
  const meta = DRIVER_META[driverId];
  // Brief device-info summary so the user sees what's currently declared.
  let deviceInfo = '';
  const n = decl?.devices?.length || 0;
  if (meta.deviceShape === 'count') {
    deviceInfo = `${n} ${n === 1 ? 'board' : 'boards'}`;
  } else if (meta.deviceShape === 'address') {
    const addrs = (decl?.devices || []).map(d => d.address).filter(Boolean);
    deviceInfo = addrs.length ? `address${addrs.length === 1 ? '' : 'es'}: ${addrs.join(', ')}` : 'no addresses set';
  } else {
    deviceInfo = 'single instance';
  }

  return `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">${escHtml(deviceInfo)} · raw XML editing only</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('${driverId}')">Open raw XML</button>
    </summary>
    <div class="hwconfig-card-body">
      <div style="font-size:11px;color:var(--text-secondary);font-style:italic;padding:8px 4px">
        A structured editor for ${escHtml(meta.label)} hasn't been built yet. Click
        <strong>Open raw XML</strong> above to edit
        <code>${escHtml(meta.configFilename)}</code> in your default editor —
        it'll be created with a minimal stub if it doesn't exist yet.
      </div>
    </div>`;
}

// ── Hardware Config — HenkSDI card ───────────────────────────────────────────
//
// Renders one collapsible <details> per declared HenkSDI device. Each device
// gets a six-section editor:
//   1. Identity  (Address, COMPort, ConnectionType, DiagnosticLEDMode,
//                 InitialIndicatorPosition)
//   2. Power-down (Enabled, Level, DelayMs)
//   3. Stator base angles (S1, S2, S3 in degrees)
//   4. Movement limits (Min, Max — byte range 0..255)
//   5. Output channels (DIG_PWM_1..7 + PWM_OUT, each with mode/initialValue
//      and a calibration breakpoint table when in PWM mode)
//   6. Update-rate control (Limit/Smooth/Speed/Misc with mode-conditional
//      sub-block)
function renderHenkSDICardHtml(decl) {
  const meta = DRIVER_META.henksdi;
  const devices = decl?.devices || [];
  const n = devices.length;
  const summary = (() => {
    const addrs = devices.map(d => d.address).filter(Boolean);
    if (addrs.length === 0) return `${n} ${n === 1 ? 'device' : 'devices'}`;
    return `${n} ${n === 1 ? 'device' : 'devices'} · ${addrs.join(', ')}`;
  })();

  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">${escHtml(summary)}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('henksdi')">Open in OS editor</button>
    </summary>`;

  const deviceSections = devices.map((dev, idx) =>
    renderHenkSDIDeviceHtml(dev, idx, n)
  ).join('');

  const body = `<div class="hwconfig-card-body">${deviceSections}</div>`;
  return header + body;
}

function renderHenkSDIDeviceHtml(dev, idx, total) {
  const titleText = total > 1 ? `Card #${idx} (${escHtml(dev.address)})` : `Card #${idx}`;
  return `
    <div class="hwconfig-device-section">
      <div class="hwconfig-device-head">
        <div class="hwconfig-device-title">${titleText}</div>
        <button class="btn-sm" onclick="resetHenkSDIDevice(${idx})">Reset to defaults</button>
      </div>
      ${renderHenkSDIIdentityHtml(dev, idx)}
      ${renderHenkSDIPowerDownHtml(dev, idx)}
      ${renderHenkSDIStatorHtml(dev, idx)}
      ${renderHenkSDILimitsHtml(dev, idx)}
      ${renderHenkSDIChannelsHtml(dev, idx)}
      ${renderHenkSDIUrcHtml(dev, idx)}
    </div>`;
}

function renderHenkSDIIdentityHtml(dev, idx) {
  const ctOpts = HENKSDI_CONNECTION_VALUES.map(v =>
    `<option value="${v}" ${dev.connectionType === v ? 'selected' : ''}>${v}</option>`).join('');
  const ledOpts = HENKSDI_DIAG_LED_VALUES.map(v =>
    `<option value="${v}" ${dev.diagnosticLEDMode === v ? 'selected' : ''}>${v}</option>`).join('');
  return `
    <div class="hwconfig-section-label">Identity</div>
    <div class="hwconfig-board-grid">
      <label>Address
        <input type="text" value="${escHtml(dev.address)}"
               onchange="setSdiField(${idx}, 'address', this.value, 'address')"/>
      </label>
      <label>COM port
        <input type="text" value="${escHtml(dev.comPort)}" placeholder="COM3"
               onchange="setSdiField(${idx}, 'comPort', this.value, 'string')"/>
      </label>
      <label>Connection type
        <select onchange="setSdiField(${idx}, 'connectionType', this.value, 'enum-connection')">${ctOpts}</select>
      </label>
      <label>Diagnostic LED
        <select onchange="setSdiField(${idx}, 'diagnosticLEDMode', this.value, 'enum-led')">${ledOpts}</select>
      </label>
      <label>Initial indicator position
        <input type="number" min="0" max="1023" value="${dev.initialIndicatorPosition}"
               onchange="setSdiField(${idx}, 'initialIndicatorPosition', this.value, 'int-1023')"/>
      </label>
    </div>`;
}

function renderHenkSDIPowerDownHtml(dev, idx) {
  const lvlOpts = HENKSDI_POWERDOWN_LEVEL_VALUES.map(v =>
    `<option value="${v}" ${dev.powerDown.level === v ? 'selected' : ''}>${v}</option>`).join('');
  return `
    <div class="hwconfig-section-label">Power-down</div>
    <div class="hwconfig-board-grid">
      <label>Enabled
        <select onchange="setSdiPowerDown(${idx}, 'enabled', this.value === 'true')">
          <option value="false" ${dev.powerDown.enabled ? '' : 'selected'}>false</option>
          <option value="true"  ${dev.powerDown.enabled ? 'selected' : ''}>true</option>
        </select>
      </label>
      <label>Level
        <select onchange="setSdiPowerDown(${idx}, 'level', this.value)">${lvlOpts}</select>
      </label>
      <label>Delay (ms)
        <input type="number" min="0" max="2016" value="${dev.powerDown.delayMs}"
               onchange="setSdiPowerDown(${idx}, 'delayMs', this.value)"/>
      </label>
    </div>`;
}

function renderHenkSDIStatorHtml(dev, idx) {
  return `
    <div class="hwconfig-section-label">Stator base angles (degrees)</div>
    <div class="hwconfig-board-grid">
      <label>S1
        <input type="number" min="0" max="359" value="${dev.statorBaseAngles.s1}"
               onchange="setSdiStator(${idx}, 's1', this.value)"/>
      </label>
      <label>S2
        <input type="number" min="0" max="359" value="${dev.statorBaseAngles.s2}"
               onchange="setSdiStator(${idx}, 's2', this.value)"/>
      </label>
      <label>S3
        <input type="number" min="0" max="359" value="${dev.statorBaseAngles.s3}"
               onchange="setSdiStator(${idx}, 's3', this.value)"/>
      </label>
    </div>`;
}

function renderHenkSDILimitsHtml(dev, idx) {
  return `
    <div class="hwconfig-section-label">Movement limits</div>
    <div class="hwconfig-board-grid">
      <label>Min (0 = no min)
        <input type="number" min="0" max="255" value="${dev.movementLimits.min}"
               onchange="setSdiLimits(${idx}, 'min', this.value)"/>
      </label>
      <label>Max (255 = no max)
        <input type="number" min="0" max="255" value="${dev.movementLimits.max}"
               onchange="setSdiLimits(${idx}, 'max', this.value)"/>
      </label>
    </div>`;
}

function renderHenkSDIChannelsHtml(dev, idx) {
  const rows = HENKSDI_CHANNEL_NAMES.map(name => {
    const ch = dev.channels[name];
    const isPwmOut = name === 'PWM_OUT';
    const showCal = isPwmOut || ch.mode === 'PWM';

    const modeCell = isPwmOut
      ? `<div class="hwconfig-channel-mode-static">PWM</div>`
      : `<select class="hwconfig-channel-mode-select"
                 onchange="setSdiChannelField(${idx}, '${name}', 'mode', this.value, 'enum-channel-mode')">
           ${HENKSDI_CHANNEL_MODE_VALUES.map(v =>
             `<option value="${v}" ${ch.mode === v ? 'selected' : ''}>${v}</option>`).join('')}
         </select>`;

    const calRows = (ch.calibration || []).map((pt, ptIdx) => `
      <div class="hwconfig-cal-row">
        <input type="number" step="0.001" min="0" max="1" value="${pt.input}"
               onchange="setSdiCalPoint(${idx}, '${name}', ${ptIdx}, 'input', this.value)"/>
        <input type="number" min="0" max="255" value="${pt.output}"
               onchange="setSdiCalPoint(${idx}, '${name}', ${ptIdx}, 'output', this.value)"/>
        <button class="btn-sm btn-danger" onclick="removeSdiCalPoint(${idx}, '${name}', ${ptIdx})">×</button>
      </div>`).join('');

    const calBlock = showCal
      ? `<div class="hwconfig-cal-block">
           <div class="hwconfig-cal-head">
             <div class="hwconfig-cal-title">Calibration breakpoints (input 0..1 → output 0..255)</div>
             <button class="btn-sm btn-primary" onclick="addSdiCalPoint(${idx}, '${name}')">+ Add point</button>
           </div>
           ${calRows.length > 0
             ? `<div class="hwconfig-cal-grid">
                  <div class="hwconfig-cal-header">
                    <div>Input</div><div>Output</div><div></div>
                  </div>
                  ${calRows}
                </div>`
             : `<div class="hwconfig-cal-empty">No breakpoints — passthrough.</div>`}
         </div>`
      : '';

    return `
      <div class="hwconfig-sdi-channel">
        <div class="hwconfig-sdi-channel-head">
          <div class="hwconfig-sdi-channel-name">${name}</div>
          ${modeCell}
          <label class="hwconfig-sdi-channel-initial">Initial
            <input type="number" min="0" max="255" value="${ch.initialValue}"
                   onchange="setSdiChannelField(${idx}, '${name}', 'initialValue', this.value, 'int-255')"/>
          </label>
        </div>
        ${calBlock}
      </div>`;
  }).join('');

  return `
    <div class="hwconfig-section-label">Output channels</div>
    <div class="hwconfig-sdi-channels">${rows}</div>`;
}

function renderHenkSDIUrcHtml(dev, idx) {
  const urc = dev.updateRateControl;
  const modeOpts = HENKSDI_URC_MODE_VALUES.map(v =>
    `<option value="${v}" ${urc.mode === v ? 'selected' : ''}>${v}</option>`).join('');
  const smOpts = HENKSDI_URC_SMOOTHING_VALUES.map(v =>
    `<option value="${v}" ${urc.smoothing.mode === v ? 'selected' : ''}>${v}</option>`).join('');

  // Mode-conditional sub-block. Limit / Speed / Miscellaneous all use
  // LimitModeSettings on disk (the C# class only ships Limit + Smoothing as
  // [XmlInclude]'d types). We show LimitThreshold for those, and the
  // smoothing controls for Smooth.
  const subBlock = urc.mode === 'Smooth'
    ? `<label>Smoothing min threshold
         <input type="number" min="0" max="15" value="${urc.smoothing.minThreshold}"
                onchange="setSdiUrcSmoothing(${idx}, 'minThreshold', this.value)"/>
       </label>
       <label>Smoothing mode
         <select onchange="setSdiUrcSmoothing(${idx}, 'mode', this.value)">${smOpts}</select>
       </label>`
    : `<label>Limit threshold (0 = disabled, max 63)
         <input type="number" min="0" max="63" value="${urc.limitThreshold}"
                onchange="setSdiUrcField(${idx}, 'limitThreshold', this.value, 'int-63')"/>
       </label>`;

  return `
    <div class="hwconfig-section-label">Update-rate control</div>
    <div class="hwconfig-board-grid">
      <label>Mode
        <select onchange="setSdiUrcField(${idx}, 'mode', this.value, 'enum-urc-mode')">${modeOpts}</select>
      </label>
      <label>Step update delay (ms, 8..256)
        <input type="number" min="8" max="256" value="${urc.stepUpdateDelayMillis}"
               onchange="setSdiUrcField(${idx}, 'stepUpdateDelayMillis', this.value, 'int-step-delay')"/>
      </label>
      <label>Use shortest path
        <select onchange="setSdiUrcField(${idx}, 'useShortestPath', this.value === 'true', 'bool')">
          <option value="false" ${urc.useShortestPath ? '' : 'selected'}>false</option>
          <option value="true"  ${urc.useShortestPath ? 'selected' : ''}>true</option>
        </select>
      </label>
      ${subBlock}
    </div>`;
}

// ── Hardware Config — HenkSDI edit handlers ──────────────────────────────────
//
// Each handler validates/coerces its input and mutates p.drivers.henksdi in
// place. Most don't re-render the whole tab — the user typed/picked a value
// and the input shows it correctly already; re-rendering the whole 8-channel
// section would steal focus mid-edit. Re-rendering IS triggered for changes
// that toggle visible structure: channel mode (shows/hides the calibration
// block), URC mode (shows/hides Limit vs Smooth sub-fields), and
// breakpoint add/remove.
function setSdiField(deviceIdx, field, value, kind) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.henksdi?.devices?.[deviceIdx];
  if (!dev) return;
  if (kind === 'address') {
    // Refuse to change address when channels are wired to the old one — same
    // protection the Hardware tab gives.
    const oldAddr = dev.address;
    const trimmed = String(value).trim();
    if (trimmed && trimmed !== oldAddr) {
      const wired = p.chain.edges.filter(e =>
        e.dstDriver === 'henksdi' && String(e.dstDriverDevice) === oldAddr).length;
      if (wired > 0) {
        toast(`Cannot change HenkSDI address from ${oldAddr}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it. Unwire first.`);
        renderHardwareConfig();
        return;
      }
    }
    dev.address = trimmed;
    return;
  }
  if (kind === 'string') {
    dev[field] = String(value);
    return;
  }
  if (kind === 'int-1023') {
    dev[field] = intClamp(value, 0, 1023, dev[field]);
    return;
  }
  if (kind === 'enum-connection') {
    if (HENKSDI_CONNECTION_VALUES.includes(value)) dev[field] = value;
    return;
  }
  if (kind === 'enum-led') {
    if (HENKSDI_DIAG_LED_VALUES.includes(value)) dev[field] = value;
    return;
  }
}
function setSdiPowerDown(deviceIdx, field, value) {
  const p = profiles[activeIdx];
  const pd = p.drivers?.henksdi?.devices?.[deviceIdx]?.powerDown;
  if (!pd) return;
  if (field === 'enabled') pd.enabled = !!value;
  else if (field === 'level' && HENKSDI_POWERDOWN_LEVEL_VALUES.includes(value)) pd.level = value;
  else if (field === 'delayMs') pd.delayMs = intClamp(value, 0, 2016, pd.delayMs);
}
function setSdiStator(deviceIdx, field, value) {
  const p = profiles[activeIdx];
  const sb = p.drivers?.henksdi?.devices?.[deviceIdx]?.statorBaseAngles;
  if (!sb) return;
  sb[field] = intClamp(value, 0, 359, sb[field]);
}
function setSdiLimits(deviceIdx, field, value) {
  const p = profiles[activeIdx];
  const ml = p.drivers?.henksdi?.devices?.[deviceIdx]?.movementLimits;
  if (!ml) return;
  ml[field] = intClamp(value, 0, 255, ml[field]);
}
function setSdiChannelField(deviceIdx, channelName, field, value, kind) {
  const p = profiles[activeIdx];
  const ch = p.drivers?.henksdi?.devices?.[deviceIdx]?.channels?.[channelName];
  if (!ch) return;
  if (kind === 'enum-channel-mode') {
    if (!HENKSDI_CHANNEL_MODE_VALUES.includes(value)) return;
    ch.mode = value;
    // Toggling Digital ↔ PWM changes whether the calibration block is shown,
    // so re-render the tab.
    renderHardwareConfig();
    return;
  }
  if (kind === 'int-255') {
    ch.initialValue = intClamp(value, 0, 255, ch.initialValue);
    return;
  }
}
function addSdiCalPoint(deviceIdx, channelName) {
  const p = profiles[activeIdx];
  const ch = p.drivers?.henksdi?.devices?.[deviceIdx]?.channels?.[channelName];
  if (!ch) return;
  if (!Array.isArray(ch.calibration)) ch.calibration = [];
  // Default new point: split halfway between the previous-last and 1.0, or
  // (0, 0) if the list is empty. Output defaults to 128 (the "centred" PWM
  // value from samples).
  const last = ch.calibration[ch.calibration.length - 1];
  const newInput = last ? Math.min(1, (last.input + 1) / 2) : 0;
  ch.calibration.push({ input: Number(newInput.toFixed(3)), output: 128 });
  renderHardwareConfig();
}
function removeSdiCalPoint(deviceIdx, channelName, ptIdx) {
  const p = profiles[activeIdx];
  const ch = p.drivers?.henksdi?.devices?.[deviceIdx]?.channels?.[channelName];
  if (!ch || !Array.isArray(ch.calibration)) return;
  ch.calibration.splice(ptIdx, 1);
  renderHardwareConfig();
}
function setSdiCalPoint(deviceIdx, channelName, ptIdx, field, value) {
  const p = profiles[activeIdx];
  const pt = p.drivers?.henksdi?.devices?.[deviceIdx]?.channels?.[channelName]?.calibration?.[ptIdx];
  if (!pt) return;
  if (field === 'input')  pt.input  = floatClamp(value, 0, 1, pt.input);
  else if (field === 'output') pt.output = intClamp(value, 0, 255, pt.output);
}
function setSdiUrcField(deviceIdx, field, value, kind) {
  const p = profiles[activeIdx];
  const urc = p.drivers?.henksdi?.devices?.[deviceIdx]?.updateRateControl;
  if (!urc) return;
  if (kind === 'enum-urc-mode') {
    if (!HENKSDI_URC_MODE_VALUES.includes(value)) return;
    urc.mode = value;
    // Toggling Limit ↔ Smooth changes which sub-block is shown.
    renderHardwareConfig();
    return;
  }
  if (kind === 'int-step-delay') {
    urc.stepUpdateDelayMillis = intClamp(value, 8, 256, urc.stepUpdateDelayMillis);
    return;
  }
  if (kind === 'int-63') {
    urc.limitThreshold = intClamp(value, 0, 63, urc.limitThreshold);
    return;
  }
  if (kind === 'bool') {
    urc.useShortestPath = !!value;
    return;
  }
}
function setSdiUrcSmoothing(deviceIdx, field, value) {
  const p = profiles[activeIdx];
  const sm = p.drivers?.henksdi?.devices?.[deviceIdx]?.updateRateControl?.smoothing;
  if (!sm) return;
  if (field === 'minThreshold') sm.minThreshold = intClamp(value, 0, 15, sm.minThreshold);
  else if (field === 'mode' && HENKSDI_URC_SMOOTHING_VALUES.includes(value)) sm.mode = value;
}
function resetHenkSDIDevice(deviceIdx) {
  const p = profiles[activeIdx];
  const decl = p.drivers?.henksdi;
  const dev = decl?.devices?.[deviceIdx];
  if (!dev) return;
  if (!confirm(`Reset HenkSDI Card #${deviceIdx} to default values? This clears the calibration tables, mode settings, and stator angles for this device. Save the profile to persist.`)) return;
  // Address survives the reset — losing it would orphan every wired channel.
  const keptAddress = dev.address;
  decl.devices[deviceIdx] = henkSdiDefaultDevice();
  decl.devices[deviceIdx].address = keptAddress;
  renderHardwareConfig();
}

// ── Hardware Config — HenkQuadSinCos card ────────────────────────────────────
//
// Tiny schema (4 fields per device) — much simpler than HenkSDI. One
// "Identity" section per device, sharing the .hwconfig-board-grid layout used
// for HenkSDI's Identity row.
function renderHenkQuadSinCosCardHtml(decl) {
  const meta = DRIVER_META.henkquadsincos;
  const devices = decl?.devices || [];
  const n = devices.length;
  const summary = (() => {
    const addrs = devices.map(d => d.address).filter(Boolean);
    if (addrs.length === 0) return `${n} ${n === 1 ? 'device' : 'devices'}`;
    return `${n} ${n === 1 ? 'device' : 'devices'} · ${addrs.join(', ')}`;
  })();

  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">${escHtml(summary)}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('henkquadsincos')">Open in OS editor</button>
    </summary>`;

  const deviceSections = devices.map((dev, idx) =>
    renderHenkQuadSinCosDeviceHtml(dev, idx, n)
  ).join('');

  return header + `<div class="hwconfig-card-body">${deviceSections}</div>`;
}

function renderHenkQuadSinCosDeviceHtml(dev, idx, total) {
  const titleText = total > 1 ? `Card #${idx} (${escHtml(dev.address)})` : `Card #${idx}`;
  const ctOpts = HENKSDI_CONNECTION_VALUES.map(v =>
    `<option value="${v}" ${dev.connectionType === v ? 'selected' : ''}>${v}</option>`).join('');
  const ledOpts = HENKSDI_DIAG_LED_VALUES.map(v =>
    `<option value="${v}" ${dev.diagnosticLEDMode === v ? 'selected' : ''}>${v}</option>`).join('');

  return `
    <div class="hwconfig-device-section">
      <div class="hwconfig-device-head">
        <div class="hwconfig-device-title">${titleText}</div>
        <button class="btn-sm" onclick="resetHenkQuadSinCosDevice(${idx})">Reset to defaults</button>
      </div>
      <div class="hwconfig-section-label">Identity</div>
      <div class="hwconfig-board-grid">
        <label>Address
          <input type="text" value="${escHtml(dev.address)}"
                 onchange="setQscField(${idx}, 'address', this.value, 'address')"/>
        </label>
        <label>COM port
          <input type="text" value="${escHtml(dev.comPort)}" placeholder="COM9"
                 onchange="setQscField(${idx}, 'comPort', this.value, 'string')"/>
        </label>
        <label>Connection type
          <select onchange="setQscField(${idx}, 'connectionType', this.value, 'enum-connection')">${ctOpts}</select>
        </label>
        <label>Diagnostic LED
          <select onchange="setQscField(${idx}, 'diagnosticLEDMode', this.value, 'enum-led')">${ledOpts}</select>
        </label>
      </div>
    </div>`;
}

// HenkQuadSinCos edit handler. Mirrors the HenkSDI Identity-section handler
// (same enum lists, same address-change safety check).
function setQscField(deviceIdx, field, value, kind) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.henkquadsincos?.devices?.[deviceIdx];
  if (!dev) return;
  if (kind === 'address') {
    const oldAddr = dev.address;
    const trimmed = String(value).trim();
    if (trimmed && trimmed !== oldAddr) {
      const wired = p.chain.edges.filter(e =>
        e.dstDriver === 'henkquadsincos' && String(e.dstDriverDevice) === oldAddr).length;
      if (wired > 0) {
        toast(`Cannot change Quad SinCos address from ${oldAddr}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it. Unwire first.`);
        renderHardwareConfig();
        return;
      }
    }
    dev.address = trimmed;
    return;
  }
  if (kind === 'string') {
    dev[field] = String(value);
    return;
  }
  if (kind === 'enum-connection') {
    if (HENKSDI_CONNECTION_VALUES.includes(value)) dev[field] = value;
    return;
  }
  if (kind === 'enum-led') {
    if (HENKSDI_DIAG_LED_VALUES.includes(value)) dev[field] = value;
    return;
  }
}
function resetHenkQuadSinCosDevice(deviceIdx) {
  const p = profiles[activeIdx];
  const decl = p.drivers?.henkquadsincos;
  const dev = decl?.devices?.[deviceIdx];
  if (!dev) return;
  if (!confirm(`Reset Quad SinCos Card #${deviceIdx} to default values? Save the profile to persist.`)) return;
  // Preserve address — losing it would orphan wired channels.
  const keptAddress = dev.address;
  decl.devices[deviceIdx] = henkQuadSinCosDefaultDevice();
  decl.devices[deviceIdx].address = keptAddress;
  renderHardwareConfig();
}

// ── Hardware Config — PHCC card ──────────────────────────────────────────────
//
// Single-instance driver. The .config file holds one field — a path pointing
// to the device-manager config (motherboard COM port + Doa peripherals). The
// editor doesn't structure-edit that nested file yet (see follow-ups); we
// just expose the pointer here, plus a button to open the pointed-at file in
// the OS editor (creating a minimal stub if it doesn't exist).
function renderPhccCardHtml(decl) {
  const meta = DRIVER_META.phcc;
  const dev = decl?.devices?.[0] || phccDefaultDevice();
  const path = dev.deviceManagerConfigFilePath || PHCC_DEVICE_DEFAULTS.deviceManagerConfigFilePath;

  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">→ ${escHtml(path)}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('phcc')">Open in OS editor</button>
    </summary>`;

  // Hint about the two-file layout — users who don't already know PHCC will
  // be confused by why this card has only one field.
  const body = `
    <div class="hwconfig-card-body">
      <div class="hwconfig-device-section">
        <div class="hwconfig-device-head">
          <div class="hwconfig-device-title">Device-manager config pointer</div>
          <button class="btn-sm" onclick="resetPhccDevice()">Reset to defaults</button>
        </div>
        <div style="font-size:11px;color:var(--text-secondary);font-style:italic;margin-bottom:10px;line-height:1.5">
          The PHCC HSM config is a thin pointer: it names a second file
          (conventionally <code>phcc.config</code>) that holds the actual
          motherboard COM port + Doa peripheral addresses. Relative paths
          resolve against the profile directory; absolute paths are used as-is.
          The editor doesn't yet structure-edit the device-manager file — use
          <strong>Open device-manager config</strong> to edit it directly.
        </div>
        <div class="hwconfig-section-label">Device-manager config file path</div>
        <div class="hwconfig-board-grid">
          <label style="grid-column: 1 / -1">Path
            <input type="text" value="${escHtml(path)}" placeholder="phcc.config"
                   onchange="setPhccPath(this.value)"/>
          </label>
        </div>
        <div style="margin-top:10px">
          <button class="btn-sm btn-primary" onclick="openPhccDeviceManagerFile()">Open device-manager config</button>
        </div>
      </div>
    </div>`;

  return header + body;
}

function setPhccPath(value) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.phcc?.devices?.[0];
  if (!dev) return;
  dev.deviceManagerConfigFilePath = String(value).trim();
}
function resetPhccDevice() {
  const p = profiles[activeIdx];
  const decl = p.drivers?.phcc;
  if (!decl) return;
  if (!confirm('Reset PHCC config to defaults? The device-manager config path will be set back to "phcc.config". Save the profile to persist.')) return;
  decl.devices[0] = phccDefaultDevice();
  renderHardwareConfig();
}
// Open the device-manager config file the PHCC pointer is pointing to. We
// resolve relative paths the same way SimLinkup does — try as-is first
// (absolute paths work), fall back to profile-dir-relative. For Electron's
// shell.openPath we need an absolute path, so the as-is fallback only kicks
// in when the path actually IS absolute. For relative paths we always pass
// `<profileDir>/<path>` as the joined filename to openDriverConfig.
//
// If the file doesn't exist, openDriverConfig writes a minimal
// <PhccDeviceManagerConfiguration> stub so the user has somewhere to start
// from.
async function openPhccDeviceManagerFile() {
  const p = profiles[activeIdx];
  if (!p) return;
  if (!mappingDir) {
    toast('Select a profile directory first.');
    return;
  }
  const dev = p.drivers?.phcc?.devices?.[0];
  const path = (dev?.deviceManagerConfigFilePath || PHCC_DEVICE_DEFAULTS.deviceManagerConfigFilePath).trim();
  if (!path) {
    toast('Set a device-manager config path first.');
    return;
  }
  // Detect Windows-absolute paths (drive letter or UNC) — the renderer runs
  // on Windows in production, so this is the only flavour we need.
  const isAbs = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
  const profileDir = mappingDir + '/' + p.name;
  const stub = `<?xml version="1.0"?>\n<PhccDeviceManagerConfiguration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n  <Devices>\n    <!-- Add a <Motherboard> with <ComPort> and <Peripherals>. See SimLinkup sample profiles (PHCC, etc.) for examples. -->\n  </Devices>\n</PhccDeviceManagerConfiguration>\n`;
  let target;
  if (isAbs) {
    // Absolute path — open as-is. openDriverConfig joins profileDir + filename
    // and rejects filenames containing slashes, so we pass the parent dir of
    // the absolute file as profileDir and the basename as filename.
    const lastSep = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
    const parent = path.slice(0, lastSep);
    const base = path.slice(lastSep + 1);
    if (!base) {
      toast('Path looks like a directory, not a file.');
      return;
    }
    target = await window.api.openDriverConfig({
      profileDir: parent, filename: base, defaultContent: stub,
    });
  } else {
    // Relative path — resolve against the profile dir. Reject paths with
    // separators (the IPC validates that) so we only accept simple filenames
    // here. If the user typed "subdir/foo.config", warn them.
    if (/[\\/]/.test(path)) {
      toast(`Relative paths must be a simple filename in the profile dir, not "${path}". Edit it manually if you need a sub-path.`);
      return;
    }
    target = await window.api.openDriverConfig({
      profileDir, filename: path, defaultContent: stub,
    });
  }
  if (!target?.success) {
    toast(`Could not open ${path}: ${target?.error || 'unknown error'}`);
  }
}

// ── Hardware Config — ArduinoSeat card ───────────────────────────────────────
//
// Single-instance driver with the largest schema yet. Layout is two top-level
// sections (Identity & motor bytes, Force levels) followed by a "Seat outputs"
// list — one card per <Output> entry. Each output card has:
//   - Header row: ID (free text), FORCE (dropdown), TYPE (dropdown), MIN, MAX
//   - Motor bits row: 4 checkboxes for which motors this output drives
//   - Motor speeds row: 4 number inputs (per-motor speed used when force=Manual
//                       or when type=Progressive/CenterPeak as the maxSpeed cap)
//   - Remove button
//   - Duplicate-ID warning pill when another output shares the same ID
//
// Plus three list-level buttons:
//   "+ Add output"               — append an empty output, focus its ID input
//   "+ Add F-16 standard outputs" — bulk-import the 40 IDs the C# HSM publishes
//   "Reset to defaults"          — wipe everything back to a fresh device
function renderArduinoSeatCardHtml(decl) {
  const meta = DRIVER_META.arduinoseat;
  const dev = decl?.devices?.[0] || arduinoSeatDefaultDevice();
  const outputs = dev.seatOutputs || [];

  // Count duplicate IDs so each output row can show a warning pill if its ID
  // appears more than once. Also flag empty IDs as a separate warning.
  const idCounts = new Map();
  for (const o of outputs) {
    const k = o.id || '';
    idCounts.set(k, (idCounts.get(k) || 0) + 1);
  }
  const dupCount = [...idCounts.entries()].filter(([id, n]) => id && n > 1).length;
  const emptyCount = idCounts.get('') || 0;

  const subParts = [`COM ${escHtml(dev.comPort || '—')}`, `${outputs.length} output${outputs.length === 1 ? '' : 's'}`];
  if (dupCount) subParts.push(`<span style="color:var(--text-danger)">⚠ ${dupCount} duplicate ID${dupCount === 1 ? '' : 's'}</span>`);
  if (emptyCount) subParts.push(`<span style="color:var(--text-danger)">⚠ ${emptyCount} empty ID${emptyCount === 1 ? '' : 's'}</span>`);

  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">${subParts.join(' · ')}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('arduinoseat')">Open in OS editor</button>
    </summary>`;

  const body = `
    <div class="hwconfig-card-body">
      <div class="hwconfig-device-section">
        <div class="hwconfig-device-head">
          <div class="hwconfig-device-title">Board configuration</div>
          <button class="btn-sm" onclick="resetArduinoSeatDevice()">Reset to defaults</button>
        </div>

        <div class="hwconfig-section-label">Identity &amp; motor bit-mask bytes</div>
        <div class="hwconfig-board-grid">
          <label>COM port
            <input type="text" value="${escHtml(dev.comPort)}" placeholder="COM7"
                   onchange="setArdSeatField('comPort', this.value, 'string')"/>
          </label>
          <label>MotorByte 1
            <input type="number" min="0" max="255" value="${dev.motorByte1}"
                   onchange="setArdSeatField('motorByte1', this.value, 'byte')"/>
          </label>
          <label>MotorByte 2
            <input type="number" min="0" max="255" value="${dev.motorByte2}"
                   onchange="setArdSeatField('motorByte2', this.value, 'byte')"/>
          </label>
          <label>MotorByte 3
            <input type="number" min="0" max="255" value="${dev.motorByte3}"
                   onchange="setArdSeatField('motorByte3', this.value, 'byte')"/>
          </label>
          <label>MotorByte 4
            <input type="number" min="0" max="255" value="${dev.motorByte4}"
                   onchange="setArdSeatField('motorByte4', this.value, 'byte')"/>
          </label>
        </div>

        <div class="hwconfig-section-label">Force levels (motor speed when FORCE=Slight/Rumble/Medium/Hard)</div>
        <div class="hwconfig-board-grid">
          <label>Slight
            <input type="number" min="0" max="255" value="${dev.forceSlight}"
                   onchange="setArdSeatField('forceSlight', this.value, 'byte')"/>
          </label>
          <label>Rumble
            <input type="number" min="0" max="255" value="${dev.forceRumble}"
                   onchange="setArdSeatField('forceRumble', this.value, 'byte')"/>
          </label>
          <label>Medium
            <input type="number" min="0" max="255" value="${dev.forceMedium}"
                   onchange="setArdSeatField('forceMedium', this.value, 'byte')"/>
          </label>
          <label>Hard
            <input type="number" min="0" max="255" value="${dev.forceHard}"
                   onchange="setArdSeatField('forceHard', this.value, 'byte')"/>
          </label>
        </div>

        <div class="hwconfig-section-label" style="display:flex;align-items:center;justify-content:space-between">
          <span>Seat outputs (${outputs.length})</span>
          <span style="display:flex;gap:6px">
            <button class="btn-sm btn-primary" onclick="addArdSeatOutput()">+ Add output</button>
            <button class="btn-sm" onclick="bulkImportArdSeatStandardOutputs()" title="Append every signal the C# HSM publishes">+ Add F-16 standard outputs</button>
          </span>
        </div>
        <div class="hwconfig-ardseat-outputs">
          ${outputs.map((o, i) => renderArduinoSeatOutputHtml(o, i, idCounts)).join('') ||
            '<div class="hwconfig-cal-empty">No outputs yet — add one above, or bulk-import the F-16 standard layout.</div>'}
        </div>
      </div>
    </div>`;

  return header + body;
}

function renderArduinoSeatOutputHtml(o, idx, idCounts) {
  const dupClass = (o.id && idCounts.get(o.id) > 1) || !o.id ? ' hwconfig-ardseat-output-dup' : '';
  const dupBadge = (o.id && idCounts.get(o.id) > 1)
    ? `<span class="hwconfig-ardseat-dup-badge" title="Another output has the same ID — only the first match is honoured at runtime">⚠ duplicate</span>`
    : (!o.id
       ? `<span class="hwconfig-ardseat-dup-badge" title="ID is required — output is dead until you set it">⚠ empty ID</span>`
       : '');
  const forceOpts = ARDSEAT_FORCE_VALUES.map(v =>
    `<option value="${v}" ${o.force === v ? 'selected' : ''}>${v}</option>`).join('');
  const typeOpts = ARDSEAT_PULSE_VALUES.map(v =>
    `<option value="${v}" ${o.type === v ? 'selected' : ''}>${v}</option>`).join('');

  return `
    <div class="hwconfig-ardseat-output${dupClass}">
      <div class="hwconfig-ardseat-output-head">
        <input type="text" class="hwconfig-ardseat-id" value="${escHtml(o.id)}" placeholder="ArduinoSeat__SIGNAL_NAME"
               onchange="setArdSeatOutputField(${idx}, 'id', this.value, 'string')"/>
        ${dupBadge}
        <button class="btn-sm btn-danger" onclick="removeArdSeatOutput(${idx})">×</button>
      </div>
      <div class="hwconfig-ardseat-output-row">
        <label>FORCE
          <select onchange="setArdSeatOutputField(${idx}, 'force', this.value, 'enum-force')">${forceOpts}</select>
        </label>
        <label>TYPE
          <select onchange="setArdSeatOutputField(${idx}, 'type', this.value, 'enum-type')">${typeOpts}</select>
        </label>
        <label>MIN
          <input type="number" step="any" value="${o.min}"
                 onchange="setArdSeatOutputField(${idx}, 'min', this.value, 'double')"/>
        </label>
        <label>MAX
          <input type="number" step="any" value="${o.max}"
                 onchange="setArdSeatOutputField(${idx}, 'max', this.value, 'double')"/>
        </label>
      </div>
      <div class="hwconfig-ardseat-output-row">
        <label class="hwconfig-ardseat-checkbox">
          <input type="checkbox" ${o.motor1 ? 'checked' : ''}
                 onchange="setArdSeatOutputField(${idx}, 'motor1', this.checked, 'bool')"/>
          Motor 1
        </label>
        <label class="hwconfig-ardseat-checkbox">
          <input type="checkbox" ${o.motor2 ? 'checked' : ''}
                 onchange="setArdSeatOutputField(${idx}, 'motor2', this.checked, 'bool')"/>
          Motor 2
        </label>
        <label class="hwconfig-ardseat-checkbox">
          <input type="checkbox" ${o.motor3 ? 'checked' : ''}
                 onchange="setArdSeatOutputField(${idx}, 'motor3', this.checked, 'bool')"/>
          Motor 3
        </label>
        <label class="hwconfig-ardseat-checkbox">
          <input type="checkbox" ${o.motor4 ? 'checked' : ''}
                 onchange="setArdSeatOutputField(${idx}, 'motor4', this.checked, 'bool')"/>
          Motor 4
        </label>
      </div>
      <div class="hwconfig-ardseat-output-row">
        <label>Motor 1 speed
          <input type="number" min="0" max="255" value="${o.motor1Speed}"
                 onchange="setArdSeatOutputField(${idx}, 'motor1Speed', this.value, 'byte')"/>
        </label>
        <label>Motor 2 speed
          <input type="number" min="0" max="255" value="${o.motor2Speed}"
                 onchange="setArdSeatOutputField(${idx}, 'motor2Speed', this.value, 'byte')"/>
        </label>
        <label>Motor 3 speed
          <input type="number" min="0" max="255" value="${o.motor3Speed}"
                 onchange="setArdSeatOutputField(${idx}, 'motor3Speed', this.value, 'byte')"/>
        </label>
        <label>Motor 4 speed
          <input type="number" min="0" max="255" value="${o.motor4Speed}"
                 onchange="setArdSeatOutputField(${idx}, 'motor4Speed', this.value, 'byte')"/>
        </label>
      </div>
    </div>`;
}

// ── ArduinoSeat edit handlers ────────────────────────────────────────────────
// Top-level board-field handler — string, byte (0..255), or short-circuited
// COMPort change with no wiring safety check (ArduinoSeat is single-instance
// and the Mappings tab doesn't address it by COM port).
function setArdSeatField(field, value, kind) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.arduinoseat?.devices?.[0];
  if (!dev) return;
  if (kind === 'string') {
    dev[field] = String(value);
  } else if (kind === 'byte') {
    dev[field] = intClamp(value, 0, 255, dev[field]);
  }
}

// Per-output handler. ID changes re-render the tab so the duplicate-warning
// badge stays accurate; everything else mutates in place to preserve focus.
function setArdSeatOutputField(idx, field, value, kind) {
  const p = profiles[activeIdx];
  const o = p.drivers?.arduinoseat?.devices?.[0]?.seatOutputs?.[idx];
  if (!o) return;
  if (kind === 'string') {
    o[field] = String(value);
    if (field === 'id') renderHardwareConfig();
  } else if (kind === 'enum-force') {
    if (ARDSEAT_FORCE_VALUES.includes(value)) o[field] = value;
  } else if (kind === 'enum-type') {
    if (ARDSEAT_PULSE_VALUES.includes(value)) o[field] = value;
  } else if (kind === 'bool') {
    o[field] = !!value;
  } else if (kind === 'byte') {
    o[field] = intClamp(value, 0, 255, o[field]);
  } else if (kind === 'double') {
    if (value === '' || !Number.isFinite(Number(value))) o[field] = 0;
    else o[field] = Number(value);
  }
}

function addArdSeatOutput() {
  const p = profiles[activeIdx];
  const dev = p.drivers?.arduinoseat?.devices?.[0];
  if (!dev) return;
  if (!Array.isArray(dev.seatOutputs)) dev.seatOutputs = [];
  dev.seatOutputs.push(arduinoSeatDefaultOutput());
  renderHardwareConfig();
}
function removeArdSeatOutput(idx) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.arduinoseat?.devices?.[0];
  if (!dev?.seatOutputs) return;
  dev.seatOutputs.splice(idx, 1);
  renderHardwareConfig();
}

// Bulk-import every ID the C# HSM publishes. Skips IDs already present so a
// repeat click doesn't create dups. Each new entry starts with sensible
// per-output defaults: digital signals get all 4 motors enabled with
// FORCE=Hard/TYPE=Fixed (matches the sample's pattern for digital triggers);
// analog signals get FORCE=Manual/TYPE=Fixed and no motors enabled (the user
// configures them per their seat layout).
function bulkImportArdSeatStandardOutputs() {
  const p = profiles[activeIdx];
  const dev = p.drivers?.arduinoseat?.devices?.[0];
  if (!dev) return;
  if (!Array.isArray(dev.seatOutputs)) dev.seatOutputs = [];
  const existing = new Set(dev.seatOutputs.map(o => o.id));
  let added = 0;
  for (const tpl of ARDSEAT_STANDARD_OUTPUTS) {
    if (existing.has(tpl.id)) continue;
    const o = arduinoSeatDefaultOutput(tpl.id);
    if (tpl.kind === 'digital') {
      // Digital triggers in the sample fire all 4 motors on Hard/Fixed.
      o.force = 'Hard'; o.type = 'Fixed';
      o.motor1 = o.motor2 = o.motor3 = o.motor4 = true;
    } else {
      // Analog signals default to Manual/Fixed with no motors — user wires
      // them per their seat layout (which motor channel reacts to which signal).
      o.force = 'Manual'; o.type = 'Fixed';
    }
    dev.seatOutputs.push(o);
    added++;
  }
  if (added === 0) {
    toast('All 40 standard outputs are already present.');
  } else {
    toast(`Added ${added} standard output${added === 1 ? '' : 's'}. ${dev.seatOutputs.length - added} previously existed.`);
  }
  renderHardwareConfig();
}

function resetArduinoSeatDevice() {
  const p = profiles[activeIdx];
  const decl = p.drivers?.arduinoseat;
  if (!decl) return;
  if (!confirm('Reset Arduino Seat config to defaults? This clears the COM port, motor-byte map, force levels, and all seat outputs. Save the profile to persist.')) return;
  decl.devices[0] = arduinoSeatDefaultDevice();
  renderHardwareConfig();
}

// ── Hardware Config — TeensyEWMU card ────────────────────────────────────────
//
// Single-instance driver. Schema is COMPort + a list of <Output> entries
// (id + invert bool). The IDs come from a fixed enum on the C# side
// (TeensyEWMUCommunicationProtocolHeaders.InvertBits) — IDs that don't
// match an enum member are silently ignored at runtime, so the editor
// renders a free-text ID input (so users can hand-author non-standard IDs
// they're testing) but the bulk-import button uses the canonical 35-entry
// list from TEWMU_STANDARD_OUTPUTS.
function renderTeensyEWMUCardHtml(decl) {
  const meta = DRIVER_META.teensyewmu;
  const dev = decl?.devices?.[0] || teensyEwmuDefaultDevice();
  const outputs = dev.dxOutputs || [];
  const invertedCount = outputs.filter(o => o.invert).length;

  const subParts = [`COM ${escHtml(dev.comPort || '—')}`, `${outputs.length} output${outputs.length === 1 ? '' : 's'}`];
  if (invertedCount) subParts.push(`${invertedCount} inverted`);

  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">${subParts.join(' · ')}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('teensyewmu')">Open in OS editor</button>
    </summary>`;

  const rows = outputs.map((o, i) => `
    <div class="hwconfig-tewmu-row">
      <input type="text" class="hwconfig-tewmu-id" value="${escHtml(o.id)}" placeholder="CMDS_O1"
             onchange="setTewmuOutputField(${i}, 'id', this.value, 'string')"/>
      <label class="hwconfig-tewmu-invert">
        <input type="checkbox" ${o.invert ? 'checked' : ''}
               onchange="setTewmuOutputField(${i}, 'invert', this.checked, 'bool')"/>
        Invert
      </label>
      <button class="btn-sm btn-danger" onclick="removeTewmuOutput(${i})">×</button>
    </div>`).join('');

  const body = `
    <div class="hwconfig-card-body">
      <div class="hwconfig-device-section">
        <div class="hwconfig-device-head">
          <div class="hwconfig-device-title">Board configuration</div>
          <button class="btn-sm" onclick="resetTeensyEWMUDevice()">Reset to defaults</button>
        </div>

        <div class="hwconfig-section-label">Identity</div>
        <div class="hwconfig-board-grid">
          <label>COM port
            <input type="text" value="${escHtml(dev.comPort)}" placeholder="COM4"
                   onchange="setTewmuField('comPort', this.value)"/>
          </label>
        </div>

        <div class="hwconfig-section-label" style="display:flex;align-items:center;justify-content:space-between">
          <span>DX outputs (${outputs.length})</span>
          <span style="display:flex;gap:6px">
            <button class="btn-sm btn-primary" onclick="addTewmuOutput()">+ Add output</button>
            <button class="btn-sm" onclick="bulkImportTewmuStandardOutputs()" title="Append every InvertBits enum member from the C# protocol headers">+ Add standard outputs</button>
          </span>
        </div>
        <div class="hwconfig-tewmu-rows">
          ${rows || '<div class="hwconfig-cal-empty">No outputs yet — add one above, or bulk-import the 35-entry standard layout.</div>'}
        </div>
      </div>
    </div>`;

  return header + body;
}

// TeensyEWMU edit handlers
function setTewmuField(field, value) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.teensyewmu?.devices?.[0];
  if (!dev) return;
  if (field === 'comPort') dev.comPort = String(value);
}
function setTewmuOutputField(idx, field, value, kind) {
  const p = profiles[activeIdx];
  const o = p.drivers?.teensyewmu?.devices?.[0]?.dxOutputs?.[idx];
  if (!o) return;
  if (kind === 'string') {
    o[field] = String(value);
  } else if (kind === 'bool') {
    o[field] = !!value;
    // Re-render so the header's "N inverted" pill stays current.
    renderHardwareConfig();
  }
}
function addTewmuOutput() {
  const p = profiles[activeIdx];
  const dev = p.drivers?.teensyewmu?.devices?.[0];
  if (!dev) return;
  if (!Array.isArray(dev.dxOutputs)) dev.dxOutputs = [];
  dev.dxOutputs.push(teensyEwmuDefaultOutput());
  renderHardwareConfig();
}
function removeTewmuOutput(idx) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.teensyewmu?.devices?.[0];
  if (!dev?.dxOutputs) return;
  dev.dxOutputs.splice(idx, 1);
  renderHardwareConfig();
}
function bulkImportTewmuStandardOutputs() {
  const p = profiles[activeIdx];
  const dev = p.drivers?.teensyewmu?.devices?.[0];
  if (!dev) return;
  if (!Array.isArray(dev.dxOutputs)) dev.dxOutputs = [];
  const existing = new Set(dev.dxOutputs.map(o => o.id));
  let added = 0;
  for (const id of TEWMU_STANDARD_OUTPUTS) {
    if (existing.has(id)) continue;
    dev.dxOutputs.push(teensyEwmuDefaultOutput(id));
    added++;
  }
  if (added === 0) {
    toast(`All ${TEWMU_STANDARD_OUTPUTS.length} standard outputs are already present.`);
  } else {
    toast(`Added ${added} standard output${added === 1 ? '' : 's'}.`);
  }
  renderHardwareConfig();
}
function resetTeensyEWMUDevice() {
  const p = profiles[activeIdx];
  const decl = p.drivers?.teensyewmu;
  if (!decl) return;
  if (!confirm('Reset Teensy EWMU config to defaults? This clears the COM port and all DX outputs. Save the profile to persist.')) return;
  decl.devices[0] = teensyEwmuDefaultDevice();
  renderHardwareConfig();
}

// ── Hardware Config — TeensyRWR card ─────────────────────────────────────────
//
// Single-instance driver. Vector-display calibration: COMPort, rotation,
// test-pattern selector, X/Y axis calibration breakpoint tables, centering
// offsets, and scaling factors.
function renderTeensyRWRCardHtml(decl) {
  const meta = DRIVER_META.teensyrwr;
  const dev = decl?.devices?.[0] || teensyRwrDefaultDevice();
  const xPts = dev.xAxisCalibration?.length || 0;
  const yPts = dev.yAxisCalibration?.length || 0;

  const subParts = [
    `COM ${escHtml(dev.comPort || '—')}`,
    `${dev.rotationDegrees}° rotation`,
    `X cal ${xPts} pt${xPts === 1 ? '' : 's'} · Y cal ${yPts} pt${yPts === 1 ? '' : 's'}`,
  ];
  if (dev.testPattern !== 0) subParts.push(`<span style="color:var(--text-info)">test pattern ${dev.testPattern}</span>`);

  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">${subParts.join(' · ')}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('teensyrwr')">Open in OS editor</button>
    </summary>`;

  const body = `
    <div class="hwconfig-card-body">
      <div class="hwconfig-device-section">
        <div class="hwconfig-device-head">
          <div class="hwconfig-device-title">Display configuration</div>
          <button class="btn-sm" onclick="resetTeensyRWRDevice()">Reset to defaults</button>
        </div>

        <div class="hwconfig-section-label">Identity &amp; orientation</div>
        <div class="hwconfig-board-grid">
          <label>COM port
            <input type="text" value="${escHtml(dev.comPort)}" placeholder="COM5"
                   onchange="setTrwrField('comPort', this.value, 'string')"/>
          </label>
          <label>Rotation (°)
            <input type="number" step="any" value="${dev.rotationDegrees}"
                   onchange="setTrwrField('rotationDegrees', this.value, 'float')"/>
          </label>
          <label>Test pattern
            <input type="number" min="0" value="${dev.testPattern}" title="0 = normal RWR drawing, 1 = calibration test pattern; other values reserved"
                   onchange="setTrwrField('testPattern', this.value, 'int')"/>
          </label>
        </div>

        <div class="hwconfig-section-label">Centering offsets (signed; typical range roughly ±4095)</div>
        <div class="hwconfig-board-grid">
          <label>OffsetX
            <input type="number" value="${dev.centering.offsetX}"
                   onchange="setTrwrCentering('offsetX', this.value)"/>
          </label>
          <label>OffsetY
            <input type="number" value="${dev.centering.offsetY}"
                   onchange="setTrwrCentering('offsetY', this.value)"/>
          </label>
        </div>

        <div class="hwconfig-section-label">Scaling factors (typically 0.0–1.0)</div>
        <div class="hwconfig-board-grid">
          <label>ScaleX
            <input type="number" step="any" value="${dev.scaling.scaleX}"
                   onchange="setTrwrScaling('scaleX', this.value)"/>
          </label>
          <label>ScaleY
            <input type="number" step="any" value="${dev.scaling.scaleY}"
                   onchange="setTrwrScaling('scaleY', this.value)"/>
          </label>
        </div>

        ${renderTrwrCalibrationHtml('X-axis calibration breakpoints', 'x', dev.xAxisCalibration)}
        ${renderTrwrCalibrationHtml('Y-axis calibration breakpoints', 'y', dev.yAxisCalibration)}
      </div>
    </div>`;

  return header + body;
}

// Shared helper for X/Y calibration tables (same shape as HenkSDI's
// breakpoint table but simpler — Input/Output doubles, no per-channel mode).
function renderTrwrCalibrationHtml(title, axis, points) {
  const pts = Array.isArray(points) ? points : [];
  const rows = pts.map((p, i) => `
    <div class="hwconfig-cal-row">
      <input type="number" step="any" value="${p.input}"
             onchange="setTrwrCalPoint('${axis}', ${i}, 'input', this.value)"/>
      <input type="number" step="any" value="${p.output}"
             onchange="setTrwrCalPoint('${axis}', ${i}, 'output', this.value)"/>
      <button class="btn-sm btn-danger" onclick="removeTrwrCalPoint('${axis}', ${i})">×</button>
    </div>`).join('');

  return `
    <div class="hwconfig-section-label" style="display:flex;align-items:center;justify-content:space-between">
      <span>${title}</span>
      <span style="display:flex;gap:6px">
        <button class="btn-sm" onclick="resetTrwrCalIdentity('${axis}')" title="Reset to identity (0→0, 4095→4095)">Reset to identity</button>
        <button class="btn-sm btn-primary" onclick="addTrwrCalPoint('${axis}')">+ Add point</button>
      </span>
    </div>
    <div class="hwconfig-cal-block">
      ${pts.length > 0
        ? `<div class="hwconfig-cal-grid">
             <div class="hwconfig-cal-header">
               <div>Input</div><div>Output</div><div></div>
             </div>
             ${rows}
           </div>`
        : `<div class="hwconfig-cal-empty">No breakpoints — straight passthrough.</div>`}
    </div>`;
}

// TeensyRWR edit handlers
function setTrwrField(field, value, kind) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.teensyrwr?.devices?.[0];
  if (!dev) return;
  if (kind === 'string') {
    dev[field] = String(value);
    return;
  }
  // Numeric kinds: 'float' (RotationDegrees) and 'int' (TestPattern). Both
  // accept any finite number; the C# class doesn't clamp either.
  if (value === '' || !Number.isFinite(Number(value))) {
    dev[field] = 0;
  } else {
    const n = Number(value);
    dev[field] = (kind === 'int') ? Math.round(n) : n;
  }
  // Re-render so the header sub-line stays accurate (rotation degrees,
  // test-pattern badge).
  renderHardwareConfig();
}
function setTrwrCentering(field, value) {
  const p = profiles[activeIdx];
  const c = p.drivers?.teensyrwr?.devices?.[0]?.centering;
  if (!c) return;
  // Both fields are short (signed 16-bit) on the C# side. Clamp to the type's
  // range so the saved file can round-trip via XmlSerializer.
  c[field] = intClamp(value, -32768, 32767, c[field]);
}
function setTrwrScaling(field, value) {
  const p = profiles[activeIdx];
  const s = p.drivers?.teensyrwr?.devices?.[0]?.scaling;
  if (!s) return;
  if (value === '' || !Number.isFinite(Number(value))) s[field] = 0;
  else s[field] = Number(value);
}
function getTrwrCalArray(axis) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.teensyrwr?.devices?.[0];
  if (!dev) return null;
  const key = axis === 'x' ? 'xAxisCalibration' : 'yAxisCalibration';
  if (!Array.isArray(dev[key])) dev[key] = [];
  return dev[key];
}
function addTrwrCalPoint(axis) {
  const arr = getTrwrCalArray(axis);
  if (!arr) return;
  // New point splits the gap between the previous-last and 4095, defaulting
  // to identity (input == output) so it sits on the existing curve.
  const last = arr[arr.length - 1];
  const newInput = last ? Math.min(4095, (last.input + 4095) / 2) : 0;
  const rounded = Math.round(newInput);
  arr.push({ input: rounded, output: rounded });
  renderHardwareConfig();
}
function removeTrwrCalPoint(axis, idx) {
  const arr = getTrwrCalArray(axis);
  if (!arr) return;
  arr.splice(idx, 1);
  renderHardwareConfig();
}
function setTrwrCalPoint(axis, idx, field, value) {
  const arr = getTrwrCalArray(axis);
  if (!arr || !arr[idx]) return;
  if (value === '' || !Number.isFinite(Number(value))) arr[idx][field] = 0;
  else arr[idx][field] = Number(value);
}
function resetTrwrCalIdentity(axis) {
  const arr = getTrwrCalArray(axis);
  if (!arr) return;
  if (arr.length > 0 && !confirm(`Replace ${axis.toUpperCase()}-axis calibration with identity (0→0, 4095→4095)? Save the profile to persist.`)) return;
  arr.length = 0;
  arr.push({ input: 0, output: 0 }, { input: 4095, output: 4095 });
  renderHardwareConfig();
}
function resetTeensyRWRDevice() {
  const p = profiles[activeIdx];
  const decl = p.drivers?.teensyrwr;
  if (!decl) return;
  if (!confirm('Reset Teensy RWR config to defaults? This clears the COM port and resets rotation/centering/scaling/calibration. Save the profile to persist.')) return;
  decl.devices[0] = teensyRwrDefaultDevice();
  renderHardwareConfig();
}

// ── Hardware Config — TeensyVectorDrawing card ───────────────────────────────
//
// Same shape as TeensyRWR plus a DeviceType dropdown (RWR/HUD/HMS) selecting
// between vector rendering modes. Reuses the `.hwconfig-cal-grid` styles and
// the breakpoint-table HTML helper from TeensyRWR.
function renderTeensyVectorDrawingCardHtml(decl) {
  const meta = DRIVER_META.teensyvectordrawing;
  const dev = decl?.devices?.[0] || teensyVectorDrawingDefaultDevice();
  const xPts = dev.xAxisCalibration?.length || 0;
  const yPts = dev.yAxisCalibration?.length || 0;

  const subParts = [
    `COM ${escHtml(dev.comPort || '—')}`,
    `${dev.deviceType} mode`,
    `${dev.rotationDegrees}° rotation`,
    `X cal ${xPts} pt${xPts === 1 ? '' : 's'} · Y cal ${yPts} pt${yPts === 1 ? '' : 's'}`,
  ];
  if (dev.testPattern !== 0) subParts.push(`<span style="color:var(--text-info)">test pattern ${dev.testPattern}</span>`);

  const dtOpts = TVD_DEVICE_TYPE_VALUES.map(v =>
    `<option value="${v}" ${dev.deviceType === v ? 'selected' : ''}>${v}</option>`).join('');

  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">${subParts.join(' · ')}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('teensyvectordrawing')">Open in OS editor</button>
    </summary>`;

  const body = `
    <div class="hwconfig-card-body">
      <div class="hwconfig-device-section">
        <div class="hwconfig-device-head">
          <div class="hwconfig-device-title">Display configuration</div>
          <button class="btn-sm" onclick="resetTeensyVectorDrawingDevice()">Reset to defaults</button>
        </div>

        <div class="hwconfig-section-label">Identity &amp; orientation</div>
        <div class="hwconfig-board-grid">
          <label>COM port
            <input type="text" value="${escHtml(dev.comPort)}" placeholder="COM5"
                   onchange="setTvdField('comPort', this.value, 'string')"/>
          </label>
          <label>Device type
            <select onchange="setTvdField('deviceType', this.value, 'enum-device-type')">${dtOpts}</select>
          </label>
          <label>Rotation (°)
            <input type="number" step="any" value="${dev.rotationDegrees}"
                   onchange="setTvdField('rotationDegrees', this.value, 'float')"/>
          </label>
          <label>Test pattern
            <input type="number" min="0" value="${dev.testPattern}" title="0 = normal vector drawing, non-zero = test pattern (specifics depend on device-type firmware)"
                   onchange="setTvdField('testPattern', this.value, 'int')"/>
          </label>
        </div>

        <div class="hwconfig-section-label">Centering offsets (signed; typical range roughly ±4095)</div>
        <div class="hwconfig-board-grid">
          <label>OffsetX
            <input type="number" value="${dev.centering.offsetX}"
                   onchange="setTvdCentering('offsetX', this.value)"/>
          </label>
          <label>OffsetY
            <input type="number" value="${dev.centering.offsetY}"
                   onchange="setTvdCentering('offsetY', this.value)"/>
          </label>
        </div>

        <div class="hwconfig-section-label">Scaling factors (typically 0.0–1.0)</div>
        <div class="hwconfig-board-grid">
          <label>ScaleX
            <input type="number" step="any" value="${dev.scaling.scaleX}"
                   onchange="setTvdScaling('scaleX', this.value)"/>
          </label>
          <label>ScaleY
            <input type="number" step="any" value="${dev.scaling.scaleY}"
                   onchange="setTvdScaling('scaleY', this.value)"/>
          </label>
        </div>

        ${renderTvdCalibrationHtml('X-axis calibration breakpoints', 'x', dev.xAxisCalibration)}
        ${renderTvdCalibrationHtml('Y-axis calibration breakpoints', 'y', dev.yAxisCalibration)}
      </div>
    </div>`;

  return header + body;
}

// Same shape as TeensyRWR's calibration table helper, but routes through
// TVD-specific handlers so axis indexing into the right device works.
function renderTvdCalibrationHtml(title, axis, points) {
  const pts = Array.isArray(points) ? points : [];
  const rows = pts.map((p, i) => `
    <div class="hwconfig-cal-row">
      <input type="number" step="any" value="${p.input}"
             onchange="setTvdCalPoint('${axis}', ${i}, 'input', this.value)"/>
      <input type="number" step="any" value="${p.output}"
             onchange="setTvdCalPoint('${axis}', ${i}, 'output', this.value)"/>
      <button class="btn-sm btn-danger" onclick="removeTvdCalPoint('${axis}', ${i})">×</button>
    </div>`).join('');

  return `
    <div class="hwconfig-section-label" style="display:flex;align-items:center;justify-content:space-between">
      <span>${title}</span>
      <span style="display:flex;gap:6px">
        <button class="btn-sm" onclick="resetTvdCalIdentity('${axis}')" title="Reset to identity (0→0, 4095→4095)">Reset to identity</button>
        <button class="btn-sm btn-primary" onclick="addTvdCalPoint('${axis}')">+ Add point</button>
      </span>
    </div>
    <div class="hwconfig-cal-block">
      ${pts.length > 0
        ? `<div class="hwconfig-cal-grid">
             <div class="hwconfig-cal-header">
               <div>Input</div><div>Output</div><div></div>
             </div>
             ${rows}
           </div>`
        : `<div class="hwconfig-cal-empty">No breakpoints — straight passthrough.</div>`}
    </div>`;
}

// TeensyVectorDrawing edit handlers
function setTvdField(field, value, kind) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.teensyvectordrawing?.devices?.[0];
  if (!dev) return;
  if (kind === 'string') {
    dev[field] = String(value);
    return;
  }
  if (kind === 'enum-device-type') {
    if (TVD_DEVICE_TYPE_VALUES.includes(value)) dev[field] = value;
    renderHardwareConfig();
    return;
  }
  // 'float' / 'int' — numeric coercion + re-render so the header sub-line
  // stays accurate.
  if (value === '' || !Number.isFinite(Number(value))) {
    dev[field] = 0;
  } else {
    const n = Number(value);
    dev[field] = (kind === 'int') ? Math.round(n) : n;
  }
  renderHardwareConfig();
}
function setTvdCentering(field, value) {
  const p = profiles[activeIdx];
  const c = p.drivers?.teensyvectordrawing?.devices?.[0]?.centering;
  if (!c) return;
  c[field] = intClamp(value, -32768, 32767, c[field]);
}
function setTvdScaling(field, value) {
  const p = profiles[activeIdx];
  const s = p.drivers?.teensyvectordrawing?.devices?.[0]?.scaling;
  if (!s) return;
  if (value === '' || !Number.isFinite(Number(value))) s[field] = 0;
  else s[field] = Number(value);
}
function getTvdCalArray(axis) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.teensyvectordrawing?.devices?.[0];
  if (!dev) return null;
  const key = axis === 'x' ? 'xAxisCalibration' : 'yAxisCalibration';
  if (!Array.isArray(dev[key])) dev[key] = [];
  return dev[key];
}
function addTvdCalPoint(axis) {
  const arr = getTvdCalArray(axis);
  if (!arr) return;
  const last = arr[arr.length - 1];
  const newInput = last ? Math.min(4095, (last.input + 4095) / 2) : 0;
  const rounded = Math.round(newInput);
  arr.push({ input: rounded, output: rounded });
  renderHardwareConfig();
}
function removeTvdCalPoint(axis, idx) {
  const arr = getTvdCalArray(axis);
  if (!arr) return;
  arr.splice(idx, 1);
  renderHardwareConfig();
}
function setTvdCalPoint(axis, idx, field, value) {
  const arr = getTvdCalArray(axis);
  if (!arr || !arr[idx]) return;
  if (value === '' || !Number.isFinite(Number(value))) arr[idx][field] = 0;
  else arr[idx][field] = Number(value);
}
function resetTvdCalIdentity(axis) {
  const arr = getTvdCalArray(axis);
  if (!arr) return;
  if (arr.length > 0 && !confirm(`Replace ${axis.toUpperCase()}-axis calibration with identity (0→0, 4095→4095)? Save the profile to persist.`)) return;
  arr.length = 0;
  arr.push({ input: 0, output: 0 }, { input: 4095, output: 4095 });
  renderHardwareConfig();
}
function resetTeensyVectorDrawingDevice() {
  const p = profiles[activeIdx];
  const decl = p.drivers?.teensyvectordrawing;
  if (!decl) return;
  if (!confirm('Reset Teensy Vector Drawing config to defaults? This clears the COM port and resets device type/rotation/centering/scaling/calibration. Save the profile to persist.')) return;
  decl.devices[0] = teensyVectorDrawingDefaultDevice();
  renderHardwareConfig();
}

// ── Hardware Config — NiclasMorin DTS Card card ──────────────────────────────
//
// Multi-device driver. One inner section per declared device with three
// blocks: Identity (Serial), DeadZone (FromDegrees / ToDegrees), and
// CalibrationData breakpoint table (Input / Output double pairs mapping sim
// values → synchro angles in degrees).
//
// Reuses the `.hwconfig-cal-grid` styles from HenkSDI / TeensyRWR for the
// calibration table.
function renderNiclasMorinDTSCardHtml(decl) {
  const meta = DRIVER_META.niclasmorindts;
  const devices = decl?.devices || [];
  const n = devices.length;
  const summary = (() => {
    const addrs = devices.map(d => d.address).filter(Boolean);
    if (addrs.length === 0) return `${n} ${n === 1 ? 'device' : 'devices'}`;
    return `${n} ${n === 1 ? 'device' : 'devices'} · ${addrs.join(', ')}`;
  })();

  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">${escHtml(meta.label)}</div>
        <div class="hwconfig-card-sub">${escHtml(summary)}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('niclasmorindts')">Open in OS editor</button>
    </summary>`;

  const deviceSections = devices.map((dev, idx) =>
    renderNiclasMorinDTSDeviceHtml(dev, idx, n)
  ).join('');

  const body = `<div class="hwconfig-card-body">${deviceSections || '<div class="hwconfig-cal-empty">No devices declared. Add one in the Hardware tab.</div>'}</div>`;
  return header + body;
}

function renderNiclasMorinDTSDeviceHtml(dev, idx, total) {
  const titleText = total > 1 ? `Card #${idx} (${escHtml(dev.address)})` : `Card #${idx}`;
  const calRows = (dev.calibrationData || []).map((p, i) => `
    <div class="hwconfig-cal-row">
      <input type="number" step="any" value="${p.input}"
             onchange="setNmdtsCalPoint(${idx}, ${i}, 'input', this.value)"/>
      <input type="number" step="any" value="${p.output}"
             onchange="setNmdtsCalPoint(${idx}, ${i}, 'output', this.value)"/>
      <button class="btn-sm btn-danger" onclick="removeNmdtsCalPoint(${idx}, ${i})">×</button>
    </div>`).join('');

  return `
    <div class="hwconfig-device-section">
      <div class="hwconfig-device-head">
        <div class="hwconfig-device-title">${titleText}</div>
        <button class="btn-sm" onclick="resetNmdtsDevice(${idx})">Reset to defaults</button>
      </div>

      <div class="hwconfig-section-label">Identity</div>
      <div class="hwconfig-board-grid">
        <label>Serial (used as device address in mappings)
          <input type="text" value="${escHtml(dev.address)}" placeholder="A0000"
                 onchange="setNmdtsField(${idx}, 'address', this.value, 'address')"/>
        </label>
      </div>

      <div class="hwconfig-section-label" title="Synchro angular range to avoid (e.g. mechanical-stop region on a fuel-flow gauge). Set both to 0 to disable.">Dead zone (degrees)</div>
      <div class="hwconfig-board-grid">
        <label>From
          <input type="number" step="any" value="${dev.deadZone.fromDegrees}"
                 onchange="setNmdtsDeadZone(${idx}, 'fromDegrees', this.value)"/>
        </label>
        <label>To
          <input type="number" step="any" value="${dev.deadZone.toDegrees}"
                 onchange="setNmdtsDeadZone(${idx}, 'toDegrees', this.value)"/>
        </label>
      </div>

      <div class="hwconfig-section-label" style="display:flex;align-items:center;justify-content:space-between">
        <span>Calibration breakpoints (input → output synchro angle in degrees)</span>
        <span style="display:flex;gap:6px">
          <button class="btn-sm btn-primary" onclick="addNmdtsCalPoint(${idx})">+ Add point</button>
        </span>
      </div>
      <div class="hwconfig-cal-block">
        ${(dev.calibrationData?.length || 0) > 0
          ? `<div class="hwconfig-cal-grid">
               <div class="hwconfig-cal-header">
                 <div>Input</div><div>Output (deg)</div><div></div>
               </div>
               ${calRows}
             </div>`
          : `<div class="hwconfig-cal-empty">No breakpoints — synchro stays at 0°.</div>`}
      </div>
    </div>`;
}

// NiclasMorinDTS edit handlers
function setNmdtsField(idx, field, value, kind) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.niclasmorindts?.devices?.[idx];
  if (!dev) return;
  if (kind === 'address') {
    // Same wired-channel safety check the Hardware tab applies. The Mappings
    // tab references this driver's devices by their Serial via dst patterns
    // like Niclas_Morin_DTS_Card["A0000"]_..., so changing the serial while
    // edges are wired would orphan them.
    const oldAddr = dev.address;
    const trimmed = String(value).trim();
    if (trimmed && trimmed !== oldAddr) {
      const wired = p.chain.edges.filter(e =>
        e.dstDriver === 'niclasmorindts' && String(e.dstDriverDevice) === oldAddr).length;
      if (wired > 0) {
        toast(`Cannot change DTS serial from ${oldAddr}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it. Unwire first.`);
        renderHardwareConfig();
        return;
      }
    }
    dev.address = trimmed;
    return;
  }
}
function setNmdtsDeadZone(idx, field, value) {
  const p = profiles[activeIdx];
  const dz = p.drivers?.niclasmorindts?.devices?.[idx]?.deadZone;
  if (!dz) return;
  if (value === '' || !Number.isFinite(Number(value))) dz[field] = 0;
  else dz[field] = Number(value);
}
function addNmdtsCalPoint(idx) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.niclasmorindts?.devices?.[idx];
  if (!dev) return;
  if (!Array.isArray(dev.calibrationData)) dev.calibrationData = [];
  // Default new point: split halfway between previous-last and a sensible
  // upper bound (1000), defaulting to identity-ish (input == output * 10).
  // Real-world calibration values are wildly variable (-1000000 to 100000000
  // appear in the sample) so any default is a guess; (0, 0) is the safest.
  dev.calibrationData.push({ input: 0, output: 0 });
  renderHardwareConfig();
}
function removeNmdtsCalPoint(devIdx, ptIdx) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.niclasmorindts?.devices?.[devIdx];
  if (!dev?.calibrationData) return;
  dev.calibrationData.splice(ptIdx, 1);
  renderHardwareConfig();
}
function setNmdtsCalPoint(devIdx, ptIdx, field, value) {
  const p = profiles[activeIdx];
  const pt = p.drivers?.niclasmorindts?.devices?.[devIdx]?.calibrationData?.[ptIdx];
  if (!pt) return;
  if (value === '' || !Number.isFinite(Number(value))) pt[field] = 0;
  else pt[field] = Number(value);
}
function resetNmdtsDevice(idx) {
  const p = profiles[activeIdx];
  const decl = p.drivers?.niclasmorindts;
  const dev = decl?.devices?.[idx];
  if (!dev) return;
  if (!confirm(`Reset DTS Card #${idx} to defaults? This clears the dead zone and calibration breakpoints. Serial is preserved (changing it would orphan wired channels). Save the profile to persist.`)) return;
  // Preserve the serial — losing it would orphan every wired channel.
  const keptAddress = dev.address;
  decl.devices[idx] = niclasMorinDtsDefaultDevice();
  decl.devices[idx].address = keptAddress;
  renderHardwareConfig();
}

// ── Hardware Config — AD edit handlers ───────────────────────────────────────
// Each handler clamps the value into the field's hardware register range and
// updates p.drivers.analogdevices in place. We intentionally don't re-render
// the whole tab on every keystroke — the <input>'s native value already shows
// the user's input correctly, and re-rendering 40 rows on each keystroke
// would lose focus mid-edit. The save flow reads from the in-memory state.
function setAdField(deviceIdx, field, value) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.analogdevices?.devices?.[deviceIdx];
  if (!dev) return;
  if (field === 'dacPrecision' && (value === 'SixteenBit' || value === 'FourteenBit')) {
    dev.dacPrecision = value;
  }
}
function setAdNumber(deviceIdx, field, value, max) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.analogdevices?.devices?.[deviceIdx];
  if (!dev) return;
  dev[field] = adClamp(value, max, dev[field]);
}
function setAdChannel(deviceIdx, channelIdx, field, value) {
  const p = profiles[activeIdx];
  const ch = p.drivers?.analogdevices?.devices?.[deviceIdx]?.channels?.[channelIdx];
  if (!ch) return;
  ch[field] = adClamp(value, 65535, ch[field]);
}
function resetAnalogDevicesDevice(deviceIdx) {
  const p = profiles[activeIdx];
  const dev = p.drivers?.analogdevices?.devices?.[deviceIdx];
  if (!dev) return;
  if (!confirm(`Reset Card #${deviceIdx} to default values? This clears all calibration on this device — channels and board offsets revert to factory defaults. Save the profile to persist.`)) return;
  Object.assign(dev, AD_DEVICE_DEFAULTS);
  dev.channels = Array.from({ length: 40 }, () => ({ ...AD_CHANNEL_DEFAULTS }));
  renderHardwareConfig();
}

// "Open in OS editor" / "Open raw XML" shared handler. For AD, the editor is
// authoritative — write the current in-memory state to disk first, then open
// it so the user sees what the editor would have saved. For other drivers
// (no structured editor yet), open the on-disk file as-is, creating a stub
// from a generated default if the file doesn't exist.
async function openDriverConfigFile(driverId) {
  const p = profiles[activeIdx];
  if (!p) return;
  if (!mappingDir) {
    toast('Select a profile directory first.');
    return;
  }
  const meta = DRIVER_META[driverId];
  if (!meta?.configFilename) {
    toast(`No config file is associated with ${meta?.label || driverId}.`);
    return;
  }
  const profileDir = mappingDir + '/' + p.name;

  // Default content depends on the driver. For AD we author from current state
  // so a freshly-opened file reflects what the editor would save.
  let defaultContent = '';
  if (driverId === 'analogdevices' && p.drivers?.analogdevices) {
    defaultContent = renderAnalogDevicesConfig(p.drivers.analogdevices);
  } else {
    // Minimal placeholder — the user is expected to fill it in from SimLinkup
    // sample profiles. Driver-specific roots match what the C# class expects.
    const rootByDriver = {
      henksdi:             'HenkSDIHardwareSupportModuleConfig',
      henkquadsincos:      'HenkieQuadSinCosHardwareSupportModuleConfig',
      phcc:                'PhccHardwareSupportModuleConfig',
      arduinoseat:         'ArduinoSeatHardwareSupportModuleConfig',
      niclasmorindts:      'DTSCardHardwareSupportModuleConfig',
      teensyewmu:          'TeensyEWMUHardwareSupportModuleConfig',
      teensyrwr:           'TeensyRWRHardwareSupportModuleConfig',
      teensyvectordrawing: 'TeensyVectorDrawingHardwareSupportModuleConfig',
    };
    const root = rootByDriver[driverId] || `${driverId}Config`;
    defaultContent = `<?xml version="1.0"?>\n<${root} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n  <!-- Edit this file manually. See SimLinkup sample profiles for examples. -->\n</${root}>\n`;
  }

  const result = await window.api.openDriverConfig({
    profileDir,
    filename: meta.configFilename,
    defaultContent,
  });
  if (!result?.success) {
    toast(`Could not open ${meta.configFilename}: ${result?.error || 'unknown error'}`);
  }
}

// ── Hardware Config — PoKeys card ────────────────────────────────────────────
//
// Multi-device output driver (one <Device> per physical PoKeys57 board,
// addressed by serial). Per-device editor exposes:
//   - Identity: Serial (uint), Name (free-form label), PWM period in microseconds.
//   - Digital outputs: list of {pin, invert} rows. + Add row. Disable Pin
//     options that are already in use on this device.
//   - PWM outputs: list of {channel} rows. + Add row. Disable channel
//     options already in use.
//
// The card is shared between the `pokeys_digital` and `pokeys_pwm` driver
// ids — they share `decl` by reference (see parseDriverConfigs +
// toggleDriver), and renderHardwareConfig dedupes so only one card
// appears even when both are declared.
function renderPoKeysCardHtml(decl) {
  const meta = DRIVER_META.pokeys_digital;
  const devices = decl?.devices || [];
  const n = devices.length;
  const summary = (() => {
    const labels = devices.map(d => {
      const addr = String(d.address ?? '').trim();
      const name = String(d.name ?? '').trim();
      if (addr && name) return `${name} (${addr})`;
      if (addr) return addr;
      if (name) return name;
      return '<unnamed>';
    });
    if (labels.length === 0) return '0 devices';
    return `${n} ${n === 1 ? 'device' : 'devices'} · ${labels.join(', ')}`;
  })();

  const header = `
    <summary class="hwconfig-card-head">
      <span class="hwconfig-card-chevron">▶</span>
      <div class="hwconfig-card-headline">
        <div class="hwconfig-card-title">PoKeys (digital pins + PWM)</div>
        <div class="hwconfig-card-sub">${escHtml(summary)}</div>
      </div>
      <button class="btn-sm" onclick="event.preventDefault(); event.stopPropagation(); openDriverConfigFile('pokeys_digital')">Open in OS editor</button>
    </summary>`;

  const deviceSections = devices.map((dev, idx) =>
    renderPoKeysDeviceHtml(dev, idx, n)
  ).join('');

  return header + `<div class="hwconfig-card-body">${deviceSections}</div>`;
}

function renderPoKeysDeviceHtml(dev, idx, total) {
  const titleText = total > 1
    ? `Board #${idx + 1} (serial ${escHtml(String(dev.address ?? ''))})`
    : `Board #${idx + 1}`;

  // Build pin dropdown options that disable pins already used on THIS
  // device — clicking them otherwise creates duplicates that the C# HSM
  // would silently last-write-wins. The current row's own pin stays
  // enabled so the user can still re-pick it.
  const usedDigitalPins = new Set(
    (dev.digitalOutputs || []).map(o => Number(o.pin))
  );
  const buildPinOptions = (currentPin) => {
    let opts = '';
    for (let p = 1; p <= 55; p++) {
      const used = usedDigitalPins.has(p) && p !== Number(currentPin);
      opts += `<option value="${p}" ${p === Number(currentPin) ? 'selected' : ''} ${used ? 'disabled' : ''}>${p}${used ? ' (in use)' : ''}</option>`;
    }
    return opts;
  };

  const usedPWMChannels = new Set(
    (dev.pwmOutputs || []).map(o => Number(o.channel))
  );
  const buildPWMChannelOptions = (currentChannel) => {
    let opts = '';
    for (let c = 1; c <= 6; c++) {
      const used = usedPWMChannels.has(c) && c !== Number(currentChannel);
      const physicalPin = 16 + c;
      opts += `<option value="${c}" ${c === Number(currentChannel) ? 'selected' : ''} ${used ? 'disabled' : ''}>PWM${c} (pin ${physicalPin})${used ? ' — in use' : ''}</option>`;
    }
    return opts;
  };

  // Digital outputs list
  const digitalOuts = dev.digitalOutputs || [];
  const digitalRows = digitalOuts.map((o, oi) => `
    <div class="hwconfig-pokeys-row">
      <label>Pin
        <select onchange="setPokeysDigitalField(${idx}, ${oi}, 'pin', this.value)">
          ${buildPinOptions(o.pin)}
        </select>
      </label>
      <label class="hwconfig-pokeys-invert">
        <input type="checkbox" ${o.invert ? 'checked' : ''}
               onchange="setPokeysDigitalField(${idx}, ${oi}, 'invert', this.checked)"/>
        <span>Invert (state=true → pin sources 3.3 V)</span>
      </label>
      <button class="btn-sm btn-danger" onclick="removePokeysDigitalOutput(${idx}, ${oi})">×</button>
    </div>`).join('');
  const allDigitalUsed = usedDigitalPins.size >= 55;

  // PWM outputs list
  const pwmOuts = dev.pwmOutputs || [];
  const pwmRows = pwmOuts.map((o, oi) => `
    <div class="hwconfig-pokeys-row">
      <label>Channel
        <select onchange="setPokeysPWMField(${idx}, ${oi}, 'channel', this.value)">
          ${buildPWMChannelOptions(o.channel)}
        </select>
      </label>
      <button class="btn-sm btn-danger" onclick="removePokeysPWMOutput(${idx}, ${oi})">×</button>
    </div>`).join('');
  const allPWMUsed = usedPWMChannels.size >= 6;

  return `
    <div class="hwconfig-device-section">
      <div class="hwconfig-device-head">
        <div class="hwconfig-device-title">${titleText}</div>
        <button class="btn-sm" onclick="resetPokeysDevice(${idx})">Reset to defaults</button>
      </div>
      <div class="hwconfig-section-label">Identity</div>
      <div class="hwconfig-board-grid">
        <label>Serial
          <input type="text" value="${escHtml(String(dev.address ?? ''))}"
                 placeholder="12345"
                 onchange="setPokeysField(${idx}, 'address', this.value)"/>
        </label>
        <label>Name (optional)
          <input type="text" value="${escHtml(String(dev.name ?? ''))}"
                 placeholder="cockpit-left"
                 onchange="setPokeysField(${idx}, 'name', this.value)"/>
        </label>
        <label>PWM period (μs)
          <input type="number" min="1" step="1" value="${dev.pwmPeriodMicroseconds ?? 20000}"
                 onchange="setPokeysField(${idx}, 'pwmPeriodMicroseconds', this.value)"/>
        </label>
      </div>

      <div class="hwconfig-section-label">Digital outputs</div>
      ${digitalRows || '<div class="hwconfig-empty-row">No digital outputs declared.</div>'}
      <button class="btn-sm btn-primary" ${allDigitalUsed ? 'disabled' : ''}
              onclick="addPokeysDigitalOutput(${idx})">+ Add digital output</button>

      <div class="hwconfig-section-label" style="margin-top:12px">PWM outputs</div>
      ${pwmRows || '<div class="hwconfig-empty-row">No PWM channels declared.</div>'}
      <button class="btn-sm btn-primary" ${allPWMUsed ? 'disabled' : ''}
              onclick="addPokeysPWMOutput(${idx})">+ Add PWM channel</button>
    </div>`;
}

// PoKeys mutators. Each one reads the shared decl (under either driver
// id — they're literally the same object reference) and re-renders so
// the dropdown disabled-state and summary line refresh.
function pokeysSharedDecl() {
  const p = profiles[activeIdx];
  return p.drivers?.pokeys_digital || p.drivers?.pokeys_pwm || null;
}

function setPokeysField(deviceIdx, field, value) {
  const decl = pokeysSharedDecl();
  const dev = decl?.devices?.[deviceIdx];
  if (!dev) return;
  if (field === 'address') {
    const oldAddr = dev.address;
    const trimmed = String(value).trim();
    if (trimmed && trimmed !== oldAddr) {
      // Refuse if anything is wired to either driver-id-flavour with the
      // current serial — changing serial would orphan those edges.
      const p = profiles[activeIdx];
      const wired = p.chain.edges.filter(e =>
        (e.dstDriver === 'pokeys_digital' || e.dstDriver === 'pokeys_pwm') &&
        String(e.dstDriverDevice) === String(oldAddr)
      ).length;
      if (wired > 0) {
        toast(`Cannot change PoKeys serial from ${oldAddr}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it. Unwire first.`);
        renderHardwareConfig();
        return;
      }
    }
    dev.address = trimmed;
    return;
  }
  if (field === 'name') {
    dev.name = String(value);
    return;
  }
  if (field === 'pwmPeriodMicroseconds') {
    const n = parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) dev.pwmPeriodMicroseconds = n;
    return;
  }
}

function addPokeysDigitalOutput(deviceIdx) {
  const decl = pokeysSharedDecl();
  const dev = decl?.devices?.[deviceIdx];
  if (!dev) return;
  if (!Array.isArray(dev.digitalOutputs)) dev.digitalOutputs = [];
  // Pick the lowest unused pin so the user doesn't have to re-pick the
  // dropdown in the common case of declaring pins in order.
  const used = new Set(dev.digitalOutputs.map(o => Number(o.pin)));
  let pin = 1;
  while (pin <= 55 && used.has(pin)) pin++;
  if (pin > 55) {
    toast('All 55 digital pins are already declared on this board.');
    return;
  }
  dev.digitalOutputs.push({ pin, invert: true });
  renderHardwareConfig();
}

function removePokeysDigitalOutput(deviceIdx, outIdx) {
  const decl = pokeysSharedDecl();
  const dev = decl?.devices?.[deviceIdx];
  if (!dev || !Array.isArray(dev.digitalOutputs)) return;
  const out = dev.digitalOutputs[outIdx];
  if (!out) return;
  // Refuse if a channel is wired to this pin so we don't silently
  // orphan an edge.
  const p = profiles[activeIdx];
  const wired = p.chain.edges.filter(e =>
    e.dstDriver === 'pokeys_digital' &&
    String(e.dstDriverDevice) === String(dev.address) &&
    e.dstDriverChannel === `DIGITAL_PIN[${out.pin}]`
  ).length;
  if (wired > 0) {
    toast(`Cannot remove pin ${out.pin}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it. Unwire first.`);
    return;
  }
  dev.digitalOutputs.splice(outIdx, 1);
  renderHardwareConfig();
}

function setPokeysDigitalField(deviceIdx, outIdx, field, value) {
  const decl = pokeysSharedDecl();
  const out = decl?.devices?.[deviceIdx]?.digitalOutputs?.[outIdx];
  if (!out) return;
  if (field === 'pin') {
    const newPin = parseInt(value, 10);
    if (newPin < 1 || newPin > 55) return;
    if (out.pin !== newPin) {
      // Same orphan-protection as the remove path — if a channel is
      // wired to the OLD pin, forbid the change.
      const p = profiles[activeIdx];
      const dev = decl.devices[deviceIdx];
      const wired = p.chain.edges.filter(e =>
        e.dstDriver === 'pokeys_digital' &&
        String(e.dstDriverDevice) === String(dev.address) &&
        e.dstDriverChannel === `DIGITAL_PIN[${out.pin}]`
      ).length;
      if (wired > 0) {
        toast(`Cannot change pin ${out.pin}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it. Unwire first.`);
        renderHardwareConfig();
        return;
      }
      out.pin = newPin;
      renderHardwareConfig();
    }
    return;
  }
  if (field === 'invert') {
    out.invert = !!value;
    return;
  }
}

function addPokeysPWMOutput(deviceIdx) {
  const decl = pokeysSharedDecl();
  const dev = decl?.devices?.[deviceIdx];
  if (!dev) return;
  if (!Array.isArray(dev.pwmOutputs)) dev.pwmOutputs = [];
  const used = new Set(dev.pwmOutputs.map(o => Number(o.channel)));
  let channel = 1;
  while (channel <= 6 && used.has(channel)) channel++;
  if (channel > 6) {
    toast('All 6 PWM channels are already declared on this board.');
    return;
  }
  dev.pwmOutputs.push({ channel });
  renderHardwareConfig();
}

function removePokeysPWMOutput(deviceIdx, outIdx) {
  const decl = pokeysSharedDecl();
  const dev = decl?.devices?.[deviceIdx];
  if (!dev || !Array.isArray(dev.pwmOutputs)) return;
  const out = dev.pwmOutputs[outIdx];
  if (!out) return;
  const p = profiles[activeIdx];
  const wired = p.chain.edges.filter(e =>
    e.dstDriver === 'pokeys_pwm' &&
    String(e.dstDriverDevice) === String(dev.address) &&
    e.dstDriverChannel === `PWM[${out.channel}]`
  ).length;
  if (wired > 0) {
    toast(`Cannot remove PWM${out.channel}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it. Unwire first.`);
    return;
  }
  dev.pwmOutputs.splice(outIdx, 1);
  renderHardwareConfig();
}

function setPokeysPWMField(deviceIdx, outIdx, field, value) {
  const decl = pokeysSharedDecl();
  const out = decl?.devices?.[deviceIdx]?.pwmOutputs?.[outIdx];
  if (!out) return;
  if (field === 'channel') {
    const newCh = parseInt(value, 10);
    if (newCh < 1 || newCh > 6) return;
    if (out.channel !== newCh) {
      const p = profiles[activeIdx];
      const dev = decl.devices[deviceIdx];
      const wired = p.chain.edges.filter(e =>
        e.dstDriver === 'pokeys_pwm' &&
        String(e.dstDriverDevice) === String(dev.address) &&
        e.dstDriverChannel === `PWM[${out.channel}]`
      ).length;
      if (wired > 0) {
        toast(`Cannot change PWM${out.channel}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it. Unwire first.`);
        renderHardwareConfig();
        return;
      }
      out.channel = newCh;
      renderHardwareConfig();
    }
  }
}

function resetPokeysDevice(deviceIdx) {
  const decl = pokeysSharedDecl();
  const dev = decl?.devices?.[deviceIdx];
  if (!dev) return;
  if (!confirm(`Reset PoKeys Board #${deviceIdx + 1} to default values? This wipes the digital and PWM output lists. Save the profile to persist.`)) return;
  // Preserve serial — losing it would orphan wired channels.
  const keptAddress = dev.address;
  decl.devices[deviceIdx] = poKeysDefaultDevice();
  decl.devices[deviceIdx].address = keptAddress;
  renderHardwareConfig();
}
