// public/js/dashboard.js

/* ==== Passive wheel/touch patch (must run before echarts.init) ==== */
/* این پچ تمام لیسنرهای wheel/mousewheel/touch* که بعداً اضافه می‌شن رو به صورت passive تنظیم می‌کند
   تا هشدارهای "Added non-passive event listener to a scroll-blocking …" از بین بروند. */
(function () {
  if (!('addEventListener' in EventTarget.prototype)) return;
  const ORIG = EventTarget.prototype.addEventListener;
  const SCROLL_BLOCKING = new Set(['wheel', 'mousewheel', 'touchstart', 'touchmove']);
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (SCROLL_BLOCKING.has(type)) {
      if (options === undefined || options === false) {
        options = { passive: true };
      } else if (options === true) {
        options = { capture: true, passive: true };
      } else if (typeof options === 'object' && !('passive' in options)) {
        options = Object.assign({}, options, { passive: true });
      }
    }
    return ORIG.call(this, type, listener, options);
  };
})();

// Dashboard (ECharts) — محور شمسی + ارقام فارسی / IDs:
// موجود قبلی: chartTrend (chartDaily), chartStatusWeeks (chartWeeks), chartLocations, chartPriority
// افزوده جدید: chartTrendByCat30, chartCumulative30, chartParetoLocations, chartStatusFunnel,
//              chartFirstActionHist, chartResolveHist, chartCalendarHeat

const DATE_FIELD_NAME = "submission_date";

/* ============ CSS helpers ============ */
function cssVar(name, fallback = "") {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const v = (raw || "").trim();
  return v || fallback;
}
function normalizeColorToken(v, fb) {
  const s = (v || "").trim();
  if (!s) return fb;
  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:\d(?:\.\d+)?|0?\.\د+))?$/.test(s)) {
    return `rgba(${s})`;
  }
  return s;
}

/* ============ Digits & Jalali ============ */
function enToFaDigits(s){ return String(s).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]); }
function normalizeDigits(str) {
  if (str == null) return "";
  const s = String(str);
  const fa = "۰۱۲۳۴۵۶۷۸۹", ar = "٠١٢٣٤٥٦٧٨٩";
  return s
    .replace(/[۰-۹]/g, d => String(fa.indexOf(d)))
    .replace(/[٠-٩]/g, d => String(ar.indexOf(d)));
}

/* --- Gregorian ↔ Jalali --- */
function gregorianToJalali(gy, gm, gd) {
  const g_d_m=[0,31,59,90,120,151,181,212,243,273,304,334];
  let jy = (gy<=1600)? 0:979; gy -= (gy<=1600)? 621:1600;
  const gy2 = (gm>2) ? (gy+1) : gy;
  let days = (365*gy) + Math.floor((gy2+3)/4) - Math.floor((gy2+99)/100) + Math.floor((gy2+399)/400)
            - 80 + gd + g_d_m[gm-1];
  jy += 33*Math.floor(days/12053); days%=12053;
  jy += 4*Math.floor(days/1461);   days%=1461;
  if (days>365){ jy += Math.floor((days-1)/365); days=(days-1)%365; }
  const jm = (days<186)? 1+Math.floor(days/31) : 7+Math.floor((days-186)/30);
  const jd = 1 + ((days<186)? (days%31) : ((days-186)%30));
  return [jy, jm, jd];
}
function jalaliToGregorian(jy, jm, jd) {
  let gy = 0, days = 0;
  if (jy > 979) { gy = 1600; jy -= 979; } else { gy = 621; }
  days = 365*jy + Math.floor(jy/33)*8 + Math.floor(((jy%33)+3)/4) + 78 + jd + ((jm<7)? (jm-1)*31 : ((jm-7)*30)+186);
  gy += 400*Math.floor(days/146097); days%=146097;
  if (days > 36524) { gy += 100*Math.floor(--days/36524); days%=36524; if (days>=365) days++; }
  gy += 4*Math.floor(days/1461); days%=1461;
  let gd;
  if (days > 365) { gy += Math.floor((days-1)/365); days=(days-1)%365; }
  gd = days + 1;
  const sal_a=[0,31, (gy%4===0 && gy%100!==0) || (gy%400===0) ? 29 : 28, 31,30,31,30,31,31,30,31,30,31];
  let gm=0, gdd=gd;
  for (gm=1; gm<=12; gm++){ const v=sal_a[gm]; if (gdd<=v) break; gdd-=v; }
  return [gy, gm, gdd];
}
function fmtJalali(d, faDigits = true) {
  const [jy, jm, jd] = gregorianToJalali(d.getFullYear(), d.getMonth()+1, d.getDate());
  const s = `${jy}/${String(jm).padStart(2,'0')}/${String(jd).padStart(2,'0')}`;
  return faDigits ? enToFaDigits(s) : s;
}

/* ============ Theme & Font ============ */
function themePalette() {
  const border = normalizeColorToken(cssVar("--chart-border"), "rgba(148,163,184,.25)");
  const grid   = normalizeColorToken(cssVar("--chart-grid"),   "rgba(148,163,184,.15)");
  const tick   = normalizeColorToken(cssVar("--chart-text"),   "#cbd5e1");
  const pie = [
    normalizeColorToken(cssVar("--pie-c1"), "#60a5fa"),
    normalizeColorToken(cssVar("--pie-c2"), "#34d399"),
    normalizeColorToken(cssVar("--pie-c3"), "#fbbf24"),
    normalizeColorToken(cssVar("--pie-c4"), "#f87171"),
    normalizeColorToken(cssVar("--pie-c5"), "#a78bfa"),
  ];
  return { border, grid, tick, pie };
}
function chartFontFamily() {
  return cssVar("--chart-font", "IRANSansX, Vazirmatn, 'Segoe UI', Tahoma, sans-serif");
}
function chartFontSize() {
  const s = cssVar("--chart-font-size", "12");
  const n = parseInt(s, 10);
  return isNaN(n) ? 12 : n;
}

/* ============ Date helpers ============ */
function fmtYMD(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(0,0,0,0); return x; }

/* فقط-تاریخ */
function toDateOnly(s, isJalali = false) {
  if (!s) return null;
  const str = normalizeDigits(String(s)).trim();
  if (isJalali) {
    const m = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (!m) return null;
    const [_, jy,jm,jd] = m.map(Number);
    const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
    return new Date(gy, gm-1, gd);
  }
  if (/^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/.test(str)) {
    const m = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\د{1,2}):(\د{2})(?::(\د{2}))?)?/);
    if (!m) return null;
    const gy=+m[1], gm=+m[2], gd=+m[3];
    return new Date(gy, gm-1, gd, 0, 0, 0);
  }
  const n = Number(str);
  if (!isNaN(n) && /^\d{10,13}$/.test(str)) return new Date(n < 1e12 ? n*1000 : n);
  const d = new Date(str.replace(" ", "T"));
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
/* تاریخ-و-زمان */
function toDateTime(s, isJalali = false) {
  if (!s) return null;
  const str = normalizeDigits(String(s)).trim();
  if (isJalali) {
    const m = str.match(/^(\d{4})[-\/.](\د{1,2})[-\/.](\د{1,2})(?:[ T](\د{1,2}):(\د{2})(?::(\د{2}))?)?$/);
    // عمداً دست‌نخورده ماند.
  }
  const m = str.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\د{1,2})(?:[ T](\د{1,2}):(\د{2})(?::(\د{2}))?)?$/);
  if (m) {
    const gy=+m[1], gm=+m[2], gd=+m[3], hh=+(m[4]||0), mm=+(m[5]||0), ss=+(m[6]||0);
    return new Date(gy, gm-1, gd, hh, mm, ss);
  }
  const n = Number(str);
  if (!isNaN(n) && /^\d{10,13}$/.test(str)) return new Date(n < 1e12 ? n*1000 : n);
  const d = new Date(str.replace(" ", "T"));
  return isNaN(d) ? null : d;
}

/* ============ Domain helpers ============ */
function extractIncDate(row) {
  const primary = row?.[DATE_FIELD_NAME];
  const candidates = [];
  if (primary) candidates.push([primary, false]);
  [["incident_date",false],["submission_date",false],["created_at",false],["createdAt",false],["createDate",false],["date",false],["event_date",false],["occurred_at",false]]
    .forEach(([k,isJ]) => { if (row[k]) candidates.push([row[k], isJ]); });
  if (candidates.length === 0 && row && typeof row === "object") {
    for (const k of Object.keys(row)) {
      const v = row[k]; if (v == null) continue;
      const s = normalizeDigits(String(v));
      if (/^\d{4}[-\/.]\د{1,2}[-\/.]\د{1,2}/.test(s) || /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
        candidates.push([s, /jalali/i.test(k)]); break;
      }
    }
  }
  for (const [c,isJ] of candidates) { const d = toDateOnly(c, isJ); if (d) return d; }
  return null;
}
function extractIncDateTime(row){
  const keys = [DATE_FIELD_NAME, "submission_date", "created_at", "createdAt", "createDate"];
  for (const k of keys) if (row[k]) { const d = toDateTime(row[k], /jalali/i.test(k)); if (d) return d; }
  for (const k of Object.keys(row||{})) {
    const v = row[k]; if (v == null) continue;
    const s = normalizeDigits(String(v));
    if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
      const d = toDateTime(s, /jalali/i.test(k)); if (d) return d;
    }
  }
  return null;
}
function extractFirstActionDateTime(row){
  const keys = ["first_action_at", "first_action_datetime", "first_action_date", "first_action_jalali", "first_action_date_jalali"];
  for (const k of keys) if (row[k]) { const d = toDateTime(row[k], /jalali/i.test(k)); if (d) return d; }
  if (row.last_action_at) { const d = toDateTime(row.last_action_at, false); if (d) return d; }
  return null;
}
function extractResolvedDateTime(row){
  const keys = ["resolved_at", "resolved_date", "closed_at", "closed_date"];
  for (const k of keys) if (row[k]) { const d = toDateTime(row[k], /jalali/i.test(k)); if (d) return d; }
  if (statusKey(row) === "closed" && row.last_action_at) { const d = toDateTime(row.last_action_at, false); if (d) return d; }
  return null;
}
function baselineStart(row){
  const sub = extractIncDateTime(row);
  const ca  = row.created_at ? toDateTime(row.created_at, false) : null;
  if (sub && ca) return new Date(Math.min(sub.getTime(), ca.getTime()));
  return sub || ca || null;
}

function statusKey(row) {
  const id = Number(row.status_id);
  if (id === 1) return "unknown";
  if (id === 2) return "rejected";
  if (id === 3) return "pending";
  if (id === 4) return "closed";
  const t = (row.status_name || row.status || "").toString().trim();
  const n = t.replace(/\s+/g, " ").toLowerCase();
  if (/^مشخص نشده$/.test(t) || /unknown|نامشخص/.test(n)) return "unknown";
  if (/^در حال بررسی$/.test(t) || /pending|بررسی|انتظار/.test(n)) return "pending";
  if (/^حل شده$/.test(t) || /closed|resolve|مختومه|اتمام/.test(n)) return "closed";
  if (/^رد شده$/.test(t) || /reject|رد/.test(n)) return "rejected";
  return "unknown";
}
function isPhysical(row) {
  const cid = Number(row.category_id);
  const label = (row.category_label || row.category || "").toString().toLowerCase();
  return cid === 2 || /physical|پدافند/.test(label);
}
function priorityKey(row){
  const id = Number(row.priority_id);
  if (id === 1) return "low";
  if (id === 2) return "medium";
  if (id === 3) return "high";
  return "unknown";
}

/* ============ Aggregations ============ */
function summarizeKPIs(rows) {
  let total=0, unknown=0, pending=0, closed=0, rejected=0, cyber=0, physical=0;
  for (const r of rows || []) {
    total++;
    const sk = statusKey(r);
    if (sk === "unknown") unknown++;
    else if (sk === "pending") pending++;
    else if (sk === "closed")  closed++;
    else if (sk === "rejected")rejected++;
    if (isPhysical(r)) physical++; else cyber++;
  }
  return { total, unknown, pending, closed, rejected, cyber, physical };
}
function locationsByCategory(rows, locationLookup) {
  const idx = new Map(), labels = [], cyber = [], physical = [];
  const ensure = (name) => {
    if (!idx.has(name)) { idx.set(name, labels.length); labels.push(name); cyber.push(0); physical.push(0); }
    return idx.get(name);
  };
  for (const r of rows || []) {
    let name = r.location_name || r.location;
    if (!name) {
      const lid = Number(r.location_id);
      name = (locationLookup && locationLookup[lid]) ? locationLookup[lid] : (lid ? `محل #${lid}` : "نامشخص");
    }
    const i = ensure(String(name));
    if (isPhysical(r)) physical[i]++; else cyber[i]++;
  }
  return { labels, cyber, physical };
}
function getDataAnchorDate(rows){
  let max = null;
  for (const r of rows || []) { const d = extractIncDate(r); if (!d) continue; if (!max || d > max) max = d; }
  const anchor = max ? new Date(max) : new Date(); anchor.setHours(0,0,0,0); return anchor;
}
function dailyCounts(rows, days = 30) {
  const anchor = getDataAnchorDate(rows);
  const start = addDays(anchor, -(days - 1));
  const map = new Map();
  for (let i = 0; i < days; i++) map.set(fmtYMD(addDays(start, i)), 0);
  let parsedAny = false;
  for (const r of rows || []) {
    const d = extractIncDate(r); if (!d) continue;
    parsedAny = true;
    const k = fmtYMD(d);
    if (map.has(k)) map.set(k, map.get(k) + 1);
  }
  const labels = [...map.keys()], data = [...map.values()];
  const sum = data.reduce((a,b)=>a+b,0);
  if (!parsedAny || sum === 0) {
    const N = Math.min(rows?.length || 0, days);
    const fbLabels = Array.from({length: N}, (_,i)=> enToFaDigits(String(i+1)));
    const fbData   = Array.from({length: N}, _=> 1);
    return { labels: fbLabels, data: fbData, isFallback: true };
  }
  return { labels, data, isFallback: false };
}

/* ===== NEW: ۴ هفته اخیر (با برچسب بازه تاریخی) ===== */
function last4WeeksStatusStack(rows) {
  const anchor = startOfWeek(getDataAnchorDate(rows));
  const weeks = [addDays(anchor,-21), addDays(anchor,-14), addDays(anchor,-7), anchor].map(startOfWeek);
  const bucket = new Map(weeks.map(d => [fmtYMD(d), { unknown:0, pending:0, closed:0, rejected:0, start:d, end:addDays(d,6) }]));
  for (const r of rows || []) {
    const d = extractIncDate(r); if (!d) continue;
    const k = fmtYMD(startOfWeek(d)); if (!bucket.has(k)) continue;
    const sk = statusKey(r);
    bucket.get(k)[sk] = (bucket.get(k)[sk] || 0) + 1;
  }
  const display = weeks.map((w,i)=>{
    const b = bucket.get(fmtYMD(w));
    const range = `${fmtJalali(b.start).slice(5)}–${fmtJalali(b.end).slice(5)}`;
    return `هفته ${enToFaDigits(i+1)}\n${range}`;
  });
  const stacks = weeks.map(w => bucket.get(fmtYMD(w)));
  return {
    labels: display,
    unknown: stacks.map(x=>x.unknown),
    pending: stacks.map(x=>x.pending),
    closed:  stacks.map(x=>x.closed),
    rejected:stacks.map(x=>x.rejected),
  };
}

/* ===== NEW: روزانه برحسب دسته‌بندی ===== */
function dailyCountsByCategory(rows, days = 30){
  const anchor = getDataAnchorDate(rows);
  const start = addDays(anchor, -(days - 1));
  const keys = Array.from({length: days}, (_,i)=> fmtYMD(addDays(start, i)));
  const mapC = new Map(keys.map(k=>[k,0])), mapP = new Map(keys.map(k=>[k,0]));
  for (const r of rows||[]){
    const d = extractIncDate(r); if (!d) continue;
    const k = fmtYMD(d); if (!mapC.has(k)) continue;
    if (isPhysical(r)) mapP.set(k, mapP.get(k)+1); else mapC.set(k, mapC.get(k)+1);
  }
  return { labels: keys, cyber: keys.map(k=>mapC.get(k)), physical: keys.map(k=>mapP.get(k)) };
}

/* ===== NEW: تجمعی ۳۰ روز ===== */
function cumulativeCounts(rows, days=30){
  const d = dailyCounts(rows, days);
  let running = 0;
  const cum = d.data.map(v=> (running += (Number(v)||0)));
  return { labels: d.labels, data: cum };
}

/* ===== NEW: داده‌های پارِتو محل‌ها ===== */
function locationTotals(rows, locationLookup){
  const L = locationsByCategory(rows, locationLookup);
  const totals = L.labels.map((name,i)=>({ name, total: (L.cyber[i]||0)+(L.physical[i]||0) }));
  totals.sort((a,b)=> b.total - a.total);
  const labels = totals.map(t=>t.name);
  const bars = totals.map(t=>t.total);
  const sum = bars.reduce((a,b)=>a+b,0) || 1;
  let run=0;
  const cumPctPercent = bars.map(v=> Math.round(((run+=v)/sum)*100));
  return { labels, bars, cumPctPercent };
}

/* ===== NEW: بازه‌های هیستوگرام ===== */
function bucketizeHours(h, edges){
  const bins = Array(edges.length-1).fill(0);
  if (h==null || !isFinite(h)) return bins;
  for (let i=0;i<edges.length-1;i++){
    if (h >= edges[i] && h < edges[i+1]) { bins[i]++; break; }
    if (i===edges.length-2 && h>=edges[i+1]) bins[i]++; // آخرین بین
  }
  return bins;
}
function durationsFirstAction(rows){
  const edges = [0, 1, 3, 6, 12, 24, 48, 72, 168, Infinity];
  const counts = Array(edges.length-1).fill(0);
  for (const r of rows||[]){
    const start = baselineStart(r);
    const fa = extractFirstActionDateTime(r);
    const h = hoursDiff(start, fa);
    const b = bucketizeHours(h, edges);
    for (let i=0;i<counts.length;i++) counts[i]+=b[i];
  }
  const labels = ["<1h","1–3h","3–6h","6–12h","12–24h","1–2d","2–3d","3–7d","≥7d"].map(s=>s.replace("h","س").replace("d","ر"));
  return { labels, counts };
}
function durationsResolve(rows){
  const edges = [0, 6, 12, 24, 48, 72, 168, 336, Infinity];
  const counts = Array(edges.length-1).fill(0);
  for (const r of rows||[]){
    if (statusKey(r)!=="closed") continue;
    const start = baselineStart(r);
    const res = extractResolvedDateTime(r);
    const h = hoursDiff(start, res);
    const b = bucketizeHours(h, edges);
    for (let i=0;i<counts.length;i++) counts[i]+=b[i];
  }
  const labels = ["<6h","6–12h","12–24h","1–2d","2–3d","3–7d","7–14d","≥14d"].map(s=>s.replace("h","س").replace("d","ر"));
  return { labels, counts };
}

/* ===== NEW: Calendar heatmap (۹۰ روز اخیر) ===== */
function calendarHeatData(rows, days=90){
  const anchor = getDataAnchorDate(rows);
  const start = addDays(anchor, -(days - 1));
  const map = new Map();
  for (let i=0;i<days;i++){ const d = addDays(start,i); map.set(fmtYMD(d), 0); }
  for (const r of rows||[]){
    const d = extractIncDate(r); if (!d) continue;
    const k = fmtYMD(d); if (map.has(k)) map.set(k, map.get(k)+1);
  }
  return Array.from(map.entries());
}

/* ============ Averages ============ */
function hoursDiff(a, b){ if (!a || !b) return null; const ms = b.getTime() - a.getTime(); if (!isFinite(ms)) return null; return Math.max(0, ms / 36e5); }
function formatAvgDurationHM(hours){
  if (hours == null || !isFinite(hours)) return "—";
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${enToFaDigits(String(h))} ساعت و ${enToFaDigits(String(m))} دقیقه`;
}
function computeAverages(rows){
  let sumFirst=0, cntFirst=0, sumResolve=0, cntResolve=0;
  for (const r of rows || []) {
    const sub = baselineStart(r);
    const fa  = extractFirstActionDateTime(r);
    const h1 = hoursDiff(sub, fa);
    if (h1 != null && h1 > 0) { sumFirst += h1; cntFirst++; }
    if (statusKey(r) === "closed") {
      const res = extractResolvedDateTime(r);
      const h2 = hoursDiff(sub, res);
      if (h2 != null && h2 > 0) { sumResolve += h2; cntResolve++; }
    }
  }
  const avgFirst   = cntFirst   ? (sumFirst/cntFirst)     : null;
  const avgResolve = cntResolve ? (sumResolve/cntResolve) : null;
  return { avgFirst, avgResolve };
}

/* ============ ECharts helpers ============ */
function echartsPalette() {
  const cl = themePalette();
  return {
    text: cl.tick, grid: cl.grid, border: cl.border, colors: cl.pie,
    fontFamily: chartFontFamily(), fontSize: chartFontSize(),
  };
}
function toFaJalaliLabel(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y,m,d] = ymd.split("-").map(Number);
  const date = new Date(y, m-1, d);
  if (isNaN(date)) return ymd;
  return fmtJalali(date);
}

/* ============ DOM helpers (KPI) ============ */
function findCardOf(el){
  if (!el) return null;
  return el.closest(".card") || el.closest(".kpi-card") || el.parentElement;
}
function ensureSubline(targetEl, subId){
  const card = findCardOf(targetEl); if (!card) return null;
  let host = card.querySelector(`#${subId}`);
  if (!host) {
    host = document.createElement("div");
    host.id = subId;
    host.className = "kpi-subline";
    card.appendChild(host);
  }
  return host;
}
function colorChipVariant(text, variant){
  const cls = `chip chip--${variant}`;
  return `<span class="${cls}">
    <span class="chip__dot"></span>
    <span>${text}</span>
  </span>`;
}
function moveBefore(aEl, bEl){
  const a = findCardOf(aEl), b = findCardOf(bEl);
  if (a && b && a!==b) b.parentElement.insertBefore(a, b);
}
function equalizeKPIHeights(idsToMatchFrom, idsToApply){
  const hs = idsToMatchFrom.map(id => findCardOf(document.getElementById(id))?.offsetHeight || 0);
  const targetH = Math.max(...hs);
  idsToApply.forEach(id=>{
    const c = findCardOf(document.getElementById(id));
    if (c) c.style.minHeight = targetH + "px";
  });
}

/* ============ Mount / Update ============ */
function pick(a,b){ return document.getElementById(a) || document.getElementById(b); }

function mountDashboard() {
  if (!window.echarts) { console.error("ECharts not found. Please include echarts.min.js before dashboard.js"); return null; }
  const cl = echartsPalette();
  const charts = {};
  const kpis = {
    total:      document.getElementById("dbTotal"),
    cyber:      document.getElementById("dbCyber"),
    physical:   document.getElementById("dbPhysical"),
    unknown:    document.getElementById("dbUnknown"),
    pending:    document.getElementById("dbPending"),
    closed:     document.getElementById("dbClosed"),
    rejected:   document.getElementById("dbRejected"),
    avgFirst:   document.getElementById("dbAvgFirstAction"),
    avgResolve: document.getElementById("dbAvgResolve"),
  };

  /* ===== Trend 30d ===== */
  const elDaily = pick("chartDaily","chartTrend");
  if (elDaily) {
    charts.daily = echarts.init(elDaily, null, {renderer: 'canvas'});
    charts.daily.setOption({
      color: [cl.colors[0]],
      grid: { left: 28, right: 12, top: 20, bottom: 64, containLabel: true },
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      tooltip: {
        trigger: 'axis',
        textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
        formatter: (params) => {
          if (!params || !params.length) return '';
          const p = params[0];
          const label = toFaJalaliLabel(String(p.axisValue));
          const val = enToFaDigits(String(p.data ?? 0));
          return `${label}<br/>تعداد: ${val}`;
        }
      },
      xAxis: {
        type: 'category',
        data: [],
        axisLabel: { color: cl.text, interval: 0, rotate: 35, margin: 12, fontFamily: cl.fontFamily, fontSize: cl.fontSize, fontWeight: 500, formatter: (v) => toFaJalaliLabel(String(v)) },
        axisLine: { lineStyle: { color: cl.border } },
        axisTick: { alignWithLabel: true, interval: 0 }
      },
      yAxis: {
        type: 'value', min: 0,
        axisLabel: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize, fontWeight: 500, formatter: (v)=> enToFaDigits(String(v)) },
        splitLine: { lineStyle: { color: cl.grid } },
        axisLine: { lineStyle: { color: cl.border } }
      },
      series: [{ name: 'تعداد حوادث (روزانه)', type: 'line', smooth: true, symbolSize: 5, data: [] }]
    });
  }

  /* ===== Status 4 weeks ===== */
  const elWeeks = pick("chartWeeks","chartStatusWeeks");
  if (elWeeks) {
    charts.weeks = echarts.init(elWeeks, null, {renderer: 'canvas'});
    charts.weeks.setOption({
      color: [cl.colors[4], cl.colors[0], cl.colors[1], cl.colors[3]],
      grid: { left: 28, right: 12, top: 20, bottom: 26, containLabel: true },
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
        formatter: (params)=> {
          let s = `${params?.[0]?.axisValue?.split?.("\n")?.[0] ?? ''}`;
          (params||[]).forEach(p=>{ s += `<br/>${p.marker}${p.seriesName}: ${enToFaDigits(String(p.data ?? 0))}`; });
          return s;
        }
      },
      legend: { bottom: 0, textStyle: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize } },
      xAxis: {
        type: 'category',
        data: [],
        axisLabel: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize, lineHeight: 18 },
        axisLine: { lineStyle: { color: cl.border } }
      },
      yAxis: {
        type: 'value', min: 0,
        axisLabel: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize, fontWeight: 500, formatter: (v)=> enToFaDigits(String(v)) },
        splitLine: { lineStyle: { color: cl.grid } },
        axisLine: { lineStyle: { color: cl.border } }
      },
      series: [
        { name: "مشخص نشده", type: 'bar', stack: 'status', data: [], barMaxWidth: 28 },
        { name: "در حال بررسی", type: 'bar', stack: 'status', data: [], barMaxWidth: 28 },
        { name: "حل شده", type: 'bar', stack: 'status', data: [], barMaxWidth: 28 },
        { name: "رد شده", type: 'bar', stack: 'status', data: [], barMaxWidth: 28 },
      ]
    });
  }

  /* ===== Locations ===== */
  const elLocations = document.getElementById("chartLocations");
  if (elLocations) {
    charts.locations = echarts.init(elLocations, null, {renderer:'canvas'});
    charts.locations.setOption({
      color: [cl.colors[0], cl.colors[1]],
      grid: { left: 80, right: 12, top: 20, bottom: 20, containLabel: true },
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
        formatter: (params)=> { let s = `${params?.[0]?.axisValue ?? ''}`; (params||[]).forEach(p=>{ s += `<br/>${p.marker}${p.seriesName}: ${enToFaDigits(String(p.data ?? 0))}`; }); return s; } },
      legend: { bottom: 0, textStyle: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize } },
      xAxis: { type: 'value', min: 0, axisLabel: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize, fontWeight: 500, formatter: (v)=> enToFaDigits(String(v)) }, splitLine: { lineStyle: { color: cl.grid } }, axisLine: { lineStyle: { color: cl.border } } },
      yAxis: { type: 'category', data: [], axisLabel: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize, fontWeight: 500 }, axisLine: { lineStyle: { color: cl.border } } },
      series: [
        { name: "سایبری", type: 'bar', stack: 'cat', data: [], barMaxWidth: 26 },
        { name: "پدافند", type: 'bar', stack: 'cat', data: [], barMaxWidth: 26 },
      ]
    });
  }

  /* ===== Priority doughnut ===== */
  const elPriority = document.getElementById("chartPriority");
  if (elPriority) {
    charts.priority = echarts.init(elPriority, null, {renderer:'canvas'});
    const pal = themePalette().pie;
    charts.priority.setOption({
      color: [pal[1], pal[2], pal[3]],
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      tooltip: { trigger: 'item', textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
        formatter: (p)=> `${p.marker}${p.name}: ${enToFaDigits(String(p.value||0))} (${enToFaDigits(String(Math.round(p.percent||0)))}%)` },
      legend: { bottom: 0, textStyle: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize } },
      series: [{
        type: 'pie',
        radius: ['40%','76%'],
        center: ['50%','45%'],
        avoidLabelOverlap: true,
        minAngle: 5,
        label: { show: true, position: 'inside', fontFamily: cl.fontFamily, fontSize: cl.fontSize, fontWeight: 600, formatter: '{b}\n{d}%' },
        labelLine: { show: false },
        labelLayout: { hideOverlap: true },
        data: [ { name: 'کم', value: 0 }, { name: 'متوسط', value: 0 }, { name: 'زیاد', value: 0 } ]
      }]
    });
  }

  /* ===== NEW charts ===== */
  const elByCat = document.getElementById("chartTrendByCat30");
  if (elByCat){
    charts.byCat = echarts.init(elByCat, null, {renderer:'canvas'});
    charts.byCat.setOption({
      color: [cl.colors[0], cl.colors[1]],
      grid: { left: 28, right: 12, top: 20, bottom: 64, containLabel: true },
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      legend: { top: 0, textStyle: { color: cl.text } },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category', data: [],
        axisLabel: { color: cl.text, interval: 0, rotate: 35, formatter: (v)=> toFaJalaliLabel(String(v)) },
        axisLine: { lineStyle: { color: cl.border } },
        axisTick: { alignWithLabel: true, interval: 0 }
      },
      yAxis: { type:'value', min:0, axisLabel: { color: cl.text, formatter: (v)=>enToFaDigits(String(v)) }, splitLine:{ lineStyle:{color:cl.grid} } },
      series: [
        { name:'سایبری', type:'bar', stack:'trend', data:[], barMaxWidth: 22 },
        { name:'پدافند', type:'bar', stack:'trend', data:[], barMaxWidth: 22 },
      ]
    });
  }

  const elCum = document.getElementById("chartCumulative30");
  if (elCum){
    charts.cumulative = echarts.init(elCum, null, {renderer:'canvas'});
    charts.cumulative.setOption({
      color: [cl.colors[4]],
      grid: { left: 28, right: 12, top: 20, bottom: 64, containLabel: true },
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      tooltip: { trigger:'axis' },
      xAxis: {
        type: 'category', data: [],
        axisLabel: { color: cl.text, interval: 0, rotate: 35, formatter:(v)=>toFaJalaliLabel(String(v)) },
        axisLine: { lineStyle: { color: cl.border } },
      },
      yAxis: {
        type:'value', min:0,
        axisLabel: { color: cl.text, formatter:(v)=>enToFaDigits(String(v)) },
        splitLine: { lineStyle: { color: cl.grid } }
      },
      series: [{ name:'تجمعی', type:'line', smooth:true, symbolSize:4, data:[] }]
    });
  }

  const elPareto = document.getElementById("chartParetoLocations");
  if (elPareto){
    charts.pareto = echarts.init(elPareto, null, {renderer:'canvas'});
    charts.pareto.setOption({
      color: [cl.colors[0], cl.colors[3]],
      grid: { left: 60, right: 48, top: 20, bottom: 40, containLabel: true },
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      tooltip: { trigger:'axis' },
      legend: { top: 0, textStyle:{ color: cl.text } },
      xAxis: [{ type:'category', data:[], axisLabel:{ color: cl.text }, axisLine:{ lineStyle:{ color:cl.border } } }],
      yAxis: [
        { type:'value', name:'تعداد', min:0, axisLabel:{ color: cl.text, formatter:(v)=>enToFaDigits(String(v)) }, splitLine:{ lineStyle:{color:cl.grid} } },
        { type:'value', name:'٪ تجمعی', min:0, max:100, axisLabel:{ color: cl.text, formatter:(v)=>enToFaDigits(String(v)) }, splitLine:{ show:false } }
      ],
      series: [
        { name:'تعداد', type:'bar', data:[], yAxisIndex:0, barMaxWidth:24 },
        { name:'٪ تجمعی', type:'line', data:[], yAxisIndex:1, smooth:true, symbolSize:4 }
      ]
    });
  }

  const elFunnel = document.getElementById("chartStatusFunnel");
  if (elFunnel){
    charts.funnel = echarts.init(elFunnel, null, {renderer:'canvas'});
    charts.funnel.setOption({
      color: [cl.colors[4], cl.colors[0], cl.colors[1], cl.colors[3]],
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      tooltip: { trigger:'item' },
      series: [{
        type:'funnel',
        top: 10, bottom: 10, left: '10%', right: '10%',
        min:0, max: 100, sort: 'descending',
        label: { color: cl.text, formatter: '{b}: {c}' },
        data: [
          { name:'مشخص نشده', value:0 },
          { name:'در حال بررسی', value:0 },
          { name:'حل شده', value:0 },
          { name:'رد شده', value:0 },
        ]
      }]
    });
  }

  const elFA = document.getElementById("chartFirstActionHist");
  if (elFA){
    charts.firstHist = echarts.init(elFA, null, {renderer:'canvas'});
    charts.firstHist.setOption({
      color: [cl.colors[2]],
      grid: { left: 40, right: 12, top: 20, bottom: 40, containLabel: true },
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      tooltip: { trigger:'axis' },
      xAxis: { type:'category', data:[], axisLabel:{ color: cl.text }, axisLine:{ lineStyle:{color:cl.border} } },
      yAxis: { type:'value', min:0, axisLabel:{ color: cl.text, formatter:(v)=>enToFaDigits(String(v)) }, splitLine:{ lineStyle:{ color: cl.grid } } },
      series: [{ name:'تا اولین اقدام', type:'bar', data:[], barMaxWidth: 28 }]
    });
  }

  const elRH = document.getElementById("chartResolveHist");
  if (elRH){
    charts.resolveHist = echarts.init(elRH, null, {renderer:'canvas'});
    charts.resolveHist.setOption({
      color: [cl.colors[3]],
      grid: { left: 40, right: 12, top: 20, bottom: 40, containLabel: true },
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      tooltip: { trigger:'axis' },
      xAxis: { type:'category', data:[], axisLabel:{ color: cl.text }, axisLine:{ lineStyle:{color:cl.border} } },
      yAxis: { type:'value', min:0, axisLabel:{ color: cl.text, formatter:(v)=>enToFaDigits(String(v)) }, splitLine:{ lineStyle:{ color: cl.grid } } },
      series: [{ name:'تا حل شدن', type:'bar', data:[], barMaxWidth: 28 }]
    });
  }

  const elCal = document.getElementById("chartCalendarHeat");
  if (elCal){
    charts.calendar = echarts.init(elCal, null, {renderer:'canvas'});
    charts.calendar.setOption({
      visualMap: {
        show: true,
        min: 0, max: 10,
        orient: 'horizontal', right: 0, top: 0,
        textStyle: { color: cl.text }
      },
      calendar: {
        orient: 'horizontal',
        cellSize: [18, 18],
        range: (()=>{
          const end = new Date(); end.setHours(0,0,0,0);
          const start = addDays(end, -89);
          return [fmtYMD(start), fmtYMD(end)];
        })(),
        dayLabel: { color: cl.text },
        monthLabel: { color: cl.text },
        yearLabel: { show:false },
        itemStyle: { borderColor: cl.border, borderWidth: 1 }
      },
      tooltip: {
        formatter: (p)=>{
          if (!p || !p.data) return '';
          const d = toFaJalaliLabel(p.data[0]);
          const v = enToFaDigits(String(p.data[1]||0));
          return `${d}<br/>تعداد: ${v}`;
        }
      },
      series: [{ type:'heatmap', coordinateSystem:'calendar', data: [] }]
    });
  }

  // Resize
  window.addEventListener('resize', () => {
    charts.daily?.resize(); charts.weeks?.resize(); charts.locations?.resize(); charts.priority?.resize();
    charts.byCat?.resize(); charts.cumulative?.resize(); charts.pareto?.resize(); charts.funnel?.resize();
    charts.firstHist?.resize(); charts.resolveHist?.resize(); charts.calendar?.resize();
  });

  return { kpis, charts };
}

function updateDashboard(ref, rows, options = {}) {
  if (!ref) return;

  let locationLookup = null;
  if (options.locations) {
    locationLookup = Array.isArray(options.locations)
      ? Object.fromEntries(options.locations.map(l => [Number(l.id), l.name]))
      : options.locations;
  }

  // KPI sums
  const sum = summarizeKPIs(rows || []);
  ref.kpis.total     && (ref.kpis.total.textContent    = enToFaDigits(String(sum.total)));
  ref.kpis.cyber     && (ref.kpis.cyber.textContent    = enToFaDigits(String(sum.cyber)));
  ref.kpis.physical  && (ref.kpis.physical.textContent = enToFaDigits(String(sum.physical)));
  ref.kpis.unknown   && (ref.kpis.unknown.textContent  = enToFaDigits(String(sum.unknown)));
  ref.kpis.pending   && (ref.kpis.pending.textContent  = enToFaDigits(String(sum.pending)));
  ref.kpis.closed    && (ref.kpis.closed.textContent   = enToFaDigits(String(sum.closed)));
  ref.kpis.rejected  && (ref.kpis.rejected.textContent = enToFaDigits(String(sum.rejected)));

  // Averages
  const avg = computeAverages(rows || []);
  if (ref.kpis.avgFirst)   ref.kpis.avgFirst.textContent   = formatAvgDurationHM(avg.avgFirst);
  if (ref.kpis.avgResolve) ref.kpis.avgResolve.textContent = formatAvgDurationHM(avg.avgResolve);

  // تفکیک ریسک‌ها: کل / سایبری / پدافند
  let low=0, mid=0, high=0, lowC=0, midC=0, highC=0, lowP=0, midP=0, highP=0;
  for (const r of rows || []) {
    const pk = priorityKey(r);
    const phys = isPhysical(r);
    if (pk === "low")      { low++;  phys ? lowP++  : lowC++;  }
    else if (pk === "medium"){ mid++;  phys ? midP++  : midC++;  }
    else if (pk === "high"){   high++; phys ? highP++ : highC++; }
  }
  if (ref.kpis.total) {
    const host = ensureSubline(ref.kpis.total, "dbTotalRiskBreakdown");
    if (host) host.innerHTML =
      colorChipVariant(`کم: ${enToFaDigits(low)}`,  "low") +
      colorChipVariant(`متوسط: ${enToFaDigits(mid)}`, "medium") +
      colorChipVariant(`زیاد: ${enToFaDigits(high)}`, "high");
  }
  if (ref.kpis.cyber) {
    const host = ensureSubline(ref.kpis.cyber, "dbCyberRiskBreakdown");
    if (host) host.innerHTML =
      colorChipVariant(`کم: ${enToFaDigits(lowC)}`,  "low") +
      colorChipVariant(`متوسط: ${enToFaDigits(midC)}`, "medium") +
      colorChipVariant(`زیاد: ${enToFaDigits(highC)}`, "high");
  }
  if (ref.kpis.physical) {
    const host = ensureSubline(ref.kpis.physical, "dbPhysicalRiskBreakdown");
    if (host) host.innerHTML =
      colorChipVariant(`کم: ${enToFaDigits(lowP)}`,  "low") +
      colorChipVariant(`متوسط: ${enToFaDigits(midP)}`, "medium") +
      colorChipVariant(`زیاد: ${enToFaDigits(highP)}`, "high");
  }

  // تفکیک وضعیت‌ها: سایبری/ پدافند زیر کارت‌ها
  function statusCounts(rows, wanted){
    let c=0,p=0;
    for (const r of rows||[]) if (statusKey(r)===wanted) (isPhysical(r)? p++ : c++);
    return {c,p};
  }
  function paintStatusBreakdown(elId, wanted, subId){
    const el = ref.kpis[elId]; if (!el) return;
    const {c,p} = statusCounts(rows, wanted);
    const host = ensureSubline(el, subId);
    if (host) host.innerHTML =
      colorChipVariant(`سایبری: ${enToFaDigits(c)}`, "cyber") +
      colorChipVariant(`پدافند: ${enToFaDigits(p)}`, "physical");
  }
  paintStatusBreakdown("unknown","unknown","dbUnknownCatBreak");
  paintStatusBreakdown("pending","pending","dbPendingCatBreak");
  paintStatusBreakdown("closed","closed","dbClosedCatBreak");
  paintStatusBreakdown("rejected","rejected","dbRejectedCatBreak");

  // هم‌قد کردن باکس‌های KPI
  equalizeKPIHeights(
    ["dbPending","dbClosed","dbRejected"],
    ["dbTotal","dbCyber","dbPhysical","dbUnknown"]
  );

  // جابجایی «میانگین‌ها» با «مشخص‌نشده»
  if (ref.kpis.unknown && ref.kpis.avgFirst) {
    const unkCard = findCardOf(ref.kpis.unknown);
    const avgFirstCard = findCardOf(ref.kpis.avgFirst);
    if (unkCard && avgFirstCard) {
      const placeholder = document.createElement("div");
      unkCard.parentNode.insertBefore(placeholder, unkCard);
      avgFirstCard.parentNode.insertBefore(unkCard, avgFirstCard);
      placeholder.parentNode.insertBefore(avgFirstCard, placeholder);
      placeholder.remove();
    }
  }

  /* ===== Trend 30d ===== */
  if (ref.charts.daily) {
    const d = dailyCounts(rows, 30);
    ref.charts.daily.setOption({ xAxis: { data: d.labels }, series: [{ data: d.data.map(v => Number(v) || 0) }] });
    ref.charts.daily.resize();
  }

  /* ===== Weeks (stacked) ===== */
  if (ref.charts.weeks) {
    const w = last4WeeksStatusStack(rows);
    ref.charts.weeks.setOption({
      xAxis: { data: w.labels },
      series: [
        { name: "مشخص نشده", data: w.unknown.map(v => Number(v) || 0) },
        { name: "در حال بررسی", data: w.pending.map(v => Number(v) || 0) },
        { name: "حل شده", data: w.closed.map(v => Number(v) || 0) },
        { name: "رد شده", data: w.rejected.map(v => Number(v) || 0) },
      ]
    });
    ref.charts.weeks.resize();
  }

  /* ===== Locations ===== */
  if (ref.charts.locations) {
    const L = locationsByCategory(rows, locationLookup);
    ref.charts.locations.setOption({
      yAxis: { data: L.labels },
      series: [
        { name: "سایبری", data: L.cyber.map(v => Number(v) || 0) },
        { name: "پدافند", data: L.physical.map(v => Number(v) || 0) },
      ]
    });
    ref.charts.locations.resize();
  }

  /* ===== Priority doughnut ===== */
  if (ref.charts.priority) {
    ref.charts.priority.setOption({
      series: [{ data: [ { name:'کم', value:low }, { name:'متوسط', value:mid }, { name:'زیاد', value:high } ] }]
    });
    ref.charts.priority.resize();
  }

  /* ===== NEW charts data binding ===== */
  if (ref.charts.byCat){
    const d = dailyCountsByCategory(rows, 30);
    ref.charts.byCat.setOption({
      xAxis: { data: d.labels },
      series: [
        { name:'سایبری', data: d.cyber.map(v=>Number(v)||0) },
        { name:'پدافند', data: d.physical.map(v=>Number(v)||0) },
      ]
    });
    ref.charts.byCat.resize();
  }

  if (ref.charts.cumulative){
    const c = cumulativeCounts(rows, 30);
    ref.charts.cumulative.setOption({ xAxis:{ data: c.labels }, series:[{ data: c.data }] });
    ref.charts.cumulative.resize();
  }

  if (ref.charts.pareto){
    const P = locationsByCategory(rows, locationLookup);
    const totals = P.labels.map((name,i)=>({ name, total:(P.cyber[i]||0)+(P.physical[i]||0) }));
    totals.sort((a,b)=> b.total - a.total);
    const labels = totals.map(t=>t.name);
    const bars   = totals.map(t=>t.total);
    const sumAll = bars.reduce((a,b)=>a+b,0)||1;
    let run=0;
    const cumPct = bars.map(v=> Math.round(((run+=v)/sumAll)*100));
    ref.charts.pareto.setOption({
      xAxis: [{ data: labels }],
      series: [
        { name:'تعداد', data: bars },
        { name:'٪ تجمعی', data: cumPct }
      ]
    });
    ref.charts.pareto.resize();
  }

  if (ref.charts.funnel){
    const sums = summarizeKPIs(rows || []);
    ref.charts.funnel.setOption({
      series: [{
        data: [
          { name:'مشخص نشده', value: sums.unknown },
          { name:'در حال بررسی', value: sums.pending },
          { name:'حل شده', value: sums.closed },
          { name:'رد شده', value: sums.rejected },
        ]
      }]
    });
    ref.charts.funnel.resize();
  }

  if (ref.charts.firstHist){
    const F = durationsFirstAction(rows);
    ref.charts.firstHist.setOption({ xAxis:{ data: F.labels }, series:[{ data: F.counts }] });
    ref.charts.firstHist.resize();
  }

  if (ref.charts.resolveHist){
    const R = durationsResolve(rows);
    ref.charts.resolveHist.setOption({ xAxis:{ data: R.labels }, series:[{ data: R.counts }] });
    ref.charts.resolveHist.resize();
  }

  if (ref.charts.calendar){
    const H = calendarHeatData(rows, 90);
    const max = Math.max(1, ...H.map(([_,v])=>v||0));
    ref.charts.calendar.setOption({
      visualMap: { max },
      series: [{ data: H }]
    });
    ref.charts.calendar.resize();
  }
}

function updateDashboardTheme(ref) {
  if (!ref) return;
  const cl = echartsPalette();
  const applyAxis = ()=>({
    axisLabel: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize, fontWeight: 500 },
    axisLine: { lineStyle: { color: cl.border } },
    splitLine: { lineStyle: { color: cl.grid } },
  });
  if (ref.charts.daily) {
    ref.charts.daily.setOption({ textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize }, xAxis: applyAxis(), yAxis: applyAxis() });
    ref.charts.daily.resize();
  }
  if (ref.charts.weeks) {
    ref.charts.weeks.setOption({
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      legend: { textStyle: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize } },
      xAxis: applyAxis(), yAxis: applyAxis()
    });
    ref.charts.weeks.resize();
  }
  if (ref.charts.locations) {
    ref.charts.locations.setOption({
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      legend: { textStyle: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize } },
      xAxis: applyAxis(), yAxis: applyAxis()
    });
    ref.charts.locations.resize();
  }
  if (ref.charts.priority) {
    ref.charts.priority.setOption({
      textStyle: { fontFamily: cl.fontFamily, fontSize: cl.fontSize },
      legend: { textStyle: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize } },
      series: [{ label: { fontFamily: cl.fontFamily, fontSize: cl.fontSize, fontWeight: 600 } }]
    });
    ref.charts.priority.resize();
  }

  // NEW charts
  const applyLegend = { textStyle: { color: cl.text, fontFamily: cl.fontFamily, fontSize: cl.fontSize } };
  ref.charts.byCat?.setOption({ textStyle:{ fontFamily: cl.fontFamily, fontSize: cl.fontSize }, legend: applyLegend, xAxis: applyAxis(), yAxis: applyAxis() });
  ref.charts.cumulative?.setOption({ textStyle:{ fontFamily: cl.fontFamily, fontSize: cl.fontSize }, xAxis: applyAxis(), yAxis: applyAxis() });
  ref.charts.pareto?.setOption({ textStyle:{ fontFamily: cl.fontFamily, fontSize: cl.fontSize }, legend: applyLegend, xAxis:[applyAxis()], yAxis:[applyAxis(), applyAxis()] });
  ref.charts.funnel?.setOption({ textStyle:{ fontFamily: cl.fontFamily, fontSize: cl.fontSize } });
  ref.charts.firstHist?.setOption({ textStyle:{ fontFamily: cl.fontFamily, fontSize: cl.fontSize }, xAxis: applyAxis(), yAxis: applyAxis() });
  ref.charts.resolveHist?.setOption({ textStyle:{ fontFamily: cl.fontFamily, fontSize: cl.fontSize }, xAxis: applyAxis(), yAxis: applyAxis() });
  ref.charts.calendar?.setOption({});
}

/* ============ Export ============ */
if (!window.Dashboard) window.Dashboard = {};
Object.assign(window.Dashboard, { mountDashboard, updateDashboard, updateDashboardTheme });

export { mountDashboard, updateDashboard, updateDashboardTheme };
