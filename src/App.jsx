import React, { useState, useEffect, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, Cell } from "recharts";
import { Fish, MapPin, Loader2, ChevronLeft, BookOpen, TrendingUp, Plus, X, Check, AlertTriangle } from "lucide-react";
import { saveCatch as saveCatchToDb, loadCatches, getSavedGuideName, saveGuideName } from "./firebase.js";

const FONT_IMPORT = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap";

const LOGO_DATA_URI = "/logo.png";

const RUST = "#B5482A";
const INK = "#2A2620";
const PAPER = "#F1EADA";
const OLIVE = "#3D4128";
const OLIVE_DK = "#2A2D1B";

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchNearestGauge(lat, lon) {
  const boxes = [0.3, 0.6, 1.2, 2.5];
  for (const d of boxes) {
    const bbox = `${(lon - d).toFixed(2)},${(lat - d).toFixed(2)},${(lon + d).toFixed(2)},${(lat + d).toFixed(2)}`;
    const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}&parameterCd=00060,00010&siteStatus=active`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const series = data?.value?.timeSeries || [];
      if (series.length === 0) continue;

      const bySite = {};
      for (const s of series) {
        const siteCode = s.sourceInfo.siteCode[0].value;
        const geo = s.sourceInfo.geoLocation.geogLocation;
        const paramCode = s.variable.variableCode[0].value;
        const val = s.values?.[0]?.value?.[0]?.value;
        if (!bySite[siteCode]) {
          bySite[siteCode] = { name: s.sourceInfo.siteName, lat: geo.latitude, lon: geo.longitude };
        }
        if (paramCode === "00060" && val !== undefined) bySite[siteCode].flowCfs = parseFloat(val);
        if (paramCode === "00010" && val !== undefined) bySite[siteCode].waterTempC = parseFloat(val);
      }
      const sites = Object.values(bySite).map((s) => ({
        ...s,
        distance: haversine(lat, lon, s.lat, s.lon),
      }));
      if (sites.length === 0) continue;
      sites.sort((a, b) => a.distance - b.distance);
      return sites[0];
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchAirTemp(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,cloud_cover,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.current || null;
  } catch {
    return null;
  }
}

function cToF(c) {
  if (c === undefined || c === null || Number.isNaN(c)) return null;
  return Math.round((c * 9) / 5 + 32);
}

function StampButton({ onClick, children, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`active:scale-95 transition-transform duration-100 ${className}`}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [view, setView] = useState("log");
  const [guideName, setGuideName] = useState("");
  const [nameLoaded, setNameLoaded] = useState(false);
  const [entries, setEntries] = useState([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const saved = getSavedGuideName();
    if (saved) setGuideName(saved);
    setNameLoaded(true);
  }, []);

  const loadEntries = useCallback(async () => {
    try {
      const valid = await loadCatches();
      setEntries(valid);
    } catch (err) {
      console.error("Failed to load catches:", err);
      setEntries([]);
    }
    setEntriesLoaded(true);
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const saveName = async (name) => {
    setGuideName(name);
    saveGuideName(name);
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const fillFromCoords = useCallback(async (latitude, longitude) => {
    const [gauge, weather] = await Promise.all([
      fetchNearestGauge(latitude, longitude),
      fetchAirTemp(latitude, longitude),
    ]);
    setDraft((d) => ({
      ...d,
      lat: latitude,
      lon: longitude,
      flowCfs: gauge?.flowCfs ?? null,
      waterTempF: gauge?.waterTempC != null ? cToF(gauge.waterTempC) : null,
      gaugeName: gauge?.name ?? null,
      gaugeDistance: gauge?.distance ?? null,
      airTempF: weather?.temperature_2m != null ? Math.round(weather.temperature_2m) : null,
      windMph: weather?.wind_speed_10m != null ? Math.round(weather.wind_speed_10m) : null,
      cloudCover: weather?.cloud_cover ?? null,
    }));
    setCaptureError(null);
  }, []);

  const locateAndFill = useCallback(() => {
    setCaptureError(null);
    setCapturing(true);

    if (!navigator.geolocation) {
      setCaptureError("Location isn't available on this device. You can still log the catch manually.");
      setCapturing(false);
      return;
    }

    const tryLocate = (opts, isRetry) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          await fillFromCoords(pos.coords.latitude, pos.coords.longitude);
          setCapturing(false);
        },
        (err) => {
          if (!isRetry && (err.code === 3 || err.code === 2)) {
            tryLocate({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }, true);
            return;
          }
          const messages = {
            1: "Location access is blocked for this page. On iPhone: Settings → Privacy & Security → Location Services (must be ON), then Safari Websites set to \"Ask\" or \"While Using the App.\" You can also tap the \"aA\" icon in Safari's address bar → Website Settings → Location → Allow. Or enter coordinates manually below.",
            2: "GPS signal wasn't available (weak signal or indoors). Enter coordinates manually below, or try again outside.",
            3: "GPS took too long to respond. Try again with a clear view of the sky, or enter coordinates manually below.",
          };
          setCaptureError(messages[err.code] || "Couldn't get GPS location. Enter coordinates manually below.");
          setCapturing(false);
        },
        opts
      );
    };

    tryLocate({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }, false);
  }, [fillFromCoords]);

  const startCatch = async () => {
    setCaptureError(null);
    setModalOpen(true);
    setDraft({
      fly: "",
      species: "",
      size: "",
      notes: "",
      timestamp: Date.now(),
      lat: null,
      lon: null,
      flowCfs: null,
      waterTempF: null,
      airTempF: null,
      windMph: null,
      cloudCover: null,
      gaugeName: null,
      gaugeDistance: null,
    });
    locateAndFill();
  };

  const saveCatch = async () => {
    if (!draft) return;
    const entry = { ...draft, guide: guideName || "Unnamed guide" };
    try {
      await saveCatchToDb(entry);
      showToast("Catch logged");
      setModalOpen(false);
      setDraft(null);
      loadEntries();
    } catch (err) {
      console.error("Save failed:", err);
      showToast("Couldn't save — check your Firebase setup");
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setDraft(null);
    setCaptureError(null);
  };

  return (
    <div
      className="min-h-screen w-full"
      style={{ backgroundColor: PAPER, color: INK, fontFamily: "Inter, sans-serif" }}
    >
      <style>{`@import url('${FONT_IMPORT}');
        .stencil { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.06em; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .paper-texture { background-image: radial-gradient(${INK}0d 1px, transparent 1px); background-size: 14px 14px; }
      `}</style>

      {/* Header */}
      <div
        className="paper-texture px-5 pt-6 pb-5 sticky top-0 z-20 shadow-lg"
        style={{ backgroundColor: OLIVE_DK }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="stencil text-3xl leading-none" style={{ color: PAPER }}>
              FIELD LOG
            </div>
            <div className="mono text-[11px] tracking-wide mt-1" style={{ color: "#9C9678" }}>
              MEND THE DRIFT · SHARED GUIDE JOURNAL
            </div>
          </div>
          <Fish size={30} style={{ color: RUST }} strokeWidth={1.5} className="hidden" />
          <img src={LOGO_DATA_URI} alt="Mend the Drift" className="w-10 h-10 rounded-full" style={{ border: `2px solid ${RUST}` }} />
        </div>
      </div>

      {/* Guide name bar */}
      {nameLoaded && (
        <div className="px-5 py-3 border-b" style={{ borderColor: "#D9CFB5", backgroundColor: "#E8DFC8" }}>
          <label className="mono text-[10px] tracking-widest uppercase" style={{ color: "#6B6449" }}>
            Logging as
          </label>
          <input
            value={guideName}
            onChange={(e) => saveName(e.target.value)}
            placeholder="Your name"
            className="w-full bg-transparent mono text-sm font-semibold outline-none border-b border-dashed pt-1"
            style={{ color: INK, borderColor: "#B5482A55" }}
          />
        </div>
      )}

      {/* Main content by view */}
      <div className="px-5 pb-28 pt-5">
        {view === "log" && (
          <LogView onStartCatch={startCatch} recent={entries.slice(0, 5)} loaded={entriesLoaded} />
        )}
        {view === "history" && <HistoryView entries={entries} loaded={entriesLoaded} />}
        {view === "patterns" && <PatternsView entries={entries} />}
      </div>

      {/* Bottom nav */}
      <div
        className="fixed bottom-0 left-0 right-0 flex items-stretch shadow-2xl z-20"
        style={{ backgroundColor: OLIVE_DK, borderTop: `2px solid ${RUST}` }}
      >
        <NavButton active={view === "log"} onClick={() => setView("log")} icon={<Plus size={20} />} label="Log" />
        <NavButton
          active={view === "history"}
          onClick={() => setView("history")}
          icon={<BookOpen size={20} />}
          label="History"
        />
        <NavButton
          active={view === "patterns"}
          onClick={() => setView("patterns")}
          icon={<TrendingUp size={20} />}
          label="Patterns"
        />
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded stencil text-sm shadow-xl flex items-center gap-2"
          style={{ backgroundColor: RUST, color: PAPER }}
        >
          <Check size={16} /> {toast}
        </div>
      )}

      {/* Catch Modal */}
      {modalOpen && draft && (
        <CatchModal
          draft={draft}
          setDraft={setDraft}
          capturing={capturing}
          captureError={captureError}
          onSave={saveCatch}
          onClose={closeModal}
          onRetryLocation={locateAndFill}
          onManualLocate={fillFromCoords}
        />
      )}
    </div>
  );
}

function NavButton({ active, onClick, icon, label }) {
  return (
    <StampButton
      onClick={onClick}
      className="flex-1 flex flex-col items-center justify-center py-3 gap-1"
    >
      <div style={{ color: active ? RUST : "#9C9678" }}>{icon}</div>
      <div className="mono text-[10px] tracking-widest uppercase" style={{ color: active ? RUST : "#9C9678" }}>
        {label}
      </div>
    </StampButton>
  );
}

function LogView({ onStartCatch, recent, loaded }) {
  return (
    <div>
      <div className="text-center py-8">
        <StampButton
          onClick={onStartCatch}
          className="rounded-full w-44 h-44 flex flex-col items-center justify-center shadow-2xl mx-auto"
        >
          <div
            className="rounded-full w-44 h-44 flex items-center justify-center overflow-hidden"
            style={{ backgroundColor: "#000", border: `3px solid ${RUST}` }}
          >
            <img
              src={LOGO_DATA_URI}
              alt="Mend the Drift"
              className="w-full h-full object-cover"
              style={{ transform: "scale(1.08)" }}
            />
          </div>
        </StampButton>
        <div className="stencil text-lg mt-3" style={{ color: RUST }}>
          LOG CATCH
        </div>
        <div className="mono text-[11px] mt-1" style={{ color: "#6B6449" }}>
          Captures GPS, flow, and temp automatically
        </div>
      </div>

      <div className="mt-4">
        <div className="stencil text-lg mb-2" style={{ color: OLIVE }}>
          RECENT ENTRIES
        </div>
        {!loaded && <div className="mono text-xs" style={{ color: "#6B6449" }}>Loading…</div>}
        {loaded && recent.length === 0 && (
          <div className="mono text-xs italic" style={{ color: "#6B6449" }}>
            No catches logged yet. Tap the button above to log your first.
          </div>
        )}
        <div className="space-y-2">
          {recent.map((e) => (
            <EntryCard key={e.id} entry={e} compact />
          ))}
        </div>
      </div>
    </div>
  );
}

function EntryCard({ entry, compact }) {
  const date = new Date(entry.timestamp);
  return (
    <div
      className="border rounded p-3"
      style={{ borderColor: "#D9CFB5", backgroundColor: "#FBF7EC" }}
    >
      <div className="flex items-center justify-between">
        <div className="stencil text-base" style={{ color: OLIVE }}>
          {entry.species || "Trout"} {entry.size ? `· ${entry.size}"` : ""}
        </div>
        <div className="mono text-[10px]" style={{ color: "#6B6449" }}>
          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      <div className="mono text-xs mt-1" style={{ color: INK }}>
        Fly: {entry.fly || "—"} &nbsp;·&nbsp; Guide: {entry.guide}
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {entry.flowCfs != null && <Tag label={`${entry.flowCfs} cfs`} />}
        {entry.waterTempF != null && <Tag label={`${entry.waterTempF}°F water`} />}
        {entry.airTempF != null && <Tag label={`${entry.airTempF}°F air`} />}
      </div>
      {!compact && entry.notes && (
        <div className="mono text-xs mt-2 italic" style={{ color: "#6B6449" }}>
          "{entry.notes}"
        </div>
      )}
      {!compact && entry.gaugeName && (
        <div className="mono text-[10px] mt-2" style={{ color: "#9C9678" }}>
          Gauge: {entry.gaugeName} ({entry.gaugeDistance?.toFixed(1)} mi)
        </div>
      )}
    </div>
  );
}

function Tag({ label }) {
  return (
    <span
      className="mono text-[10px] px-2 py-0.5 rounded-full border"
      style={{ borderColor: RUST, color: RUST }}
    >
      {label}
    </span>
  );
}

function HistoryView({ entries, loaded }) {
  if (!loaded) return <div className="mono text-xs" style={{ color: "#6B6449" }}>Loading…</div>;
  if (entries.length === 0)
    return (
      <div className="mono text-xs italic" style={{ color: "#6B6449" }}>
        No entries yet.
      </div>
    );
  return (
    <div>
      <div className="stencil text-lg mb-3" style={{ color: OLIVE }}>
        ALL ENTRIES ({entries.length})
      </div>
      <div className="space-y-2">
        {entries.map((e) => (
          <EntryCard key={e.id} entry={e} />
        ))}
      </div>
    </div>
  );
}

function PatternsView({ entries }) {
  const flyData = useMemo(() => {
    const counts = {};
    entries.forEach((e) => {
      const f = e.fly?.trim() || "Unlogged";
      counts[f] = (counts[f] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [entries]);

  const flowScatter = useMemo(
    () =>
      entries
        .filter((e) => e.flowCfs != null)
        .map((e) => ({ x: e.flowCfs, y: e.waterTempF ?? 0, name: e.fly || "—" })),
    [entries]
  );

  if (entries.length === 0) {
    return (
      <div className="mono text-xs italic" style={{ color: "#6B6449" }}>
        Log a few catches first — patterns will show up here once there's data to work with.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="stencil text-lg mb-1" style={{ color: OLIVE }}>
          TOP PRODUCING FLIES
        </div>
        <div className="mono text-[10px] mb-3" style={{ color: "#6B6449" }}>
          BASED ON {entries.length} LOGGED CATCH{entries.length === 1 ? "" : "ES"}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={flyData} layout="vertical" margin={{ left: 10, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D9CFB5" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke="#6B6449" allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={90}
              tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
              stroke="#6B6449"
            />
            <Tooltip contentStyle={{ fontFamily: "JetBrains Mono", fontSize: 11 }} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]}>
              {flyData.map((_, i) => (
                <Cell key={i} fill={i === 0 ? RUST : OLIVE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {flowScatter.length > 1 && (
        <div>
          <div className="stencil text-lg mb-1" style={{ color: OLIVE }}>
            FLOW VS. WATER TEMP AT CATCH
          </div>
          <div className="mono text-[10px] mb-3" style={{ color: "#6B6449" }}>
            EACH DOT IS ONE LOGGED CATCH
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ left: 0, right: 10, top: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9CFB5" />
              <XAxis
                type="number"
                dataKey="x"
                name="Flow"
                unit=" cfs"
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                stroke="#6B6449"
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Water Temp"
                unit="°F"
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                stroke="#6B6449"
              />
              <Tooltip contentStyle={{ fontFamily: "JetBrains Mono", fontSize: 11 }} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={flowScatter} fill={RUST} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function CatchModal({ draft, setDraft, capturing, captureError, onSave, onClose, onRetryLocation, onManualLocate }) {
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const submitManual = async () => {
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return;
    setManualBusy(true);
    await onManualLocate(lat, lon);
    setManualBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center px-4 pb-4"
      style={{ backgroundColor: "#00000066", paddingTop: "max(6rem, env(safe-area-inset-top, 0px) + 5rem)" }}
    >
      <div
        className="w-full sm:max-w-md rounded-2xl overflow-hidden flex flex-col"
        style={{ backgroundColor: PAPER, maxHeight: "calc(100vh - max(8rem, env(safe-area-inset-top, 0px) + 7rem))" }}
      >
        <div
          className="paper-texture px-5 pt-5 pb-4 flex items-center justify-between shrink-0"
          style={{ backgroundColor: OLIVE_DK }}
        >
          <div className="flex items-center gap-3">
            <img
              src={LOGO_DATA_URI}
              alt="Mend the Drift"
              className="w-9 h-9 rounded-full"
              style={{ border: `2px solid ${RUST}` }}
            />
            <div>
              <div className="stencil text-2xl leading-none" style={{ color: PAPER }}>
                LOG CATCH
              </div>
              <div className="mono text-[10px] tracking-wide mt-0.5" style={{ color: "#9C9678" }}>
                MEND THE DRIFT
              </div>
            </div>
          </div>
          <StampButton onClick={onClose}>
            <X size={22} color={PAPER} />
          </StampButton>
        </div>

        <div
          className="px-5 pt-5 pb-5 overflow-y-auto"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y", overscrollBehavior: "contain" }}
        >

        {/* Auto-captured conditions */}
        <div
          className="rounded p-3 mb-4 border"
          style={{ borderColor: "#D9CFB5", backgroundColor: "#FBF7EC" }}
        >
          <div className="mono text-[10px] tracking-widest uppercase mb-2 flex items-center gap-1" style={{ color: "#6B6449" }}>
            <MapPin size={11} /> Conditions
          </div>
          {capturing ? (
            <div className="flex items-center gap-2 mono text-xs" style={{ color: OLIVE }}>
              <Loader2 size={14} className="animate-spin" /> Reading GPS, flow, and temperature…
            </div>
          ) : captureError ? (
            <div>
              <div className="flex items-start gap-2 mono text-xs mb-3" style={{ color: RUST }}>
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {captureError}
              </div>
              <StampButton onClick={onRetryLocation} className="mb-3">
                <div
                  className="mono text-[11px] px-3 py-1.5 rounded border inline-block"
                  style={{ borderColor: RUST, color: RUST }}
                >
                  RETRY GPS
                </div>
              </StampButton>

              <div className="mono text-[10px] tracking-widest uppercase mt-2 mb-1" style={{ color: "#6B6449" }}>
                Or enter coordinates manually
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <input
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    placeholder="Latitude"
                    inputMode="decimal"
                    className="w-full bg-transparent text-xs mono outline-none border-b pt-1 pb-1"
                    style={{ color: INK, borderColor: "#D9CFB5" }}
                  />
                </div>
                <div className="flex-1">
                  <input
                    value={manualLon}
                    onChange={(e) => setManualLon(e.target.value)}
                    placeholder="Longitude"
                    inputMode="decimal"
                    className="w-full bg-transparent text-xs mono outline-none border-b pt-1 pb-1"
                    style={{ color: INK, borderColor: "#D9CFB5" }}
                  />
                </div>
                <StampButton onClick={submitManual}>
                  <div
                    className="mono text-[11px] px-3 py-1.5 rounded"
                    style={{ backgroundColor: OLIVE, color: PAPER }}
                  >
                    {manualBusy ? "…" : "GO"}
                  </div>
                </StampButton>
              </div>
              <div className="mono text-[9px] mt-1" style={{ color: "#9C9678" }}>
                Tip: drop a pin in Maps at your spot, then copy the coordinates here.
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 mono text-xs" style={{ color: INK }}>
              <div>Flow: {draft.flowCfs != null ? `${draft.flowCfs} cfs` : "—"}</div>
              <div>Water: {draft.waterTempF != null ? `${draft.waterTempF}°F` : "—"}</div>
              <div>Air: {draft.airTempF != null ? `${draft.airTempF}°F` : "—"}</div>
              <div>Wind: {draft.windMph != null ? `${draft.windMph} mph` : "—"}</div>
              <div className="col-span-2">
                {new Date(draft.timestamp).toLocaleString()}
              </div>
              {draft.gaugeName && (
                <div className="col-span-2 text-[10px]" style={{ color: "#9C9678" }}>
                  Nearest gauge: {draft.gaugeName} ({draft.gaugeDistance?.toFixed(1)} mi)
                </div>
              )}
            </div>
          )}
        </div>

        <Field label="Fly used" value={draft.fly} onChange={set("fly")} placeholder="e.g. Parachute Adams #16" />
        <Field label="Species (optional)" value={draft.species} onChange={set("species")} placeholder="e.g. Brown Trout" />
        <Field label="Size, inches (optional)" value={draft.size} onChange={set("size")} placeholder="e.g. 18" />
        <FieldArea label="Notes (optional)" value={draft.notes} onChange={set("notes")} placeholder="Seam behind the boulder, sipping rise" />

        <StampButton
          onClick={onSave}
          className="w-full mt-2 py-3 rounded stencil text-xl flex items-center justify-center gap-2"
        >
          <div className="w-full py-3 rounded flex items-center justify-center gap-2" style={{ backgroundColor: RUST, color: PAPER }}>
            <Check size={18} /> SAVE ENTRY
          </div>
        </StampButton>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div className="mb-3">
      <label className="mono text-[10px] tracking-widest uppercase" style={{ color: "#6B6449" }}>
        {label}
      </label>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm font-medium outline-none border-b pt-1 pb-1"
        style={{ color: INK, borderColor: "#D9CFB5" }}
      />
    </div>
  );
}

function FieldArea({ label, value, onChange, placeholder }) {
  return (
    <div className="mb-3">
      <label className="mono text-[10px] tracking-widest uppercase" style={{ color: "#6B6449" }}>
        {label}
      </label>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-transparent text-sm font-medium outline-none border-b pt-1 pb-1 resize-none"
        style={{ color: INK, borderColor: "#D9CFB5" }}
      />
    </div>
  );
}
