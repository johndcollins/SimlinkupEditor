// ── Hardware tab ─────────────────────────────────────────────────────────────
//
// Catalog of output drivers the editor knows about. Click "+ Add" to declare
// a driver; the card expands to show the device list (count for AD, address
// list for HenkSDI/HenkQuadSinCos, single-instance for the rest). Removing a
// driver while channels are wired to it is refused with a warning so the user
// knows to unwire first.
function renderHardware() {
  const pane = document.getElementById('pane-hardware');
  if (!pane) return;
  const p = profiles[activeIdx];
  const driverIds = Object.keys(DRIVER_META).sort((a, b) =>
    DRIVER_META[a].label.localeCompare(DRIVER_META[b].label));
  const channelCounts = new Map();
  for (const e of p.chain.edges) {
    if (!e.dstDriver) continue;
    channelCounts.set(e.dstDriver, (channelCounts.get(e.dstDriver) || 0) + 1);
  }
  pane.innerHTML = `
    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
      Declare which hardware drivers this profile loads. Each driver becomes a
      <code>&lt;Module&gt;</code> entry in <code>HardwareSupportModule.registry</code>.
      For drivers that support multiple devices (DAC boards, SDI cards), set
      the device count or addresses on the card.
    </div>
    <div id="hardwareCards" class="inst-grid"></div>`;
  const container = document.getElementById('hardwareCards');
  for (const id of driverIds) container.appendChild(renderHardwareCard(id, channelCounts.get(id) || 0));
}

function renderHardwareCard(driverId, channelsWired) {
  const p = profiles[activeIdx];
  const meta = DRIVER_META[driverId];
  const declared = !!p.drivers[driverId];
  const decl = p.drivers[driverId];
  const card = document.createElement('div');
  card.className = 'inst-card' + (declared ? ' added' : '');

  const headerHtml = `
    <div class="inst-card-top">
      <div class="inst-pn">${escHtml(driverId)}</div>
      <button class="btn-sm ${declared ? 'btn-danger' : 'btn-primary'}"
              onclick="toggleDriver('${driverId}')">${declared ? 'Remove' : '+ Add'}</button>
    </div>
    <div class="inst-name">${escHtml(meta.label)}</div>`;

  let bodyHtml = '';
  if (declared) {
    if (meta.deviceShape === 'count') {
      const n = decl.devices.length;
      bodyHtml = `
        <div class="hw-device-block">
          <div class="hw-device-row">
            <span style="font-size:11px;color:var(--text)">${n} ${n === 1 ? 'board' : 'boards'}</span>
            <div style="display:flex;gap:4px">
              <button class="btn-sm" onclick="removeDriverDevice('${driverId}', ${n - 1})" ${n <= 1 ? 'disabled' : ''}>−</button>
              <button class="btn-sm btn-primary" onclick="addDriverDevice('${driverId}')">+</button>
            </div>
          </div>
        </div>`;
    } else if (meta.deviceShape === 'address') {
      // Per-driver placeholder — most address-shape drivers use I²C-style
      // hex addresses (HenkSDI/HenkQuadSinCos/NiclasMorinDTS), but PoKeys
      // is addressed by USB device serial number which is a plain integer
      // visible on the board's silkscreen and in the PoKeys vendor tool.
      const placeholder = driverId === 'pokeys' ? '52153 (serial)' : '0x30';
      const rows = decl.devices.map((d, idx) => `
        <div class="hw-device-row">
          <input type="text" value="${escHtml(d.address ?? '')}"
                 onchange="setDriverDeviceAddress('${driverId}', ${idx}, this.value)"
                 placeholder="${escHtml(placeholder)}" style="flex:1;font-family:var(--font-mono);font-size:11px"/>
          <button class="btn-sm btn-danger" onclick="removeDriverDevice('${driverId}', ${idx})">×</button>
        </div>`).join('');
      bodyHtml = `
        <div class="hw-device-block">
          ${rows}
          <button class="btn-sm btn-primary" style="margin-top:6px"
                  onclick="addDriverDevice('${driverId}')">+ Add device</button>
        </div>`;
    } else {
      bodyHtml = `<div class="hw-device-block" style="font-size:11px;color:var(--text-secondary);font-style:italic">single instance — no device list</div>`;
    }
    if (channelsWired > 0) {
      bodyHtml += `<div style="font-size:10px;color:var(--text-secondary);margin-top:4px">${channelsWired} channel${channelsWired === 1 ? '' : 's'} wired to this driver</div>`;
    }
  }

  card.innerHTML = headerHtml + bodyHtml;
  return card;
}

function toggleDriver(driverId) {
  const p = profiles[activeIdx];
  if (p.drivers[driverId]) {
    const wired = p.chain.edges.filter(e => e.dstDriver === driverId).length;
    if (wired > 0) {
      toast(`Cannot remove ${DRIVER_META[driverId].label}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it. Unwire them in Signal mappings first.`);
      return;
    }
    delete p.drivers[driverId];
  } else {
    p.drivers[driverId] = { devices: [DRIVER_META[driverId].defaultDevice()] };
  }
  renderEditor();
}

function addDriverDevice(driverId) {
  const p = profiles[activeIdx];
  const decl = p.drivers[driverId];
  if (!decl) return;
  decl.devices.push(DRIVER_META[driverId].defaultDevice());
  renderEditor();
}

function removeDriverDevice(driverId, idx) {
  const p = profiles[activeIdx];
  const decl = p.drivers[driverId];
  if (!decl) return;
  if (decl.devices.length <= 1) {
    toast(`At least one device is required while ${DRIVER_META[driverId].label} is declared. Remove the driver itself instead.`);
    return;
  }
  const meta = DRIVER_META[driverId];
  const dev = decl.devices[idx];
  // Identity used in edges' dstDriverDevice: address-shape uses the
  // address field; count-shape normally uses the index, but PoKeys
  // is the exception (count-shape for declaration but addressed by
  // serial in signal ids — see DRIVER_META.pokeys comment).
  const targetValue = meta.deviceShape === 'address'
    ? dev.address
    : (driverId === 'pokeys' ? dev.address : String(idx));
  const wired = p.chain.edges.filter(e =>
    e.dstDriver === driverId && String(e.dstDriverDevice) === String(targetValue ?? '')
  ).length;
  if (wired > 0) {
    toast(`Cannot remove device ${targetValue || '#' + idx}: ${wired} channel${wired === 1 ? ' is' : 's are'} wired to it.`);
    return;
  }
  decl.devices.splice(idx, 1);
  renderEditor();
}

function setDriverDeviceAddress(driverId, idx, address) {
  const p = profiles[activeIdx];
  const decl = p.drivers[driverId];
  if (!decl) return;
  const oldAddr = decl.devices[idx].address;
  if (address !== oldAddr) {
    const wired = p.chain.edges.filter(e =>
      e.dstDriver === driverId && String(e.dstDriverDevice) === String(oldAddr)
    ).length;
    if (wired > 0) {
      toast(`Cannot change address from ${oldAddr}: ${wired} channel${wired === 1 ? ' is' : 's are'} still wired to it. Unwire first.`);
      renderEditor();  // revert input
      return;
    }
  }
  decl.devices[idx].address = address.trim();
}
