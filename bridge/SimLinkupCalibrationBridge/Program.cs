using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using PoKeysDevice_DLL;
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace SimLinkupCalibrationBridge
{
    // Long-running stdio host. The Electron editor spawns this once when the
    // user opens a Calibration tab and keeps it alive until the editor
    // closes. Each line on stdin is one JSON command; each line on stdout
    // is the JSON response for the previous command. No back-channel
    // events; the protocol is strictly request/response so the renderer
    // can `await` each call and surface errors inline.
    //
    // Protocol (one JSON object per line, both directions):
    //
    //   ─→ { "id": "1", "cmd": "ping" }
    //   ←─ { "id": "1", "ok": true }
    //
    //   ─→ { "id": "2", "cmd": "isSimRunning", "sim": "falcon4" }
    //   ←─ { "id": "2", "ok": true, "running": false }
    //
    //   ─→ { "id": "3", "cmd": "startSession", "sim": "falcon4" }
    //   ←─ { "id": "3", "ok": true }
    //   or
    //   ←─ { "id": "3", "ok": false, "error": "Falcon BMS is currently running. ..." }
    //
    //   ─→ { "id": "4", "cmd": "setSignals", "sim": "falcon4",
    //                   "signals": { "F4_RPM1__RPM_PERCENT": 75.0 } }
    //   ←─ { "id": "4", "ok": true, "unknown": [] }
    //
    //   ─→ { "id": "4b", "cmd": "getSignals", "sim": "falcon4",
    //                    "ids": ["F4_RPM1__RPM_PERCENT","F4_FTIT1__FTIT_TEMP_DEG_CELCIUS"] }
    //   ←─ { "id": "4b", "ok": true,
    //         "values": { "F4_RPM1__RPM_PERCENT": 75.0, "F4_FTIT1__FTIT_TEMP_DEG_CELCIUS": 850.0 },
    //         "unknown": [] }
    //
    //   ─→ { "id": "5", "cmd": "endSession", "sim": "falcon4" }
    //   ←─ { "id": "5", "ok": true }
    //
    // PoKeys USB + Ethernet device enumeration (stateless — no sim, no
    // session). Network discovery has a 2 s timeout so the call
    // doesn't hang on networks with no PoKeys devices listening but
    // still has time to find boards across subnets.
    //
    //   ─→ { "id": "6", "cmd": "pokeys.enumerate" }
    //   ←─ { "id": "6", "ok": true,
    //         "devices": [
    //           { "serial": 52153, "userId": 0, "name": "PoKeys57U",
    //             "hwName": "57U", "firmware": "4.7.15",
    //             "connection": "usb" },
    //           { "serial": 12345, "userId": 1, "name": "Cockpit",
    //             "hwName": "57E", "firmware": "4.7.15",
    //             "connection": "network" },
    //           ...
    //         ] }
    //
    // SimLinkup process-running check via a kernel mutex SimLinkup
    // creates at startup (Local\\SimLinkupRunning). Returns instantly
    // (microseconds) — replaces the previous tasklist shellout which
    // was taking ~3 s on machines with AV process-enumeration hooks.
    //
    //   ─→ { "id": "7", "cmd": "system.isSimLinkupRunning" }
    //   ←─ { "id": "7", "ok": true, "running": false }
    //
    //   ─→ { "id": "8", "cmd": "shutdown" }
    //   ←─ { "id": "8", "ok": true }   (then exit 0)
    //
    // Errors and exceptions in the bridge surface as { ok: false, error: "..." }
    // — never as exit codes. A non-zero exit only happens on truly catastrophic
    // failures (unhandled exception in the read loop, stdin closed unexpectedly).
    internal static class Program
    {
        private static int Main(string[] args)
        {
            // stdin/stdout already wired by the parent; no setup required
            // beyond setting line discipline. UTF-8 on stdout is implicit
            // for Console.WriteLine on .NET Framework 4.8 + Windows when
            // encoding is left as default — Electron's child_process API
            // hands us bytes either way. We write JSON ASCII so encoding
            // doesn't matter.
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);

            try
            {
                RunLoop();
                return 0;
            }
            catch (Exception ex)
            {
                // Fatal — log to stderr (parent captures it) and exit non-zero.
                Console.Error.WriteLine($"Bridge fatal: {ex.GetType().Name}: {ex.Message}");
                return 1;
            }
            finally
            {
                SimRegistry.DisposeAll();
            }
        }

        private static void RunLoop()
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                line = line?.Trim();
                if (string.IsNullOrEmpty(line)) continue;

                JObject request;
                try
                {
                    request = JObject.Parse(line);
                }
                catch (JsonException jex)
                {
                    EmitError(null, $"Invalid JSON: {jex.Message}");
                    continue;
                }

                var id  = (string)request["id"];
                var cmd = (string)request["cmd"];
                if (string.IsNullOrEmpty(cmd))
                {
                    EmitError(id, "Missing 'cmd' field.");
                    continue;
                }

                try
                {
                    var response = Dispatch(id, cmd, request);
                    Emit(response);
                    if (cmd == "shutdown") return;
                }
                catch (Exception ex)
                {
                    EmitError(id, $"{ex.GetType().Name}: {ex.Message}");
                }
            }
        }

        private static JObject Dispatch(string id, string cmd, JObject req)
        {
            // Shared bag that every response includes for caller correlation.
            var resp = new JObject { ["id"] = id };

            switch (cmd)
            {
                case "ping":
                    resp["ok"]      = true;
                    resp["version"] = "1.0.0";
                    return resp;

                case "isSimRunning":
                {
                    var sim = (string)req["sim"];
                    var bridge = SimRegistry.Get(sim);
                    if (bridge == null) return ErrorResp(id, $"Unknown sim '{sim}'.");
                    resp["ok"]      = true;
                    resp["running"] = bridge.IsSimRunning();
                    return resp;
                }

                case "startSession":
                {
                    var sim = (string)req["sim"];
                    var bridge = SimRegistry.Get(sim);
                    if (bridge == null) return ErrorResp(id, $"Unknown sim '{sim}'.");
                    // Opt-in escape hatch for callers that don't care
                    // about the sim overwriting written values — the
                    // PoKeys test path uses this because it only needs
                    // SimLinkup to see the value briefly to drive the
                    // relay. The live-calibration path keeps the
                    // default guard (sim running == values get
                    // clobbered on next tick == calibration is
                    // useless).
                    bool allowSimRunning = req["allowSimRunning"]?.ToObject<bool>() ?? false;
                    if (!allowSimRunning && bridge.IsSimRunning())
                    {
                        return ErrorResp(id,
                            "The sim's runtime process is currently running. " +
                            "Close it before starting a calibration session — the " +
                            "live sim would overwrite calibration values on every " +
                            "tick.");
                    }
                    bridge.OpenSession();
                    resp["ok"] = true;
                    return resp;
                }

                case "setSignals":
                {
                    var sim = (string)req["sim"];
                    var bridge = SimRegistry.Get(sim);
                    if (bridge == null) return ErrorResp(id, $"Unknown sim '{sim}'.");
                    var signalsObj = req["signals"] as JObject;
                    if (signalsObj == null) return ErrorResp(id, "Missing 'signals' object.");

                    var signals = new Dictionary<string, double>();
                    foreach (var prop in signalsObj.Properties())
                    {
                        if (prop.Value.Type == JTokenType.Float || prop.Value.Type == JTokenType.Integer)
                        {
                            signals[prop.Name] = prop.Value.Value<double>();
                        }
                        else if (prop.Value.Type == JTokenType.Boolean)
                        {
                            // Allow boolean → 1/0 mapping for digital signals.
                            signals[prop.Name] = prop.Value.Value<bool>() ? 1.0 : 0.0;
                        }
                        // Skip anything else silently — caller should only send numbers/bools.
                    }

                    var unknown = bridge.WriteSignals(signals);
                    resp["ok"]      = true;
                    resp["unknown"] = new JArray(unknown);
                    return resp;
                }

                case "getSignals":
                {
                    var sim = (string)req["sim"];
                    var bridge = SimRegistry.Get(sim);
                    if (bridge == null) return ErrorResp(id, $"Unknown sim '{sim}'.");
                    var idsArr = req["ids"] as JArray;
                    if (idsArr == null) return ErrorResp(id, "Missing 'ids' array.");
                    var idsList = new List<string>();
                    foreach (var t in idsArr) idsList.Add((string)t);

                    var values = new Dictionary<string, double>();
                    var unknown = bridge.ReadSignals(idsList, values);

                    var valuesObj = new JObject();
                    foreach (var kv in values) valuesObj[kv.Key] = kv.Value;
                    resp["ok"]      = true;
                    resp["values"]  = valuesObj;
                    resp["unknown"] = new JArray(unknown);
                    return resp;
                }

                case "endSession":
                {
                    var sim = (string)req["sim"];
                    var bridge = SimRegistry.Get(sim);
                    if (bridge == null) return ErrorResp(id, $"Unknown sim '{sim}'.");
                    bridge.CloseSession();
                    resp["ok"] = true;
                    return resp;
                }

                case "pokeys.enumerate":
                {
                    // Scan for plugged-in PoKeys devices on USB AND
                    // Ethernet. Stateless request/response — no
                    // session lifecycle, no dependency on a running
                    // sim. The DLL does the USB enumeration
                    // synchronously (<100 ms with a few boards). For
                    // the network scan, the DLL broadcasts a discovery
                    // packet and waits ethernetDiscoveryTimeout
                    // milliseconds for responses; 2000 ms is enough
                    // for cross-subnet discovery on busy networks
                    // while staying inside the bridge's 5 s request
                    // timeout (main.js bridgeRequest).
                    //
                    // Connect-and-disconnect-per-call is deliberate:
                    // the editor is a casual consumer (one click of
                    // Detect now and then, not continuous output drive)
                    // so holding the device handle would needlessly
                    // lock it out from other apps — the PoKeys vendor
                    // tool, a separately running SimLinkup, etc. Each
                    // enumerate call grabs a fresh connection only
                    // long enough to read the device list, then
                    // releases. The DLL's EnumeratePoKeysDevices does
                    // its own per-device connect/disconnect internally;
                    // we still call DisconnectDevice() on the local
                    // instance afterward as belt-and-suspenders.
                    PoKeysDevice device = null;
                    try
                    {
                        device = new PoKeysDevice();
                        var found = device.EnumeratePoKeysDevices(
                            extendedDeviceInformation: true,
                            enumerateUSBdevices: true,
                            enumerateNetworkDevices: true,
                            ethernetDiscoveryTimeout: 2000);
                        var devices = new JArray();
                        if (found != null)
                        {
                            foreach (var info in found)
                            {
                                if (info == null) continue;
                                var data = info.deviceData;
                                // DeviceName / DeviceHWName come back as
                                // fixed-width buffers padded with nulls
                                // (and occasionally garbage past the
                                // first null). Trim at the first null
                                // and strip any remaining non-printable
                                // bytes so the editor doesn't render
                                // mojibake like "UHF".
                                // Surface the connection type so the
                                // editor can show USB / Network in the
                                // picker — useful when both kinds are
                                // detected and the user needs to pick
                                // the right one.
                                var conn = info.connectionType == ePoKeysDeviceConnectionType.NetworkDevice
                                    ? "network"
                                    : "usb";
                                var item = new JObject
                                {
                                    ["serial"]     = (uint)info.SerialNumber,
                                    ["userId"]     = (int)data.UserID,
                                    ["name"]       = SanitizeDeviceString(data.DeviceName),
                                    ["hwName"]     = SanitizeDeviceString(data.DeviceHWName),
                                    ["firmware"]   = $"{data.FirmwareVersionMajor / 16}.{data.FirmwareVersionMajor % 16}.{data.FirmwareVersionMinor}",
                                    ["connection"] = conn,
                                };
                                devices.Add(item);
                            }
                        }
                        resp["ok"] = true;
                        resp["devices"] = devices;
                        // Clear the DLL's internal detectedDevicesList
                        // before returning. EnumeratePoKeysDevices
                        // populates it via a buggy native marshaller
                        // that writes the literal byte 0xFF into one
                        // of the managed reference slots of the
                        // backing array. Letting it linger means the
                        // bridge's next GC mark phase walks it and
                        // AVs in clr!SVR::gc_heap::mark_object_simple1.
                        // Bridge is small, so it usually doesn't reach
                        // a Gen 2 collection — but consumers that
                        // hold the bridge open for a long time and
                        // call enumerate repeatedly could eventually
                        // crash it.
                        ClearDetectedDevicesList(device);
                        return resp;
                    }
                    catch (Exception e)
                    {
                        return ErrorResp(id, $"PoKeys enumeration failed: {e.Message}");
                    }
                    finally
                    {
                        // Defensive disconnect in case the enumerator
                        // left a handle open. Errors here are ignored —
                        // we're just being tidy.
                        try { device?.DisconnectDevice(); } catch { }
                    }
                }

                case "pokeys.setOutput":
                {
                    // Test-drive a single PoKeys output. Latched: the
                    // device holds whatever state we wrote until the
                    // next call. Connect/disconnect per call so the
                    // device stays free for SimLinkup or the vendor
                    // tool between clicks.
                    //
                    // Request shape:
                    //   { cmd: "pokeys.setOutput",
                    //     serial: 52153,
                    //     kind: "digital" | "pwm" | "extbus",
                    //     index: 1..55 | 1..6 | 1..80,
                    //     value: 0|1 (digital/extbus) | 0..1 (pwm),
                    //     invert: bool (digital/extbus, default false),
                    //     pwmPeriodMicroseconds: number (pwm only,
                    //                                   default 20000) }
                    var serialReq = req["serial"]?.ToObject<uint>() ?? 0u;
                    var kind = (string)req["kind"] ?? "";
                    var index = req["index"]?.ToObject<int>() ?? 0;
                    var valueToken = req["value"];
                    var invert = req["invert"]?.ToObject<bool>() ?? false;
                    if (serialReq == 0) return ErrorResp(id, "serial is required.");
                    if (kind != "digital" && kind != "pwm" && kind != "extbus")
                        return ErrorResp(id, $"Unknown PoKeys output kind '{kind}'.");

                    PoKeysDevice testDevice = null;
                    try
                    {
                        testDevice = new PoKeysDevice();
                        // Locate the configured serial in the
                        // Connect by serial directly. We deliberately do
                        // NOT call EnumeratePoKeysDevices here:
                        // PoKeysDevice_DLL's enumerate populates an
                        // internal List<PoKeysUSBDeviceObject> via a
                        // buggy native marshaller that writes the
                        // literal byte 0xFF into one of the managed
                        // reference slots of the list's backing
                        // array. The bad reference sits in the heap;
                        // the next GC mark phase walks it and AVs in
                        // clr!SVR::gc_heap::mark_object_simple1.
                        // Bridge is small + workstation GC so it's
                        // less likely to trigger, but consumers that
                        // hold the bridge open across many test calls
                        // could eventually hit it.
                        //
                        // ConnectToDevice(int serial, int checkEthernet)
                        // also enumerates internally so we still get
                        // the bad list — clear it via reflection
                        // immediately after.
                        // checkEthernet=1: include Ethernet PoKeys.
                        if (!testDevice.ConnectToDevice((int)serialReq, 1))
                            return ErrorResp(id, $"PoKeys serial {serialReq} not reachable on USB or Ethernet (unplugged, in use by SimLinkup or the PoKeys vendor tool, or wrong serial).");
                        ClearDetectedDevicesList(testDevice);

                        if (kind == "digital")
                        {
                            if (index < 1 || index > 55) return ErrorResp(id, $"Digital pin {index} out of range (1..55).");
                            // Force the pin into output mode with the
                            // right invert bit before writing — pins
                            // default to digital input on power-up.
                            byte function = (byte)(0x04 | (invert ? 0x80 : 0));
                            testDevice.SetPinData((byte)(index - 1), function);
                            bool boolValue = (valueToken?.ToObject<int>() ?? 0) != 0;
                            testDevice.SetOutput((byte)(index - 1), boolValue);
                        }
                        else if (kind == "extbus")
                        {
                            if (index < 1 || index > 80) return ErrorResp(id, $"PoExtBus bit {index} out of range (1..80).");
                            // Read current state so we don't blow
                            // away other bits the user previously
                            // set. AuxilaryBusGetData reads back the
                            // device's last-sent output payload.
                            byte enabled = 0;
                            byte[] cache = new byte[10];
                            try
                            {
                                // Some DLL versions don't support get
                                // — if it fails, start from zeros
                                // (safe but loses prior bit state).
                                testDevice.AuxilaryBusGetData(ref enabled);
                            }
                            catch { /* ok; cache stays zero */ }
                            bool boolValue = (valueToken?.ToObject<int>() ?? 0) != 0;
                            bool effective = invert ? !boolValue : boolValue;
                            int byteIndex = (index - 1) / 8;
                            int bitInByte = (index - 1) % 8;
                            byte mask = (byte)(1 << bitInByte);
                            if (effective) cache[byteIndex] |= mask;
                            else cache[byteIndex] &= (byte)~mask;
                            testDevice.AuxilaryBusSetData(1, cache);
                        }
                        else // pwm
                        {
                            if (index < 1 || index > 6) return ErrorResp(id, $"PWM channel {index} out of range (1..6).");
                            double frac = valueToken?.ToObject<double>() ?? 0.0;
                            if (frac < 0) frac = 0;
                            if (frac > 1) frac = 1;
                            uint periodMicros = req["pwmPeriodMicroseconds"]?.ToObject<uint>() ?? 20000u;
                            double freqHz = testDevice.GetPWMFrequency();
                            double cyclesDouble = periodMicros * (freqHz / 1e6);
                            if (cyclesDouble < 1) cyclesDouble = 1;
                            if (cyclesDouble > uint.MaxValue) cyclesDouble = uint.MaxValue;
                            uint period = (uint)cyclesDouble;
                            // Reverse channel index (PWM1 -> slot 5).
                            bool[] enables = new bool[6];
                            uint[] duty = new uint[6];
                            enables[6 - index] = true;
                            duty[6 - index] = (uint)(frac * period);
                            testDevice.SetPWMOutputs(ref enables, ref period, ref duty);
                        }

                        resp["ok"] = true;
                        return resp;
                    }
                    catch (Exception e)
                    {
                        return ErrorResp(id, $"PoKeys output write failed: {e.Message}");
                    }
                    finally
                    {
                        try { testDevice?.DisconnectDevice(); } catch { }
                    }
                }

                case "system.isSimLinkupRunning":
                {
                    // Fast running-state check via a kernel mutex that
                    // SimLinkup creates at startup (see SimLinkup's
                    // Program.Main, "Local\\SimLinkupRunning"). The
                    // alternative — shelling out to `tasklist` — was
                    // taking ~3 seconds on the user's machine (likely
                    // AV/Defender hooking process enumeration), which
                    // showed up as 4-second per-click latency on the
                    // PoKeys test buttons. OpenMutex is a kernel call
                    // and returns in microseconds.
                    //
                    // SYNCHRONIZE access is the minimum needed to open
                    // the handle; we don't need to wait/release/own
                    // anything. The kernel auto-releases the mutex when
                    // SimLinkup exits or crashes, so a stale "running"
                    // result isn't possible.
                    bool running = false;
                    try
                    {
                        IntPtr h = OpenMutex(SYNCHRONIZE, false, "Local\\SimLinkupRunning");
                        if (h != IntPtr.Zero)
                        {
                            CloseHandle(h);
                            running = true;
                        }
                    }
                    catch (Exception e)
                    {
                        return ErrorResp(id, $"OpenMutex failed: {e.Message}");
                    }
                    resp["ok"]      = true;
                    resp["running"] = running;
                    return resp;
                }

                case "shutdown":
                    resp["ok"] = true;
                    return resp;

                default:
                    return ErrorResp(id, $"Unknown command '{cmd}'.");
            }
        }

        // P/Invoke for the SimLinkup-running mutex check.
        // SYNCHRONIZE (0x00100000) is the minimum access right needed
        // to open the handle; we never wait or release.
        private const uint SYNCHRONIZE = 0x00100000;

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr OpenMutex(uint dwDesiredAccess, bool bInheritHandle, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr hObject);

        // Trim a PoKeys device-name buffer at the first null and strip
        // remaining non-printable bytes. The DLL hands us fixed-width
        // string fields (DeviceName ~10 bytes, DeviceHWName ~10 bytes)
        // that are null-padded, but occasionally the bytes past the
        // first null are garbage from a stale buffer rather than zeros.
        // C#'s string conversion would otherwise carry that garbage
        // through to JSON and the editor would render mojibake.
        // Wipe PoKeysDevice.detectedDevicesList via reflection. The
        // DLL's enumeration code (called both directly via
        // EnumeratePoKeysDevices and indirectly via ConnectToDevice)
        // populates this private List<> with results from a buggy
        // native marshal — one slot of its backing array contains
        // the literal byte 0xFF instead of a managed object reference.
        // Replacing the list with a fresh empty one makes the corrupt
        // backing array unrooted; the next GC collects it. Same
        // workaround as SimLinkup's PoKeys HSM (see
        // jc-lightningstools commit b590f7e for the full forensics).
        private static readonly FieldInfo _detectedDevicesListField =
            typeof(PoKeysDevice).GetField("detectedDevicesList",
                BindingFlags.Instance | BindingFlags.NonPublic);

        private static void ClearDetectedDevicesList(PoKeysDevice device)
        {
            if (device == null || _detectedDevicesListField == null) return;
            try
            {
                _detectedDevicesListField.SetValue(device, new List<PoKeysUSBDeviceObject>());
            }
            catch
            {
                // Best-effort. Worst case the corrupt array stays in
                // heap; bridge process is small + workstation GC, so
                // unlikely to crash before next process restart.
            }
        }

        private static string SanitizeDeviceString(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "";
            // First-null cutoff handles the well-formed null-padded
            // case; the printable filter catches the stale-buffer case.
            int nul = raw.IndexOf('\0');
            if (nul >= 0) raw = raw.Substring(0, nul);
            var sb = new System.Text.StringBuilder(raw.Length);
            foreach (var c in raw)
            {
                if (c >= 0x20 && c < 0x7F) sb.Append(c);
            }
            return sb.ToString().Trim();
        }

        private static JObject ErrorResp(string id, string message)
        {
            return new JObject { ["id"] = id, ["ok"] = false, ["error"] = message };
        }

        private static void EmitError(string id, string message)
        {
            Emit(ErrorResp(id, message));
        }

        private static void Emit(JObject obj)
        {
            // One line per response. Newtonsoft.Json's default settings produce
            // single-line minified JSON; explicit just to be safe.
            Console.Out.WriteLine(obj.ToString(Formatting.None));
            // Important: stdout is buffered by default. Flushing per response
            // keeps the editor's request/response loop snappy.
            Console.Out.Flush();
        }
    }
}
