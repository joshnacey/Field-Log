import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, Cell } from "recharts";
import { Fish, MapPin, Loader2, BookOpen, TrendingUp, Plus, X, Check, AlertTriangle, Map as MapIcon, Trash2 } from "lucide-react";
import { saveCatch as saveCatchToDb, loadCatches, deleteCatch, getSavedGuideName, saveGuideName } from "./firebase.js";

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

/* ---------- shared helpers ---------- */

function normName(s) {
  return (s || "").trim().toLowerCase();
}

function ownsEntry(entry, guideName) {
  const g = normName(guideName);
  return g.length > 0 && normName(entry.guide) === g;
}

// "SNAKE RIVER NR HEISE ID" -> "Snake River"
function prettyRiver(gaugeName) {
  if (!gaugeName) return "";
  let s = String(gaugeName).toUpperCase();
  s = s.split(/\s+(?:NR|NEAR|AT|ABV|ABOVE|BLW|BELOW|BL|AB|DS|US)\s+/)[0];
  s = s.split(",")[0];
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function riverOf(entry) {
  const r = (entry.river || "").trim();
  if (r) return r;
  const derived = prettyRiver(entry.gaugeName);
  return derived || "Unknown water";
}

function sectionOf(entry) {
  const s = (entry.section || "").trim();
  return s || "Unmarked section";
}

// Groups nearby catches into a single spot. radiusMi 0.05 ≈ 90 yards.
function clusterEntries(list, radiusMi = 0.05) {
  const clusters = [];
  for (const e of list) {
    let hit = null;
    for (const c of clusters) {
      if (haversine(e.lat, e.lon, c.lat, c.lon) <= radiusMi) {
        hit = c;
        break;
      }
    }
    if (hit) {
      hit.entries.push(e);
      hit.lat = hit.entries.reduce((s, x) => s + x.lat, 0) / hit.entries.length;
      hit.lon = hit.entries.reduce((s, x) => s + x.lon, 0) / hit.entries.length;
    } else {
      clusters.push({ lat: e.lat, lon: e.lon, entries: [e] });
    }
  }
  return clusters.sort((a, b) => b.entries.length - a.entries.length);
}

function topOf(list, pick) {
  const counts = {};
  list.forEach((e) => {
    const v = pick(e);
    if (v) counts[v] = (counts[v] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length ? { name: sorted[0][0], count: sorted[0][1] } : null;
}

// Buckets numeric values into bands, filling empty bands between min and max.
function bandData(list, key, size) {
  const vals = list.map((e) => e[key]).filter((v) => v != null && !Number.isNaN(v));
  if (vals.length === 0) return [];
  const counts = {};
  vals.forEach((v) => {
    const b = Math.floor(v / size) * size;
    counts[b] = (counts[b] || 0) + 1;
  });
  const bands = Object.keys(counts).map(Number);
  const min = Math.min(...bands);
  const max = Math.max(...bands);
  const out = [];
  for (let b = min; b <= max; b += size) {
    out.push({ band: b, count: counts[b] || 0, name: `${b}–${b + size}` });
  }
  return out;
}

function bestBand(data) {
  if (!data.length) return null;
  return data.reduce((a, b) => (b.count > a.count ? b : a));
}

function hourLabel(h) {
  const ampm = h < 12 ? "a" : "p";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}

function hourLabelLong(h) {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  const nh = (h + 1) % 24;
  const nAmpm = nh < 12 ? "AM" : "PM";
  const nHr = nh % 12 === 0 ? 12 : nh % 12;
  return `${hr} ${ampm} – ${nHr} ${nAmpm}`;
}

/* ---------- Leaflet loaded from CDN (no build changes needed) ---------- */

let leafletPromise = null;
function loadLeaflet() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Map library failed to load"));
    document.head.appendChild(script);
  });
  return leafletPromise;
}

/* ---------- data fetchers (unchanged) ---------- */

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
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

    // Inherit river + section from catches logged within 2 miles of here.
    const nearby = entries.filter(
      (e) => e.lat != null && e.lon != null && haversine(latitude, longitude, e.lat, e.lon) <= 2
    );
    const nearRiver = topOf(
      nearby.filter((e) => (e.river || "").trim()),
      (e) => e.river.trim()
    );
    const nearSection = topOf(
      nearby.filter((e) => (e.section || "").trim()),
      (e) => e.section.trim()
    );

    setDraft((d) => ({
      ...d,
      lat: latitude,
      lon: longitude,
      river: (d.river || "").trim() || nearRiver?.name || prettyRiver(gauge?.name) || "",
      section: (d.section || "").trim() || nearSection?.name || "",
      flowCfs: gauge?.flowCfs ?? null,
      waterTempF: gauge?.waterTempC != null ? cToF(gauge.waterTempC) : null,
      gaugeName: gauge?.name ?? null,
      gaugeDistance: gauge?.distance ?? null,
      airTempF: weather?.temperature_2m != null ? Math.round(weather.temperature_2m) : null,
      windMph: weather?.wind_speed_10m != null ? Math.round(weather.wind_speed_10m) : null,
      cloudCover: weather?.cloud_cover ?? null,
    }));
    setCaptureError(null);
  }, [entries]);

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
      river: "",
      section: "",
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

  const requestDelete = (entry) => {
    if (!ownsEntry(entry, guideName)) return;
    setPendingDelete(entry);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteCatch(pendingDelete.id);
      setEntries((es) => es.filter((e) => e.id !== pendingDelete.id));
      showToast("Entry deleted");
      setPendingDelete(null);
    } catch (err) {
      console.error("Delete failed:", err);
      showToast("Couldn't delete — try again");
    }
    setDeleting(false);
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
        .leaflet-container { background: #E8DFC8; font-family: 'JetBrains Mono', monospace; }
        .leaflet-popup-content-wrapper { border-radius: 4px; background: ${PAPER}; color: ${INK}; }
        .leaflet-popup-tip { background: ${PAPER}; }
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
          <LogView
            onStartCatch={startCatch}
            recent={entries.slice(0, 5)}
            loaded={entriesLoaded}
            guideName={guideName}
            onRequestDelete={requestDelete}
          />
        )}
        {view === "history" && (
          <HistoryView
            entries={entries}
            loaded={entriesLoaded}
            guideName={guideName}
            onRequestDelete={requestDelete}
          />
        )}
        {view === "map" && <MapView entries={entries} loaded={entriesLoaded} />}
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
        <NavButton active={view === "map"} onClick={() => setView("map")} icon={<MapIcon size={20} />} label="Map" />
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
          entries={entries}
          capturing={capturing}
          captureError={captureError}
          onSave={saveCatch}
          onClose={closeModal}
          onRetryLocation={locateAndFill}
          onManualLocate={fillFromCoords}
        />
      )}

      {/* Delete confirm */}
      {pendingDelete && (
        <DeleteConfirm
          entry={pendingDelete}
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
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

function LogView({ onStartCatch, recent, loaded, guideName, onRequestDelete }) {
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
            <EntryCard
              key={e.id}
              entry={e}
              compact
              canDelete={ownsEntry(e, guideName)}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EntryCard({ entry, compact, canDelete, onRequestDelete }) {
  const date = new Date(entry.timestamp);
  const timerRef = useRef(null);
  const [held, setHeld] = useState(false);

  const startHold = () => {
    if (!canDelete) return;
    setHeld(true);
    timerRef.current = setTimeout(() => {
      setHeld(false);
      onRequestDelete(entry);
    }, 600);
  };

  const cancelHold = () => {
    setHeld(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), []);

  return (
    <div
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      onTouchMove={cancelHold}
      onTouchCancel={cancelHold}
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onContextMenu={(e) => {
        if (canDelete) e.preventDefault();
      }}
      className="border rounded p-3 transition-transform duration-150"
      style={{
        borderColor: held ? RUST : "#D9CFB5",
        backgroundColor: held ? "#F4E6DE" : "#FBF7EC",
        transform: held ? "scale(0.98)" : "scale(1)",
        WebkitUserSelect: canDelete ? "none" : "auto",
        userSelect: canDelete ? "none" : "auto",
        WebkitTouchCallout: "none",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="stencil text-base" style={{ color: OLIVE }}>
          {entry.species || "Trout"} {entry.size ? `· ${entry.size}"` : ""}
        </div>
        <div className="mono text-[10px]" style={{ color: "#6B6449" }}>
          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      <div className="mono text-[11px] mt-1 font-semibold" style={{ color: RUST }}>
        {riverOf(entry)} · {sectionOf(entry)}
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
      {canDelete && (
        <div className="mono text-[9px] mt-2 flex items-center gap-1" style={{ color: "#9C9678" }}>
          <Trash2 size={9} /> Press and hold to delete
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

function DeleteConfirm({ entry, busy, onCancel, onConfirm }) {
  const date = new Date(entry.timestamp);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "#00000088" }}
    >
      <div className="w-full sm:max-w-sm rounded-2xl overflow-hidden" style={{ backgroundColor: PAPER }}>
        <div className="paper-texture px-5 py-4" style={{ backgroundColor: OLIVE_DK }}>
          <div className="stencil text-2xl leading-none" style={{ color: PAPER }}>
            DELETE ENTRY
          </div>
          <div className="mono text-[10px] tracking-wide mt-1" style={{ color: "#9C9678" }}>
            THIS REMOVES IT FOR EVERY GUIDE
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="mono text-xs" style={{ color: INK }}>
            {entry.species || "Trout"}
            {entry.size ? ` · ${entry.size}"` : ""} — {entry.fly || "no fly logged"}
          </div>
          <div className="mono text-[10px] mt-1" style={{ color: "#6B6449" }}>
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
            {riverOf(entry)}
          </div>
          <div className="mono text-[11px] mt-3" style={{ color: RUST }}>
            Deleted entries can't be recovered.
          </div>
          <div className="flex gap-2 mt-5">
            <StampButton onClick={onCancel} className="flex-1">
              <div
                className="w-full py-3 rounded stencil text-lg border"
                style={{ borderColor: OLIVE, color: OLIVE }}
              >
                KEEP
              </div>
            </StampButton>
            <StampButton onClick={busy ? () => {} : onConfirm} className="flex-1">
              <div
                className="w-full py-3 rounded stencil text-lg flex items-center justify-center gap-2"
                style={{ backgroundColor: RUST, color: PAPER, opacity: busy ? 0.6 : 1 }}
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {busy ? "DELETING" : "DELETE"}
              </div>
            </StampButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryView({ entries, loaded, guideName, onRequestDelete }) {
  const f = useWaterFilter(entries);

  if (!loaded) return <div className="mono text-xs" style={{ color: "#6B6449" }}>Loading…</div>;
  if (entries.length === 0)
    return (
      <div className="mono text-xs italic" style={{ color: "#6B6449" }}>
        No entries yet.
      </div>
    );

  return (
    <div>
      <WaterFilter f={f} />

      <div className="stencil text-lg mb-1 mt-2" style={{ color: OLIVE }}>
        {f.label.toUpperCase()} ({f.filtered.length})
      </div>
      <div className="mono text-[10px] mb-3" style={{ color: "#6B6449" }}>
        PRESS AND HOLD YOUR OWN ENTRY TO DELETE IT
      </div>

      {f.filtered.length === 0 && (
        <div className="mono text-xs italic" style={{ color: "#6B6449" }}>
          Nothing logged on this water yet.
        </div>
      )}

      <div className="space-y-2">
        {f.filtered.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            canDelete={ownsEntry(e, guideName)}
            onRequestDelete={onRequestDelete}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------- Map ---------- */

function useWaterFilter(entries) {
  const [river, setRiver] = useState("ALL");
  const [section, setSection] = useState("ALL");

  const rivers = useMemo(() => Array.from(new Set(entries.map(riverOf))).sort(), [entries]);
  const byRiver = useMemo(
    () => (river === "ALL" ? entries : entries.filter((e) => riverOf(e) === river)),
    [entries, river]
  );
  const sections = useMemo(() => Array.from(new Set(byRiver.map(sectionOf))).sort(), [byRiver]);
  const filtered = useMemo(
    () => (section === "ALL" ? byRiver : byRiver.filter((e) => sectionOf(e) === section)),
    [byRiver, section]
  );

  const pickRiver = (r) => {
    setRiver(r);
    setSection("ALL");
  };

  const label =
    river === "ALL" ? "All water" : section === "ALL" ? river : `${river} · ${section}`;

  return { river, pickRiver, section, setSection, rivers, sections, filtered, label };
}

function FilterChips({ items, value, onPick, allLabel }) {
  if (items.length < 2) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
      {["ALL", ...items].map((r) => {
        const active = value === r;
        return (
          <StampButton key={r} onClick={() => onPick(r)}>
            <div
              className="mono text-[10px] px-3 py-1.5 rounded-full border whitespace-nowrap"
              style={{
                borderColor: active ? RUST : "#D9CFB5",
                backgroundColor: active ? RUST : "transparent",
                color: active ? PAPER : "#6B6449",
              }}
            >
              {r === "ALL" ? allLabel : r.length > 28 ? r.slice(0, 28) + "…" : r}
            </div>
          </StampButton>
        );
      })}
    </div>
  );
}

function WaterFilter({ f }) {
  if (f.rivers.length < 2 && f.sections.length < 2) return null;
  return (
    <div className="mb-1">
      <FilterChips items={f.rivers} value={f.river} onPick={f.pickRiver} allLabel="ALL RIVERS" />
      <FilterChips items={f.sections} value={f.section} onPick={f.setSection} allLabel="ALL SECTIONS" />
    </div>
  );
}

function MapView({ entries, loaded }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [status, setStatus] = useState("loading");

  const geo = useMemo(() => entries.filter((e) => e.lat != null && e.lon != null), [entries]);
  const f = useWaterFilter(geo);
  const spots = useMemo(() => clusterEntries(f.filtered), [f.filtered]);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(
          [44.5, -111.0],
          6
        );
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "© OpenStreetMap",
        }).addTo(map);
        mapRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);
        setStatus("ready");
      })
      .catch(() => !cancelled && setStatus("error"));

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const L = window.L;
    if (status !== "ready" || !L || !mapRef.current || !layerRef.current) return;
    layerRef.current.clearLayers();
    if (spots.length === 0) return;

    const max = spots[0].entries.length;
    spots.forEach((s) => {
      const n = s.entries.length;
      const radius = 8 + 14 * Math.sqrt(n / max);
      const topFly = topOf(s.entries, (e) => e.fly?.trim());
      const sizes = s.entries.map((e) => parseFloat(e.size)).filter((v) => !Number.isNaN(v));
      const avgSize = sizes.length ? (sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1) : null;

      const marker = L.circleMarker([s.lat, s.lon], {
        radius,
        color: RUST,
        weight: 2,
        fillColor: RUST,
        fillOpacity: 0.35,
      });
      marker.bindPopup(
        `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.5">
          <div style="font-size:14px;color:${RUST};font-weight:700">${n} fish</div>
          <div>${riverOf(s.entries[0])}</div>
          <div style="color:#6B6449">${sectionOf(s.entries[0])}</div>
          ${topFly ? `<div>Top fly: ${topFly.name} (${topFly.count})</div>` : ""}
          ${avgSize ? `<div>Avg size: ${avgSize}"</div>` : ""}
          <div style="color:#6B6449">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</div>
        </div>`
      );
      marker.addTo(layerRef.current);
    });

    const bounds = L.latLngBounds(spots.map((s) => [s.lat, s.lon]));
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 150);
  }, [spots, status]);

  return (
    <div>
      <div className="stencil text-lg mb-1" style={{ color: OLIVE }}>
        CATCH MAP
      </div>
      <div className="mono text-[10px] mb-3" style={{ color: "#6B6449" }}>
        BIGGER CIRCLE = MORE FISH. TAP ONE FOR THE READ.
      </div>

      <WaterFilter f={f} />

      {loaded && geo.length === 0 && (
        <div className="mono text-xs italic mb-3" style={{ color: "#6B6449" }}>
          No entries have coordinates yet. Catches logged with GPS or manual coordinates will plot here.
        </div>
      )}

      <div
        className="rounded overflow-hidden border relative"
        style={{ borderColor: "#D9CFB5", height: "58vh", minHeight: 320 }}
      >
        <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
        {status === "loading" && (
          <div
            className="absolute inset-0 flex items-center justify-center mono text-xs gap-2"
            style={{ backgroundColor: "#E8DFC8", color: OLIVE }}
          >
            <Loader2 size={14} className="animate-spin" /> Loading map…
          </div>
        )}
        {status === "error" && (
          <div
            className="absolute inset-0 flex items-center justify-center mono text-xs px-6 text-center"
            style={{ backgroundColor: "#E8DFC8", color: RUST }}
          >
            Map couldn't load. Check your connection and reopen this tab.
          </div>
        )}
      </div>

      {spots.length > 0 && (
        <div className="mt-5">
          <div className="stencil text-lg mb-2" style={{ color: OLIVE }}>
            TOP SPOTS
          </div>
          <div className="space-y-2">
            {spots.slice(0, 5).map((s, i) => {
              const topFly = topOf(s.entries, (e) => e.fly?.trim());
              return (
                <div
                  key={i}
                  className="border rounded p-3 flex items-start justify-between gap-3"
                  style={{ borderColor: "#D9CFB5", backgroundColor: "#FBF7EC" }}
                >
                  <div>
                    <div className="stencil text-base" style={{ color: OLIVE }}>
                      {s.entries.length} FISH
                    </div>
                    <div className="mono text-[10px] mt-0.5" style={{ color: "#6B6449" }}>
                      {riverOf(s.entries[0])} · {sectionOf(s.entries[0])}
                    </div>
                    {topFly && (
                      <div className="mono text-[10px] mt-0.5" style={{ color: INK }}>
                        Top fly: {topFly.name}
                      </div>
                    )}
                  </div>
                  <div className="mono text-[10px] text-right shrink-0" style={{ color: "#9C9678" }}>
                    {s.lat.toFixed(4)}
                    <br />
                    {s.lon.toFixed(4)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Patterns ---------- */

function ChartBlock({ title, subtitle, children }) {
  return (
    <div>
      <div className="stencil text-lg mb-1" style={{ color: OLIVE }}>
        {title}
      </div>
      <div className="mono text-[10px] mb-3" style={{ color: "#6B6449" }}>
        {subtitle}
      </div>
      {children}
    </div>
  );
}

function CountBars({ data, height = 200, highlightMax = true }) {
  const max = Math.max(...data.map((d) => d.count));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#D9CFB5" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
          stroke="#6B6449"
          interval={0}
          angle={data.length > 8 ? -40 : 0}
          textAnchor={data.length > 8 ? "end" : "middle"}
          height={data.length > 8 ? 46 : 24}
        />
        <YAxis tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} stroke="#6B6449" allowDecimals={false} />
        <Tooltip contentStyle={{ fontFamily: "JetBrains Mono", fontSize: 11 }} />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={highlightMax && d.count === max && max > 0 ? RUST : OLIVE} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PatternsView({ entries }) {
  const f = useWaterFilter(entries);
  const data = f.filtered;

  const sectionData = useMemo(() => {
    const counts = {};
    data.forEach((e) => {
      const s = sectionOf(e);
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [data]);

  const flyData = useMemo(() => {
    const counts = {};
    data.forEach((e) => {
      const f = e.fly?.trim() || "Unlogged";
      counts[f] = (counts[f] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [data]);

  const hourData = useMemo(() => {
    const counts = {};
    data.forEach((e) => {
      const h = new Date(e.timestamp).getHours();
      counts[h] = (counts[h] || 0) + 1;
    });
    const hours = Object.keys(counts).map(Number);
    if (hours.length === 0) return [];
    const min = Math.min(...hours);
    const max = Math.max(...hours);
    const out = [];
    for (let h = min; h <= max; h++) {
      out.push({ hour: h, name: hourLabel(h), count: counts[h] || 0 });
    }
    return out;
  }, [data]);

  const waterData = useMemo(() => bandData(data, "waterTempF", 2), [data]);
  const flowData = useMemo(() => bandData(data, "flowCfs", 250), [data]);
  const airData = useMemo(() => bandData(data, "airTempF", 5), [data]);

  const flowScatter = useMemo(
    () =>
      data
        .filter((e) => e.flowCfs != null && e.waterTempF != null)
        .map((e) => ({ x: e.flowCfs, y: e.waterTempF, name: e.fly || "—" })),
    [data]
  );

  const bestHour = useMemo(() => (hourData.length ? bestBand(hourData) : null), [hourData]);
  const bestWater = useMemo(() => bestBand(waterData), [waterData]);
  const bestFlow = useMemo(() => bestBand(flowData), [flowData]);
  const topFly = useMemo(() => topOf(data, (e) => e.fly?.trim()), [data]);
  const topSpot = useMemo(() => {
    const geo = data.filter((e) => e.lat != null && e.lon != null);
    const spots = clusterEntries(geo);
    return spots.length ? spots[0] : null;
  }, [data]);

  if (entries.length === 0) {
    return (
      <div className="mono text-xs italic" style={{ color: "#6B6449" }}>
        Log a few catches first — patterns will show up here once there's data to work with.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <WaterFilter f={f} />

      {/* The Read */}
      <div className="rounded border p-4" style={{ borderColor: RUST, backgroundColor: "#FBF7EC" }}>
        <div className="stencil text-xl mb-1" style={{ color: RUST }}>
          THE READ
        </div>
        <div className="mono text-[10px] mb-3" style={{ color: "#6B6449" }}>
          {data.length} CATCH{data.length === 1 ? "" : "ES"} · {f.label.toUpperCase()}
        </div>
        <div className="space-y-1.5 mono text-xs" style={{ color: INK }}>
          {f.section === "ALL" && (
            <ReadLine
              label="Best section"
              value={
                sectionData.length && sectionData[0].name !== "Unmarked section"
                  ? `${sectionData[0].name} · ${sectionData[0].count} fish`
                  : null
              }
            />
          )}
          <ReadLine
            label="Best window"
            value={bestHour && bestHour.count > 0 ? `${hourLabelLong(bestHour.hour)} · ${bestHour.count} fish` : null}
          />
          <ReadLine
            label="Best water temp"
            value={bestWater ? `${bestWater.band}–${bestWater.band + 2}°F · ${bestWater.count} fish` : null}
          />
          <ReadLine
            label="Best flow"
            value={bestFlow ? `${bestFlow.band}–${bestFlow.band + 250} cfs · ${bestFlow.count} fish` : null}
          />
          <ReadLine label="Top fly" value={topFly ? `${topFly.name} · ${topFly.count} fish` : null} />
          <ReadLine
            label="Best spot"
            value={
              topSpot
                ? `${topSpot.entries.length} fish · ${sectionOf(topSpot.entries[0])}`
                : null
            }
          />
        </div>
        <div className="mono text-[10px] mt-3 pt-3 border-t" style={{ color: "#6B6449", borderColor: "#D9CFB5" }}>
          These count where fish were logged, not fish per hour fished. Read them as leads to check, not conclusions.
        </div>
      </div>

      {sectionData.length > 1 && (
        <ChartBlock title="CATCHES BY SECTION" subtitle="WHERE THE FISH ARE COMING FROM">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sectionData} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D9CFB5" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                stroke="#6B6449"
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                stroke="#6B6449"
              />
              <Tooltip contentStyle={{ fontFamily: "JetBrains Mono", fontSize: 11 }} />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {sectionData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? RUST : OLIVE} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartBlock>
      )}

      {hourData.length > 1 && (
        <ChartBlock title="CATCHES BY TIME OF DAY" subtitle="EACH BAR IS ONE HOUR">
          <CountBars data={hourData} />
        </ChartBlock>
      )}

      {waterData.length > 1 && (
        <ChartBlock title="WATER TEMPERATURE AT CATCH" subtitle="2°F BANDS">
          <CountBars data={waterData} />
        </ChartBlock>
      )}

      {flowData.length > 1 && (
        <ChartBlock title="FLOW AT CATCH" subtitle="250 CFS BANDS">
          <CountBars data={flowData} />
        </ChartBlock>
      )}

      {airData.length > 1 && (
        <ChartBlock title="AIR TEMPERATURE AT CATCH" subtitle="5°F BANDS">
          <CountBars data={airData} />
        </ChartBlock>
      )}

      <ChartBlock
        title="TOP PRODUCING FLIES"
        subtitle={`BASED ON ${data.length} LOGGED CATCH${data.length === 1 ? "" : "ES"}`}
      >
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
      </ChartBlock>

      {flowScatter.length > 1 && (
        <ChartBlock title="FLOW VS. WATER TEMP" subtitle="EACH DOT IS ONE LOGGED CATCH">
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
                domain={["dataMin - 2", "dataMax + 2"]}
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                stroke="#6B6449"
              />
              <Tooltip contentStyle={{ fontFamily: "JetBrains Mono", fontSize: 11 }} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={flowScatter} fill={RUST} />
            </ScatterChart>
          </ResponsiveContainer>
        </ChartBlock>
      )}
    </div>
  );
}

function ReadLine({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: "#6B6449" }}>{label}</span>
      <span className="text-right font-semibold" style={{ color: value ? INK : "#9C9678" }}>
        {value || "not enough data"}
      </span>
    </div>
  );
}

/* ---------- Catch modal (unchanged) ---------- */

function CatchModal({ draft, setDraft, entries, capturing, captureError, onSave, onClose, onRetryLocation, onManualLocate }) {
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const pick = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const knownRivers = useMemo(
    () => Array.from(new Set((entries || []).map(riverOf).filter((r) => r !== "Unknown water"))).sort(),
    [entries]
  );

  const knownSections = useMemo(() => {
    const river = (draft.river || "").trim().toLowerCase();
    const pool = (entries || []).filter((e) => {
      if (!(e.section || "").trim()) return false;
      if (!river) return true;
      return riverOf(e).toLowerCase() === river;
    });
    return Array.from(new Set(pool.map((e) => e.section.trim()))).sort();
  }, [entries, draft.river]);

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

        <Field label="River" value={draft.river} onChange={set("river")} placeholder="e.g. Snake River" />
        {knownRivers.length > 0 && (
          <ChipRow items={knownRivers} onPick={(v) => pick("river", v)} />
        )}

        <Field
          label="Section or run"
          value={draft.section}
          onChange={set("section")}
          placeholder="e.g. Conant to Byington"
        />
        {knownSections.length > 0 && (
          <ChipRow items={knownSections} onPick={(v) => pick("section", v)} />
        )}

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

function ChipRow({ items, onPick }) {
  return (
    <div className="flex gap-2 overflow-x-auto -mt-2 mb-3 pb-1">
      {items.slice(0, 12).map((v) => (
        <StampButton key={v} onClick={() => onPick(v)}>
          <div
            className="mono text-[10px] px-2.5 py-1 rounded-full border whitespace-nowrap"
            style={{ borderColor: "#D9CFB5", color: "#6B6449" }}
          >
            {v}
          </div>
        </StampButton>
      ))}
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
