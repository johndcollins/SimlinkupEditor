using System;
using System.Collections.Generic;

namespace SimLinkupCalibrationBridge
{
    // Per-sim contract for the calibration bridge. One implementation per
    // supported sim — Falcon BMS today, DCS / P3D / others can be added
    // later as separate classes registered with the SimRegistry. The bridge
    // host (Program.cs) dispatches to the right implementation based on the
    // `sim` field of each incoming command.
    //
    // Lifecycle for a calibration session:
    //   1. Host calls IsSimRunning() — if true, refuses to start (would
    //      conflict with the live sim).
    //   2. Host calls OpenSession() — implementation acquires whatever
    //      resources it needs (shared memory areas, sockets, etc.).
    //   3. Editor pushes WriteSignal() calls as the user drags sliders.
    //   4. Host calls CloseSession() — implementation releases everything.
    //
    // No method should block longer than a few ms; the stdio loop must
    // remain responsive to the editor's commands.
    public interface ISimBridge : IDisposable
    {
        // Stable identifier matching the editor's `SIM_SUPPORTS[].id` field.
        // Examples: "falcon4", "dcs", "p3d". Used for protocol dispatch.
        string SimId { get; }

        // True if the live sim process is currently running. Bridge refuses
        // to start a session in that case to avoid fighting over shared
        // memory or in-process state.
        bool IsSimRunning();

        // Allocate shared memory areas (or equivalent), claim write access.
        // Throws on failure; callers report the message back to the editor.
        // Calling OpenSession on a session that's already open is a no-op.
        void OpenSession();

        // Release everything. Idempotent.
        void CloseSession();

        // Write one named sim signal to shared memory. Signal IDs are the
        // same string format the editor's catalog uses (e.g. "F4_TACHOMETER__RPM"
        // for Falcon BMS). Implementations translate the ID to the relevant
        // struct field internally.
        //
        // Returns the list of signal IDs that were not recognized — the host
        // surfaces these to the editor so the user knows which fields the
        // bridge couldn't write. Empty list = full success.
        IList<string> WriteSignals(IDictionary<string, double> signals);

        // Read named sim signals back out of the bridge's staged shared
        // memory snapshot. Used by the editor to populate slider initial
        // values when a calibration session starts — better than guessing
        // a baseline because it reflects whatever was actually in shared
        // memory at session-open time (a previous calibration session,
        // leftover state, etc.).
        //
        // Mutates `result` in place: each recognized signal id gets a
        // double entry. Returns the list of signal IDs that were NOT
        // recognized (parallel to WriteSignals) so the editor can fall
        // back to its own baseline-inference for those.
        IList<string> ReadSignals(IList<string> signalIds, IDictionary<string, double> result);
    }
}
