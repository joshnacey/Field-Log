import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, Cell } from "recharts";
import { Fish, MapPin, Loader2, BookOpen, TrendingUp, Plus, X, Check, AlertTriangle, Map as MapIcon, Trash2, ClipboardList, Target, LogOut, WifiOff, CloudUpload, Pencil } from "lucide-react";
import { saveCatch as saveCatchToDb, updateCatch as updateCatchToDb, loadCatches, deleteCatch, saveAAR as saveAARToDb, loadAARs, deleteAAR, watchAuth, signIn, signUp, signOut, authErrorMessage } from "./firebase.js";

const FONT_IMPORT = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap";

const LOGO_DATA_URI = "/logo.png";

const RUST = "#B5482A";
const RUST_LT = "#D9663F";
const INK = "#ECE7D8"; // primary text (light on dark)
const PAPER = "#F1EADA"; // bright text on dark panels
const OLIVE = "#A8B07A"; // sage — headings/secondary
const OLIVE_DK = "#2A2D1B";
const BG = "#12140D"; // page background
const PANEL = "#171A0F"; // modal / popover surface

const SPECIES_OPTIONS = ["Rainbow Trout", "Brown Trout", "Cutthroat Trout", "Brook Trout", "Bull Trout", "Whitefish", "Other"];

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

/* ---------- historical conditions (for backfilling offline catches) ---------- */

// Asks USGS what the flow and water temp actually were at this place and time.
async function fetchHistoricalGauge(lat, lon, timestamp) {
  const when = new Date(timestamp);
  const start = new Date(when.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const end = new Date(when.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const boxes = [0.3, 0.6, 1.2, 2.5];

  for (const d of boxes) {
    const bbox = `${(lon - d).toFixed(2)},${(lat - d).toFixed(2)},${(lon + d).toFixed(2)},${(lat + d).toFixed(2)}`;
    const url =
      `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}` +
      `&parameterCd=00060,00010&startDT=${start}Z&endDT=${end}Z`;
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
        const points = s.values?.[0]?.value || [];
        if (points.length === 0) continue;

        // Pick the reading closest in time to when the fish was actually caught.
        let best = null;
        let bestGap = Infinity;
        for (const p of points) {
          const gap = Math.abs(new Date(p.dateTime).getTime() - timestamp);
          if (gap < bestGap) {
            bestGap = gap;
            best = p.value;
          }
        }
        if (best === null || best === undefined) continue;

        if (!bySite[siteCode]) {
          bySite[siteCode] = { name: s.sourceInfo.siteName, lat: geo.latitude, lon: geo.longitude };
        }
        if (paramCode === "00060") bySite[siteCode].flowCfs = parseFloat(best);
        if (paramCode === "00010") bySite[siteCode].waterTempC = parseFloat(best);
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

// Open-Meteo keeps a rolling week of past hours, which covers any realistic sync delay.
async function fetchHistoricalWeather(lat, lon, timestamp) {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,cloud_cover,wind_speed_10m&past_days=7` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const times = data?.hourly?.time || [];
    if (times.length === 0) return null;

    let bestIdx = -1;
    let bestGap = Infinity;
    for (let i = 0; i < times.length; i++) {
      const gap = Math.abs(new Date(times[i]).getTime() - timestamp);
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;

    return {
      temperature_2m: data.hourly.temperature_2m?.[bestIdx] ?? null,
      cloud_cover: data.hourly.cloud_cover?.[bestIdx] ?? null,
      wind_speed_10m: data.hourly.wind_speed_10m?.[bestIdx] ?? null,
    };
  } catch {
    return null;
  }
}

/* ---------- offline queue ---------- */

const QUEUE_CATCHES = "mtd-pending-catches";
const QUEUE_AARS = "mtd-pending-aars";

function readQueue(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    /* storage full or unavailable — nothing useful to do here */
  }
}

function queueEntry(key, entry) {
  const items = readQueue(key);
  items.push({ ...entry, queuedAt: Date.now() });
  writeQueue(key, items);
  return items.length;
}

function totalPending() {
  return readQueue(QUEUE_CATCHES).length + readQueue(QUEUE_AARS).length;
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

function ProfilePopover({ guideName, email, onClose, onSignOut }) {
  const initials = (guideName || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end overlay-blur animate-fade" onClick={onClose}>
      <div
        className="mt-[4.5rem] mr-4 w-64 rounded-2xl overflow-hidden elev-2 animate-scale-in"
        style={{ backgroundColor: PANEL, transformOrigin: "top right" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grad-header paper-texture px-4 pt-4 pb-4 flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center stencil text-lg shrink-0"
            style={{ backgroundColor: RUST, color: PAPER }}
          >
            {initials || "G"}
          </div>
          <div className="min-w-0">
            <div className="mono text-sm font-semibold truncate" style={{ color: PAPER }}>
              {guideName || "Guide"}
            </div>
            {email && (
              <div className="mono text-[10px] truncate mt-0.5" style={{ color: "#A8A283" }}>
                {email}
              </div>
            )}
          </div>
        </div>
        <div className="p-3">
          <div className="mono text-[9px] tracking-[0.2em] uppercase mb-2 px-1" style={{ color: "#93907A" }}>
            Signed in
          </div>
          <StampButton onClick={onSignOut} className="w-full">
            <div
              className="w-full py-2.5 rounded-xl mono text-xs font-semibold flex items-center justify-center gap-2 border press"
              style={{ borderColor: "#B5482A44", color: RUST, backgroundColor: "#B5482A0d" }}
            >
              <LogOut size={14} /> Sign out
            </div>
          </StampButton>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined = still checking
  const [view, setView] = useState("log");
  const [profileOpen, setProfileOpen] = useState(false);
  const guideName = (authUser?.displayName || authUser?.email || "").trim();
  const [entries, setEntries] = useState([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [toast, setToast] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [savingCatch, setSavingCatch] = useState(false);
  const [savingAar, setSavingAar] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  const [aars, setAars] = useState([]);
  const [aarsLoaded, setAarsLoaded] = useState(false);
  const [aarModalOpen, setAarModalOpen] = useState(false);
  const [aarDraft, setAarDraft] = useState(null);
  const [aarCapturing, setAarCapturing] = useState(false);
  const [pendingAarDelete, setPendingAarDelete] = useState(null);
  const [aarDeleting, setAarDeleting] = useState(false);

  useEffect(() => {
    const unsub = watchAuth((u) => setAuthUser(u || null));
    return unsub;
  }, []);

  // Cache the app on the phone so it opens with no signal.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Offline mode unavailable:", err);
      });
    }
  }, []);

  useEffect(() => {
    setPendingCount(totalPending());
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

  const loadMyAars = useCallback(async (uid, name) => {
    setAarsLoaded(false);
    try {
      const mine = await loadAARs(uid, name);
      setAars(mine);
    } catch (err) {
      console.error("Failed to load AARs:", err);
      setAars([]);
    }
    setAarsLoaded(true);
  }, []);

  useEffect(() => {
    if (authUser) loadMyAars(authUser.uid, guideName);
    else {
      setAars([]);
      setAarsLoaded(false);
    }
  }, [authUser, guideName, loadMyAars]);

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

  // Reopens the log form pre-filled to edit an already-logged catch. Keeps the
  // original GPS/conditions/timestamp — only the visible form fields are editable —
  // so we do NOT re-run locateAndFill().
  const startEditCatch = (entry) => {
    setCaptureError(null);
    setDraft({ ...entry });
    setModalOpen(true);
  };

  const saveCatch = async () => {
    if (!draft || savingCatch) return;
    if (!(draft.fly || "").trim() && !(draft.species || "").trim()) {
      showToast("Add a fly or species first");
      return;
    }
    const isEdit = !!draft.id;
    setSavingCatch(true);

    // An edit must not reassign authorship or catch time, so keep the draft's own
    // timestamp/guide/uid. A fresh catch stamps them now.
    const entry = isEdit
      ? { ...draft }
      : {
          ...draft,
          timestamp: Date.now(),
          guide: guideName || "Unnamed guide",
          uid: authUser?.uid || null,
        };

    if (isEdit) {
      if (!navigator.onLine) {
        showToast("You're offline — try again once you have signal");
        setSavingCatch(false);
        return;
      }
      try {
        const { id, ...fields } = entry;
        await updateCatchToDb(id, fields);
        showToast("Catch updated");
        setModalOpen(false);
        setDraft(null);
        loadEntries();
      } catch (err) {
        console.error("Update failed:", err);
        showToast("Couldn't save changes — try again");
      }
      setSavingCatch(false);
      return;
    }

    const stash = () => {
      queueEntry(QUEUE_CATCHES, entry);
      const n = totalPending();
      setPendingCount(n);
      showToast(`Saved to phone — ${n} waiting to upload`);
      setModalOpen(false);
      setDraft(null);
    };

    if (!navigator.onLine) {
      stash();
      setSavingCatch(false);
      return;
    }

    try {
      await saveCatchToDb(entry);
      showToast("Catch logged");
      setModalOpen(false);
      setDraft(null);
      loadEntries();
    } catch (err) {
      console.error("Save failed, queuing locally:", err);
      stash();
    }
    setSavingCatch(false);
  };

  // Uploads anything logged out of service, filling in what the conditions
  // actually were at the time and place it was recorded.
  const syncQueue = useCallback(async () => {
    if (syncing || !navigator.onLine) return;
    const catches = readQueue(QUEUE_CATCHES);
    const aars = readQueue(QUEUE_AARS);
    if (catches.length === 0 && aars.length === 0) {
      setPendingCount(0);
      return;
    }

    setSyncing(true);

    const backfill = async (item) => {
      const entry = { ...item };
      delete entry.queuedAt;
      const needsConditions = entry.lat != null && entry.lon != null && entry.flowCfs == null;
      if (!needsConditions) return entry;

      const [gauge, weather] = await Promise.all([
        fetchHistoricalGauge(entry.lat, entry.lon, entry.timestamp),
        fetchHistoricalWeather(entry.lat, entry.lon, entry.timestamp),
      ]);
      if (gauge) {
        entry.flowCfs = gauge.flowCfs ?? null;
        entry.waterTempF = gauge.waterTempC != null ? cToF(gauge.waterTempC) : null;
        entry.gaugeName = entry.gaugeName || gauge.name || null;
        entry.gaugeDistance = entry.gaugeDistance ?? gauge.distance ?? null;
        if (!(entry.river || "").trim()) entry.river = prettyRiver(gauge.name) || "";
      }
      if (weather) {
        entry.airTempF = weather.temperature_2m != null ? Math.round(weather.temperature_2m) : null;
        entry.windMph = weather.wind_speed_10m != null ? Math.round(weather.wind_speed_10m) : null;
        entry.cloudCover = weather.cloud_cover ?? null;
      }
      return entry;
    };

    const drain = async (items, save) => {
      const stillPending = [];
      for (const item of items) {
        try {
          const entry = await backfill(item);
          await save(entry);
        } catch (err) {
          console.error("Sync failed for one entry, keeping it queued:", err);
          stillPending.push(item);
        }
      }
      return stillPending;
    };

    const catchesLeft = await drain(catches, saveCatchToDb);
    const aarsLeft = await drain(aars, saveAARToDb);

    writeQueue(QUEUE_CATCHES, catchesLeft);
    writeQueue(QUEUE_AARS, aarsLeft);
    setPendingCount(catchesLeft.length + aarsLeft.length);
    setSyncing(false);

    const uploadedCatches = catches.length - catchesLeft.length;
    const uploadedAars = aars.length - aarsLeft.length;
    if (uploadedCatches > 0 || uploadedAars > 0) {
      const parts = [];
      if (uploadedCatches > 0) parts.push(`${uploadedCatches} catch${uploadedCatches === 1 ? "" : "es"}`);
      if (uploadedAars > 0) parts.push(`${uploadedAars} review${uploadedAars === 1 ? "" : "s"}`);
      showToast(`${parts.join(" and ")} uploaded`);
      if (uploadedCatches > 0) loadEntries();
      if (uploadedAars > 0) loadMyAars(authUser?.uid, guideName);
    }
  }, [syncing, loadEntries, loadMyAars, authUser, guideName]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      syncQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [syncQueue]);

  useEffect(() => {
    if (authUser && navigator.onLine) syncQueue();
  }, [authUser, syncQueue]);

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

  const locateAar = useCallback(() => {
    setAarCapturing(true);
    if (!navigator.geolocation) {
      setAarCapturing(false);
      return;
    }
    const fill = async (lat, lon) => {
      const [gauge, weather] = await Promise.all([fetchNearestGauge(lat, lon), fetchAirTemp(lat, lon)]);
      setAarDraft((d) =>
        d
          ? {
              ...d,
              lat,
              lon,
              flowCfs: gauge?.flowCfs ?? null,
              waterTempF: gauge?.waterTempC != null ? cToF(gauge.waterTempC) : null,
              gaugeName: gauge?.name ?? null,
              gaugeDistance: gauge?.distance ?? null,
              river: (d.river || "").trim() || prettyRiver(gauge?.name) || "",
              airTempF: weather?.temperature_2m != null ? Math.round(weather.temperature_2m) : null,
              windMph: weather?.wind_speed_10m != null ? Math.round(weather.wind_speed_10m) : null,
              cloudCover: weather?.cloud_cover ?? null,
            }
          : d
      );
      setAarCapturing(false);
    };
    navigator.geolocation.getCurrentPosition(
      (pos) => fill(pos.coords.latitude, pos.coords.longitude),
      () => setAarCapturing(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  const startAar = () => {
    setAarDraft({
      type: "aar",
      conditions: "",
      diagnosis: "",
      decision: "",
      result: "",
      miss: "",
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
    setAarModalOpen(true);
    locateAar();
  };

  const saveAarEntry = async () => {
    if (!aarDraft || savingAar) return;
    if (!(aarDraft.miss || "").trim()) {
      showToast("Miss is required — that's the point");
      return;
    }
    setSavingAar(true);
    const entry = {
      ...aarDraft,
      timestamp: Date.now(),
      guide: guideName || "Unnamed guide",
      uid: authUser?.uid || null,
    };

    const stash = () => {
      queueEntry(QUEUE_AARS, entry);
      const n = totalPending();
      setPendingCount(n);
      showToast(`Review saved to phone — ${n} waiting to upload`);
      setAarModalOpen(false);
      setAarDraft(null);
    };

    if (!navigator.onLine) {
      stash();
      setSavingAar(false);
      return;
    }

    try {
      await saveAARToDb(entry);
      showToast("AAR logged");
      setAarModalOpen(false);
      setAarDraft(null);
      loadMyAars(authUser?.uid, guideName);
    } catch (err) {
      console.error("AAR save failed, queuing locally:", err);
      stash();
    }
    setSavingAar(false);
  };

  const confirmAarDelete = async () => {
    if (!pendingAarDelete) return;
    setAarDeleting(true);
    try {
      await deleteAAR(pendingAarDelete.id);
      setAars((a) => a.filter((e) => e.id !== pendingAarDelete.id));
      showToast("AAR deleted");
      setPendingAarDelete(null);
    } catch (err) {
      console.error("AAR delete failed:", err);
      showToast("Couldn't delete — try again");
    }
    setAarDeleting(false);
  };

  if (authUser === undefined) {
    return (
      <div
        className="topo-bg min-h-screen w-full flex items-center justify-center"
        style={{ color: INK }}
      >
        <style>{`@import url('${FONT_IMPORT}'); .mono { font-family: 'JetBrains Mono', monospace; }`}</style>
        <div className="flex items-center gap-2 mono text-sm" style={{ color: OLIVE }}>
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  if (!authUser) {
    return <AuthScreen />;
  }

  return (
    <div
      className="topo-bg min-h-screen w-full"
      style={{ color: INK, fontFamily: "Inter, sans-serif" }}
    >
      <style>{`@import url('${FONT_IMPORT}');
        .stencil { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.06em; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .paper-texture { background-image: radial-gradient(${PAPER}14 1px, transparent 1px); background-size: 16px 16px; }
      `}</style>

      {/* Header */}
      <div className="grad-header paper-texture px-5 pt-7 pb-6 sticky top-0 z-20 elev-header">
        <div className="flex items-center justify-between">
          <div>
            <div className="stencil text-5xl leading-none" style={{ color: PAPER }}>
              FIELD LOG
            </div>
            <div className="mono text-[10px] tracking-[0.22em] mt-2" style={{ color: "#A8A283" }}>
              MEND THE DRIFT · SHARED GUIDE JOURNAL
            </div>
          </div>
          <StampButton onClick={() => setProfileOpen(true)} className="shrink-0">
            <img
              src={LOGO_DATA_URI}
              alt="Profile"
              className="w-11 h-11 rounded-full lift"
              style={{ border: `1px solid ${RUST}`, boxShadow: "0 4px 12px rgba(0,0,0,0.35)" }}
            />
          </StampButton>
        </div>
      </div>

      {/* Guide name bar */}
      <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: "rgba(255,255,255,0.09)", backgroundColor: "#15180E" }}>
        <div className="min-w-0">
          <div className="mono text-[9px] tracking-[0.2em] uppercase" style={{ color: "#93907A" }}>
            Logging as
          </div>
          <div className="mono text-sm font-semibold truncate mt-0.5" style={{ color: INK }}>
            {guideName}
          </div>
        </div>
        <StampButton onClick={() => signOut()} className="shrink-0 ml-3">
          <div className="mono text-[9px] tracking-[0.16em] uppercase flex items-center gap-1.5 px-3 py-2 rounded-full border press" style={{ borderColor: "#B5482A44", color: RUST, backgroundColor: "#B5482A0d" }}>
            <LogOut size={12} /> Sign out
          </div>
        </StampButton>
      </div>

      {profileOpen && (
        <ProfilePopover
          guideName={guideName}
          email={authUser?.email}
          onClose={() => setProfileOpen(false)}
          onSignOut={() => { setProfileOpen(false); signOut(); }}
        />
      )}

      {(!online || pendingCount > 0) && (
        <div
          className="px-5 py-2 flex items-center gap-2 mono text-[11px]"
          style={{ backgroundColor: !online ? "#3D4128" : "#B5482A", color: PAPER }}
        >
          {syncing ? (
            <Loader2 size={13} className="animate-spin shrink-0" />
          ) : !online ? (
            <WifiOff size={13} className="shrink-0" />
          ) : (
            <CloudUpload size={13} className="shrink-0" />
          )}
          <span>
            {syncing
              ? "Uploading and filling in conditions…"
              : !online
              ? pendingCount > 0
                ? `No service — ${pendingCount} entr${pendingCount === 1 ? "y" : "ies"} saved on your phone`
                : "No service — entries will save to your phone"
              : `${pendingCount} entr${pendingCount === 1 ? "y" : "ies"} waiting to upload`}
          </span>
          {online && pendingCount > 0 && !syncing && (
            <StampButton onClick={syncQueue} className="ml-auto shrink-0">
              <div className="mono text-[10px] tracking-widest uppercase underline">Upload now</div>
            </StampButton>
          )}
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
            onEdit={startEditCatch}
          />
        )}
        {view === "history" && (
          <HistoryView
            entries={entries}
            loaded={entriesLoaded}
            guideName={guideName}
            onRequestDelete={requestDelete}
            onEdit={startEditCatch}
          />
        )}
        {view === "map" && <MapView entries={entries} loaded={entriesLoaded} />}
        {view === "patterns" && <PatternsView entries={entries} />}
        {view === "aar" && (
          <AARView
            aars={aars}
            loaded={aarsLoaded}
            guideName={guideName}
            onStart={startAar}
            onRequestDelete={setPendingAarDelete}
          />
        )}
      </div>

      {/* Floating capsule bottom nav */}
      <div
        className="fixed left-0 right-0 z-30 flex justify-center px-4 pointer-events-none"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)" }}
      >
        <div className="glass-strong elev-nav rounded-full flex items-stretch gap-0.5 px-1.5 py-1.5 pointer-events-auto">
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
          <NavButton
            active={view === "aar"}
            onClick={() => setView("aar")}
            icon={<ClipboardList size={20} />}
            label="AAR"
          />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="grad-rust animate-toast fixed top-24 left-1/2 z-50 px-5 py-2.5 rounded-full stencil text-sm elev-2 flex items-center gap-2"
          style={{ color: PAPER }}
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
          online={online}
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

      {/* AAR modal */}
      {aarModalOpen && aarDraft && (
        <AARModal
          draft={aarDraft}
          setDraft={setAarDraft}
          online={online}
          capturing={aarCapturing}
          onSave={saveAarEntry}
          onClose={() => {
            setAarModalOpen(false);
            setAarDraft(null);
          }}
        />
      )}

      {/* AAR delete confirm */}
      {pendingAarDelete && (
        <AARDeleteConfirm
          entry={pendingAarDelete}
          busy={aarDeleting}
          onCancel={() => setPendingAarDelete(null)}
          onConfirm={confirmAarDelete}
        />
      )}
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("in"); // "in" or "up"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Email and password are both required.");
      return;
    }
    if (mode === "up" && !name.trim()) {
      setError("Add your name — it's how your catches get filed.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "up") await signUp(email, password, name, code);
      else await signIn(email, password);
      // watchAuth in App will pick it up and swap the screen.
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="topo-bg min-h-screen w-full flex flex-col" style={{ color: INK, fontFamily: "Inter, sans-serif" }}>
      <style>{`@import url('${FONT_IMPORT}');
        .stencil { font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.06em; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .paper-texture { background-image: radial-gradient(${PAPER}14 1px, transparent 1px); background-size: 16px 16px; }
      `}</style>

      <div className="grad-header paper-texture px-6 pt-20 pb-12 text-center elev-header">
        <img src={LOGO_DATA_URI} alt="Mend the Drift" className="w-24 h-24 rounded-full mx-auto mb-5 glossy" style={{ border: `1px solid ${RUST}`, backgroundColor: "#000", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }} />
        <div className="stencil text-5xl leading-none" style={{ color: PAPER }}>
          FIELD LOG
        </div>
        <div className="mono text-[10px] tracking-[0.18em] mt-3" style={{ color: "#A8A283" }}>
          MEND THE DRIFT · SHARED GUIDE JOURNAL
        </div>
      </div>

      <div className="px-6 pt-10 pb-10 flex-1 max-w-md w-full mx-auto animate-slide-up">
        <div className="stencil text-3xl mb-1" style={{ color: OLIVE }}>
          {mode === "in" ? "SIGN IN" : "CREATE ACCOUNT"}
        </div>
        <div className="mono text-[11px] mb-7" style={{ color: "#9E9A82" }}>
          {mode === "in"
            ? "Your reviews are private to your account."
            : "One account per guide. Your AARs stay yours."}
        </div>

        {mode === "up" && (
          <AuthField label="Name" value={name} onChange={setName} placeholder="Joshua Nacey" />
        )}
        <AuthField label="Email" value={email} onChange={setEmail} placeholder="you@example.com" type="email" />
        <AuthField label="Password" value={password} onChange={setPassword} placeholder="At least 6 characters" type="password" />
        {mode === "up" && (
          <AuthField label="Signup code" value={code} onChange={setCode} placeholder="From whoever gave you the app" />
        )}

        {error && (
          <div className="mono text-xs mt-1 mb-2 flex items-start gap-1.5" style={{ color: RUST }}>
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <StampButton onClick={busy ? () => {} : submit} className="w-full mt-6">
          <div
            className="grad-rust press w-full py-3.5 rounded-2xl stencil text-xl flex items-center justify-center gap-2 elev-1 glow-rust-soft"
            style={{ color: PAPER, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            {mode === "in" ? "SIGN IN" : "CREATE ACCOUNT"}
          </div>
        </StampButton>

        <div className="text-center mt-6">
          <StampButton
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setError(null);
            }}
          >
            <div className="mono text-xs" style={{ color: OLIVE }}>
              {mode === "in" ? "No account yet? Create one" : "Already have an account? Sign in"}
            </div>
          </StampButton>
        </div>
      </div>
    </div>
  );
}

function AuthField({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div className="mb-4">
      <label className="mono text-[10px] tracking-[0.16em] uppercase" style={{ color: "#93907A" }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        autoCapitalize={type === "email" || type === "password" ? "none" : "words"}
        autoCorrect="off"
        className="field-input w-full text-sm font-medium outline-none border rounded-xl px-3.5 py-3 mt-1.5"
        style={{ color: INK, borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" }}
      />
    </div>
  );
}

function NavButton({ active, onClick, icon, label }) {
  return (
    <StampButton
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-1 min-w-0 press rounded-full px-3.5 py-2"
    >
      <div
        className="flex items-center justify-center rounded-full w-10 h-10 transition-all duration-200"
        style={
          active
            ? { color: PAPER, background: "linear-gradient(140deg, #C1502F 0%, #9A3D22 100%)", boxShadow: "0 0 18px rgba(181,72,42,0.55)" }
            : { color: "#8A8770", backgroundColor: "transparent" }
        }
      >
        {icon}
      </div>
      <div
        className="mono text-[8px] tracking-[0.14em] uppercase truncate max-w-full transition-colors duration-200"
        style={{ color: active ? RUST_LT : "#6f6c58", fontWeight: active ? 700 : 500 }}
      >
        {label}
      </div>
    </StampButton>
  );
}

function LogView({ onStartCatch, recent, loaded, guideName, onRequestDelete, onEdit }) {
  return (
    <div className="animate-fade">
      <div className="text-center py-10">
        <StampButton
          onClick={onStartCatch}
          className="rounded-full w-44 h-44 flex flex-col items-center justify-center mx-auto lift"
        >
          <div
            className="rounded-full w-44 h-44 flex items-center justify-center overflow-hidden elev-2 glossy"
            style={{ backgroundColor: "#000", border: `1px solid ${RUST}` }}
          >
            <img
              src={LOGO_DATA_URI}
              alt="Mend the Drift"
              className="w-full h-full object-cover"
              style={{ transform: "scale(1.08)" }}
            />
          </div>
        </StampButton>
        <div className="stencil text-2xl mt-5 tracking-wide" style={{ color: RUST }}>
          LOG CATCH
        </div>
        <div className="mono text-[11px] mt-1.5" style={{ color: "#9E9A82" }}>
          Captures GPS, flow, and temp automatically
        </div>
      </div>

      <div className="mt-2">
        <div className="stencil text-xl mb-3" style={{ color: OLIVE }}>
          RECENT ENTRIES
        </div>
        {!loaded && <LoadingRow />}
        {loaded && recent.length === 0 && (
          <EmptyState
            title="NO CATCHES YET"
            body="Tap the button above to log your first. GPS, flow, and water temp fill in automatically."
          />
        )}
        <div className="space-y-3">
          {recent.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              compact
              canDelete={ownsEntry(e, guideName)}
              onRequestDelete={onRequestDelete}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EntryCard({ entry, compact, canDelete, onRequestDelete, onEdit }) {
  const date = new Date(entry.timestamp);
  const timerRef = useRef(null);
  const firedRef = useRef(false); // long-press completed — suppress the tap-to-edit click
  const [held, setHeld] = useState(false);

  const startHold = () => {
    if (!canDelete) return;
    firedRef.current = false;
    setHeld(true);
    timerRef.current = setTimeout(() => {
      setHeld(false);
      firedRef.current = true;
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

  const handleClick = () => {
    if (firedRef.current) {
      firedRef.current = false;
      return;
    }
    if (canDelete && onEdit) onEdit(entry);
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
      onClick={handleClick}
      onContextMenu={(e) => {
        if (canDelete) e.preventDefault();
      }}
      className="border rounded-2xl p-4 lift elev-1"
      style={{
        borderColor: held ? RUST : "rgba(255,255,255,0.09)",
        backgroundColor: held ? "rgba(181,72,42,0.16)" : "rgba(255,255,255,0.04)",
        transform: held ? "scale(0.98)" : "scale(1)",
        cursor: canDelete && onEdit ? "pointer" : "default",
        WebkitUserSelect: canDelete ? "none" : "auto",
        userSelect: canDelete ? "none" : "auto",
        WebkitTouchCallout: "none",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="stencil text-lg" style={{ color: OLIVE }}>
          {entry.species || "Trout"} {entry.size ? `· ${entry.size}"` : ""}
        </div>
        <div className="mono text-[10px] shrink-0" style={{ color: "#93907A" }}>
          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      <div className="mono text-[11px] mt-1.5 font-bold tracking-wide" style={{ color: RUST }}>
        {riverOf(entry)} · {sectionOf(entry)}
      </div>
      <div className="mono text-xs mt-1.5" style={{ color: INK }}>
        <span style={{ color: "#93907A" }}>Fly:</span> {entry.fly || "—"} &nbsp;·&nbsp;{" "}
        <span style={{ color: "#93907A" }}>Guide:</span> {entry.guide}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {entry.flowCfs != null && <Tag label={`${entry.flowCfs} cfs`} />}
        {entry.waterTempF != null && <Tag label={`${entry.waterTempF}°F water`} />}
        {entry.airTempF != null && <Tag label={`${entry.airTempF}°F air`} />}
        {entry.flowCfs == null && entry.waterTempF == null && entry.airTempF == null && (
          <Tag label="no conditions logged" muted />
        )}
      </div>
      {!compact && entry.notes && (
        <div className="mono text-xs mt-3 italic leading-relaxed" style={{ color: "#9E9A82" }}>
          "{entry.notes}"
        </div>
      )}
      {!compact && entry.gaugeName && (
        <div className="mono text-[10px] mt-2.5" style={{ color: "#82806A" }}>
          Gauge: {entry.gaugeName} ({entry.gaugeDistance?.toFixed(1)} mi)
        </div>
      )}
      {canDelete && (
        <div className="mono text-[9px] mt-2.5 flex items-center gap-1.5" style={{ color: "#82806A" }}>
          <Pencil size={9} /> Tap to edit
          <span aria-hidden="true">·</span>
          <Trash2 size={9} /> Press and hold to delete
        </div>
      )}
    </div>
  );
}

function Tag({ label, muted }) {
  return (
    <span
      className="mono text-[10px] px-2.5 py-1 rounded-full border font-medium"
      style={
        muted
          ? { borderColor: "rgba(255,255,255,0.1)", color: "#82806A", backgroundColor: "rgba(255,255,255,0.04)" }
          : { borderColor: "#B5482A55", color: RUST, backgroundColor: "#B5482A0f" }
      }
    >
      {label}
    </span>
  );
}

function LoadingRow() {
  return (
    <div className="mono text-xs flex items-center gap-2 py-2" style={{ color: "#9E9A82" }}>
      <Loader2 size={14} className="animate-spin" /> Loading…
    </div>
  );
}

function EmptyState({ icon, title, body }) {
  return (
    <div
      className="rounded-2xl border border-dashed px-6 py-10 text-center flex flex-col items-center gap-3 animate-fade"
      style={{ borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.04)" }}
    >
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: "#B5482A12", color: RUST }}
      >
        {icon || <Fish size={26} strokeWidth={1.5} />}
      </div>
      <div className="stencil text-xl" style={{ color: OLIVE }}>
        {title}
      </div>
      <div className="mono text-[11px] leading-relaxed max-w-xs" style={{ color: "#9E9A82" }}>
        {body}
      </div>
    </div>
  );
}

function DeleteConfirm({ entry, busy, onCancel, onConfirm }) {
  const date = new Date(entry.timestamp);
  return (
    <div
      className="overlay-blur animate-fade fixed inset-0 z-50 flex items-center justify-center px-6"
    >
      <div className="w-full sm:max-w-sm rounded-3xl overflow-hidden elev-2 animate-scale-in" style={{ backgroundColor: PANEL }}>
        <div className="grad-header paper-texture px-5 py-4">
          <div className="stencil text-2xl leading-none" style={{ color: PAPER }}>
            DELETE ENTRY
          </div>
          <div className="mono text-[10px] tracking-wide mt-1" style={{ color: "#82806A" }}>
            THIS REMOVES IT FOR EVERY GUIDE
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="mono text-xs" style={{ color: INK }}>
            {entry.species || "Trout"}
            {entry.size ? ` · ${entry.size}"` : ""} — {entry.fly || "no fly logged"}
          </div>
          <div className="mono text-[10px] mt-1" style={{ color: "#9E9A82" }}>
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
            {riverOf(entry)}
          </div>
          <div className="mono text-[11px] mt-3" style={{ color: RUST }}>
            Deleted entries can't be recovered.
          </div>
          <div className="flex gap-2.5 mt-6">
            <StampButton onClick={onCancel} className="flex-1">
              <div
                className="press w-full py-3 rounded-2xl stencil text-lg border"
                style={{ borderColor: OLIVE, color: OLIVE, backgroundColor: "#3D41280a" }}
              >
                KEEP
              </div>
            </StampButton>
            <StampButton onClick={busy ? () => {} : onConfirm} className="flex-1">
              <div
                className="grad-rust press w-full py-3 rounded-2xl stencil text-lg flex items-center justify-center gap-2 elev-1 glow-rust-soft"
                style={{ color: PAPER, opacity: busy ? 0.6 : 1 }}
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

function HistoryView({ entries, loaded, guideName, onRequestDelete, onEdit }) {
  const f = useWaterFilter(entries);

  if (!loaded) return <LoadingRow />;
  if (entries.length === 0)
    return (
      <EmptyState
        icon={<BookOpen size={26} strokeWidth={1.5} />}
        title="NO ENTRIES YET"
        body="Logged catches will collect here, filterable by river and section."
      />
    );

  return (
    <div className="animate-fade">
      <WaterFilter f={f} />

      <div className="stencil text-xl mb-1 mt-2" style={{ color: OLIVE }}>
        {f.label.toUpperCase()} ({f.filtered.length})
      </div>
      <div className="mono text-[10px] tracking-wide mb-4" style={{ color: "#93907A" }}>
        PRESS AND HOLD YOUR OWN ENTRY TO DELETE IT
      </div>

      {f.filtered.length === 0 && (
        <div className="mono text-xs italic" style={{ color: "#9E9A82" }}>
          Nothing logged on this water yet.
        </div>
      )}

      <div className="space-y-3">
        {f.filtered.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            canDelete={ownsEntry(e, guideName)}
            onRequestDelete={onRequestDelete}
            onEdit={onEdit}
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
    <div className="chip-scroll flex gap-2 overflow-x-auto pb-2.5 -mx-1 px-1">
      {["ALL", ...items].map((r) => {
        const active = value === r;
        return (
          <StampButton key={r} onClick={() => onPick(r)}>
            <div
              className={`chip mono text-[10px] tracking-wide px-3.5 py-1.5 rounded-full border whitespace-nowrap font-medium ${active ? "grad-rust" : ""}`}
              style={{
                borderColor: active ? "transparent" : "rgba(255,255,255,0.09)",
                backgroundColor: active ? undefined : "rgba(255,255,255,0.04)",
                color: active ? PAPER : "#9E9A82",
                boxShadow: active ? "0 3px 10px rgba(181,72,42,0.3)" : "none",
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
          <div style="color:#9E9A82">${sectionOf(s.entries[0])}</div>
          ${topFly ? `<div>Top fly: ${topFly.name} (${topFly.count})</div>` : ""}
          ${avgSize ? `<div>Avg size: ${avgSize}"</div>` : ""}
          <div style="color:#9E9A82">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</div>
        </div>`
      );
      marker.addTo(layerRef.current);
    });

    const bounds = L.latLngBounds(spots.map((s) => [s.lat, s.lon]));
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 150);
  }, [spots, status]);

  return (
    <div className="animate-fade">
      <div className="stencil text-xl mb-1" style={{ color: OLIVE }}>
        CATCH MAP
      </div>
      <div className="mono text-[10px] tracking-wide mb-4" style={{ color: "#93907A" }}>
        BIGGER CIRCLE = MORE FISH. TAP ONE FOR THE READ.
      </div>

      <WaterFilter f={f} />

      {loaded && geo.length === 0 && (
        <EmptyState
          icon={<MapIcon size={26} strokeWidth={1.5} />}
          title="NOTHING TO PLOT YET"
          body="Catches logged with GPS or manual coordinates will drop pins here, sized by how many fish came from each spot."
        />
      )}

      <div
        className="rounded-2xl overflow-hidden border relative elev-1"
        style={{ borderColor: "rgba(255,255,255,0.09)", height: "42vh", minHeight: 260, display: loaded && geo.length === 0 ? "none" : "block" }}
      >
        <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
        {status === "loading" && (
          <div
            className="absolute inset-0 flex items-center justify-center mono text-xs gap-2"
            style={{ backgroundColor: "#15180E", color: OLIVE }}
          >
            <Loader2 size={14} className="animate-spin" /> Loading map…
          </div>
        )}
        {status === "error" && (
          <div
            className="absolute inset-0 flex items-center justify-center mono text-xs px-6 text-center"
            style={{ backgroundColor: "#15180E", color: RUST }}
          >
            Map couldn't load. Check your connection and reopen this tab.
          </div>
        )}
      </div>

      {spots.length > 0 && (
        <div className="mt-6">
          <div className="stencil text-xl mb-3" style={{ color: OLIVE }}>
            TOP SPOTS
          </div>
          <div className="space-y-3">
            {spots.slice(0, 5).map((s, i) => {
              const topFly = topOf(s.entries, (e) => e.fly?.trim());
              return (
                <div
                  key={i}
                  className="border rounded-2xl p-4 flex items-start justify-between gap-3 lift elev-1"
                  style={{ borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" }}
                >
                  <div>
                    <div className="stencil text-lg" style={{ color: i === 0 ? RUST : OLIVE }}>
                      {s.entries.length} FISH
                    </div>
                    <div className="mono text-[10px] mt-1" style={{ color: "#9E9A82" }}>
                      {riverOf(s.entries[0])} · {sectionOf(s.entries[0])}
                    </div>
                    {topFly && (
                      <div className="mono text-[10px] mt-0.5" style={{ color: INK }}>
                        Top fly: {topFly.name}
                      </div>
                    )}
                  </div>
                  <div className="mono text-[10px] text-right shrink-0" style={{ color: "#82806A" }}>
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

const TOOLTIP_STYLE = {
  fontFamily: "JetBrains Mono",
  fontSize: 11,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
  backgroundColor: "#1C1F14",
  color: "#ECE7D8",
};
const TOOLTIP_CURSOR = { fill: "rgba(255,255,255,0.06)" };

function ChartBlock({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border p-4 elev-1" style={{ borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" }}>
      <div className="stencil text-xl mb-1" style={{ color: OLIVE }}>
        {title}
      </div>
      <div className="mono text-[10px] tracking-wide mb-4" style={{ color: "#93907A" }}>
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
        <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#9E9A82" }}
          stroke="rgba(255,255,255,0.16)"
          tickLine={false}
          interval={0}
          angle={data.length > 8 ? -40 : 0}
          textAnchor={data.length > 8 ? "end" : "middle"}
          height={data.length > 8 ? 46 : 24}
        />
        <YAxis tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#9E9A82" }} stroke="rgba(255,255,255,0.16)" tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={54}>
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

  const speciesData = useMemo(() => {
    const counts = {};
    data.forEach((e) => {
      const s = e.species?.trim() || "Unlogged";
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
  const topSpecies = useMemo(() => topOf(data, (e) => e.species?.trim()), [data]);
  const topSpot = useMemo(() => {
    const geo = data.filter((e) => e.lat != null && e.lon != null);
    const spots = clusterEntries(geo);
    return spots.length ? spots[0] : null;
  }, [data]);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<TrendingUp size={26} strokeWidth={1.5} />}
        title="NO PATTERNS YET"
        body="Log a few catches first — the read, charts, and best-window analysis surface here once there's data to work with."
      />
    );
  }

  return (
    <div className="space-y-8 animate-fade">
      <WaterFilter f={f} />

      {/* The Read */}
      <div className="rounded-2xl border p-5 elev-1" style={{ borderColor: "#B5482A55", backgroundColor: "rgba(255,255,255,0.04)" }}>
        <div className="stencil text-2xl mb-1" style={{ color: RUST }}>
          THE READ
        </div>
        <div className="mono text-[10px] tracking-wide mb-4" style={{ color: "#93907A" }}>
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
          <ReadLine label="Top species" value={topSpecies ? `${topSpecies.name} · ${topSpecies.count} fish` : null} />
          <ReadLine
            label="Best spot"
            value={
              topSpot
                ? `${topSpot.entries.length} fish · ${sectionOf(topSpot.entries[0])}`
                : null
            }
          />
        </div>
        <div className="mono text-[10px] mt-3 pt-3 border-t" style={{ color: "#9E9A82", borderColor: "rgba(255,255,255,0.09)" }}>
          These count where fish were logged, not fish per hour fished. Read them as leads to check, not conclusions.
        </div>
      </div>

      {sectionData.length > 1 && (
        <ChartBlock title="CATCHES BY SECTION" subtitle="WHERE THE FISH ARE COMING FROM">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sectionData} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.09)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9E9A82" }}
                stroke="#9E9A82"
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#9E9A82" }}
                stroke="#9E9A82"
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {sectionData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? RUST : OLIVE} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartBlock>
      )}

      {speciesData.length > 1 && (
        <ChartBlock title="CATCHES BY SPECIES" subtitle="HOW YOUR FISHING BREAKS DOWN">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={speciesData} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.09)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9E9A82" }}
                stroke="#9E9A82"
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#9E9A82" }}
                stroke="#9E9A82"
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {speciesData.map((_, i) => (
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
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.09)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9E9A82" }} stroke="#9E9A82" allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={90}
              tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9E9A82" }}
              stroke="#9E9A82"
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={TOOLTIP_CURSOR} />
            <Bar dataKey="count" radius={[0, 6, 6, 0]}>
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
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.09)" />
              <XAxis
                type="number"
                dataKey="x"
                name="Flow"
                unit=" cfs"
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9E9A82" }}
                stroke="#9E9A82"
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Water Temp"
                unit="°F"
                domain={["dataMin - 2", "dataMax + 2"]}
                tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9E9A82" }}
                stroke="#9E9A82"
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.16)" }} />
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
      <span style={{ color: "#9E9A82" }}>{label}</span>
      <span className="text-right font-semibold" style={{ color: value ? INK : "#82806A" }}>
        {value || "not enough data"}
      </span>
    </div>
  );
}

/* ---------- AAR (private after-action review) ---------- */

// Pulls the words that recur across a guide's Misses — a rough pattern-of-life on themselves.
const STOPWORDS = new Set(
  "the a an and or but to of in on at for with was were is are be been it its i we my our me us that this had has have did do you your they them he she his her fish fishing water river run day today too very just really more most some any not no".split(
    /\s+/
  )
);

function recurringMissTerms(aars) {
  const counts = {};
  aars.forEach((e) => {
    const words = (e.miss || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
    new Set(words).forEach((w) => {
      counts[w] = (counts[w] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term, count]) => ({ term, count }));
}

function AARView({ aars, loaded, guideName, onStart, onRequestDelete }) {
  const terms = useMemo(() => recurringMissTerms(aars), [aars]);
  const hasName = (guideName || "").trim().length > 0;

  return (
    <div className="animate-fade">
      <div className="stencil text-xl mb-1" style={{ color: OLIVE }}>
        AFTER-ACTION REVIEW
      </div>
      <div className="mono text-[10px] tracking-wide mb-4" style={{ color: "#93907A" }}>
        PRIVATE TO YOU. NO OTHER GUIDE SEES THESE.
      </div>

      {!hasName && (
        <div className="rounded-2xl border p-4 mb-4 mono text-xs elev-1" style={{ borderColor: "#B5482A66", color: RUST, backgroundColor: "#B5482A0a" }}>
          Set your name up top first. Your AARs are filed under it — without a name they can't stay yours.
        </div>
      )}

      <StampButton onClick={hasName ? onStart : () => {}} className="w-full mb-6">
        <div
          className={`press w-full py-3.5 rounded-2xl stencil text-xl flex items-center justify-center gap-2 ${hasName ? "grad-rust elev-1 glow-rust-soft" : ""}`}
          style={{ backgroundColor: hasName ? undefined : "#82806A", color: PAPER, opacity: hasName ? 1 : 0.85 }}
        >
          <Plus size={18} /> NEW AAR
        </div>
      </StampButton>

      {/* Recurring misses read-back */}
      {aars.length >= 2 && (
        <div className="rounded-2xl border p-5 mb-6 elev-1" style={{ borderColor: "#B5482A55", backgroundColor: "rgba(255,255,255,0.04)" }}>
          <div className="stencil text-xl mb-1 flex items-center gap-2" style={{ color: RUST }}>
            <Target size={16} /> YOUR RECURRING MISSES
          </div>
          <div className="mono text-[10px] tracking-wide mb-3.5" style={{ color: "#93907A" }}>
            WORDS THAT KEEP SHOWING UP ACROSS {aars.length} REVIEWS
          </div>
          {terms.length === 0 ? (
            <div className="mono text-xs italic" style={{ color: "#9E9A82" }}>
              No repeats yet. Keep filing — patterns surface once the same miss shows up twice.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {terms.map((t) => (
                <span
                  key={t.term}
                  className="grad-rust mono text-[11px] px-3 py-1.5 rounded-full font-medium"
                  style={{ color: PAPER, boxShadow: "0 2px 8px rgba(181,72,42,0.25)" }}
                >
                  {t.term} · {t.count}
                </span>
              ))}
            </div>
          )}
          <div className="mono text-[10px] mt-3 pt-3 border-t" style={{ color: "#9E9A82", borderColor: "rgba(255,255,255,0.09)" }}>
            This is pattern-of-life run on yourself. The word that keeps repeating is the read you keep blowing.
          </div>
        </div>
      )}

      <div className="stencil text-xl mb-3" style={{ color: OLIVE }}>
        YOUR REVIEWS ({aars.length})
      </div>
      {!loaded && <LoadingRow />}
      {loaded && aars.length === 0 && (
        <EmptyState
          icon={<ClipboardList size={26} strokeWidth={1.5} />}
          title="NO REVIEWS YET"
          body="File one at the takeout — Conditions, Diagnosis, Decision, Result, and the Miss."
        />
      )}
      <div className="space-y-3">
        {aars.map((e) => (
          <AARCard key={e.id} entry={e} onRequestDelete={onRequestDelete} />
        ))}
      </div>
    </div>
  );
}

function AARCard({ entry, onRequestDelete }) {
  const date = new Date(entry.timestamp);
  const timerRef = useRef(null);
  const [held, setHeld] = useState(false);

  const startHold = () => {
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
      onContextMenu={(e) => e.preventDefault()}
      className="border rounded-2xl p-4 lift elev-1"
      style={{
        borderColor: held ? RUST : "rgba(255,255,255,0.09)",
        backgroundColor: held ? "rgba(181,72,42,0.16)" : "rgba(255,255,255,0.04)",
        transform: held ? "scale(0.98)" : "scale(1)",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="mono text-[11px] font-bold tracking-wide" style={{ color: RUST }}>
          {riverOf(entry)} · {sectionOf(entry)}
        </div>
        <div className="mono text-[10px]" style={{ color: "#9E9A82" }}>
          {date.toLocaleDateString()}
        </div>
      </div>
      <AARLine label="Conditions" value={entry.conditions} />
      <AARLine label="Diagnosis" value={entry.diagnosis} />
      <AARLine label="Decision" value={entry.decision} />
      <AARLine label="Result" value={entry.result} />
      <AARLine label="Miss" value={entry.miss} highlight />
      <div className="mono text-[9px] mt-2 flex items-center gap-1" style={{ color: "#82806A" }}>
        <Trash2 size={9} /> Press and hold to delete
      </div>
    </div>
  );
}

function AARLine({ label, value, highlight }) {
  if (!value) return null;
  return (
    <div className="mt-1.5">
      <span className="mono text-[9px] tracking-widest uppercase" style={{ color: highlight ? RUST : "#9E9A82" }}>
        {label}
      </span>
      <div className="mono text-xs" style={{ color: highlight ? RUST : INK }}>
        {value}
      </div>
    </div>
  );
}

function AARModal({ draft, setDraft, online, capturing, onSave, onClose }) {
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const missReady = (draft.miss || "").trim().length > 0;

  return (
    <div
      className="overlay-blur animate-fade fixed inset-0 z-40 flex items-start justify-center px-4 pb-4"
      style={{ paddingTop: "max(6rem, env(safe-area-inset-top, 0px) + 5rem)" }}
    >
      <div
        className="w-full sm:max-w-md rounded-3xl overflow-hidden flex flex-col elev-2 animate-slide-up"
        style={{ backgroundColor: PANEL, maxHeight: "calc(100vh - max(8rem, env(safe-area-inset-top, 0px) + 7rem))" }}
      >
        <div className="grad-header paper-texture px-5 pt-5 pb-4 flex items-center justify-between shrink-0">
          <div>
            <div className="stencil text-2xl leading-none" style={{ color: PAPER }}>
              AFTER-ACTION REVIEW
            </div>
            <div className="mono text-[10px] tracking-wide mt-0.5" style={{ color: "#82806A" }}>
              PRIVATE · MEND THE DRIFT
            </div>
          </div>
          <StampButton onClick={onClose}>
            <div className="press w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "#ffffff1a" }}>
              <X size={20} color={PAPER} />
            </div>
          </StampButton>
        </div>

        <div
          className="px-5 pt-5 pb-5 overflow-y-auto"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y", overscrollBehavior: "contain" }}
        >
          <div className="rounded-2xl p-4 mb-4 border elev-1" style={{ borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" }}>
            <div className="mono text-[10px] tracking-[0.16em] uppercase mb-2.5 flex items-center gap-1.5" style={{ color: "#93907A" }}>
              <MapPin size={11} /> Conditions captured
            </div>
            {capturing ? (
              <div className="flex items-center gap-2 mono text-xs" style={{ color: OLIVE }}>
                <Loader2 size={14} className="animate-spin" /> Reading GPS, flow, and temp…
              </div>
            ) : !online ? (
              <div className="flex items-start gap-2 mono text-xs" style={{ color: OLIVE }}>
                <WifiOff size={14} className="mt-0.5 shrink-0" />
                <div>
                  No service. Write it now — the review saves to your phone and uploads itself when
                  you're back in signal.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 mono text-xs" style={{ color: INK }}>
                <div>Flow: {draft.flowCfs != null ? `${draft.flowCfs} cfs` : "—"}</div>
                <div>Water: {draft.waterTempF != null ? `${draft.waterTempF}°F` : "—"}</div>
                <div>Air: {draft.airTempF != null ? `${draft.airTempF}°F` : "—"}</div>
                <div>Wind: {draft.windMph != null ? `${draft.windMph} mph` : "—"}</div>
              </div>
            )}
          </div>

          <Field label="River" value={draft.river} onChange={set("river")} placeholder="e.g. Snake River" />
          <Field label="Section or run" value={draft.section} onChange={set("section")} placeholder="e.g. Conant to Byington" />

          <FieldArea label="Conditions — what the day was" value={draft.conditions} onChange={set("conditions")} placeholder="Hot, bluebird, flows dropping, hatch sputtered by noon" />
          <FieldArea label="Diagnosis — what you read" value={draft.diagnosis} onChange={set("diagnosis")} placeholder="Oxygen squeeze pushing fish to the fastest water they'd hold in" />
          <FieldArea label="Decision — what you did about it" value={draft.decision} onChange={set("decision")} placeholder="Moved off the deep bucket, fished the broken riffle feeding it" />
          <FieldArea label="Result — what happened" value={draft.result} onChange={set("result")} placeholder="Two in the first hour, then it went quiet" />

          <div className="mt-1 rounded-2xl p-3.5 border" style={{ borderColor: "#B5482A44", backgroundColor: "#B5482A0a" }}>
            <div className="mono text-[10px] tracking-[0.16em] uppercase flex items-center gap-1.5" style={{ color: RUST }}>
              <Target size={11} /> Miss — what you'd do differently *
            </div>
            <textarea
              value={draft.miss}
              onChange={set("miss")}
              placeholder="Waited too long to move. The water told me at 10, I didn't act until noon."
              rows={2}
              className="field-input w-full text-sm font-medium outline-none border rounded-xl px-3 py-2 mt-2 resize-none"
              style={{ color: INK, borderColor: "#B5482A66", backgroundColor: "rgba(255,255,255,0.04)" }}
            />
            <div className="mono text-[9px] mt-1.5" style={{ color: "#82806A" }}>
              Required. The Miss is the whole point — an AAR with no miss is a highlight reel.
            </div>
          </div>

          <StampButton onClick={missReady ? onSave : () => {}} className="w-full mt-5">
            <div
              className={`press w-full py-3.5 rounded-2xl stencil text-xl flex items-center justify-center gap-2 ${missReady ? "grad-rust elev-1 glow-rust-soft" : ""}`}
              style={{ backgroundColor: missReady ? undefined : "#82806A", color: PAPER, opacity: missReady ? 1 : 0.85 }}
            >
              <Check size={18} /> FILE REVIEW
            </div>
          </StampButton>
        </div>
      </div>
    </div>
  );
}

function AARDeleteConfirm({ entry, busy, onCancel, onConfirm }) {
  return (
    <div className="overlay-blur animate-fade fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="w-full sm:max-w-sm rounded-3xl overflow-hidden elev-2 animate-scale-in" style={{ backgroundColor: PANEL }}>
        <div className="grad-header paper-texture px-5 py-4">
          <div className="stencil text-2xl leading-none" style={{ color: PAPER }}>
            DELETE REVIEW
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="mono text-xs" style={{ color: INK }}>
            {riverOf(entry)} · {sectionOf(entry)}
          </div>
          {entry.miss && (
            <div className="mono text-[11px] mt-2 italic" style={{ color: "#9E9A82" }}>
              "{entry.miss.length > 90 ? entry.miss.slice(0, 90) + "…" : entry.miss}"
            </div>
          )}
          <div className="mono text-[11px] mt-3" style={{ color: RUST }}>
            This can't be recovered.
          </div>
          <div className="flex gap-2.5 mt-6">
            <StampButton onClick={onCancel} className="flex-1">
              <div
                className="press w-full py-3 rounded-2xl stencil text-lg border"
                style={{ borderColor: OLIVE, color: OLIVE, backgroundColor: "rgba(168,176,122,0.08)" }}
              >
                KEEP
              </div>
            </StampButton>
            <StampButton onClick={busy ? () => {} : onConfirm} className="flex-1">
              <div
                className="grad-rust press w-full py-3 rounded-2xl stencil text-lg flex items-center justify-center gap-2 elev-1 glow-rust-soft"
                style={{ color: PAPER, opacity: busy ? 0.6 : 1 }}
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

/* ---------- Catch modal (unchanged) ---------- */

function CatchModal({ draft, setDraft, entries, online, capturing, captureError, onSave, onClose, onRetryLocation, onManualLocate }) {
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const pick = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const isEdit = !!draft.id;
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
      className="overlay-blur animate-fade fixed inset-0 z-40 flex items-start justify-center px-4 pb-4"
      style={{ paddingTop: "max(6rem, env(safe-area-inset-top, 0px) + 5rem)" }}
    >
      <div
        className="w-full sm:max-w-md rounded-3xl overflow-hidden flex flex-col elev-2 animate-slide-up"
        style={{ backgroundColor: PANEL, maxHeight: "calc(100vh - max(8rem, env(safe-area-inset-top, 0px) + 7rem))" }}
      >
        <div className="grad-header paper-texture px-5 pt-5 pb-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <img
              src={LOGO_DATA_URI}
              alt="Mend the Drift"
              className="w-9 h-9 rounded-full"
              style={{ border: `1px solid ${RUST}` }}
            />
            <div>
              <div className="stencil text-2xl leading-none" style={{ color: PAPER }}>
                {isEdit ? "EDIT CATCH" : "LOG CATCH"}
              </div>
              <div className="mono text-[10px] tracking-wide mt-0.5" style={{ color: "#82806A" }}>
                MEND THE DRIFT
              </div>
            </div>
          </div>
          <StampButton onClick={onClose}>
            <div className="press w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "#ffffff1a" }}>
              <X size={20} color={PAPER} />
            </div>
          </StampButton>
        </div>

        <div
          className="px-5 pt-5 pb-5 overflow-y-auto"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y", overscrollBehavior: "contain" }}
        >

        {/* Auto-captured conditions */}
        <div
          className="rounded-2xl p-4 mb-4 border elev-1"
          style={{ borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" }}
        >
          <div className="mono text-[10px] tracking-[0.16em] uppercase mb-2.5 flex items-center gap-1.5" style={{ color: "#93907A" }}>
            <MapPin size={11} /> Conditions
          </div>
          {!isEdit && capturing ? (
            <div className="flex items-center gap-2 mono text-xs" style={{ color: OLIVE }}>
              <Loader2 size={14} className="animate-spin" /> Reading GPS, flow, and temperature…
            </div>
          ) : !isEdit && !online ? (
            <div>
              <div className="flex items-start gap-2 mono text-xs" style={{ color: OLIVE }}>
                <WifiOff size={14} className="mt-0.5 shrink-0" />
                <div>
                  No service. Your GPS still works — the spot is being recorded. Flow and temperature
                  will fill in automatically once you're back in signal, using the readings from the
                  time you caught it.
                </div>
              </div>
              {draft.lat != null && (
                <div className="mono text-[10px] mt-2" style={{ color: "#82806A" }}>
                  Pinned: {draft.lat.toFixed(4)}, {draft.lon.toFixed(4)}
                </div>
              )}
            </div>
          ) : !isEdit && captureError ? (
            <div>
              <div className="flex items-start gap-2 mono text-xs mb-3" style={{ color: RUST }}>
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {captureError}
              </div>
              <StampButton onClick={onRetryLocation} className="mb-3">
                <div
                  className="press mono text-[11px] font-semibold px-3.5 py-2 rounded-full border inline-block"
                  style={{ borderColor: RUST, color: RUST, backgroundColor: "#B5482A0f" }}
                >
                  RETRY GPS
                </div>
              </StampButton>

              <div className="mono text-[10px] tracking-[0.16em] uppercase mt-2 mb-1.5" style={{ color: "#93907A" }}>
                Or enter coordinates manually
              </div>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <input
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    placeholder="Latitude"
                    inputMode="decimal"
                    className="field-input w-full text-xs mono outline-none border rounded-xl px-3 py-2"
                    style={{ color: INK, borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" }}
                  />
                </div>
                <div className="flex-1">
                  <input
                    value={manualLon}
                    onChange={(e) => setManualLon(e.target.value)}
                    placeholder="Longitude"
                    inputMode="decimal"
                    className="field-input w-full text-xs mono outline-none border rounded-xl px-3 py-2"
                    style={{ color: INK, borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" }}
                  />
                </div>
                <StampButton onClick={submitManual}>
                  <div
                    className="press mono text-[11px] font-semibold px-4 py-2.5 rounded-xl"
                    style={{ backgroundColor: OLIVE, color: PAPER }}
                  >
                    {manualBusy ? "…" : "GO"}
                  </div>
                </StampButton>
              </div>
              <div className="mono text-[9px] mt-1" style={{ color: "#82806A" }}>
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
                <div className="col-span-2 text-[10px]" style={{ color: "#82806A" }}>
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
        <ChipRow items={SPECIES_OPTIONS} onPick={(v) => pick("species", v)} />
        <Field label="Size, inches (optional)" value={draft.size} onChange={set("size")} placeholder="e.g. 18" />
        <FieldArea label="Notes (optional)" value={draft.notes} onChange={set("notes")} placeholder="Seam behind the boulder, sipping rise" />

        <StampButton onClick={onSave} className="w-full mt-3">
          <div className="grad-rust press w-full py-3.5 rounded-2xl stencil text-xl flex items-center justify-center gap-2 elev-1 glow-rust-soft" style={{ color: PAPER }}>
            <Check size={18} /> {isEdit ? "SAVE CHANGES" : "SAVE ENTRY"}
          </div>
        </StampButton>
        </div>
      </div>
    </div>
  );
}

function ChipRow({ items, onPick }) {
  return (
    <div className="chip-scroll flex gap-2 overflow-x-auto -mt-1.5 mb-3.5 pb-1">
      {items.slice(0, 12).map((v) => (
        <StampButton key={v} onClick={() => onPick(v)}>
          <div
            className="chip mono text-[10px] px-3 py-1.5 rounded-full border whitespace-nowrap font-medium"
            style={{ borderColor: "rgba(255,255,255,0.09)", color: "#9E9A82", backgroundColor: "rgba(255,255,255,0.04)" }}
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
    <div className="mb-3.5">
      <label className="mono text-[10px] tracking-[0.16em] uppercase" style={{ color: "#93907A" }}>
        {label}
      </label>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="field-input w-full text-sm font-medium outline-none border rounded-xl px-3.5 py-2.5 mt-1.5"
        style={{ color: INK, borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" }}
      />
    </div>
  );
}

function FieldArea({ label, value, onChange, placeholder }) {
  return (
    <div className="mb-3.5">
      <label className="mono text-[10px] tracking-[0.16em] uppercase" style={{ color: "#93907A" }}>
        {label}
      </label>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={2}
        className="field-input w-full text-sm font-medium outline-none border rounded-xl px-3.5 py-2.5 mt-1.5 resize-none"
        style={{ color: INK, borderColor: "rgba(255,255,255,0.09)", backgroundColor: "rgba(255,255,255,0.04)" }}
      />
    </div>
  );
}
