using F4SharedMem;
using F4SharedMem.Headers;
using SimLinkupCalibrationBridge;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace SimLinkupCalibrationBridge.Sims.Falcon
{
    // Falcon BMS implementation of ISimBridge.
    //
    // Strategy: maintain two staged structs (BMS4FlightData + FlightData2),
    // mutate them as the editor pushes WriteSignals() calls, then marshal
    // both into byte arrays and hand to F4SharedMem.Writer which stamps the
    // bytes into the canonical Falcon shared memory areas.
    //
    // SimLinkup, watching the same memory areas, will pick up the mutated
    // values and drive the corresponding gauge HSMs as if Falcon BMS were
    // the source. Crucially: if Falcon BMS is actually running, it will
    // also be writing to the same areas at sim tick rate — the editor's
    // values will be overwritten on the next BMS update. IsSimRunning()
    // refuses to start a session in that case (caller's responsibility to
    // surface the error).
    //
    // All values arrive from the editor in their natural display units
    // (degrees, percent, knots, feet, etc.). The C# F4SimSupportModule
    // applies known transforms (degrees↔radians, sign flips, rate scaling)
    // when reading; we apply the inverse here when writing so the round
    // trip yields the same value the user dialled in.
    public sealed class FalconBridge : ISimBridge
    {
        private const string FALCON_PROCESS_NAME = "Falcon BMS";

        // Sentinel values borrowed from F4SimSupportModule.cs constants.
        private const double DEGREES_PER_RADIAN = 57.295779513082323;
        private const double FEET_PER_SECOND_PER_KNOT = 1.6878098570997;

        private Writer _writer;
        private BMS4FlightData _flightData;
        private FlightData2 _flightData2;
        private bool _sessionOpen;
        private bool _disposed;

        public string SimId => "falcon4";

        public bool IsSimRunning()
        {
            // Process.GetProcessesByName matches "Falcon BMS" (case-sensitive
            // on case-sensitive volumes, but Windows process names are
            // case-insensitive at the API level — this is fine). The
            // returned array is empty when no match.
            try
            {
                var procs = Process.GetProcessesByName(FALCON_PROCESS_NAME);
                if (procs.Length == 0) return false;
                foreach (var p in procs) p.Dispose();
                return true;
            }
            catch
            {
                // If enumeration fails for any reason, err on the safe side
                // and report sim NOT running; better to allow calibration
                // than to refuse it for an unrelated process query failure.
                return false;
            }
        }

        public void OpenSession()
        {
            if (_sessionOpen) return;
            _writer = new Writer();
            // Read existing shared memory (if any) so subsequent
            // WriteSignals calls preserve fields the user isn't actively
            // editing. If no shared memory exists yet, fall back to zeroed
            // structs. We deliberately do NOT flush anything to memory on
            // open — writes only happen when the user moves a slider.
            _flightData = ReadCurrentPrimaryOrZero();
            _flightData2 = ReadCurrentSecondaryOrZero();
            _sessionOpen = true;
        }

        // Read the current primary block out of shared memory and marshal
        // into a BMS4FlightData. Returns a fresh zeroed struct when the
        // shared memory area doesn't exist yet (first session, no prior
        // writer). Treats any read error as "use zeros" — the worst case
        // is the user sees a fresh baseline instead of stale state, which
        // is harmless.
        private static BMS4FlightData ReadCurrentPrimaryOrZero()
        {
            try
            {
                using (var reader = new Reader())
                {
                    var bytes = reader.GetRawPrimaryFlightData();
                    if (bytes != null && bytes.Length >= Marshal.SizeOf(typeof(BMS4FlightData)))
                    {
                        return BytesToStruct<BMS4FlightData>(bytes);
                    }
                }
            }
            catch { /* fall through */ }
            return CreateZeroedFlightData();
        }

        private static FlightData2 ReadCurrentSecondaryOrZero()
        {
            try
            {
                using (var reader = new Reader())
                {
                    var bytes = reader.GetRawFlightData2();
                    if (bytes != null && bytes.Length >= Marshal.SizeOf(typeof(FlightData2)))
                    {
                        return BytesToStruct<FlightData2>(bytes);
                    }
                }
            }
            catch { /* fall through */ }
            return CreateZeroedFlightData2();
        }

        public void CloseSession()
        {
            if (!_sessionOpen) return;
            try { _writer?.Dispose(); } catch { /* ignore */ }
            _writer = null;
            _sessionOpen = false;
        }

        public void Dispose()
        {
            if (_disposed) return;
            CloseSession();
            _disposed = true;
        }

        public IList<string> WriteSignals(IDictionary<string, double> signals)
        {
            if (!_sessionOpen) throw new InvalidOperationException("Session not open. Call OpenSession() first.");
            var unknown = new List<string>();
            bool primaryDirty = false;
            bool secondaryDirty = false;

            foreach (var kv in signals)
            {
                var routed = RouteSignal(kv.Key, kv.Value, ref _flightData, ref _flightData2);
                switch (routed)
                {
                    case Routing.Primary:   primaryDirty   = true; break;
                    case Routing.Secondary: secondaryDirty = true; break;
                    case Routing.Unknown:   unknown.Add(kv.Key);   break;
                }
            }

            if (primaryDirty)   FlushPrimary();
            if (secondaryDirty) FlushSecondary();
            return unknown;
        }

        public IList<string> ReadSignals(IList<string> signalIds, IDictionary<string, double> result)
        {
            if (!_sessionOpen) throw new InvalidOperationException("Session not open. Call OpenSession() first.");
            var unknown = new List<string>();
            foreach (var id in signalIds)
            {
                if (!ReadSignal(id, _flightData, _flightData2, out var value))
                {
                    unknown.Add(id);
                    continue;
                }
                result[id] = value;
            }
            return unknown;
        }

        // ── Translation: F4_* signal id → struct field assignment ────────
        // Mirrors the case-arms in lightningstools'
        // src/F4Utils/SimSupport/F4SimSupportModule.cs ApplyOutputs(). When
        // the source there does `_lastFlightData.X = expr`, we do the
        // inverse here: `expr = value` solved for X.
        //
        // Adding a new signal: add a case-arm with the right inverse
        // transform and route. Anything we don't handle returns Unknown
        // and is reported back to the editor.
        private enum Routing { Primary, Secondary, Unknown }

        private static Routing RouteSignal(string id, double value, ref BMS4FlightData fd, ref FlightData2 fd2)
        {
            switch (id)
            {
                // ── BMS4FlightData (primary) ──────────────────────────
                case "F4_ALTIMETER__INDICATED_ALTITUDE__MSL":
                    // Source reads -aauz; invert. NOTE: aauz lives on
                    // FlightData2 (extended block added in BMS), not the
                    // primary struct.
                    fd2.aauz = (float)(-value);
                    return Routing.Secondary;
                case "F4_ALTIMETER__BAROMETRIC_PRESSURE_INCHES_HG":
                    // Source reads AltCalReading / 100 when the AltCal type
                    // bit is set; both fields live on FlightData2.
                    fd2.AltCalReading = (int)Math.Round(value * 100);
                    fd2.altBits = (uint)((AltBits)fd2.altBits | AltBits.CalType);
                    return Routing.Secondary;
                case "F4_TRUE_ALTITUDE__MSL":
                    fd.z = (float)(-value);
                    return Routing.Primary;
                case "F4_VVI__VERTICAL_VELOCITY_FPM":
                    // Source reads `-_lastFlightData.zDot * 60`. zDot is ft/sec.
                    fd.zDot = (float)(-value / 60.0);
                    return Routing.Primary;
                case "F4_AIRSPEED_MACH_INDICATOR__INDICATED_AIRSPEED_KNOTS":
                    fd.kias = (float)value;
                    return Routing.Primary;
                case "F4_AIRSPEED_MACH_INDICATOR__MACH_NUMBER":
                    fd.mach = (float)value;
                    return Routing.Primary;
                case "F4_AIRSPEED_MACH_INDICATOR__TRUE_AIRSPEED_KNOTS":
                    fd.vt = (float)(value * FEET_PER_SECOND_PER_KNOT);
                    return Routing.Primary;
                case "F4_NOZ_POS1__NOZZLE_PERCENT_OPEN":
                    // Source reads nozzlePos × 100; field is 0..1.
                    fd.nozzlePos = (float)(value / 100.0);
                    return Routing.Primary;
                case "F4_RPM1__RPM_PERCENT":
                    fd.rpm = (float)value;
                    return Routing.Primary;
                case "F4_RPM2__RPM_PERCENT":
                    fd2.rpm2 = (float)value;
                    return Routing.Secondary;
                case "F4_FTIT1__FTIT_TEMP_DEG_CELCIUS":
                    // Source reads ftit × 100; field is hundreds of degrees C.
                    fd.ftit = (float)(value / 100.0);
                    return Routing.Primary;
                case "F4_FUEL_FLOW1__FUEL_FLOW_POUNDS_PER_HOUR":
                    fd.fuelFlow = (float)value;
                    return Routing.Primary;
                case "F4_FUEL_FLOW2__FUEL_FLOW_POUNDS_PER_HOUR":
                    fd2.fuelFlow2 = (float)value;
                    return Routing.Secondary;
                case "F4_FUEL_QTY__INTERNAL_FUEL_POUNDS":
                    fd.internalFuel = (float)value;
                    return Routing.Primary;
                case "F4_FUEL_QTY__EXTERNAL_FUEL_POUNDS":
                    fd.externalFuel = (float)value;
                    return Routing.Primary;
                case "F4_FUEL_QTY__AFT_QTY_LBS":
                    // Source reads aft / 10.0f; field is in tenths-of-pounds.
                    fd.aft = (float)(value * 10.0);
                    return Routing.Primary;
                case "F4_FUEL_QTY__FOREWARD_QTY_LBS":
                    fd.fwd = (float)(value * 10.0);
                    return Routing.Primary;
                case "F4_FUEL_QTY__TOTAL_FUEL_LBS":
                    fd.total = (float)value;
                    return Routing.Primary;
                case "F4_OIL_PRESS1__OIL_PRESS_PERCENT":
                    fd.oilPressure = (float)value;
                    return Routing.Primary;
                case "F4_OIL_PRESS2__OIL_PRESS_PERCENT":
                    fd2.oilPressure2 = (float)value;
                    return Routing.Secondary;
                case "F4_NOZ_POS2__NOZZLE_PERCENT_OPEN":
                    // Source reads nozzlePos2 × 100; field is 0..1.
                    fd2.nozzlePos2 = (float)(value / 100.0);
                    return Routing.Secondary;
                case "F4_GEAR_PANEL__GEAR_POSITION":
                    // 0 = up, 1 = down. Slider passes through.
                    fd.gearPos = (float)value;
                    return Routing.Primary;
                case "F4_GEAR_PANEL__NOSE_GEAR_POSITION":
                    fd.NoseGearPos = (float)value;
                    return Routing.Primary;
                case "F4_GEAR_PANEL__LEFT_GEAR_POSITION":
                    fd.LeftGearPos = (float)value;
                    return Routing.Primary;
                case "F4_GEAR_PANEL__RIGHT_GEAR_POSITION":
                    fd.RightGearPos = (float)value;
                    return Routing.Primary;
                case "F4_SPEED_BRAKE__POSITION":
                    // 0 = closed, 1 = 60 degrees open.
                    fd.speedBrake = (float)value;
                    return Routing.Primary;
                case "F4_FLIGHT_DYNAMICS__CLIMBDIVE_ANGLE_DEGREES":
                    // Source reads gamma × DEG_PER_RAD; field is radians.
                    fd.gamma = (float)(value / DEGREES_PER_RADIAN);
                    return Routing.Primary;
                case "F4_FLIGHT_DYNAMICS__SIDESLIP_ANGLE_DEGREES":
                    // Same field as ADI inclinometer (beta), just different
                    // signal id with degrees-direct rather than the
                    // inclinometer's "deflection × 5°" scaling.
                    fd.beta = (float)value;
                    return Routing.Primary;
                case "F4_MAP__GROUND_SPEED_KNOTS":
                    // Source reads sqrt(xDot² + yDot²) / FPS_PER_KNOT.
                    // For calibration we synthesize a ground-speed by
                    // putting all motion onto the X axis: xDot = value ×
                    // FPS_PER_KNOT, yDot = 0. The reader then sees
                    // sqrt((value × FPS)² + 0²) / FPS = value.
                    fd.xDot = (float)(value * FEET_PER_SECOND_PER_KNOT);
                    fd.yDot = 0;
                    return Routing.Primary;
                // F4_HSI__COURSE_DEVIATION_LIMIT_DEGREES is not a struct
                // field — F4SimSupportModule computes it from the active
                // waypoint type at runtime. Cannot be set via shared
                // memory; the user calibrates the HSI gauge's course
                // deviation breakpoint table to encode the limit instead.
                // F4_ADI__RATE_OF_TURN_INDICATOR_POSITION is derived by the
                // upstream IndicatedRateOfTurnCalculator (filtered yaw
                // rate over time), not invertible from a slider value.
                // The user calibrates the rate-of-turn breakpoint table
                // by entering values directly rather than scrubbing.
                case "F4_EPU_FUEL__EPU_FUEL_PERCENT":
                    fd.epuFuel = (float)value;
                    return Routing.Primary;
                case "F4_AOA_INDICATOR__AOA_DEGREES":
                    fd.alpha = (float)value;
                    return Routing.Primary;
                case "F4_COMPASS__MAGNETIC_HEADING_DEGREES":
                    // Source reads `(360 + currentHeading) % 360`. Storing the
                    // raw value works as long as it's in 0..360.
                    fd.currentHeading = (float)value;
                    return Routing.Primary;
                case "F4_ADI__PITCH_DEGREES":
                case "F4_STBY_ADI__PITCH_DEGREES":
                    // Source reads pitch × DEGREES_PER_RADIAN; field is radians.
                    fd.pitch = (float)(value / DEGREES_PER_RADIAN);
                    return Routing.Primary;
                case "F4_ADI__ROLL_DEGREES":
                case "F4_STBY_ADI__ROLL_DEGREES":
                    fd.roll = (float)(value / DEGREES_PER_RADIAN);
                    return Routing.Primary;
                case "F4_ADI__INCLINOMETER_POSITION":
                    // Source reads `beta / SIDESLIP_ANGLE_LIMIT_DEGREES` (limit
                    // is approximately 5°). Scale up.
                    fd.beta = (float)(value * 5.0);
                    return Routing.Primary;
                case "F4_ADI__ILS_HORIZONTAL_BAR_POSITION":
                    // Source reads AdiIlsVerPos * DEG_PER_RAD / glideslope_limit.
                    // Glideslope deviation limit is 1° per F4SimSupportModule.
                    fd.AdiIlsVerPos = (float)(value * 1.0 / DEGREES_PER_RADIAN);
                    return Routing.Primary;
                case "F4_ADI__ILS_VERTICAL_BAR_POSITION":
                    // Source reads AdiIlsHorPos * DEG_PER_RAD / localizer_limit
                    // (5°).
                    fd.AdiIlsHorPos = (float)(value * 5.0 / DEGREES_PER_RADIAN);
                    return Routing.Primary;
                case "F4_HSI__COURSE_DEVIATION_DEGREES":
                    fd.courseDeviation = (float)value;
                    return Routing.Primary;
                case "F4_HSI__DESIRED_COURSE_DEGREES":
                    fd.desiredCourse = (float)value;
                    return Routing.Primary;
                case "F4_HSI__BEARING_TO_BEACON_DEGREES":
                    fd.bearingToBeacon = (float)value;
                    return Routing.Primary;
                case "F4_HSI__CURRENT_HEADING_DEGREES":
                    fd.currentHeading = (float)value;
                    return Routing.Primary;
                case "F4_HSI__DESIRED_HEADING_DEGREES":
                    fd.desiredHeading = (float)value;
                    return Routing.Primary;
                case "F4_HSI__DISTANCE_TO_BEACON_NAUTICAL_MILES":
                    fd.distanceToBeacon = (float)value;
                    return Routing.Primary;

                // ── FlightData2 (secondary) ───────────────────────────
                case "F4_HYD_PRESSURE_A__PSI":
                    fd2.hydPressureA = (float)value;
                    return Routing.Secondary;
                case "F4_HYD_PRESSURE_B__PSI":
                    fd2.hydPressureB = (float)value;
                    return Routing.Secondary;
                case "F4_CABIN_PRESS__CABIN_PRESS_FEET_MSL":
                    fd2.cabinAlt = (float)value;
                    return Routing.Secondary;

                default:
                    return Routing.Unknown;
            }
        }

        // Inverse of RouteSignal: read the struct field for a known F4_*
        // signal id and apply the SAME forward-transform the upstream
        // F4SimSupportModule does (sign flips, unit conversions, etc.) so
        // the editor sees values in their natural display units.
        //
        // Returns true on success and writes to `value`; false when the
        // signal isn't recognized. The case-arms here MUST stay in lockstep
        // with the ones in RouteSignal — same set of signals, opposite
        // direction.
        private static bool ReadSignal(string id, BMS4FlightData fd, FlightData2 fd2, out double value)
        {
            switch (id)
            {
                case "F4_ALTIMETER__INDICATED_ALTITUDE__MSL":
                    value = -fd2.aauz; return true;
                case "F4_ALTIMETER__BAROMETRIC_PRESSURE_INCHES_HG":
                    value = (((AltBits)fd2.altBits & AltBits.CalType) == AltBits.CalType)
                        ? (fd2.AltCalReading != 0 ? fd2.AltCalReading : 2992) / 100.0
                        : 29.92;
                    return true;
                case "F4_TRUE_ALTITUDE__MSL":
                    value = -fd.z; return true;
                case "F4_VVI__VERTICAL_VELOCITY_FPM":
                    value = -fd.zDot * 60.0; return true;
                case "F4_AIRSPEED_MACH_INDICATOR__INDICATED_AIRSPEED_KNOTS":
                    value = fd.kias; return true;
                case "F4_AIRSPEED_MACH_INDICATOR__MACH_NUMBER":
                    value = fd.mach; return true;
                case "F4_AIRSPEED_MACH_INDICATOR__TRUE_AIRSPEED_KNOTS":
                    value = fd.vt / FEET_PER_SECOND_PER_KNOT; return true;
                case "F4_NOZ_POS1__NOZZLE_PERCENT_OPEN":
                    value = fd.nozzlePos * 100.0; return true;
                case "F4_NOZ_POS2__NOZZLE_PERCENT_OPEN":
                    value = fd2.nozzlePos2 * 100.0; return true;
                case "F4_RPM1__RPM_PERCENT":
                    value = fd.rpm; return true;
                case "F4_RPM2__RPM_PERCENT":
                    value = fd2.rpm2; return true;
                case "F4_FTIT1__FTIT_TEMP_DEG_CELCIUS":
                    value = fd.ftit * 100.0; return true;
                case "F4_FUEL_FLOW1__FUEL_FLOW_POUNDS_PER_HOUR":
                    value = fd.fuelFlow; return true;
                case "F4_FUEL_FLOW2__FUEL_FLOW_POUNDS_PER_HOUR":
                    value = fd2.fuelFlow2; return true;
                case "F4_FUEL_QTY__INTERNAL_FUEL_POUNDS":
                    value = fd.internalFuel; return true;
                case "F4_FUEL_QTY__EXTERNAL_FUEL_POUNDS":
                    value = fd.externalFuel; return true;
                case "F4_FUEL_QTY__AFT_QTY_LBS":
                    value = fd.aft / 10.0; return true;
                case "F4_FUEL_QTY__FOREWARD_QTY_LBS":
                    value = fd.fwd / 10.0; return true;
                case "F4_FUEL_QTY__TOTAL_FUEL_LBS":
                    value = fd.total; return true;
                case "F4_OIL_PRESS1__OIL_PRESS_PERCENT":
                    value = fd.oilPressure; return true;
                case "F4_OIL_PRESS2__OIL_PRESS_PERCENT":
                    value = fd2.oilPressure2; return true;
                case "F4_GEAR_PANEL__GEAR_POSITION":
                    value = fd.gearPos; return true;
                case "F4_GEAR_PANEL__NOSE_GEAR_POSITION":
                    value = fd.NoseGearPos; return true;
                case "F4_GEAR_PANEL__LEFT_GEAR_POSITION":
                    value = fd.LeftGearPos; return true;
                case "F4_GEAR_PANEL__RIGHT_GEAR_POSITION":
                    value = fd.RightGearPos; return true;
                case "F4_SPEED_BRAKE__POSITION":
                    value = fd.speedBrake; return true;
                case "F4_FLIGHT_DYNAMICS__CLIMBDIVE_ANGLE_DEGREES":
                    value = fd.gamma * DEGREES_PER_RADIAN; return true;
                case "F4_FLIGHT_DYNAMICS__SIDESLIP_ANGLE_DEGREES":
                    value = fd.beta; return true;
                case "F4_MAP__GROUND_SPEED_KNOTS":
                    value = Math.Sqrt(fd.xDot * fd.xDot + fd.yDot * fd.yDot) / FEET_PER_SECOND_PER_KNOT;
                    return true;
                case "F4_EPU_FUEL__EPU_FUEL_PERCENT":
                    value = fd.epuFuel; return true;
                case "F4_AOA_INDICATOR__AOA_DEGREES":
                    value = fd.alpha; return true;
                case "F4_COMPASS__MAGNETIC_HEADING_DEGREES":
                    value = (360 + fd.currentHeading) % 360; return true;
                case "F4_ADI__PITCH_DEGREES":
                case "F4_STBY_ADI__PITCH_DEGREES":
                    value = fd.pitch * DEGREES_PER_RADIAN; return true;
                case "F4_ADI__ROLL_DEGREES":
                case "F4_STBY_ADI__ROLL_DEGREES":
                    value = fd.roll * DEGREES_PER_RADIAN; return true;
                case "F4_ADI__INCLINOMETER_POSITION":
                    value = fd.beta / 5.0; return true;
                case "F4_ADI__ILS_HORIZONTAL_BAR_POSITION":
                    value = fd.AdiIlsVerPos * DEGREES_PER_RADIAN / 1.0; return true;
                case "F4_ADI__ILS_VERTICAL_BAR_POSITION":
                    value = fd.AdiIlsHorPos * DEGREES_PER_RADIAN / 5.0; return true;
                case "F4_HSI__COURSE_DEVIATION_DEGREES":
                    value = fd.courseDeviation; return true;
                case "F4_HSI__DESIRED_COURSE_DEGREES":
                    value = fd.desiredCourse; return true;
                case "F4_HSI__BEARING_TO_BEACON_DEGREES":
                    value = fd.bearingToBeacon; return true;
                case "F4_HSI__CURRENT_HEADING_DEGREES":
                    value = fd.currentHeading; return true;
                case "F4_HSI__DESIRED_HEADING_DEGREES":
                    value = fd.desiredHeading; return true;
                case "F4_HSI__DISTANCE_TO_BEACON_NAUTICAL_MILES":
                    value = fd.distanceToBeacon; return true;
                case "F4_HYD_PRESSURE_A__PSI":
                    value = fd2.hydPressureA; return true;
                case "F4_HYD_PRESSURE_B__PSI":
                    value = fd2.hydPressureB; return true;
                case "F4_CABIN_PRESS__CABIN_PRESS_FEET_MSL":
                    value = fd2.cabinAlt; return true;

                default:
                    value = 0;
                    return false;
            }
        }

        // ── Marshalling helpers ───────────────────────────────────────
        // Allocate, copy struct → managed bytes, hand to writer.
        private void FlushPrimary()
        {
            var bytes = StructToBytes(_flightData);
            _writer.WritePrimaryFlightData(bytes);
        }

        private void FlushSecondary()
        {
            var bytes = StructToBytes(_flightData2);
            _writer.WriteFlightData2(bytes);
        }

        private static byte[] StructToBytes<T>(T value) where T : struct
        {
            int size = Marshal.SizeOf(typeof(T));
            var buffer = new byte[size];
            IntPtr ptr = IntPtr.Zero;
            try
            {
                ptr = Marshal.AllocHGlobal(size);
                Marshal.StructureToPtr(value, ptr, fDeleteOld: false);
                Marshal.Copy(ptr, buffer, 0, size);
            }
            finally
            {
                if (ptr != IntPtr.Zero) Marshal.FreeHGlobal(ptr);
            }
            return buffer;
        }

        // Inverse of StructToBytes — copy a byte array (longer is OK, we
        // only consume sizeof(T)) into a struct via the marshaller. Used
        // by ReadCurrent*OrZero to populate the staged struct from the
        // raw bytes Reader gives us.
        private static T BytesToStruct<T>(byte[] bytes) where T : struct
        {
            int size = Marshal.SizeOf(typeof(T));
            IntPtr ptr = IntPtr.Zero;
            try
            {
                ptr = Marshal.AllocHGlobal(size);
                Marshal.Copy(bytes, 0, ptr, size);
                return (T)Marshal.PtrToStructure(ptr, typeof(T));
            }
            finally
            {
                if (ptr != IntPtr.Zero) Marshal.FreeHGlobal(ptr);
            }
        }

        // Construct a struct with all variable-length fields initialized to
        // sane empty arrays so the marshal doesn't trip on null sub-fields.
        // Mirrors what SharedMemorySample does in the SharedMemoryTester
        // example.
        private static BMS4FlightData CreateZeroedFlightData()
        {
            return new BMS4FlightData
            {
                bearing          = new float[FlightData.MAX_RWR_OBJECTS],
                lethality        = new float[FlightData.MAX_RWR_OBJECTS],
                missileActivity  = new uint [FlightData.MAX_RWR_OBJECTS],
                missileLaunch    = new uint [FlightData.MAX_RWR_OBJECTS],
                newDetection     = new uint [FlightData.MAX_RWR_OBJECTS],
                RWRsymbol        = new int  [FlightData.MAX_RWR_OBJECTS],
                selected         = new uint [FlightData.MAX_RWR_OBJECTS],
                DEDLines         = new DED_PFL_LineOfText[5],
                Invert           = new DED_PFL_LineOfText[5],
                PFLLines         = new DED_PFL_LineOfText[5],
                PFLInvert        = new DED_PFL_LineOfText[5],
            };
        }

        private static FlightData2 CreateZeroedFlightData2()
        {
            return new FlightData2
            {
                ecmBits          = new uint[FlightData2.MAX_ECM_PROGRAMS],
                pilotsCallsign   = new Callsign_LineOfText[FlightData2.MAX_CALLSIGNS],
                pilotsStatus     = new byte[FlightData2.MAX_CALLSIGNS],
                RTT_area         = new ushort[(int)RTT_areas.RTT_noOfAreas * 4],
                RTT_size         = new ushort[2],
                RwrInfo          = new byte[FlightData2.RWRINFO_SIZE],
                RWRjammingStatus = new JammingStates[FlightData.MAX_RWR_OBJECTS],
                tacanInfo        = new byte[(int)TacanSources.NUMBER_OF_SOURCES],
            };
        }
    }
}
