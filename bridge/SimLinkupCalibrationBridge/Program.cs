using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.IO;

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
    //   ─→ { "id": "6", "cmd": "shutdown" }
    //   ←─ { "id": "6", "ok": true }   (then exit 0)
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
                    if (bridge.IsSimRunning())
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

                case "shutdown":
                    resp["ok"] = true;
                    return resp;

                default:
                    return ErrorResp(id, $"Unknown command '{cmd}'.");
            }
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
