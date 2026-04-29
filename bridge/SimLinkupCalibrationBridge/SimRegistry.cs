using System;
using System.Collections.Generic;
using SimLinkupCalibrationBridge.Sims.Falcon;

namespace SimLinkupCalibrationBridge
{
    // Sim id → ISimBridge factory. New sims get a new entry here and a new
    // class under Sims/<SimName>/. The registry intentionally lazily creates
    // bridges so a user who only ever calibrates Falcon never instantiates
    // the DCS bridge (and never pays for whatever resources it might want).
    //
    // Registry holds ONE instance per sim id for the lifetime of the
    // process — sessions open and close on the same instance. Disposal is
    // handled by the host on shutdown.
    internal static class SimRegistry
    {
        // Wrapped in lock-on-this for thread safety; Program's stdio loop is
        // single-threaded today but defensive in case we add concurrent
        // commands later.
        private static readonly Dictionary<string, ISimBridge> _instances =
            new Dictionary<string, ISimBridge>(StringComparer.OrdinalIgnoreCase);

        // Construct (or return cached) the bridge for `simId`. Returns null
        // when the sim is unknown — the host turns this into an error
        // response.
        public static ISimBridge Get(string simId)
        {
            if (string.IsNullOrEmpty(simId)) return null;
            lock (_instances)
            {
                if (_instances.TryGetValue(simId, out var existing)) return existing;
                ISimBridge created = null;
                switch (simId.ToLowerInvariant())
                {
                    case "falcon4":
                    case "falconbms":
                    case "bms":
                        created = new FalconBridge();
                        break;
                    // Future sims register here.
                }
                if (created != null)
                {
                    _instances[simId] = created;
                }
                return created;
            }
        }

        // Dispose all live bridges. Called on Ctrl+C / shutdown command.
        public static void DisposeAll()
        {
            lock (_instances)
            {
                foreach (var kv in _instances)
                {
                    try { kv.Value.Dispose(); } catch { /* ignore */ }
                }
                _instances.Clear();
            }
        }
    }
}
