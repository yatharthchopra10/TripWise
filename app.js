/* TripWise – Frontend track
 * Destinations: REST Countries (primary) with an open-data backup + local cache.
 * Weather: Open-Meteo. No API keys needed.
 */
const COUNTRIES_API = "https://restcountries.com/v3.1";
const BACKUP_API = "https://cdn.jsdelivr.net/gh/mledoze/countries@master/dist/countries.json";
const WEATHER_API = "https://api.open-meteo.com/v1/forecast";

const STORAGE_KEY = "tripwise.itinerary.v1";
const CACHE_KEY = "tripwise.countries.cache.v1";
const THEME_KEY = "tripwise.theme";

// REST Countries allows a maximum of 10 fields on /all
const LIST_FIELDS = "name,cca3,capital,region,subregion,population,area,flags,latlng,languages";
const EXTRA_FIELDS = "cca3,currencies,timezones,borders,car";
const PAGE_SIZE = 24;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  all: [],
  trip: loadTrip(),
  loaded: false,
  region: "",
  visible: PAGE_SIZE,
  rendered: 0,
  filtered: [],
};

/* ================= HELPERS ================= */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-IN") : "—");
const compact = (n) => (typeof n === "number" ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n) : "—");
const capitalOf = (c) => (c.capital && c.capital[0]) || "—";
const flagOf = (c) => c.flags?.svg || c.flags?.png || "";
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2400);
}

async function fetchJSON(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Request timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function animateNumber(el, to) {
  const from = Number(el.textContent) || 0;
  if (from === to) return;
  const start = performance.now();
  const dur = 700;
  const step = (now) => {
    const p = Math.min((now - start) / dur, 1);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ================= THEME ================= */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#themeToggle").textContent = theme === "dark" ? "🌙" : "☀️";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#060912" : "#f4f6fb");
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  applyTheme(saved || "dark");
}

/* ================= ITINERARY (localStorage) ================= */
function loadTrip() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function saveTrip() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trip));
  } catch {
    toast("Couldn't save – browser storage is unavailable");
  }
  $("#tripCount").textContent = state.trip.length;
  animateNumber($("#statTrip"), state.trip.length);
}
const inTrip = (code) => state.trip.some((t) => t.cca3 === code);

function addToTrip(c) {
  if (!c || inTrip(c.cca3)) return;
  state.trip.push({
    cca3: c.cca3,
    name: c.name.common,
    flag: flagOf(c),
    capital: capitalOf(c),
    region: c.region || "",
    note: "",
    addedAt: Date.now(),
  });
  saveTrip();
  toast(`✈️ ${c.name.common} added to your trip`);
  refreshButtons();
  renderTrip();
}
function removeFromTrip(code) {
  const item = state.trip.find((t) => t.cca3 === code);
  state.trip = state.trip.filter((t) => t.cca3 !== code);
  saveTrip();
  if (item) toast(`${item.name} removed`);
  refreshButtons();
  renderTrip();
}
function moveItem(code, dir) {
  const i = state.trip.findIndex((t) => t.cca3 === code);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.trip.length) return;
  [state.trip[i], state.trip[j]] = [state.trip[j], state.trip[i]];
  saveTrip();
  renderTrip();
}

/* ================= DATA LOADING ================= */
function normalizeBackup(c) {
  const cca2 = (c.cca2 || "").toLowerCase();
  return {
    cca3: c.cca3,
    name: { common: c.name?.common, official: c.name?.official },
    capital: c.capital || [],
    region: c.region || "",
    subregion: c.subregion || "",
    population: typeof c.population === "number" ? c.population : null,
    area: c.area,
    flags: { svg: "", png: cca2 ? `https://flagcdn.com/w640/${cca2}.png` : "" },
    latlng: c.latlng,
    languages: c.languages,
    currencies: c.currencies,
    timezones: c.timezones,
    borders: c.borders,
    car: c.car,
  };
}
const readCache = () => { try { const d = JSON.parse(localStorage.getItem(CACHE_KEY)); return Array.isArray(d) && d.length ? d : null; } catch { return null; } };
const writeCache = (d) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch {} };

async function loadCountries() {
  showSkeletons();
  hideState();
  let data = null;
  let source = "live";
  let err1, err2;

  try {
    data = await fetchJSON(`${COUNTRIES_API}/all?fields=${LIST_FIELDS}`);
    if (!Array.isArray(data) || !data.length) throw new Error("Empty response");
  } catch (e) {
    err1 = e;
    console.warn("[TripWise] REST Countries failed:", e);
    try {
      const raw = await fetchJSON(BACKUP_API, 20000);
      data = raw.map(normalizeBackup);
      source = "backup";
    } catch (e2) {
      err2 = e2;
      console.warn("[TripWise] Backup source failed:", e2);
      data = readCache();
      source = "cache";
    }
  }

  if (!data) {
    $("#grid").innerHTML = "";
    $("#resultCount").textContent = "";
    $("#moreWrap").hidden = true;
    showState("📡", "Couldn't load destinations", "We couldn't reach the data service. Check your connection and try again.", "Try again", loadCountries,
      `Details: ${err1?.message || "unknown"} / ${err2?.message || "unknown"}`);
    return;
  }

  data = data.filter((c) => c?.name?.common && c.cca3);
  if (source === "live") writeCache(data);
  if (source === "backup") toast("Using backup data source");
  if (source === "cache") toast("Offline – showing saved destinations");

  state.all = data;
  state.loaded = true;
  animateNumber($("#statTotal"), data.length);
  animateNumber($("#statRegions"), new Set(data.map((c) => c.region).filter(Boolean)).size);
  renderGrid();
}

/* ================= EXPLORE ================= */
function showSkeletons() {
  $("#grid").innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join("");
  $("#resultCount").textContent = "Loading destinations…";
  $("#moreWrap").hidden = true;
}
function hideState() { $("#state").hidden = true; }
function showState(icon, title, text, btnLabel, onClick, small) {
  const el = $("#state");
  el.hidden = false;
  el.innerHTML = `<div class="state-icon float">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>` +
    (btnLabel ? `<button class="btn" id="stateBtn">${esc(btnLabel)}</button>` : "") +
    (small ? `<small>${esc(small)}</small>` : "");
  if (btnLabel) $("#stateBtn").addEventListener("click", onClick);
}

function getFiltered() {
  const q = $("#search").value.trim().toLowerCase();
  const sort = $("#sort").value;
  const list = state.all.filter((c) => {
    if (state.region && c.region !== state.region) return false;
    if (!q) return true;
    const hay = [c.name.common, c.name.official, c.subregion, ...(c.capital || [])].join(" ").toLowerCase();
    return hay.includes(q);
  });
  const by = {
    "name-asc": (a, b) => a.name.common.localeCompare(b.name.common),
    "name-desc": (a, b) => b.name.common.localeCompare(a.name.common),
    "pop-desc": (a, b) => (b.population || 0) - (a.population || 0),
    "pop-asc": (a, b) => (a.population || 0) - (b.population || 0),
    "area-desc": (a, b) => (b.area || 0) - (a.area || 0),
  }[sort];
  return list.sort(by);
}

function cardHTML(c, i) {
  const flag = esc(flagOf(c));
  return `
  <article class="card" data-open="${esc(c.cca3)}" style="--i:${i % 12}">
    <div class="cover" style="--flag:url('${flag}')">
      <span class="region-tag">${esc(c.region || "—")}</span>
      <button class="add-btn trip-btn" data-add="${esc(c.cca3)}" aria-label="Add ${esc(c.name.common)} to trip"></button>
      <img loading="lazy" src="${flag}" alt="Flag of ${esc(c.name.common)}" />
    </div>
    <div class="card-body">
      <h3>${esc(c.name.common)}</h3>
      <div class="meta">📍 ${esc(capitalOf(c))}${c.subregion ? " · " + esc(c.subregion) : ""}</div>
      <div class="card-foot">
        <span class="pop">👥 ${compact(c.population)}<small>people</small></span>
        <span class="more-link">Details →</span>
      </div>
    </div>
  </article>`;
}

function renderGrid() {
  const list = getFiltered();
  state.filtered = list;
  state.visible = PAGE_SIZE;
  const grid = $("#grid");
  $("#resultCount").textContent = `${list.length} destination${list.length === 1 ? "" : "s"}${state.region ? " in " + state.region : ""}`;

  if (!list.length) {
    grid.innerHTML = "";
    $("#moreWrap").hidden = true;
    showState("🔍", "No destinations found", "Try a different search term or clear the filters.", "Reset filters", resetFilters);
    return;
  }
  hideState();
  const shown = list.slice(0, state.visible);
  grid.innerHTML = shown.map(cardHTML).join("");
  state.rendered = shown.length;
  updateMore();
  refreshButtons();
}

function showMore() {
  const next = state.filtered.slice(state.rendered, state.rendered + PAGE_SIZE);
  $("#grid").insertAdjacentHTML("beforeend", next.map((c, i) => cardHTML(c, i)).join(""));
  state.rendered += next.length;
  updateMore();
  refreshButtons();
}
function updateMore() {
  const left = state.filtered.length - state.rendered;
  $("#moreWrap").hidden = left <= 0;
  $("#more").textContent = `Show more (${left} left)`;
}

function refreshButtons() {
  $$(".trip-btn").forEach((b) => {
    const added = inTrip(b.dataset.add);
    b.textContent = added ? "✓" : "+";
    b.classList.toggle("added", added);
    b.setAttribute("aria-label", `${added ? "Remove" : "Add"} from trip`);
    b.title = added ? "Remove from trip" : "Add to trip";
  });
  const d = $("#dialogTripBtn");
  if (d) {
    const added = inTrip(d.dataset.code);
    d.textContent = added ? "✓ Added · Remove" : "+ Add to my trip";
    d.classList.toggle("added", added);
  }
}

function resetFilters() {
  $("#search").value = "";
  $("#sort").value = "name-asc";
  state.region = "";
  $$(".chip").forEach((c) => c.classList.toggle("active", c.dataset.region === ""));
  if (state.loaded) renderGrid();
}

/* ================= DETAILS ================= */
const WEATHER_CODES = {
  0: ["☀️", "Clear sky"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"], 48: ["🌫️", "Rime fog"], 51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"],
  61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"], 71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"],
  75: ["❄️", "Heavy snow"], 80: ["🌦️", "Rain showers"], 81: ["🌧️", "Heavy showers"], 82: ["⛈️", "Violent showers"],
  95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm & hail"], 99: ["⛈️", "Severe thunderstorm"],
};
const wx = (code) => WEATHER_CODES[code] || ["🌡️", "—"];

function getCountry(code) {
  const found = state.all.find((x) => x.cca3 === code);
  if (found) return found;
  const t = state.trip.find((x) => x.cca3 === code);
  if (!t) return null;
  return { cca3: t.cca3, name: { common: t.name, official: t.name }, capital: [t.capital], region: t.region, flags: { svg: t.flag } };
}

function extraFactsHTML(c) {
  const currencies = c.currencies
    ? Object.values(c.currencies).map((x) => `${x.name}${x.symbol ? " (" + x.symbol + ")" : ""}`).join(", ")
    : "—";
  const tz = c.timezones?.length ? c.timezones.slice(0, 2).join(", ") + (c.timezones.length > 2 ? ` +${c.timezones.length - 2}` : "") : "—";
  return `
    <div class="fact"><span>💱 Currency</span><b>${esc(currencies)}</b></div>
    <div class="fact"><span>🕒 Timezones</span><b>${esc(tz)}</b></div>
    <div class="fact"><span>🗺️ Neighbours</span><b>${c.borders?.length ? esc(c.borders.join(", ")) : c.borders ? "Island nation" : "—"}</b></div>
    <div class="fact"><span>🚗 Drives on</span><b>${esc(c.car?.side ? c.car.side[0].toUpperCase() + c.car.side.slice(1) : "—")}</b></div>`;
}

async function openDetails(code) {
  const c = getCountry(code);
  if (!c) return;
  const dlg = $("#details");
  dlg.dataset.code = code;
  const flag = esc(flagOf(c));
  const langs = c.languages ? Object.values(c.languages).join(", ") : "—";
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(capitalOf(c) + ", " + c.name.common)}`;
  const hasExtra = c.currencies !== undefined || c.timezones !== undefined;

  $("#detailsBody").innerHTML = `
    <div class="d-cover" style="--flag:url('${flag}')"><img src="${flag}" alt="Flag of ${esc(c.name.common)}" /></div>
    <div class="d-content">
      <span class="pill">${esc(c.region || "—")}${c.subregion ? " · " + esc(c.subregion) : ""}</span>
      <h2 id="dTitle">${esc(c.name.common)}</h2>
      <div class="muted">${esc(c.name.official)}</div>
      <div class="facts">
        <div class="fact"><span>📍 Capital</span><b>${esc(capitalOf(c))}</b></div>
        <div class="fact"><span>👥 Population</span><b>${fmt(c.population)}</b></div>
        <div class="fact"><span>📐 Area</span><b>${c.area ? fmt(c.area) + " km²" : "—"}</b></div>
        <div class="fact"><span>🗣️ Languages</span><b>${esc(langs)}</b></div>
        <span id="extraFacts" style="display:contents">${hasExtra ? extraFactsHTML(c) :
          ["💱 Currency", "🕒 Timezones", "🗺️ Neighbours", "🚗 Drives on"].map((l) => `<div class="fact load"><span>${l}</span><b>Loading…</b></div>`).join("")}</span>
      </div>
      <div class="weather" id="weatherBox"><h4>Weather in ${esc(capitalOf(c))}</h4><span class="muted">Checking the sky…</span></div>
      <div class="d-actions">
        <button class="btn" id="dialogTripBtn" data-code="${esc(c.cca3)}"></button>
        <a class="btn ghost" href="${mapsUrl}" target="_blank" rel="noopener">🗺️ Open in Maps</a>
      </div>
    </div>`;

  $("#dialogTripBtn").addEventListener("click", () => {
    const cur = getCountry(code);
    inTrip(code) ? removeFromTrip(code) : addToTrip(cur);
  });
  refreshButtons();
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;

  loadWeather(c, code);
  if (!hasExtra) loadExtras(c, code);
}

async function loadExtras(c, code) {
  try {
    const data = await fetchJSON(`${COUNTRIES_API}/alpha/${encodeURIComponent(code)}?fields=${EXTRA_FIELDS}`, 10000);
    const extra = Array.isArray(data) ? data[0] : data;
    Object.assign(c, { currencies: extra.currencies || null, timezones: extra.timezones, borders: extra.borders || [], car: extra.car });
  } catch (e) {
    console.warn("[TripWise] Extra details failed:", e);
    Object.assign(c, { currencies: null });
  }
  if ($("#details").dataset.code === code && $("#extraFacts")) $("#extraFacts").innerHTML = extraFactsHTML(c);
}

async function loadWeather(c, code) {
  const set = (html) => { if ($("#details").dataset.code === code && $("#weatherBox")) $("#weatherBox").innerHTML = html; };
  const title = `<h4>Weather in ${esc(capitalOf(c))}</h4>`;
  if (!c.latlng || c.latlng.length < 2) return set(title + '<span class="muted">Weather isn\'t available for this destination.</span>');
  const [lat, lon] = c.latlng;
  const url = `${WEATHER_API}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`;
  try {
    const w = await fetchJSON(url, 10000);
    const [icon, label] = wx(w.current.weather_code);
    const days = w.daily.time.map((d, i) => {
      const [ic] = wx(w.daily.weather_code[i]);
      const name = new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short" });
      return `<div><b>${esc(name)}</b><span class="fi">${ic}</span>${Math.round(w.daily.temperature_2m_max[i])}° / ${Math.round(w.daily.temperature_2m_min[i])}°</div>`;
    }).join("");
    set(`${title}<div class="now"><span class="ico">${icon}</span><div><div class="t">${Math.round(w.current.temperature_2m)}°C</div><div class="lbl">${esc(label)}</div></div></div><div class="forecast">${days}</div>`);
  } catch (e) {
    console.warn("[TripWise] Weather failed:", e);
    set(title + '<span class="muted">Weather is unavailable right now.</span>');
  }
}

/* ================= MY TRIP ================= */
function renderTrip() {
  const list = $("#tripList");
  const empty = $("#tripEmpty");
  $("#tripCount").textContent = state.trip.length;

  if (!state.trip.length) {
    list.innerHTML = "";
    $("#tripStats").innerHTML = "";
    empty.hidden = false;
    $("#tripToolbar").hidden = true;
    $("#tripSummary").textContent = "Your saved destinations appear here.";
    return;
  }
  empty.hidden = true;
  $("#tripToolbar").hidden = false;

  const regions = new Set(state.trip.map((t) => t.region).filter(Boolean)).size;
  const notes = state.trip.filter((t) => t.note.trim()).length;
  $("#tripSummary").textContent = "Reorder your stops, jot down notes, and export when you're ready.";
  $("#tripStats").innerHTML = `
    <div class="stat"><b>${state.trip.length}</b><span>Stops</span></div>
    <div class="stat"><b>${regions}</b><span>Region${regions === 1 ? "" : "s"}</span></div>
    <div class="stat"><b>${notes}</b><span>With notes</span></div>`;

  list.innerHTML = state.trip.map((t, i) => `
    <div class="stop" style="--i:${i}">
      <div class="rail"><div class="num">${i + 1}</div><div class="line"></div></div>
      <article class="stop-card">
        <img src="${esc(t.flag)}" alt="Flag of ${esc(t.name)}" data-open="${esc(t.cca3)}" />
        <div>
          <h3>${esc(t.name)}</h3>
          <div class="meta">📍 ${esc(t.capital)} · ${esc(t.region)}</div>
          <textarea data-note="${esc(t.cca3)}" placeholder="Notes — hotels, dates, must-do activities…" aria-label="Notes for ${esc(t.name)}">${esc(t.note)}</textarea>
        </div>
        <div class="stop-btns">
          <button class="btn ghost" data-open="${esc(t.cca3)}">Details</button>
          <button class="btn ghost" data-up="${esc(t.cca3)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
          <button class="btn ghost" data-down="${esc(t.cca3)}" ${i === state.trip.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
          <button class="btn danger" data-remove="${esc(t.cca3)}">Remove</button>
        </div>
      </article>
    </div>`).join("");
}

function itineraryText() {
  const lines = ["TripWise Itinerary", "==================", ""];
  state.trip.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.name} — ${t.capital} (${t.region})`);
    if (t.note.trim()) lines.push(`   Notes: ${t.note.trim()}`);
  });
  return lines.join("\n");
}
async function copyItinerary() {
  try {
    await navigator.clipboard.writeText(itineraryText());
    toast("📋 Itinerary copied to clipboard");
  } catch {
    toast("Couldn't copy – try downloading instead");
  }
}
function downloadItinerary() {
  const blob = new Blob([itineraryText()], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "tripwise-itinerary.txt";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ================= NAVIGATION & EVENTS ================= */
function showView(name) {
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  if (name === "trip") renderTrip();
  history.replaceState(null, "", `#${name}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-view],[data-region],[data-open],[data-add],[data-remove],[data-up],[data-down],[data-action]");
  if (!t) return;
  if (t.dataset.view) { e.preventDefault(); return showView(t.dataset.view); }
  if (t.dataset.action === "copy") return copyItinerary();
  if (t.dataset.action === "download") return downloadItinerary();
  if (t.dataset.region !== undefined) {
    state.region = t.dataset.region;
    $$(".chip").forEach((c) => c.classList.toggle("active", c === t));
    return state.loaded && renderGrid();
  }
  if (t.dataset.add) {
    const code = t.dataset.add;
    return inTrip(code) ? removeFromTrip(code) : addToTrip(getCountry(code));
  }
  if (t.dataset.open) return openDetails(t.dataset.open);
  if (t.dataset.remove) return removeFromTrip(t.dataset.remove);
  if (t.dataset.up) return moveItem(t.dataset.up, -1);
  if (t.dataset.down) return moveItem(t.dataset.down, 1);
});

document.addEventListener("input", (e) => {
  if (e.target.matches("[data-note]")) {
    const item = state.trip.find((t) => t.cca3 === e.target.dataset.note);
    if (item) { item.note = e.target.value; saveTrip(); }
  }
});
document.addEventListener("keydown", (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName || "");
  if (e.key === "/" && !typing && !$("#details").open) { e.preventDefault(); showView("explore"); $("#search").focus(); }
});

$("#search").addEventListener("input", debounce(() => state.loaded && renderGrid(), 200));
$("#sort").addEventListener("change", () => state.loaded && renderGrid());
$("#reset").addEventListener("click", resetFilters);
$("#more").addEventListener("click", showMore);
$("#surprise").addEventListener("click", () => {
  if (!state.loaded) return toast("Still loading destinations…");
  const c = state.all[Math.floor(Math.random() * state.all.length)];
  openDetails(c.cca3);
});
$("#clearTrip").addEventListener("click", () => {
  if (confirm("Remove all destinations from your trip?")) {
    state.trip = [];
    saveTrip();
    renderTrip();
    refreshButtons();
  }
});
$("#themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
});

const dlg = $("#details");
$("#closeDetails").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener("close", () => document.body.classList.remove("modal-open"));
new MutationObserver(() => document.body.classList.toggle("modal-open", dlg.open)).observe(dlg, { attributes: true, attributeFilter: ["open"] });

/* ================= INIT ================= */
initTheme();
saveTrip();
showView(location.hash === "#trip" ? "trip" : "explore");
loadCountries();
