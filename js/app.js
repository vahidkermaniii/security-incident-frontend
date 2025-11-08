// public/js/app.js
import api from "./dataService.js";
import { mountDashboard, updateDashboard, updateDashboardTheme } from "./dashboard.js"; // داشبورد UI جدا
let _dashboardRef = null;
const API_BASE = (window.API_BASE || 'https://security-incident-backend.onrender.com/api').replace(/\/+$/, '');

/* ======================= Utils: Role ======================= */
function normalizeRole(r){
  if (!r) return '';
  const t = String(r).trim();
  if (t === 'مدیر سیستم') return 'system-admin';
  if (t === 'مدیر پدافند' || t === 'مدیر پدافند غیر عامل') return 'defense-admin';
  return t.toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
}
function isSystemAdmin(){ return normalizeRole(currentUser?.role) === 'system-admin'; }
function isDefenseAdmin(){ return normalizeRole(currentUser?.role) === 'defense-admin'; }
function isAdminish(){ const r = normalizeRole(currentUser?.role); return r==='system-admin' || r==='defense-admin'; }

/* ======================= Utils: DOM ======================= */
function forceShow(el){
  if(!el) return;
  el.classList.remove('hidden');
  el.style.display = (el?.tagName === 'BUTTON' ? 'inline-flex' : '');
}
function forceHide(el){
  if(!el) return;
  el.classList.add('hidden');
  el.style.display = 'none';
}
function getSection(el){
  return el?.closest?.('.base-data-card, .card, section, .panel, .box, .group') || el?.parentElement || null;
}
function insertAfter(ref, node){
  if(!ref || !ref.parentNode) return;
  ref.parentNode.insertBefore(node, ref.nextSibling);
}
function debounce(fn, wait=120){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ======================= Grab Elements ======================= */
const loginView          = document.getElementById('loginView');
const mainContent        = document.getElementById('mainContent');
const loginForm          = document.getElementById('loginForm');
const loginError         = document.getElementById('loginError');
const logoutBtn          = document.getElementById('logoutBtn');
const displayNameSpan    = document.getElementById('displayName');
const myPager            = document.getElementById('userIncPager');
const allPager           = document.getElementById('allIncPager');

// pages
const navButtons         = document.querySelectorAll('.nav-btn');
const homePage           = document.getElementById('homePage');
const incidentsPage      = document.getElementById('incidentsPage');
const adminPage          = document.getElementById('adminPage');
const baseDataPage       = document.getElementById('baseDataPage');
const userManagementPage = document.getElementById('userManagementPage');
const resourcesPage      = document.getElementById('resourcesPage');
const dashboardPage      = document.getElementById('dashboardPage');
const navDashboard       = document.getElementById('navDashboard');

// role-marked elements
const adminOnlyEls    = document.querySelectorAll('.admin-only');
const sysAdminOnlyEls = document.querySelectorAll('.system-admin-only');

// tables
const userIncidentsTable = document.getElementById('userIncidentsTable'); // این tbody است
const allIncidentsTable  = document.getElementById('allIncidentsTable');  // این هم tbody است

/* ======================= Pagination (client-side) ======================= */
const pagerState = {
  mine: { page: 1, pageSize: 10, total: 0 },
  all:  { page: 1, pageSize: 10, total: 0 },
};

let cacheMyIncidents = [];
let cacheAllIncidents = [];

/** Helper functions */
function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function pagesCount(total, pageSize){ return Math.max(1, Math.ceil((total||0) / (pageSize||10))); }

/** Get pager elements */
function getPagerEls(kind){
  const root = (kind === 'mine') ? myPager : allPager;
  if (!root) return {};
  return {
    root,
    size:  root.querySelector('.pager-size'),
    info:  root.querySelector('.pager-info'),
    first: root.querySelector('.pager-first'),
    prev:  root.querySelector('.pager-prev'),
    next:  root.querySelector('.pager-next'),
    last:  root.querySelector('.pager-last'),
  };
}

/** Setup pagination controls once */
function setupPager(kind){
  const els = getPagerEls(kind);
  if (!els.root) return;

  if (els.size) {
    const initSize = parseInt(els.size.value || pagerState[kind].pageSize, 10) || 10;
    pagerState[kind].pageSize = initSize;
    els.size.value = String(initSize);

    els.size.onchange = () => {
      const v = parseInt(els.size.value, 10) || 10;
      pagerState[kind].pageSize = v;
      pagerState[kind].page = 1;
      rerenderFromCache(kind);
    };
  }

  els.first && (els.first.onclick = () => { pagerState[kind].page = 1; rerenderFromCache(kind); });
  els.prev  && (els.prev.onclick  = () => { pagerState[kind].page = Math.max(1, pagerState[kind].page - 1); rerenderFromCache(kind); });
  els.next  && (els.next.onclick  = () => {
    const st = pagerState[kind];
    const pc = pagesCount(st.total, st.pageSize);
    st.page = Math.min(pc, st.page + 1);
    rerenderFromCache(kind);
  });
  els.last  && (els.last.onclick  = () => {
    const st = pagerState[kind];
    st.page = pagesCount(st.total, st.pageSize);
    rerenderFromCache(kind);
  });

  // مطمئن شو باکس صفحه‌بندی زیر جدول است
  movePagerBelowTable(kind);
}

/** Update pager text and button states */
function updatePagerUI(kind){
  const els = getPagerEls(kind);
  if (!els.root) return;

  const st = pagerState[kind];
  const pc = pagesCount(st.total, st.pageSize);
  st.page = clamp(st.page, 1, pc);

  if (els.info) els.info.textContent = `صفحه ${st.page} از ${pc} — ${st.total} ردیف`;

  if (els.first) els.first.disabled = (st.page <= 1);
  if (els.prev)  els.prev.disabled  = (st.page <= 1);
  if (els.next)  els.next.disabled  = (st.page >= pc);
  if (els.last)  els.last.disabled  = (st.page >= pc);
}

/** Re-render table from cache according to pager state */
function rerenderFromCache(kind){
  if (kind === 'mine') {
    renderIncidentsTable(userIncidentsTable, cacheMyIncidents, { mine:true, kind:'mine' });
  } else {
    renderIncidentsTable(allIncidentsTable, cacheAllIncidents, { mine:false, kind:'all' });
  }
  updatePagerUI(kind);
}

/* ======================= Filters ======================= */
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const priorityFilter = document.getElementById('priorityFilter');
const locationFilter = document.getElementById('locationFilter');
const locationFilterContainer = document.getElementById('locationFilterContainer');
const categoryFilter = document.getElementById('categoryFilter');
const categoryFilterContainer = document.getElementById('categoryFilterContainer');
const resetFiltersBtn = document.getElementById('resetFiltersBtn');
let reporterFilter = document.getElementById('reporterFilter');

/* ======================= Tabs ======================= */
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

/* ======================= Base-data lists ======================= */
const cyberTitlesList = document.getElementById('cyberTitlesList');
const physicalTitlesList = document.getElementById('physicalTitlesList');
const locationList = document.getElementById('locationList');
const priorityList = document.getElementById('priorityList');
const statusList = document.getElementById('statusList');

/* ======================= Base-data modal ======================= */
const configItemModal = document.getElementById('configItemModal');
const configModalTitle = document.getElementById('configModalTitle');
const configItemForm = document.getElementById('configItemForm');
const configTypeInput = document.getElementById('config-type');
const configIndexInput = document.getElementById('config-index');
const configValueInput = document.getElementById('configValue');

/* ======================= New incident ======================= */
const newIncidentModal = document.getElementById('newIncidentModal');
const navIncidentBtn = document.getElementById('navIncidentBtn');
const navIncidentBtnTop = document.getElementById('navIncidentBtnTop'); // دکمه بالای صفحه (غیرفعال می‌شود)
const newIncidentForm = document.getElementById('newIncidentForm');
const incidentCategorySelect = document.getElementById('incidentCategory');
const incidentTitleSelect = document.getElementById('incidentTitleSelect');
const incidentTitleOtherInput = document.getElementById('incidentTitleOther');
const incidentLocationSelect = document.getElementById('incidentLocation');
const incidentDateInput = document.getElementById('incidentDate');
const incidentTimeInput = document.getElementById('incidentTime');
const incidentDescriptionInput = document.getElementById('incidentDescription');
const incidentPrioritySelect = document.getElementById('incidentPriority');

/* ======================= Incident Details modal ======================= */
const incidentDetailsModal = document.getElementById('incidentDetailsModal');
const detailId = document.getElementById('detail-id');
const detailReporter = document.getElementById('detail-reporter');
const detailTitle = document.getElementById('detail-title');
const detailLocation = document.getElementById('detail-location');
const detailDescription = document.getElementById('detail-description');
const detailPriority = document.getElementById('detail-priority');
const detailStatus = document.getElementById('detail-status');
const detailDate = document.getElementById('detail-date');
const actionSection = document.getElementById('action-section');
const actionHistory = document.getElementById('action-history');

/* ======================= Add Action modal ======================= */
const addActionModal = document.getElementById('addActionModal');
const addActionForm = document.getElementById('addActionForm');
const actionIncidentIdInput = document.getElementById('action-incident-id');
const actionDescriptionInput = document.getElementById('actionDescription');
const actionDateInput = document.getElementById('actionDate');
const actionStatusSelect = document.getElementById('actionStatus');

/* ======================= messages ======================= */
const successModal = document.getElementById('successModal');
const successMessage = document.getElementById('successMessage');
const closeSuccessModalBtn = document.getElementById('closeSuccessModalBtn');
const errorModal = document.getElementById('errorModal');
const errorMessage = document.getElementById('errorMessage');
const closeErrorModalBtn = document.getElementById('closeErrorModalBtn');

/* ======================= users ======================= */
const addUserBtn = document.getElementById('addUserBtn');
const usersTable = document.getElementById('usersTable');
const userModal = document.getElementById('userModal');
const userModalTitle = document.getElementById('userModalTitle');
const userForm = document.getElementById('userForm');
const userIdInput = document.getElementById('user-id');
const userUsernameInput = document.getElementById('user-username');
const userFullnameInput = document.getElementById('user-fullname');
const userPositionInput = document.getElementById('user-position');
const userRoleSelect = document.getElementById('user-role');
const userPasswordInput = document.getElementById('user-password');
const userStatusSelect = document.getElementById('user-status');
const cancelUserBtn = document.getElementById('cancelUserBtn');

/* ======================= resources ======================= */
const resourcesContainer = document.getElementById('resourcesContainer');
const addResourceBtn = document.getElementById('addResourceBtn');
const resourceModal = document.getElementById('resourceModal');
const resourceModalTitle = document.getElementById('resourceModalTitle');
const resourceForm = document.getElementById('resourceForm');
const resourceIdInput = document.getElementById('resource-id');
const resourceTitleInput = document.getElementById('resource-title');
const resourceCategorySelect = document.getElementById('resource-category');
const resourceFileInput = document.getElementById('resource-file');
// ✅ دامنه (سایبری/پدافندی) در مودال افزودن/ویرایش فایل آموزشی
const resourceDomainSelect = document.getElementById('resource-domain');

/* ======== Resources: filters (Cyber vs Physical) – نیاز به دکمه‌های tabs در HTML ======== */
const resourcesFilterAll      = document.getElementById('resourcesFilterAll');
const resourcesFilterCyber    = document.getElementById('resourcesFilterCyber');
const resourcesFilterPhysical = document.getElementById('resourcesFilterPhysical');
let resourcesCurrentFilter = 'all';
function setResourceTabs(){
  [resourcesFilterAll, resourcesFilterCyber, resourcesFilterPhysical].forEach(el => el?.classList.remove('active'));
  if (resourcesCurrentFilter === 'all') resourcesFilterAll?.classList.add('active');
  else if (resourcesCurrentFilter === 'cyber') resourcesFilterCyber?.classList.add('active');
  else if (resourcesCurrentFilter === 'physical') resourcesFilterPhysical?.classList.add('active');

  // رنگ دکمه‌ها (همه: خاکستری، سایبری: آبی، پدافند: سبز) — نیازمند کلاس‌ها در CSS
  resourcesFilterAll?.classList.remove('btn-blue','btn-green'); resourcesFilterAll?.classList.add('btn-gray');
  resourcesFilterCyber?.classList.remove('btn-green','btn-gray'); resourcesFilterCyber?.classList.add('btn-blue');
  resourcesFilterPhysical?.classList.remove('btn-blue','btn-gray'); resourcesFilterPhysical?.classList.add('btn-green');
}
resourcesFilterAll?.addEventListener('click', ()=>{ resourcesCurrentFilter='all'; setResourceTabs(); loadResources(); });
resourcesFilterCyber?.addEventListener('click', ()=>{ resourcesCurrentFilter='cyber'; setResourceTabs(); loadResources(); });
resourcesFilterPhysical?.addEventListener('click', ()=>{ resourcesCurrentFilter='physical'; setResourceTabs(); loadResources(); });

/* ======================= theme ======================= */
const themeToggle = document.getElementById('themeToggle');

/* ======================= CSV Export buttons ======================= */
const exportMyBtn  = document.getElementById('exportMyIncCsv');
const exportAllBtn = document.getElementById('exportAllIncCsv');

/* ======================= Excel Export buttons (XLSX) ======================= */
const exportMyXlsxBtn  = document.getElementById('exportMyIncXlsx');
const exportAllXlsxBtn = document.getElementById('exportAllIncXlsx');

/* ======================= Session ======================= */
let currentUser = null;
// حالت خاص: آیا در وضعیت "رمز منقضی" هستیم؟
let passwordChangeMode = "normal"; // "normal" | "expired"
let pendingUsernameForExpired = ""; // برای ارسال به روت بدون توکن
function persistSession(tokens, user) {
  try {
    if (tokens?.accessToken) localStorage.setItem('accessToken', tokens.accessToken);
    if (tokens?.refreshToken) localStorage.setItem('refreshToken', tokens.refreshToken);
    if (user) localStorage.setItem('currentUser', JSON.stringify(user));
  } catch {}
}
function loadSession() {
  try {
    const t = localStorage.getItem('accessToken');
    const u = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (t && u) {
      api.setToken?.(t);
      currentUser = { ...u, role: normalizeRole(u?.role) };
      return true;
    }
  } catch {}
  return false;
}
function clearSession() {
  try {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
  } catch {}
}

/* ======================= UI helpers ======================= */
function showSuccess(msg) {
  if (!successModal) return;
  successMessage.textContent = msg;
  successModal.classList.remove('hidden');
}
function showError(msg) {
  if (!errorModal) { try{ console.error("ERROR:", msg);}catch{} return; }
  errorMessage.textContent = msg;
  errorModal.classList.remove('hidden');
}
function closeModals() {
  successModal?.classList.add('hidden');
  errorModal?.classList.add('hidden');
  configItemModal?.classList.add('hidden');
  newIncidentModal?.classList.add('hidden');
  userModal?.classList.add('hidden');
  resourceModal?.classList.add('hidden');
  incidentDetailsModal?.classList.add('hidden');
  addActionModal?.classList.add('hidden');
  preloginModal?.classList.add('hidden');
}

/* ======================= 401/403 Global Handler ======================= */
function handleAuthError(err){
  const st = Number(err?.status || 0);
  if (st === 401) {
    api.logoutLocal?.();
    currentUser = null;
    clearSession();
    mainContent?.classList.add('hidden');
    loginView?.classList.remove('hidden');
    showError(err?.message || "نشست شما منقضی شده است؛ لطفاً دوباره وارد شوید.");
    return true;
  }
  // برای رمز منقضی: دقیقا مودال تغییر رمز قبل از ورود باز شود
  if (st === 403 && (err?.payload?.code === "PASSWORD_EXPIRED")) {
    try {
      const preset =
        (loginForm?.username?.value || '').trim() ||
        (typeof pendingUsernameForExpired === 'string' && pendingUsernameForExpired) ||
        (currentUser?.username || '');
      openPreloginChangePasswordModal({ presetUsername: preset });
    } catch {}
    showError(err?.payload?.message || err?.message || "رمز شما منقضی شده است. لطفاً رمز را تغییر دهید.");
    return true;
  }
  return false;
}
window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev?.reason;
  if (reason instanceof Error && handleAuthError(reason)) {
    ev.preventDefault?.();
  }
});

/* ======================= FAB visibility + Safe area ======================= */
function updateFabVisibility(pageEl) {
  const shouldShow = !!pageEl && ['homePage','incidentsPage'].includes(pageEl.id);

  // دکمه شناور اصلی (پایین) فقط در صفحات مشخص:
  if (navIncidentBtn) {
    navIncidentBtn.style.display = shouldShow ? 'inline-flex' : 'none';
    navIncidentBtn.classList.toggle('hidden', !shouldShow);
  }

  // ⛔ دکمه بالای صفحه باید کاملا مخفی بماند
  if (navIncidentBtnTop) {
    navIncidentBtnTop.style.display = 'none';
    navIncidentBtnTop.classList.add('hidden');
  }

  applyFabSafeAreaDebounced();
}
function isFabShown(){
  if (!navIncidentBtn) return false;
  const style = getComputedStyle(navIncidentBtn);
  return style.display !== 'none' && !navIncidentBtn.classList.contains('hidden');
}
function getSpacer(kind){
  const id = (kind==='mine') ? 'fab-spacer-mine' : 'fab-spacer-all';
  return document.getElementById(id);
}
function ensureSpacer(kind){
  const id = (kind==='mine') ? 'fab-spacer-mine' : 'fab-spacer-all';
  let sp = document.getElementById(id);
  if (sp) return sp;

  sp = document.createElement('div');
  sp.id = id;
  sp.style.height = '0px';
  sp.style.pointerEvents = 'none';

  const pager = (kind==='mine') ? myPager : allPager;
  if (pager && pager.parentNode) insertAfter(pager, sp);
  else {
    const tbody = (kind==='mine') ? userIncidentsTable : allIncidentsTable;
    const tbl = tbody?.closest?.('table');
    if (tbl) insertAfter(tbl, sp);
    else if (tbody) insertAfter(tbody, sp);
    else document.body.appendChild(sp);
  }
  return sp;
}
function applyFabSafeArea(){
  const gap = 24;
  const height = (isFabShown() ? (navIncidentBtn.getBoundingClientRect().height || 56) + gap : 0);
  const spMine = ensureSpacer('mine');
  const spAll  = ensureSpacer('all');
  const mineVisible = incidentsPage && !incidentsPage.classList.contains('hidden');
  const allVisible  = adminPage && !adminPage.classList.contains('hidden');
  spMine.style.height = (mineVisible && isFabShown()) ? `${height}px` : '0px';
  spAll.style.height  = (allVisible  && isFabShown()) ? `${height}px` : '0px';
}
const applyFabSafeAreaDebounced = debounce(applyFabSafeArea, 80);
window.addEventListener('resize', applyFabSafeAreaDebounced);

/* ======================= صفحه‌ها ======================= */
function showPage(pageEl) {
  [homePage, incidentsPage, adminPage, baseDataPage, userManagementPage, resourcesPage, dashboardPage]
    .forEach(p => p && p.classList.add('hidden'));
  if (pageEl) pageEl.classList.remove('hidden');
  updateFabVisibility(pageEl);

  // 🔄 همگام‌سازی نمایش دکمه افزودن فایل آموزشی بر اساس نقش/صفحه
  try { refreshAddResourceBtnVisibility(); } catch {}

  // اگر وارد داشبورد شدیم و نقش ادمینی داریم
  if (pageEl === dashboardPage && isAdminish()) {
    ensureDashboardMounted();
    try { updateDashboard(_dashboardRef, cacheAllIncidents || []); } catch {}
  }
}

/* ======================= Status helpers ======================= */
let STATUS_ID_MAP = { open:null, pending:null, closed:null, onhold:null, rejected:null };

function _normalizeFa(s=''){
  const map = { 'ي':'ی','ك':'ک','ۀ':'ه','ة':'ه','أ':'ا','إ':'ا','ؤ':'و','ئ':'ی','‌':' ','‏':' ' };
  return String(s)
    .toLowerCase()
    .replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
    .replace(/[ي]/g, map['ي']).replace(/[ك]/g, map['ك'])
    .replace(/[ۀ]/g, map['ۀ']).replace(/[ة]/g, map['ة'])
    .replace(/[أإ]/g, 'ا').replace(/[ؤ]/g, 'و').replace(/[ئ]/g, 'ی')
    .replace(/[\u200c\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function buildStatusIdMap(statuses = []){
  const map = { open:null, pending:null, closed:null, onhold:null, rejected:null };
  (statuses || []).forEach(st => {
    const name = _normalizeFa(st.name || st.title || '');
    const id = Number(st.id);
    if (!id) return;
    if (/(^| )باز( |$)|(^| )open( |$)|ثبت اولیه|جدید/.test(name)) map.open = id;
    else if (/در حال بررسي|در حال بررسی|بررسي|بررسی|pending|انتظار|پيگيري|پیگیری/.test(name)) map.pending = id;
    else if (/حل شده|حل‌شده|برطرف|مختومه|اتمام|closed|resolve/.test(name)) map.closed = id;
    else if (/تعليق|تعلیق|معلق|on ?hold|در انتظار پاسخ|نياز به اطلاعات|نیاز به اطلاعات/.test(name)) map.onhold = id;
    else if (/رد شده|(^| )رد( |$)|rejected|ابطال|لغو|عدم تاييد|عدم تایید/.test(name)) map.rejected = id;
  });
  return map;
}
function statusKey(row){
  const sid  = Number(row.status_id);
  const txt  = _normalizeFa(row.status_name || row.status || '');
  for (const k of ['open','pending','closed','onhold','rejected']) {
    if (STATUS_ID_MAP[k] && STATUS_ID_MAP[k] === sid) return k;
  }
  if (/(^| )باز( |$)|(^| )open( |$)|ثبت اولیه|جدید/.test(txt))                 return 'open';
  if (/در حال بررسي|در حال بررسی|بررسي|بررسی|pending|انتظار|پيگيري|پیگیری/.test(txt)) return 'pending';
  if (/حل شده|حل‌شده|برطرف|مختومه|اتمام|closed|resolve/.test(txt))            return 'closed';
  if (/تعليق|تعلیق|معلق|on ?hold|در انتظار پاسخ|نياز به اطلاعات|نیاز به اطلاعات/.test(txt)) return 'onhold';
  if (/رد شده|(^| )رد( |$)|rejected|ابطال|لغو|عدم تاييد|عدم تایید/.test(txt)) return 'rejected';
  if (/مشخص نشده|نامشخص|تعيين نشده|تعیین نشده|ناملوم|نامعلوم|unspecified/.test(txt)) return 'unknown';
  return 'pending';
}
function statusLabel(row){ return row.status_name || row.status || 'نامشخص'; }
function _statusIconClasses(key){
  switch (key) {
    case 'open':     return 'fas fa-check-circle';
    case 'pending':  return 'fas fa-hourglass-half';
    case 'closed':   return 'fas fa-check-circle';
    case 'onhold':   return 'fas fa-pause-circle';
    case 'rejected': return 'fas fa-times-circle';
    case 'unknown':  return 'fas fa-question-circle';
    default:         return 'fas fa-circle';
  }
}
function statusChipHtml(row){
  const key = statusKey(row);
  const lbl = statusLabel(row);
  const ico = _statusIconClasses(key);
  const tip = actionTooltip(row);
  return `<span class="status-chip status--${key}" ${tip ? `title="${tip}"` : ''}>
    <i class="${ico} icon"></i><span>${escapeHtml(lbl)}</span>
  </span>`;
}

/* ======================= Helpers: تاریخ ======================= */
function pad2(n){ return String(n).padStart(2, '0'); }
function normalizeJalaliDate(val){
  if (!val) return '';
  let s = String(val).trim();
  const fa = '۰۱۲۳۴۵۶۷۸۹', ar = '٠١٢٣٤٥٦٧٨٩';
  s = s.replace(/[۰-۹]/g, d => String(fa.indexOf(d)))
       .replace(/[٠-٩]/g, d => String(ar.indexOf(d)))
       .replace(/[\/\.]/g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) s = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return s;
}
function ymdPart(s){
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function timePart(s){
  if (!s) return '';
  const m = String(s).match(/T?(\d{2}:\d{2})(?::\d{2})?/);
  return m ? m[1] : '';
}
function gregorianToJalali(gy, gm, gd){
  const g_d_m=[0,31,59,90,120,151,181,212,243,273,304,334];
  let jy = (gy<=1600)? 0:979;
  gy -= (gy<=1600)? 621:1600;
  const gy2 = (gm>2) ? (gy+1) : gy;
  let days = (365*gy) + Math.floor((gy2+3)/4) - Math.floor((gy2+99)/100) + Math.floor((gy2+399)/400)
             - 80 + gd + g_d_m[gm-1];
  jy += 33*Math.floor(days/12053); days%=12053;
  jy += 4*Math.floor(days/1461);   days%=1461;
  if (days>365){ jy += Math.floor((days-1)/365); days=(days-1)%365; }
  const jm = (days<186)? 1+Math.floor(days/31) : 7+Math.floor((days-186)/30);
  const jd = 1 + ((days<186)? (days%31) : ((days-186)%30));
  return {jy, jm, jd};
}
function gregStrToJalaliYMD(s){
  if (!s) return '';
  if (/^(13|14)\d{2}-\d{2}-\د{2}/.test(String(s))) {
    return normalizeJalaliDate(s);
  }
  const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  const gy = parseInt(m[1],10), gm = parseInt(m[2],10), gd = parseInt(m[3],10);
  try {
    if (window.jalaali && typeof window.jalaali.toJalaali === 'function') {
      const j = window.jalaali.toJalaali(gy, gm, gd);
      return `${j.jy}-${pad2(j.jm)}-${pad2(j.jd)}`;
    }
  } catch {}
  const j = gregorianToJalali(gy, gm, gd);
  return `${j.jy}-${pad2(j.jm)}-${pad2(j.jd)}`;
}
function getTodayJalaliSafe(){
  const g = new Date();
  try {
    if (window.jalaali && typeof window.jalaali.toJalaali === 'function') {
      const j = window.jalaali.toJalaali(g.getFullYear(), g.getMonth()+1, g.getDate());
      return `${j.jy}-${pad2(j.jm)}-${pad2(j.jd)}`;
    }
  } catch {}
  const j = gregorianToJalali(g.getFullYear(), g.getMonth()+1, g.getDate());
  return `${j.jy}-${pad2(j.jm)}-${pad2(j.jd)}`;
}
function isEpochLike(x){
  return typeof x === 'number' || (/^\d{10,13}$/.test(String(x||'')));
}
function toTehranFromAny(input){
  if (!input) return null;
  let d;
  if (isEpochLike(input)) {
    const n = Number(input);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    const s = String(input).replace(' ', 'T');
    d = new Date(s);
    if (isNaN(d.getTime())) return null;
  }
  const localOffsetMin = d.getTimezoneOffset();
  const utcMs = d.getTime() + localOffsetMin * 60000;
  const tehranMs = utcMs + (3*60 + 30) * 60000; 
  const t = new Date(tehranMs);
  return {
    gy: t.getUTCFullYear(),
    gm: t.getUTCMonth() + 1,
    gd: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes()
  };
}
function tehranYMDHMtoJalaliStr(dt){
  if (!dt) return { jYMD:'', hm:'' };
  const { gy, gm, gd, hh, mm } = dt;
  const j = (window.jalaali && window.jalaali.toJalaali)
    ? window.jalaali.toJalaali(gy, gm, gd)
    : gregorianToJalali(gy, gm, gd);
  return { jYMD: `${j.jy}-${pad2(j.jm)}-${pad2(j.jd)}`, hm: `${pad2(hh)}:${pad2(mm)}` };
}
function pickRegisteredJDate(row){
  const s = row?.submission_date || row?.created_at || '';
  return s ? gregStrToJalaliYMD(s) : '';
}
function pickRegisteredTime(row){
  const s = row?.submission_date || row?.created_at || '';
  const m = String(s).match(/\b(\d{2}:\d{2})\b/);
  return m ? m[1] : '';
}
/* ======================= تاریخ‌های حادثه ======================= */
function pickIncidentDate(row){
  if (row.incident_date_jalali) return normalizeJalaliDate(row.incident_date_jalali);
  const src = row.incident_date || row.submission_date || row.created_at || '';
  return gregStrToJalaliYMD(src);
}
function pickIncidentTime(row){
  if (row.incident_time)       return row.incident_time.slice(0,5);
  if (row.submission_date)     return timePart(row.submission_date);
  if (row.created_at)          return timePart(row.created_at);
  return '';
}

/* ======================= Sanitizer ======================= */
function escapeHtml(s){
  return String(s||'').replace(/&/g,'&amp;')
                      .replace(/</g,'&lt;')
                      .replace(/>/g,'&gt;')
                      .replace(/"/g,'&quot;')
                      .replace(/'/g,'&#39;');
}
// ✅ افزودن unescape برای بازگردانی ایمن در فرم‌ها
function unescapeHtml(s){
  return String(s||'').replace(/&(lt|gt|amp|quot|#39);/g, (m, p1) => ({
    lt:'<', gt:'>', amp:'&', quot:'"', '#39':"'"
  }[p1]));
}

/* ======================= Badges ======================= */
function categoryFa(row){
  const cid = (row.category_id ?? row.category)?.toString();
  const cl = row.category_label;
  if (cl && /cyber|physical|امنیت|پدافند/i.test(cl)) {
    if (/cyber/i.test(cl)) return 'امنیت سایبری';
    if (/physical/i.test(cl)) return 'پدافند غیر عامل';
    return cl;
  }
  if (cid === '1' || /^cyber$/i.test(row.category_type||''))  return 'امنیت سایبری';
  if (cid === '2' || /^physical$/i.test(row.category_type||'')) return 'پدافند غیر عامل';
  return '-';
}
function _badge(text, className){ return `<span class="badge ${className}">${escapeHtml(text)}</span>`; }
function priorityKey(row){
  const id   = Number(row.priority_id);
  const name = (row.priority_name || row.priority || "").toString().toLowerCase();
  if (id === 1 || /low|کم/.test(name)) return "low";
  if (id === 3 || /high|زیاد/.test(name)) return "high";
  return "medium";
}
const catBadge = (row)=>{
  const key = (/^2$|physical/i.test(row.category_label||row.category_type||row.category_id)) ? 'physical' : 'cyber';
  return _badge(categoryFa(row), `badge--cat-${key}`);
};
function _locIndex(id){ const n = Math.abs(Number(id||0)); return (n % 10) + 1; }
const locBadge = (row)=>{
  const idx = _locIndex(row.location_id);
  const label = row.location_name ?? row.location ?? '-';
  return _badge(label, `badge--loc-${idx}`);
};
const prioBadge = (row)=>{
  const k = priorityKey(row);
  const label = row.priority_name ?? row.priority ?? (k==='low'?'کم':k==='high'?'زیاد':'متوسط');
  return _badge(label, `badge--prio-${k}`);
};

/* ======================= Login / Logout ======================= */
// عناصر مودال تغییر رمز پیش‌از-ورود
const preloginModal      = document.getElementById('preloginModal');
const preloginPassForm   = document.getElementById('preloginPassForm'); // ✅ فرم
const preU               = document.getElementById('prelogin-username');
const preCur             = document.getElementById('prelogin-current-password');
const preNew             = document.getElementById('prelogin-new-password');
const preNew2            = document.getElementById('prelogin-new-password-2');
const preloginCancelBtn  = document.getElementById('preloginCancelBtn');
// نکته: دکمهٔ submit داخل فرم است؛ نیازی به click-listener جداگانه نیست.

function openPreloginChangePasswordModal({ presetUsername = "" } = {}){
  if (preU)   preU.value   = presetUsername || '';
  if (preCur) preCur.value = '';
  if (preNew) preNew.value = '';
  if (preNew2)preNew2.value= '';
  preloginModal?.classList.remove('hidden');
}
preloginCancelBtn?.addEventListener('click', ()=> preloginModal?.classList.add('hidden'));

// ✅ هندلر submit فرم (به‌جای click روی دکمه)
preloginPassForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();

  const username         = (preU?.value || '').trim();
  const current_password = (preCur?.value || '').trim();
  const new_password     = (preNew?.value || '').trim();
  const new_password_2   = (preNew2?.value || '').trim();

  if (!username || !current_password || !new_password) {
    showError("نام کاربری، رمز فعلی و رمز جدید الزامی است.");
    return;
  }
  if (new_password !== new_password_2) {
    showError("تکرار رمز جدید مطابقت ندارد.");
    return;
  }

  try {
    // ⬅️ مسیر درست برای تغییر رمز منقضی
    const data = await api.changePasswordExpired({ username, current_password, new_password });

    // اگر بک‌اند همانجا توکن و کاربر برگرداند:
    if (data?.ok && data?.accessToken && data?.user) {
      api.setToken?.(data.accessToken);
      currentUser = {
        id: data.user.id,
        username: data.user.username,
        fullname: data.user.fullname,
        role: normalizeRole(data.user.role),
        position: data.user.position,
        status: data.user.status
      };
      persistSession({ accessToken: data.accessToken, refreshToken: data.refreshToken }, currentUser);
    } else if (data?.ok || data?.success) {
      // در اکثر پیاده‌سازی‌ها فقط ok/success برمی‌گردد؛ پس با رمز جدید لاگین می‌کنیم
      const loginRes = await api.login(username, new_password);
      const access   = loginRes?.accessToken || loginRes?.token;
      const refresh  = loginRes?.refreshToken;
      if (!loginRes?.ok || !access || !loginRes?.user) {
        showError(loginRes?.message || "ورود پس از تغییر رمز ناموفق بود.");
        return;
      }
      api.setToken?.(access);
      currentUser = {
        id: loginRes.user.id,
        username: loginRes.user.username,
        fullname: loginRes.user.fullname,
        role: normalizeRole(loginRes.user.role),
        position: loginRes.user.position,
        status: loginRes.user.status
      };
      persistSession({ accessToken: access, refreshToken: refresh }, currentUser);
    } else {
      showError(data?.message || "تغییر رمز ناموفق بود.");
      return;
    }

    // ✅ پس از موفقیت: بستن مودال، مخفی کردن صفحهٔ لاگین و نمایش داشبورد
    preloginModal?.classList.add('hidden');
    loginView.classList.add('hidden');
    mainContent.classList.remove('hidden');
    displayNameSpan.textContent = escapeHtml(currentUser.fullname || currentUser.username);

    updateRoleBasedUI();
    // 🔁 دکمه افزودن منابع: بایند و به‌روزرسانی نمایش
    try { setupAddResourceBtnOnce(); refreshAddResourceBtnVisibility(); } catch {}

    await Promise.all([
      initBaseConfig(),
      setupReporterFilter(),
      loadMyIncidents(),
      (isAdminish() ? loadAllIncidents() : Promise.resolve()),
      loadResources(),
    ]);

    showPage(homePage);
    showSuccess("رمز با موفقیت تغییر کرد. خوش آمدید!");
  } catch (e) {
    if (!handleAuthError(e)) showError(e?.message || "تغییر رمز ناموفق بود.");
  }
});


loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const username = loginForm.username.value.trim();
    const password = loginForm.password.value.trim();

    const data = await api.login(username, password);
    const access = data?.accessToken || data?.token;
    const refresh= data?.refreshToken;
    if (!data?.ok || !access || !data?.user) {
      loginError?.classList.remove('hidden');
      return;
    }
    api.setToken?.(access);
    currentUser = {
      id: data.user.id,
      username: data.user.username,
      fullname: data.user.fullname,
      role: normalizeRole(data.user.role),
      position: data.user.position,
      status: data.user.status
    };
    persistSession({ accessToken: access, refreshToken: refresh }, currentUser);

    loginView.classList.add('hidden');
    mainContent.classList.remove('hidden');
    displayNameSpan.textContent = escapeHtml(currentUser.fullname || currentUser.username);

    updateRoleBasedUI();
    // 🔁 دکمه افزودن منابع: بایند و به‌روزرسانی نمایش
    try { setupAddResourceBtnOnce(); refreshAddResourceBtnVisibility(); } catch {}

    await Promise.all([
      initBaseConfig(),
      setupReporterFilter(),
      loadMyIncidents(),
      (isAdminish() ? loadAllIncidents() : Promise.resolve()),
      loadResources(),
    ]);

    showPage(homePage);
  } catch (err) {
    // اگر رمز منقضی است (از لاگین)
    if (Number(err?.status) === 403 && err?.payload?.code === 'PASSWORD_EXPIRED') {
      pendingUsernameForExpired = (loginForm.username.value || '').trim();
      loginError?.classList.add('hidden'); // پیام خطای لاگین را پنهان کن
      openPreloginChangePasswordModal({ presetUsername: pendingUsernameForExpired });
      showError(err?.payload?.message || 'رمز شما منقضی شده است. لطفاً ابتدا رمز را تغییر دهید.');
      return;
    }
    if (!handleAuthError(err)) {
      try{ console.error(err);}catch{}
      loginError?.classList.remove('hidden');
    }
  }
});

logoutBtn?.addEventListener('click', () => {
  api.logoutLocal?.();
  currentUser = null;
  clearSession();
  window.location.reload();
});

/* ======================= Role-based UI ======================= */
function updateRoleBasedUI() {
  const role = normalizeRole(currentUser?.role);

  // اول همه مخفی + hidden
  adminOnlyEls.forEach(el => { if(!el) return; el.classList.add('hidden'); el.style.display = 'none'; });
  sysAdminOnlyEls.forEach(el => { if(!el) return; el.classList.add('hidden'); el.style.display = 'none'; });

  if (role === 'system-admin') {
    // نمایش کامل برای system-admin
    adminOnlyEls.forEach(el => { if(!el) return; el.classList.remove('hidden'); el.style.display = ''; });
    sysAdminOnlyEls.forEach(el => { if(!el) return; el.classList.remove('hidden'); el.style.display = ''; });

    enableAllBaseDataTabsForSystemAdmin();
    navDashboard && forceShow(navDashboard);
    forceShow(dashboardPage);
  } else if (role === 'defense-admin') {
    // نمایش admin-only اما نگه‌داشتن system-admin-only در حالت مخفی
    adminOnlyEls.forEach(el => { if(!el) return; el.classList.remove('hidden'); el.style.display = ''; });

    const navAdmin = document.querySelector('.nav-btn[data-target="adminPage"]');
    const navBaseData = document.querySelector('.nav-btn[data-target="baseDataPage"]');
    forceShow(navAdmin);
    forceShow(navBaseData);
    forceHide(document.querySelector('.nav-btn[data-target="userManagementPage"]'));
    forceShow(adminPage);
    forceShow(baseDataPage);
    forceHide(userManagementPage);
    limitBaseDataForDefenseAdmin();

    navDashboard && forceShow(navDashboard);
    forceShow(dashboardPage);
  } else {
    // کاربر معمولی
    forceHide(adminPage);
    forceHide(baseDataPage);
    forceHide(userManagementPage);
    navDashboard && forceHide(navDashboard);
    forceHide(dashboardPage);
  }

  const active = [homePage, incidentsPage, adminPage, baseDataPage, userManagementPage, resourcesPage, dashboardPage]
    .find(p => p && !p.classList.contains('hidden')) || homePage;
  updateFabVisibility(active);

  // 🔄 دکمه افزودن منبع آموزشی را همگام کن
  try { refreshAddResourceBtnVisibility(); } catch {}
}
function limitBaseDataForDefenseAdmin(){
  tabs.forEach(t=>{
    const key = t.getAttribute('data-tab');
    if (key === 'titles') t.classList.remove('hidden');
    else t.classList.add('hidden');
  });
  tabContents.forEach(p=>{
    if (p.id === 'titles-tab') p.classList.add('active');
    else p.classList.remove('active');
  });
  const cyberCard = getSection(cyberTitlesList);
  const physicalCard = getSection(physicalTitlesList);
  forceHide(cyberCard);
  forceShow(physicalCard);
}
function enableAllBaseDataTabsForSystemAdmin(){
  tabs.forEach(t => t.classList.remove('hidden'));
  const activeTab = Array.from(tabs).find(t => t.classList.contains('active')) || document.querySelector('.tab[data-tab="titles"]');
  tabs.forEach(t => t.classList.remove('active'));
  activeTab?.classList.add('active');

  const key = activeTab?.getAttribute('data-tab') || 'titles';
  const targetId = `${key}-tab`;
  tabContents.forEach(pane=>{
    if (pane.id === targetId) pane.classList.add('active');
    else pane.classList.remove('active');
  });

  [cyberTitlesList, physicalTitlesList, locationList, priorityList, statusList]
    .map(getSection)
    .forEach(sec => sec && forceShow(sec));
}

/* ======================= Tabs ======================= */
tabs.forEach(tab=>{
  tab.addEventListener('click', ()=>{
    const key = tab.getAttribute('data-tab');
    const targetId = `${key}-tab`;
    if (isDefenseAdmin() && key !== 'titles') return;

    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    tabContents.forEach(p => p.id === targetId ? p.classList.add('active') : p.classList.remove('active'));
  });
});

/* ======================= Base Data ======================= */
let baseConfigCache = null;

async function initBaseConfig() {
  try {
    baseConfigCache = await api.fetchConfigData();
    STATUS_ID_MAP = buildStatusIdMap(baseConfigCache?.statuses);
    fillBaseDataLists();
    fillFiltersFromConfig();
    fillIncidentFormSelects();

    if (isDefenseAdmin()) {
      limitBaseDataForDefenseAdmin();
    } else if (isSystemAdmin()) {
      enableAllBaseDataTabsForSystemAdmin();
    }
  } catch (e) {
    if (!handleAuthError(e)) {
      try{ console.error(e);}catch{}
      showError("خطا در دریافت اطلاعات پایه.");
    }
  }
}
function fillBaseDataLists() {
  fillUl(cyberTitlesList,    baseConfigCache?.titles?.cyber    || [], 'title', 'title_id', 'title');
  fillUl(physicalTitlesList, baseConfigCache?.titles?.physical || [], 'title', 'title_id', 'title');
  fillUl(locationList,  baseConfigCache?.locations  || [], 'name', 'id', 'location');
  fillUl(priorityList,  baseConfigCache?.priorities || [], 'name', 'id', 'priority');
  fillUl(statusList,    baseConfigCache?.statuses   || [], 'name', 'id', 'status');
}
function fillUl(ulEl, arr, labelKey, idKey, type) {
  if (!ulEl) return;
  ulEl.innerHTML = "";
  arr.forEach(item => {
    const name = escapeHtml(item[labelKey]);
    const idVal = Number(item[idKey]);
    const li = document.createElement('li');
    // ✅ تنها تغییر برای مرتب شدن دکمه‌های ویرایش/حذف:
    li.className = "flex items-center justify-between bg-gray-700 p-2 rounded-lg";
    li.innerHTML = `
      <span>${name}</span>
      ${isAdminish() ? `
      <div class="space-x-2 space-x-reverse">
        <button class="btn-secondary px-2 py-1 rounded edit-config" data-type="${type}" data-id="${idVal}" data-name="${name}">ویرایش</button>
        <button class="btn-danger px-2 py-1 rounded del-config" data-type="${type}" data-id="${idVal}">حذف</button>
      </div>` : ``}
    `;
    ulEl.appendChild(li);
  });

  ulEl.querySelectorAll('.edit-config').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      openConfigModal(btn.dataset.type, Number(btn.dataset.id), btn.dataset.name);
    });
  });
  ulEl.querySelectorAll('.del-config').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm('حذف شود؟')) return;
      try{
        const r = await api.deleteConfigItem(btn.dataset.type, Number(btn.dataset.id));
        if(r?.success || !r?.message){
          showSuccess("حذف شد.");
          await initBaseConfig();
        }else{
          showError(r.message || "حذف با خطا مواجه شد.");
        }
      }catch(e){ showError("حذف با خطا مواجه شد."); }
    });
  });

  document.querySelectorAll('.add-config-item').forEach(btn=>{
    btn.onclick = ()=> openConfigModal(btn.dataset.type, -1, "");
  });
}
function fillFiltersFromConfig() {
  setOptions(statusFilter,  [{value:"all", label:"همه وضعیت‌ها"}, ...mapNameId(baseConfigCache?.statuses)]);
  setOptions(priorityFilter,[{value:"all", label:"همه درجه‌های ریسک"}, ...mapNameId(baseConfigCache?.priorities)]);
  setOptions(locationFilter,[{value:"all", label:"همه مکان‌ها"}, ...mapNameId(baseConfigCache?.locations)]);
  locationFilterContainer?.classList.remove('hidden');

  if (categoryFilter) {
    const cats = [
      { value: "all", label: "همه دسته‌بندی‌ها" },
      { value: "1",   label: "امنیت سایبری" },
      { value: "2",   label: "پدافند غیر عامل" },
    ];
    setOptions(categoryFilter, cats);
    categoryFilterContainer?.classList.remove('hidden');

    if (isDefenseAdmin()) {
      categoryFilter.value = "2";
      categoryFilter.disabled = true;
    } else {
      categoryFilter.disabled = false;
      categoryFilter.value = "all";
    }
  }
}
function setOptions(selectEl, items) {
  if(!selectEl) return;
  selectEl.innerHTML = "";
  items.forEach(it=>{
    const opt = document.createElement('option');
    opt.value = it.value;
    opt.textContent = it.label;
    selectEl.appendChild(opt);
  });
}
function mapNameId(list = []) { return list.map(x=>({ value: String(x.id), label: x.name })); }
function fillIncidentFormSelects() {
  setOptions(incidentLocationSelect, [{value:"", label:"انتخاب کنید..."}, ...mapNameId(baseConfigCache?.locations)]);
  setOptions(incidentPrioritySelect, [{value:"", label:"انتخاب کنید..."}, ...mapNameId(baseConfigCache?.priorities)]);
}

// base-data modal
function openConfigModal(type, id, name) {
  if (!configItemModal) return;
  configModalTitle.textContent = (id && id !== -1) ? "ویرایش آیتم" : "افزودن آیتم جدید";
  configTypeInput.value = type;
  configIndexInput.value = id;
  // بازگردانی HTML entities برای ویرایش راحت
  const un = unescapeHtml(String(name || ""));
  configValueInput.value = un;
  configItemModal.classList.remove('hidden');
}
document.getElementById('cancelConfigBtn')?.addEventListener('click', ()=> configItemModal.classList.add('hidden'));
configItemForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const type = configTypeInput.value;
  const id = Number(configIndexInput.value);
  const name = configValueInput.value.trim();
  if(!name) { showError("نام را وارد کنید."); return; }
  try{
    const r = (id && id !== -1)
      ? await api.updateConfigItem(type, id, name)
      : await api.createConfigItem(type, name);
    if (r?.message && !r?.id && !r?.success) {
      showError(r.message);
    } else {
      showSuccess("ذخیره شد.");
      configItemModal.classList.add('hidden');
      await initBaseConfig();
    }
  }catch(err){ if(!handleAuthError(err)) showError("ذخیره با خطا مواجه شد."); }
});

/* ======================= Reporter Filter ======================= */
let reportersCache = [];
function ensureReporterSelect(){
  if (!reporterFilter) return null;
  if (reporterFilter.tagName === 'SELECT') return reporterFilter;
  const sel = document.createElement('select');
  sel.id = reporterFilter.id;
  sel.className = reporterFilter.className || 'input-field و-full p-2 rounded-lg'.replace('و','w');
  reporterFilter.parentNode.replaceChild(sel, reporterFilter);
  reporterFilter = sel;
  return reporterFilter;
}
async function setupReporterFilter(){
  // فقط سیستم‌ادمین اجازهٔ دیدن لیست کاربران را دارد
  if (!isSystemAdmin()) return;
  const sel = ensureReporterSelect();
  if (!sel) return;

  sel.innerHTML = `<option value="all">همه کاربران</option>`;
  try {
    const resp = await api.fetchUsersList();
    const rows =
      Array.isArray(resp)           ? resp :
      Array.isArray(resp?.users)    ? resp.users :
      Array.isArray(resp?.data)     ? resp.data :
      Array.isArray(resp?.items)    ? resp.items :
      Array.isArray(resp?.results)  ? resp.results : [];

    reportersCache = rows.map(u => ({
      id: Number(u.id),
      fullname: (u.fullname && String(u.fullname).trim()) || u.username || `#${u.id}`
    }));

    for (const u of reportersCache) {
      const opt = document.createElement('option');
      opt.value = String(u.id);
      opt.textContent = u.fullname;
      sel.appendChild(opt);
    }
  } catch (e) {
    try{ console.error("fetchUsersList error:", e);}catch{}
  }

  sel.onchange = ()=> isAdminish() && loadAllIncidents();
}

/* ======================= Incidents ======================= */
async function loadMyIncidents(){
  try{
    const rows = await api.fetchMyIncidents();
    cacheMyIncidents = rows || [];
    pagerState.mine.page = 1;
    renderIncidentsTable(userIncidentsTable, cacheMyIncidents, { mine:true, kind:'mine' });
    updatePagerUI('mine');
  }catch(e){
    if (!handleAuthError(e)) {
      try{ console.error('fetchMyIncidents error', e);}catch{}
      showError("خطا در دریافت گزارش‌های شما.");
    }
  }
}

async function loadAllIncidents(){
  try{
    const filters = {
      search: (searchInput?.value||"").trim(),
      status_id: getFilterVal(statusFilter),
      priority_id: getFilterVal(priorityFilter),
      location_id: getFilterVal(locationFilter),
      category_id: getFilterVal(categoryFilter)
    };
    const repVal = getFilterVal(reporterFilter);
    if (repVal) filters.reporter_id = repVal;

    if (isDefenseAdmin()) {
      // مشاهدهٔ لیست: پدافندی. (ثبت حادثه آزادی کامل دارد)
      filters.category_id = "2";
      if (categoryFilter) {
        categoryFilter.value = "2";
        categoryFilter.disabled = true;
      }
    }
    const rows = await api.fetchAllIncidents(filters);
    cacheAllIncidents = rows || [];
    pagerState.all.page = 1;
    renderIncidentsTable(allIncidentsTable, cacheAllIncidents, { mine:false, kind:'all' });
    updatePagerUI('all');

    if (dashboardPage && !dashboardPage.classList.contains('hidden') && isAdminish()) {
      try {
        ensureDashboardMounted();
        updateDashboard(_dashboardRef, cacheAllIncidents || []);
      } catch {}
    }
  }catch(e){
    if (!handleAuthError(e)) {
      try{ console.error('fetchAllIncidents error', e);}catch{}
      showError("خطا در دریافت همه حوادث.");
    }
  }
}
function getFilterVal(sel){
  if(!sel) return undefined;
  const v = sel.value;
  return (v && v !== "all") ? v : undefined;
}
resetFiltersBtn?.addEventListener('click', ()=>{
  if(statusFilter) statusFilter.value = "all";
  if(priorityFilter) priorityFilter.value = "all";
  if(locationFilter) locationFilter.value = "all";
  if (reporterFilter) reporterFilter.value = "all";
  if (categoryFilter) {
    if (isDefenseAdmin()) {
      categoryFilter.value = "2";
      categoryFilter.disabled = true;
    } else {
      categoryFilter.value = "all";
      categoryFilter.disabled = false;
    }
  }
  loadAllIncidents();
});
[statusFilter, priorityFilter, locationFilter, categoryFilter, searchInput].forEach(el=>{
  el?.addEventListener('change', ()=> isAdminish() && loadAllIncidents());
  el?.addEventListener('keyup', (e)=>{
    if(e.key === 'Enter' && isAdminish()) loadAllIncidents();
  });
});
function actionTooltip(row){
  const desc = row.last_action_description || row.last_action_note || row.latest_action || '';
  const dtRaw = row.last_action_date || row.last_action_at || row.last_action_date_time || '';
  let when = '';
  const dt = toTehranFromAny(dtRaw);
  if (dt) {
    const r = tehranYMDHMtoJalaliStr(dt);
    when = r.hm ? `${r.jYMD} ${r.hm}` : r.jYMD;
  }
  const status = row.last_action_status_name || '';
  const parts = [status && `وضعیت: ${status}`, desc, when].filter(Boolean);
  return parts.length ? escapeHtml(parts.join(' — ')) : '';
}
function latestAdminActionSummary(row){
  const hasAnyAction =
    (row.actions_count != null && Number(row.actions_count) > 0) ||
    !!(row.last_action_description || row.last_action_at || row.last_action_date);

  const tip = actionTooltip(row);
  const label = hasAnyAction ? 'ثبت شده' : 'ثبت نشده';
  const cls   = hasAnyAction ? 'badge--ok' : 'badge--none';

  return `<span class="badge badge--act ${cls}" ${tip ? `title="${escapeHtml(tip)}"` : ''}>${escapeHtml(label)}</span>`;
}

/** باکس صفحه‌بندی همیشه زیر جدول باشد */
function movePagerBelowTable(kind){
  const pager = kind === 'mine' ? myPager : allPager;
  const tbody = kind === 'mine' ? userIncidentsTable : allIncidentsTable;
  if (!pager || !tbody) return;
  const tbl = tbody.closest('table');
  if (tbl && pager.parentNode !== tbl.parentNode) {
    insertAfter(tbl, pager);
  } else if (tbl) {
    insertAfter(tbl, pager);
  }
  // کمی فاصله
  pager.style.marginTop = '8px';
}

/** رندر جدول‌ها */
function renderIncidentsTable(tbodyEl, rows = [], opts = {}) {
  if(!tbodyEl) return;
  tbodyEl.innerHTML = "";
  if (!rows || rows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="${opts.mine ? 9 : 9}" class="px-6 py-4 text-center">موردی یافت نشد</td>`;
    tbodyEl.appendChild(tr);
    if (opts.kind) { pagerState[opts.kind].total = 0; updatePagerUI(opts.kind); }
    // صفحه‌بندی زیر جدول
    movePagerBelowTable(opts.kind === 'mine' ? 'mine' : 'all');
    applyFabSafeAreaDebounced();
    return;
  }
  rows = [...rows].sort((a,b)=> (Number(a.id)||0) - (Number(b.id)||0));
  if (opts.kind) {
    const st = pagerState[opts.kind];
    st.total = rows.length;
    const pc = pagesCount(st.total, st.pageSize);
    st.page = clamp(st.page, 1, pc);
    const start = (st.page - 1) * st.pageSize;
    const end   = start + st.pageSize;
    rows = rows.slice(start, end);
  }
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = "border-b border-gray-700 hover:bg-gray-700";
    const tip = actionTooltip(row);
    if (tip) tr.setAttribute('title', tip);
    const dateStr = pickRegisteredJDate(row);
    const timeStr = pickRegisteredTime(row);
    const dateTimeStr = timeStr ? `${dateStr} ${timeStr}` : dateStr;

    let cells = `
      <td class="px-6 py-3" ${tip ? `title="${tip}"` : ''}>${escapeHtml(row.id ?? "")}</td>
    `;
    if (!opts.mine) {
      const reporter = row.reporter_fullname || row.fullname || row.username || row.reporter_username || "-";
      cells += `<td class="px-6 py-3">${escapeHtml(reporter)}</td>`;
    }
    cells += `
      <td class="px-6 py-3">${escapeHtml(row.title ?? "")}</td>
      <td class="px-6 py-3">${catBadge(row)}</td>
      <td class="px-6 py-3">${locBadge(row)}</td>
      <td class="px-6 py-3">${escapeHtml(dateTimeStr)}</td>
      <td class="px-6 py-3">${prioBadge(row)}</td>
      <td class="px-6 py-3">${statusChipHtml(row)}</td>
    `;
    if (opts.mine) {
      cells += `<td class="px-6 py-3">${latestAdminActionSummary(row)}</td>`;
    }
    let actions = `<button class="btn-secondary text-white font-bold px-3 py-1 rounded view-inc" data-id="${row.id}">جزئیات</button>`;
    if (!opts.mine && isAdminish()) {
      actions += ` <button class="btn-success text-white font-bold px-3 py-1 rounded add-act" data-id="${row.id}">ثبت اقدام</button>`;
    }
    tr.innerHTML = cells + `<td class="px-6 py-3">${actions}</td>`;
    tbodyEl.appendChild(tr);
  });

  tbodyEl.querySelectorAll('.view-inc').forEach(btn => {
    btn.addEventListener('click', () => openIncidentDetails(btn.dataset.id));
  });
  tbodyEl.querySelectorAll('.add-act').forEach(btn=>{
    btn.addEventListener('click', ()=> openAddActionModal(btn.dataset.id));
  });

  if (opts.kind) updatePagerUI(opts.kind);
  // صفحه‌بندی زیر جدول
  movePagerBelowTable(opts.kind === 'mine' ? 'mine' : 'all');
  applyFabSafeAreaDebounced();
}

/* ======================= Persian Datepicker ======================= */
let pdpInitialized = false;
function ensurePersianDatepicker() {
  if (pdpInitialized) return;
  try {
    if (window.$ && $.fn?.persianDatepicker && window.persianDate && incidentDateInput) {
      $(incidentDateInput).persianDatepicker({
        format: 'YYYY-MM-DD',
        autoClose: true,
        observer: true,
        initialValue: false,
        toolbox: { calendarSwitch: { enabled: false } },
        timePicker: { enabled: false },
        calendar: { persian: { leapYearMode: 'astronomical' } }
      });
      if (actionDateInput) {
        $(actionDateInput).persianDatepicker({
          format: 'YYYY-MM-DD',
          autoClose: true,
          observer: true,
          initialValue: false,
          toolbox: { calendarSwitch: { enabled: false } },
          timePicker: { enabled: false },
          calendar: { persian: { leapYearMode: 'astronomical' } }
        });
      }
      pdpInitialized = true;
    }
  } catch (e) {
    try { console.error('Persian datepicker init failed', e); } catch {}
  }
}

/* ======================= New Incident ======================= */
function initPersianDateInputs() {
  try {
    const todayJalali = getTodayJalaliSafe();
    if (incidentDateInput) incidentDateInput.value = todayJalali;
  } catch {}
  try {
    const now = new Date();
    const hh = pad2(now.getHours());
    const mm = pad2(now.getMinutes());
    if (incidentTimeInput) incidentTimeInput.value = `${hh}:${mm}`;
  } catch {}
}
function categoryValueToId(val){
  if (!val) return 0;
  if (val === 'cyber' || val === '1') return 1;
  if (val === 'physical' || val === '2') return 2;
  return Number(val) || 0;
}
function categoryValueToType(val){
  const id = categoryValueToId(val);
  return id === 1 ? 'cyber' : id === 2 ? 'physical' : '';
}
navIncidentBtn?.addEventListener('click', ()=>{
  ensurePersianDatepicker();
  initPersianDateInputs();
  if (incidentCategorySelect) incidentCategorySelect.value = "";
  if (incidentTitleSelect) incidentTitleSelect.innerHTML = `<option value="">ابتدا دسته‌بندی را انتخاب کنید</option>`;
  if (incidentLocationSelect) incidentLocationSelect.value = "";
  if (incidentPrioritySelect) incidentPrioritySelect.value = "";
  if (incidentTitleOtherInput) { incidentTitleOtherInput.classList.add('hidden'); incidentTitleOtherInput.value = ""; }
  if (incidentDescriptionInput) incidentDescriptionInput.value = "";
  newIncidentModal?.classList.remove('hidden');
});

// ⛔ لیسنر دکمه بالای صفحه حذف شد تا هیچوقت عمل نکند
// navIncidentBtnTop?.addEventListener('click', ()=> navIncidentBtn?.click());

document.getElementById('cancelNewIncidentBtn')?.addEventListener('click', ()=> newIncidentModal?.classList.add('hidden'));

incidentCategorySelect?.addEventListener('change', async ()=>{
  const raw = incidentCategorySelect.value;
  const catId = categoryValueToId(raw);
  incidentTitleSelect.innerHTML = `<option value="">در حال بارگذاری...</option>`;
  if (!catId) {
    incidentTitleSelect.innerHTML = `<option value="">ابتدا دسته‌بندی را انتخاب کنید</option>`;
    return;
  }
  try {
    const titles = await api.fetchTitlesByCategory(catId);
    const opts = [`<option value="">انتخاب کنید...</option>`,
                  ...titles.map(t=> `<option value="${t.title_id}" data-text="${escapeHtml(t.title)}">${escapeHtml(t.title)}</option>`),
                  `<option value="__other__">سایر...</option>`];
    incidentTitleSelect.innerHTML = opts.join('');
  } catch {
    incidentTitleSelect.innerHTML = `<option value="">خطا در دریافت عناوین</option>`;
  }
});
incidentTitleSelect?.addEventListener('change', ()=>{
  if (incidentTitleSelect.value === '__other__') {
    incidentTitleOtherInput.classList.remove('hidden');
    incidentTitleOtherInput.focus();
  } else {
    incidentTitleOtherInput.classList.add('hidden');
    incidentTitleOtherInput.value = "";
  }
});
newIncidentForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  try {
    const rawCategory = (incidentCategorySelect.value || '').trim();
    const category_type = categoryValueToType(rawCategory);
    const titleOption = incidentTitleSelect.selectedOptions?.[0];
    // عنوان از data-text ممکن است HTML-escaped باشد
    let title = titleOption?.dataset?.text || titleOption?.textContent || "";
    title = unescapeHtml(title);
    if (incidentTitleSelect.value === '__other__') {
      title = (incidentTitleOtherInput.value || '').trim();
    }
    const location_id = Number(incidentLocationSelect.value);
    const priority_id = Number(incidentPrioritySelect.value);
    const description = (incidentDescriptionInput.value || '').trim();
    const incident_date_jalali_raw = (incidentDateInput.value || '').trim();
    const incident_date_jalali = normalizeJalaliDate(incident_date_jalali_raw);
    const timeRaw = (incidentTimeInput.value || '').trim();
    let incident_time;
    if (/^\d{2}:\d{2}$/.test(timeRaw)) incident_time = timeRaw;
    else {
      const now = new Date();
      incident_time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    }
    if (!category_type || !title || !location_id || !priority_id || !description || !incident_date_jalali) {
      showError("فیلدهای اجباری را کامل کنید.");
      return;
    }
    const defaultStatusId =
      baseConfigCache?.statuses?.find(s => String(s.id) === "1")?.id
      ?? baseConfigCache?.statuses?.[0]?.id
      ?? 1;

    const payload = {
      title,
      description,
      location_id,
      priority_id,
      category_type,
      incident_date_jalali,
      incident_time,
      status_id: Number(defaultStatusId)
    };
    const r = await api.submitIncident(payload);
    if (r?.id) {
      showSuccess("حادثه با موفقیت ثبت شد.");
      newIncidentModal?.classList.add('hidden');
      await loadMyIncidents();
      if (isAdminish()) await loadAllIncidents();
    } else {
      showError(r?.message || "ثبت حادثه با خطا مواجه شد.");
    }
  } catch (e) {
    if (!handleAuthError(e)) {
      try{ console.error(e);}catch{}
      showError(e?.message || "ثبت حادثه با خطا مواجه شد.");
    }
  }
});

/* ======================= Incident Details & Actions ======================= */
let editingActionId = null; // اگر null باشد یعنی حالت "ایجاد" هستیم، وگرنه "ویرایش"

function fillActionsSelectFromConfig(){
  setOptions(actionStatusSelect, [{value:"", label:"بدون تغییر وضعیت"}, ...mapNameId(baseConfigCache?.statuses)]);
}

async function openIncidentDetails(id){
  try{
    const data = await api.fetchIncidentDetails(Number(id));
    const inc  = data?.incident || data?.data || data || {};

    let actions = [];
    try { actions = await api.listActions(Number(id)); } catch(e){ /* noop */ }

    detailId.textContent        = inc.id ?? id;
    detailReporter.textContent  = inc.reporter_fullname || inc.fullname || inc.username || inc.reporter_username || '-';
    detailTitle.textContent     = inc.title || '-';
    detailLocation.textContent  = inc.location_name || inc.location || '-';
    detailDescription.textContent = inc.description || '-';
    detailPriority.textContent  = inc.priority_name || inc.priority || '-';
    detailStatus.innerHTML      = statusChipHtml(inc);

    const d = pickRegisteredJDate(inc);
    const t = pickRegisteredTime(inc);
    detailDate.textContent = t ? `${d} ${t}` : d || '-';

    renderActionHistory(actions, { incidentId: Number(id) });
    incidentDetailsModal.classList.remove('hidden');
  }catch(e){
    if (!handleAuthError(e)) showError("خطا در دریافت جزئیات حادثه.");
  }
}

function renderActionHistory(actions = [], { incidentId } = {}){
  if (!actionHistory) return;
  actionHistory.innerHTML = "";
  if (!actions || actions.length===0){
    actionSection?.classList.add('hidden');
    return;
  }
  actionSection?.classList.remove('hidden');

  actions.forEach(a=>{
    const item = document.createElement('div');
    item.className = "bg-gray-700 p-3 rounded-lg flex flex-col gap-1";
    const txt = a.description || a.note || a.action || '-';
    const dt  = (a.action_date_jalali || a.action_date || a.created_at || '');
    const d   = a.action_date_jalali ? normalizeJalaliDate(a.action_date_jalali) : gregStrToJalaliYMD(dt);
    const tm  = timePart(dt);
    const status = a.status_name || a.status || '';

    let tools = '';
    if (isAdminish()) {
      tools = `
        <div class="mt-2 flex gap-2">
          <button class="btn-secondary px-2 py-1 rounded edit-act"
                  data-aid="${a.id}"
                  data-desc="${escapeHtml(txt)}"
                  data-date="${escapeHtml(d)}"
                  data-status="${a.status_id ? Number(a.status_id) : ''}"
                  data-incident="${incidentId || a.incident_id || ''}">
            ویرایش
          </button>
          <button class="btn-danger px-2 py-1 rounded del-act" data-aid="${a.id}" data-incident="${incidentId || a.incident_id || ''}">
            حذف
          </button>
        </div>`;
    }

    item.innerHTML = `
      <div class="text-gray-200">${escapeHtml(txt)}</div>
      <div class="text-xs text-gray-400">${escapeHtml([d, tm].filter(Boolean).join(' '))}</div>
      ${status ? `<div class="text-xs text-blue-300">وضعیت: ${escapeHtml(status)}</div>` : ``}
      ${tools}
    `;
    actionHistory.appendChild(item);
  });

  if (isAdminish()) {
    actionHistory.querySelectorAll('.edit-act').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const aid   = Number(btn.dataset.aid);
        // بازگردانی متن توضیح
        const desc  = unescapeHtml(btn.dataset.desc || '');
        const date  = btn.dataset.date || '';
        const st = btn.dataset.status ? Number(btn.dataset.status) : '';
        const incId = Number(btn.dataset.incident || detailId.textContent || 0);
        openEditActionModal({ id: aid, incident_id: incId, description: desc, action_date_jalali: date, status_id: st });
      });
    });
    actionHistory.querySelectorAll('.del-act').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const aid   = Number(btn.dataset.aid);
        const incId = Number(btn.dataset.incident || detailId.textContent || 0);
        if (!aid) return;
        if (!confirm('این اقدام حذف شود؟')) return;
        try{
          const r = await api.deleteIncidentAction(aid);
          if (r?.ok || r?.success || !r?.message) {
            showSuccess('اقدام حذف شد.');
            if (isAdminish()) await loadAllIncidents();
            await loadMyIncidents();
            if (!incidentDetailsModal.classList.contains('hidden')) openIncidentDetails(incId);
          } else {
            showError(r?.message || 'حذف اقدام با خطا مواجه شد.');
          }
        }catch(err){ if(!handleAuthError(err)) showError('حذف اقدام با خطا مواجه شد.'); }
      });
    });
  }
}

function openAddActionModal(incidentId){
  if (!isAdminish()) return;
  ensurePersianDatepicker();
  editingActionId = null;
  try { actionDateInput.value = getTodayJalaliSafe(); } catch {}
  actionDescriptionInput.value = "";
  actionStatusSelect.innerHTML = "";
  fillActionsSelectFromConfig();
  actionIncidentIdInput.value = incidentId;
  addActionModal.classList.remove('hidden');
}

function openEditActionModal(action){
  if (!isAdminish()) return;
  ensurePersianDatepicker();
  editingActionId = Number(action.id);
  actionIncidentIdInput.value   = Number(action.incident_id || detailId.textContent || 0);
  // بازگردانی توضیح
  actionDescriptionInput.value  = unescapeHtml(action.description || '');
  actionStatusSelect.innerHTML  = "";
  fillActionsSelectFromConfig();
  try {
    actionDateInput.value = normalizeJalaliDate(action.action_date_jalali || '');
  } catch { actionDateInput.value = ''; }
  if (action.status_id) {
    const opt = Array.from(actionStatusSelect.options).find(o => Number(o.value) === Number(action.status_id));
    if (opt) actionStatusSelect.value = String(action.status_id);
  }
  addActionModal.classList.remove('hidden');
}

document.getElementById('closeDetailsModalBtn')?.addEventListener('click', ()=>{
  incidentDetailsModal?.classList.add('hidden');
});
document.getElementById('cancelAddActionBtn')?.addEventListener('click', ()=>{
  addActionModal?.classList.add('hidden');
  editingActionId = null;
});

addActionForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!isAdminish()) { showError("دسترسی ندارید."); return; }

  const incident_id = Number(actionIncidentIdInput.value || 0);
  const description = (actionDescriptionInput.value || '').trim();
  const action_date_jalali = normalizeJalaliDate((actionDateInput.value || '').trim());
  const status_id = actionStatusSelect.value ? Number(actionStatusSelect.value) : undefined;

  if (!incident_id || !description || !action_date_jalali) {
    showError("توضیح اقدام و تاریخ الزامی است.");
    return;
  }

  try{
    if (editingActionId) {
      const payload = { description, action_date_jalali };
      if (status_id !== undefined) payload.status_id = status_id;
      const r = await api.updateIncidentAction(editingActionId, payload);
      if (r?.id || r?.success || !r?.message) {
        showSuccess("اقدام ویرایش شد.");
      } else {
        showError(r?.message || "ویرایش اقدام با خطا مواجه شد.");
        return;
      }
    } else {
      const r = await api.addIncidentAction(incident_id, { description, action_date_jalali, status_id });
      if (r?.success || r?.id) {
        showSuccess("اقدام ثبت شد.");
      } else {
        showError(r?.message || "ثبت اقدام با خطا مواجه شد.");
        return;
      }
    }

    addActionModal?.classList.add('hidden');
    editingActionId = null;

    if (isAdminish()) await loadAllIncidents();
    await loadMyIncidents();

    if (!incidentDetailsModal.classList.contains('hidden')) {
      openIncidentDetails(incident_id);
    }
  }catch(err){
    if (!handleAuthError(err)) {
      try{ console.error('action submit error', err);}catch{}
      showError("ثبت/ویرایش اقدام با خطا مواجه شد.");
    }
  }
});

/* ======================= Users (system-admin) ======================= */
async function loadUsers(){
  if(!isSystemAdmin()) return;
  try{
    const resp = await api.fetchUsersList();
    const rows =
      Array.isArray(resp)           ? resp :
      Array.isArray(resp?.users)    ? resp.users :
      Array.isArray(resp?.data)     ? resp.data :
      Array.isArray(resp?.items)    ? resp.items :
      Array.isArray(resp?.results)  ? resp.results :
      [];
    renderUsers(rows);
    if (rows.length === 0 && (resp?.meta?.total === 0 || resp?.total === 0)) {
      showInfoRowOnUsersTable("هیچ کاربری پیدا نشد.");
    }
  }catch(e){
    if (!handleAuthError(e)) {
      showError("خطا در دریافت کاربران.");
      try{ console.error("fetchUsersList error:", e);}catch{}
    }
  }
}
function renderUsers(rows = []){
  if(!usersTable) return;
  usersTable.innerHTML = "";
  if (!Array.isArray(rows) || rows.length === 0) {
    showInfoRowOnUsersTable("هیچ کاربری ثبت نشده است.");
    return;
  }
  rows.forEach(u=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(u.username ?? '')}</td>
      <td>${escapeHtml(u.fullname ?? '')}</td>
      <td>${escapeHtml(u.position || '')}</td>
      <td>${escapeHtml(normalizeRole(u.role) || '')}</td>
      <td>${escapeHtml(u.status || '')}</td>
      <td>
        <button
          class="btn-secondary px-2 py-1 rounded edit-user"
          data-id="${u.id}"
          data-username="${escapeHtml(u.username || '')}"
          data-fullname="${escapeHtml(u.fullname || '')}"
          data-position="${escapeHtml(u.position || '')}"
          data-role="${escapeHtml(normalizeRole(u.role) || 'user')}"
          data-status="${escapeHtml(u.status || 'active')}"
        >ویرایش</button>
        <button class="btn-danger px-2 py-1 rounded del-user" data-id="${u.id}">حذف</button>
      </td>
    `;
    usersTable.appendChild(tr);
  });
  usersTable.querySelectorAll('.edit-user').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      // برگشت از escape برای نمایش در ورودی‌ها
      openUserModal({
        id: Number(btn.dataset.id),
        username: unescapeHtml(btn.dataset.username || ''),
        fullname: unescapeHtml(btn.dataset.fullname || ''),
        position: unescapeHtml(btn.dataset.position || ''),
        role: btn.dataset.role,
        status: btn.dataset.status
      });
    });
  });
  usersTable.querySelectorAll('.del-user').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm('حذف کاربر؟')) return;
      try{
        const r = await api.deleteUser(Number(btn.dataset.id));
        if (r?.success) {
          showSuccess("کاربر حذف شد.");
          await loadUsers();
        } else {
          showError(r?.message || "حذف با خطا مواجه شد.");
        }
      }catch(err){ if(!handleAuthError(err)) showError("حذف با خطا مواجه شد."); }
    });
  });
}
function showInfoRowOnUsersTable(text){
  if(!usersTable) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `<td colspan="6" class="text-center py-3 text-gray-300">${escapeHtml(text || 'داده‌ای موجود نیست.')}</td>`;
  usersTable.appendChild(tr);
}

addUserBtn?.addEventListener('click', ()=> openUserModal());
cancelUserBtn?.addEventListener('click', ()=> userModal?.classList.add('hidden'));
function openUserModal(userOrId){
  const isEdit = !!(userOrId && typeof userOrId === 'object' && userOrId.id);
  userModalTitle.textContent = isEdit ? "ویرایش کاربر" : "افزودن کاربر جدید";
  userIdInput.value        = isEdit ? userOrId.id : "";
  userUsernameInput.value  = isEdit ? (userOrId.username || "") : "";
  userFullnameInput.value  = isEdit ? (userOrId.fullname || "") : "";
  userPositionInput.value  = isEdit ? (userOrId.position || "") : "";
  userRoleSelect.value     = isEdit ? (normalizeRole(userOrId.role) || "user") : "user";
  userStatusSelect.value   = isEdit ? (userOrId.status || "active") : "active";
  userPasswordInput.value = "";
  if (isEdit) userPasswordInput.removeAttribute('required');
  else userPasswordInput.setAttribute('required','');
  userModal?.classList.remove('hidden');
}
userForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!isSystemAdmin()) { showError("دسترسی ندارید."); return; }
  const id = Number(userIdInput.value || 0);
  const payload = {
    username: userUsernameInput.value.trim(),
    fullname: userFullnameInput.value.trim(),
    position: userPositionInput.value.trim(),
    role: userRoleSelect.value,
    status: userStatusSelect.value
  };
  if (!id) {
    payload.password = userPasswordInput.value.trim();
    if(!payload.password){ showError("رمز عبور الزامی است."); return;}
  }
  try{
    const r = id ? await api.updateUser(id, payload) : await api.createUser(payload);
    // اگر در حالت ویرایش، فیلد رمز پر باشد، رمز هم به‌صورت جداگانه بروزرسانی شود
    if (id && userPasswordInput.value && userPasswordInput.value.trim()) {
      try {
        await api.changeUserPassword(id, userPasswordInput.value.trim());
      } catch (e) {
        try { console.error("changeUserPassword error", e); } catch {}
        showError(e?.message || "تغییر رمز کاربر با خطا مواجه شد.");
        return;
      }
    }

    if (r?.message && !r?.id && !r?.username) {
      showError(r.message);
    } else {
      showSuccess(id ? "کاربر ویرایش شد." : "کاربر ایجاد شد.");
      userModal?.classList.add('hidden');
      await loadUsers();
    }
  }catch(err){ if(!handleAuthError(err)) showError("ثبت با خطا مواجه شد."); }
});

/* ======================= Resources ======================= */
// ⚠️ اصلاح: بایند دکمه افزودن را از renderResources جدا کردیم تا حتی با لیست خالی، کلیک کار کند.
function iconByTypeOrExt({ category, filename, mime } = {}) {
  const type = (category || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  const ext = ((filename || "").toLowerCase().split(".").pop() || "").trim();

  const byType = (t) => {
    switch (t) {
      case "pdf":        return { cls:"fa-file-pdf",        hint:"دانلود فایل PDF" };
      case "video":      return { cls:"fa-file-video",      hint:"مشاهده ویدیو" };
      case "powerpoint": return { cls:"fa-file-powerpoint", hint:"دانلود فایل PowerPoint" };
      case "word":       return { cls:"fa-file-word",       hint:"دانلود فایل Word" };
      case "excel":      return { cls:"fa-file-excel",      hint:"دانلود فایل Excel" };
      case "image":      return { cls:"fa-file-image",      hint:"دانلود تصویر" };
      default:           return { cls:"fa-file",            hint:"دانلود/مشاهده" };
    }
  };

  // اولویت: category -> mime -> ext
  if (type) return byType(type);

  if (m.startsWith("application/pdf")) return byType("pdf");
  if (m.startsWith("video/"))          return byType("video");
  if (m.includes("powerpoint"))        return byType("powerpoint");
  if (m.includes("msword") || m.includes("officedocument.word")) return byType("word");
  if (m.includes("excel") || m.includes("spreadsheetml"))        return byType("excel");
  if (m.startsWith("image/"))          return byType("image");

  if (ext === "pdf") return byType("pdf");
  if (["mp4","mkv","avi","mov","wmv","webm"].includes(ext)) return byType("video");
  if (["ppt","pptx","pps","ppsx"].includes(ext)) return byType("powerpoint");
  if (["doc","docx","rtf"].includes(ext)) return byType("word");
  if (["xls","xlsx","csv"].includes(ext)) return byType("excel");
  if (["jpg","jpeg","png","gif","svg","webp"].includes(ext)) return byType("image");

  return byType("other");
}

async function loadResources(){
  try {
    // فیلتر سروری: domain = cyber | physical | undefined (برای همه)
    const params = {};
    if (resourcesCurrentFilter === "cyber")    params.domain = "cyber";
    if (resourcesCurrentFilter === "physical") params.domain = "physical";
    const list = await api.listResources(params);
    renderResources(list || []);
  } catch(e) {
    if(!handleAuthError(e)) showError("خطا در بارگذاری فایل‌های آموزشی.");
  }
}

// Fallbackهای تشخیص حوزه فقط اگر دادهٔ domain نداشتیم
function _isCyberResource(it){
  const v = (it.domain || it.category_type || it.category_label || it.category || it.category_id || '').toString().toLowerCase();
  if (v === "cyber") return true;
  return /(^|[^a-z])cyber([^a-z]|$)|^1$|امنیت/.test(v);
}
function _isPhysicalResource(it){
  const v = (it.domain || it.category_type || it.category_label || it.category || it.category_id || '').toString().toLowerCase();
  if (v === "physical") return true;
  return /(^|[^a-z])physical([^a-z]|$)|^2$|پدافند/.test(v);
}

function renderResources(items = []){
  if (!resourcesContainer) return;
  resourcesContainer.innerHTML = "";

  const filtered = (items || []).filter(it=>{
    if (resourcesCurrentFilter === 'all') return true;
    if (resourcesCurrentFilter === 'cyber')    return (it.domain ? it.domain === 'cyber'    : _isCyberResource(it));
    if (resourcesCurrentFilter === 'physical') return (it.domain ? it.domain === 'physical' : _isPhysicalResource(it));
    return true;
  });

  if (filtered.length === 0){
    const p = document.createElement('p');
    p.className = 'text-center py-6 text-gray-400';
    p.textContent = 'موردی برای نمایش وجود ندارد.';
    resourcesContainer.appendChild(p);
    // ⚠️ از اینجا به بعد return می‌کنیم، اما دکمهٔ افزودن قبلاً بیرون از این تابع بایند شده است.
    return;
  }

  filtered.forEach(it => {
    const title = escapeHtml(it.title || "بدون عنوان");
    const { cls, hint } = iconByTypeOrExt({ category: it.category, filename: it.filename, mime: it.mime });
    const isPhysical = (it.domain ? it.domain === 'physical' : _isPhysicalResource(it));

    // مسیرهای سرور (محافظت‌شده با توکن)
    const viewUrl     = `${API_BASE}/resources/view/${encodeURIComponent(it.id)}`;
const downloadUrl = `${API_BASE}/resources/download/${encodeURIComponent(it.id)}`;

    // کارت
    const card = document.createElement("div");
    card.className =
      "block p-6 bg-gray-700 rounded-lg text-center hover:bg-gray-800 transition-colors duration-300 transform hover:-translate-y-1";

    card.innerHTML = `
      <i class="fas ${cls} text-5xl ${isPhysical ? 'text-green-300' : 'text-blue-300'} mb-3"></i>
      <h4 class="font-bold text-white">${title}</h4>

      <div class="mt-2">
        <span class="text-[11px] px-2 py-0.5 rounded ${isPhysical?'bg-green-700':'bg-blue-700'}">
          ${isPhysical ? 'پدافندی' : 'سایبری'}
        </span>
      </div>

      <p class="text-xs text-gray-400 mt-2">${escapeHtml(hint)}</p>

      <div class="mt-3 flex justify-center gap-2">
        <button class="btn-primary text-sm px-3 py-2 rounded view-file" data-id="${it.id}">
          <i class="fas fa-eye ml-1"></i> مشاهده
        </button>
        <button class="btn-secondary text-sm px-3 py-2 rounded download-file" data-id="${it.id}">
          <i class="fas fa-download ml-1"></i> دانلود
        </button>
      </div>
    `;

    const wrap = document.createElement("div");
    wrap.className = "flex flex-col";
    wrap.appendChild(card);

    // ابزارهای مدیریتی (بدون تغییر)
    const canEdit   = isSystemAdmin() || (isDefenseAdmin() && isPhysical);
    const canDelete = isSystemAdmin() || (isDefenseAdmin() && isPhysical);

    if (canEdit || canDelete) {
  const tools = document.createElement("div");
  tools.className = "mt-2 flex justify-center gap-2";
  tools.innerHTML = `
    ${ canEdit   ? `<button class="btn-secondary px-3 py-2 rounded edit-res" data-id="${it.id}">ویرایش</button>` : "" }
    ${ canDelete ? `<button class="btn-danger px-3 py-2 rounded del-res"  data-id="${it.id}">حذف</button>`   : "" }
  `;
  wrap.appendChild(tools);

  // ✅ این دو listener را همین‌جا اضافه کن:
  tools.querySelector(".edit-res")?.addEventListener("click", () => {
    openEditResourceModal(it.id); // باز شدن مودال ویرایش
  });

  tools.querySelector(".del-res")?.addEventListener("click", async () => {
    if (!confirm("این فایل آموزشی حذف شود؟")) return;
    try {
      const r = await api.deleteResource(it.id);
      if (r?.ok || r?.success) {
        showSuccess("فایل حذف شد.");
        await loadResources();
      } else {
        showError(r?.message || "حذف با خطا مواجه شد.");
      }
    } catch (e) {
      if (!handleAuthError(e)) showError(e?.message || "حذف با خطا مواجه شد.");
    }
  });
}

    resourcesContainer.appendChild(wrap);

    // ====== هندلر "مشاهده": با توکن fetch → Blob → باز شدن در تب جدید
    card.querySelector(".view-file")?.addEventListener("click", async () => {
      let token = "";
      try { token = localStorage.getItem('accessToken') || ""; } catch {}
      if (!token) { showError("ابتدا وارد شوید."); return; }

      try {
        const res = await fetch(viewUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) {
          let msg = "خطا در مشاهده فایل.";
          try { const j = await res.json(); msg = j?.message || msg; } catch {}
          showError(msg);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(()=> URL.revokeObjectURL(url), 120000);
      } catch {
        showError("خطا در دریافت فایل برای نمایش.");
      }
    });

    // ====== هندلر "دانلود": با توکن fetch → Blob → trigger دانلود (بدون ترک صفحه)
    card.querySelector(".download-file")?.addEventListener("click", async () => {
      let token = "";
      try { token = localStorage.getItem('accessToken') || ""; } catch {}
      if (!token) { showError("ابتدا وارد شوید."); return; }

      try {
        const res = await fetch(downloadUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) {
          let msg = "خطا در دانلود فایل.";
          try { const j = await res.json(); msg = j?.message || msg; } catch {}
          showError(msg);
          return;
        }
        // نام فایل از هدر
        const disp = res.headers.get('Content-Disposition') || '';
        let filename = it.filename || (it.title ? `${it.title}.bin` : 'file');
        const m = /filename\*\=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i.exec(disp);
        if (m) filename = decodeURIComponent(m[1] || m[2] || filename);

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(()=> {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 0);
      } catch {
        showError("خطا در دریافت فایل برای دانلود.");
      }
    });
  });

  // ⚠️ اینجا دیگه addResourceBtn را بایند نمی‌کنیم؛ بیرون از این تابع یک‌بار برای همیشه وصل شده است.
}

// ====== Resource Modal Helpers: Domain (سایبری/پدافندی) ======
function prepareResourceDomainField(domainValue = ""){
  if (!resourceDomainSelect) return;
  // گزینه‌ها را تنظیم کن
  resourceDomainSelect.innerHTML = `
    <option value="">انتخاب دامنه…</option>
    <option value="cyber">سایبری</option>
    <option value="physical">پدافندی</option>
  `;
  if (isSystemAdmin()) {
    // ادمین سیستم می‌تواند انتخاب کند
    resourceDomainSelect.disabled = false;
    resourceDomainSelect.closest('.form-row')?.classList.remove('hidden');
    if (domainValue) resourceDomainSelect.value = domainValue;
  } else if (isDefenseAdmin()) {
    // ادمین پدافند: دامنه به‌صورت خودکار پدافندی و غیرفعال
    resourceDomainSelect.disabled = true;
    resourceDomainSelect.value = "physical";
    resourceDomainSelect.closest('.form-row')?.classList.remove('hidden');
  } else {
    // کاربر معمولی اصلاً این فیلد را نمی‌بیند (و دکمه افزودن ندارد)
    resourceDomainSelect.closest('.form-row')?.classList.add('hidden');
  }
}

async function openAddResourceModal(){
  resourceModalTitle.textContent = "افزودن فایل آموزشی";
  resourceIdInput.value = "";
  resourceTitleInput.value = "";
  resourceFileInput.value = "";
  await fillResourceTypeSelect("");
  // دامنه
  prepareResourceDomainField("");
  resourceModal?.classList.remove("hidden");
}

async function openEditResourceModal(itemOrId){
  let item = itemOrId;
  if (typeof itemOrId === "number") {
    const list = await api.listResources(
      (resourcesCurrentFilter === 'all') ? {} : { domain: resourcesCurrentFilter }
    );
    item = (list || []).find(x => Number(x.id) === Number(itemOrId));
  }
  if (!item) { showError("مورد یافت نشد."); return; }
  resourceModalTitle.textContent = "ویرایش فایل آموزشی";
  resourceIdInput.value = String(item.id);
  resourceTitleInput.value = item.title || "";
  resourceFileInput.value = "";
  await fillResourceTypeSelect(item.category || "");
  // دامنه
  prepareResourceDomainField(item.domain || "");
  resourceModal?.classList.remove("hidden");
}

document.getElementById("cancelResourceBtn")?.addEventListener("click", ()=> resourceModal?.classList.add("hidden"));

async function fillResourceTypeSelect(selected = "") {
  if (!resourceCategorySelect) return;
  resourceCategorySelect.innerHTML = `<option value="">انتخاب کنید…</option>`;
  try {
    const types = await api.listResourceTypes();
    (types || []).forEach(t => {
      const o = document.createElement("option");
      o.value = t.value;
      o.textContent = t.label;
      if (selected && selected === t.value) o.selected = true;
      resourceCategorySelect.appendChild(o);
    });
  } catch {
    [
      { value: "pdf",        label: "PDF" },
      { value: "video",      label: "ویدیو" },
      { value: "powerpoint", label: "PowerPoint" },
      { value: "word",       label: "Word" },
      { value: "excel",      label: "Excel" },
      { value: "image",      label: "تصویر" },
      { value: "other",      label: "سایر" },
    ].forEach(t => {
      const o = document.createElement("option");
      o.value = t.value; o.textContent = t.label;
      if (selected && selected === t.value) o.selected = true;
      resourceCategorySelect.appendChild(o);
    });
  }
}

function guessCategoryByFile(file){
  if (!file) return "";
  const ext = (file.name || "").toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (["mp4","mkv","avi","mov","wmv","webm"].includes(ext)) return "video";
  if (["ppt","pptx","pps","ppsx"].includes(ext)) return "powerpoint";
  if (["doc","docx","rtf"].includes(ext)) return "word";
  if (["xls","xlsx","csv"].includes(ext)) return "excel";
  if (["jpg","jpeg","png","gif","svg","webp"].includes(ext)) return "image";
  return "other";
}

resourceFileInput?.addEventListener("change", ()=>{
  const file = resourceFileInput.files?.[0];
  const g = guessCategoryByFile(file);
  if (g && !resourceCategorySelect.value) resourceCategorySelect.value = g;
});

resourceForm?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  if (!isSystemAdmin() && !isDefenseAdmin()) { showError("دسترسی ندارید."); return; }

  const id    = Number(resourceIdInput.value || 0);
  const title = (resourceTitleInput.value || "").trim();
  const file  = resourceFileInput.files?.[0] || null;
  const category = (resourceCategorySelect.value || "").trim().toLowerCase();
  let domain =
    isDefenseAdmin() ? "physical" :
    (resourceDomainSelect?.value || "").trim().toLowerCase();

  if (!title) { showError("عنوان را وارد کنید."); return; }
  if (!category && !file) { showError("نوع فایل را انتخاب کنید یا فایلی انتخاب نمایید."); return; }

  // رعایت قواعد دامنه:
  // - system-admin: انتخاب آزاد (cyber/physical). اگر خالی بود، ارور می‌دهیم تا شفاف باشد.
  // - defense-admin: اجباری physical
  if (isSystemAdmin()) {
    if (!domain) {
      showError("دامنه فایل آموزشی را انتخاب کنید (سایبری/پدافندی).");
      return;
    }
  } else {
    domain = "physical";
  }

  const payload = { title, category, file, domain };

  try {
    const r = id
      ? await api.updateResource(id, payload)
      : await api.createResource(payload);

    showSuccess(id ? "ویرایش شد." : "ثبت شد.");
    resourceModal?.classList.add("hidden");
    await loadResources();
  } catch (e) {
    if(!handleAuthError(e)) showError(e?.message || "ثبت با خطا مواجه شد.");
  }
});

/* ======= NEW: Wiring addResourceBtn globally (independent of list emptiness) ======= */
function refreshAddResourceBtnVisibility() {
  if (!addResourceBtn) return;
  const can = isSystemAdmin() || isDefenseAdmin();
  addResourceBtn.classList.toggle('hidden', !can);
  // رنگ دکمه بر اساس نقش
  addResourceBtn.classList.remove('btn-green','btn-blue','btn-gray');
  if (can) addResourceBtn.classList.add(isDefenseAdmin() ? 'btn-green' : 'btn-blue');
}
function setupAddResourceBtnOnce() {
  if (!addResourceBtn) return;
  if (!addResourceBtn.__wired) {
    addResourceBtn.onclick = ()=>{
      if (!(isSystemAdmin() || isDefenseAdmin())) {
        showError('فقط مدیر می‌تواند فایل آموزشی اضافه کند.');
        return;
      }
      openAddResourceModal();
    };
    addResourceBtn.__wired = true;
  }
  refreshAddResourceBtnVisibility();
}
// یک‌بار برای همیشه پس از تعریف المنت‌ها
setupAddResourceBtnOnce();

/* ======================= Dashboard (mount-by-demand) ======================= */
function ensureDashboardMounted(){
  if (!_dashboardRef) {
    try { _dashboardRef = mountDashboard(); } catch {}
  }
}
async function loadDashboard() {
  if (!isAdminish() || !dashboardPage) return;
  ensureDashboardMounted();
  try {
    // بک‌اند برای defense-admin خودش category_id=2 را اجباری می‌کند
    const allRows = await api.fetchAllIncidents({});
    cacheAllIncidents = allRows || [];
    updateDashboard(_dashboardRef, cacheAllIncidents);
  } catch (e) {
    if (!handleAuthError(e)) {
      console.error("DASHBOARD_FETCH_ERR:", e);
      showError("خطا در دریافت اطلاعات داشبورد.");
    }
  }
}

/* ======================= Theme (single, fixed) ======================= */
if (localStorage.getItem('theme') === 'light') {
  document.documentElement.classList.add('light-theme');
}
themeToggle?.addEventListener('click', () => {
  document.documentElement.classList.toggle('light-theme');
  const isLight = document.documentElement.classList.contains('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  try {
    if (_dashboardRef && typeof updateDashboardTheme === 'function') {
      updateDashboardTheme(_dashboardRef);
    }
  } catch {}
});

/* ======================= CSV Export (client-side) ======================= */
function _csvEscape(v){
  const s = String(v ?? '').replace(/\r?\n/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
function _downloadCsv(filename, rows){
  const blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=> {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
function exportIncidentsCSV(kind='mine'){
  const src = kind==='mine' ? cacheMyIncidents : cacheAllIncidents;
  const isAll = (kind==='all');
  const header = isAll
    ? ['شناسه','کاربر','عنوان حادثه','دسته‌بندی','محل وقوع','تاریخ ثبت','ساعت ثبت','درجه ریسک','وضعیت']
    : ['شناسه','عنوان حادثه','دسته‌بندی','محل وقوع','تاریخ ثبت','ساعت ثبت','درجه ریسک','وضعیت','اقدام ادمین'];
  const lines = [header.map(_csvEscape).join(',')];

  (src || []).forEach(row=>{
    const dateStr = pickRegisteredJDate(row);
    const timeStr = pickRegisteredTime(row);
    const baseCols = [
      row.id ?? '',
      ...(isAll ? [ (row.reporter_fullname || row.fullname || row.username || row.reporter_username || '-') ] : []),
      row.title ?? '',
      categoryFa(row),
      (row.location_name || row.location || '-'),
      dateStr,
      timeStr || '',
      (row.priority_name || row.priority || ''),
      (row.status_name || row.status || '')
    ];
    const cols = isAll ? baseCols : [...baseCols, (row.actions_count>0 || row.last_action_description) ? 'ثبت شده' : 'ثبت نشده'];
    lines.push(cols.map(_csvEscape).join(','));
  });

  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0'), d = String(now.getDate()).padStart(2,'0');
  const filename = (kind==='mine')
    ? `my_incidents_${y}${m}${d}.csv`
    : `all_incidents_${y}${m}${d}.csv`;
  _downloadCsv(filename, lines);
}
exportMyBtn?.addEventListener('click', ()=> exportIncidentsCSV('mine'));
exportAllBtn?.addEventListener('click', ()=> exportIncidentsCSV('all'));

/* ======================= Excel Export (client-side, SheetJS) ======================= */
function _toWorksheetFromRows(headerRow, dataRows) {
  if (typeof XLSX === 'undefined' || !XLSX?.utils) {
    showError("کتابخانه Excel (SheetJS) بارگذاری نشده است.");
    return null;
  }
  return XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
}
function exportIncidentsXLSX(kind = 'mine') {
  const src = kind === 'mine' ? cacheMyIncidents : cacheAllIncidents;
  const isAll = kind === 'all';
  if (!Array.isArray(src) || src.length === 0) {
    showError("داده‌ای برای خروجی گرفتن وجود ندارد.");
    return;
  }
  const header = isAll
    ? ['شناسه','گزارش‌دهنده','عنوان','دسته‌بندی','محل','تاریخ گزارش','زمان','درجه','وضعیت']
    : ['شناسه','عنوان','دسته‌بندی','محل','تاریخ گزارش','زمان','درجه','وضعیت','اقدام ادمین'];

  const rows = src.map(row => {
    const dateStr = pickRegisteredJDate(row);
    const timeStr = pickRegisteredTime(row);
    const base = [
      row.id ?? '',
      ...(isAll ? [ (row.reporter_fullname || row.fullname || row.username || row.reporter_username || '-') ] : []),
      row.title ?? '',
      categoryFa(row),
      (row.location_name || row.location || '-'),
      dateStr,
      timeStr || '',
      (row.priority_name || row.priority || ''),
      (row.status_name || row.status || '')
    ];
    return isAll ? base : [...base, (row.actions_count>0 || row.last_action_description) ? 'ثبت شده' : 'ثبت نشده'];
  });

  const ws = _toWorksheetFromRows(header, rows);
  if (!ws) return;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, kind==='mine' ? 'حوادث_من' : 'همه_حوادث');

  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0'), d = String(now.getDate()).padStart(2,'0');
  const filename = kind === 'mine' ? `my_incidents_${y}${m}${d}.xlsx` : `all_incidents_${y}${m}${d}.xlsx`;
  XLSX.writeFile(wb, filename);
}
exportMyXlsxBtn?.addEventListener('click', ()=> exportIncidentsXLSX('mine'));
exportAllXlsxBtn?.addEventListener('click', ()=> exportIncidentsXLSX('all'));

/* ======================= Modals Close ======================= */
closeSuccessModalBtn?.addEventListener('click', () => successModal?.classList.add('hidden'));
closeErrorModalBtn?.addEventListener('click', () => errorModal?.classList.add('hidden'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModals();
});

/* ======================= Profile: Change My Password (داخل اپ) ======================= */
const openProfileBtn  = document.getElementById('openProfileBtn');
const profileModal    = document.getElementById('profileModal');
const closeProfileBtn = document.getElementById('closeProfileBtn');
const closeProfileBtn2= document.getElementById('closeProfileBtn2');
const myPassForm      = document.getElementById('myPassForm');
const myCurrentPass   = document.getElementById('my-current-password');
const myNewPass       = document.getElementById('my-new-password');
const myNewPass2      = document.getElementById('my-new-password-2');

openProfileBtn?.addEventListener('click', ()=>{
  if (!currentUser) { showError("ابتدا وارد شوید."); return; }
  myCurrentPass.value = "";
  myNewPass.value     = "";
  myNewPass2.value    = "";
  profileModal?.classList.remove('hidden');
});

closeProfileBtn?.addEventListener('click', ()=> profileModal?.classList.add('hidden'));
closeProfileBtn2?.addEventListener('click', ()=> profileModal?.classList.add('hidden'));

myPassForm?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const cur = (myCurrentPass.value || '').trim();
  const np  = (myNewPass.value || '').trim();
  const np2 = (myNewPass2.value || '').trim();

  if (!cur || !np) { showError("رمز فعلی و رمز جدید الزامی است."); return; }
  if (np !== np2) { showError("تکرار رمز جدید مطابقت ندارد."); return; }

  try {
    const r = await api.changeMyPassword(cur, np);
    if (r?.success) {
      showSuccess("رمز عبور با موفقیت تغییر کرد.");
      profileModal?.classList.add('hidden');
    } else {
      showError(r?.message || "تغییر رمز با خطا مواجه شد.");
    }
  } catch (e) {
    if (!handleAuthError?.(e)) showError(e?.message || "تغییر رمز با خطا مواجه شد.");
  }
});

/* ======================= Navigation ======================= */
navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-target');
    switch (target) {
      case 'homePage':
        showPage(homePage);
        break;
      case 'incidentsPage':
        showPage(incidentsPage);
        loadMyIncidents();
        break;
      case 'adminPage':
        showPage(adminPage);
        if (isAdminish()) {
          Promise
            .resolve(setupReporterFilter())
            .then(() => loadAllIncidents());
        }
        break;
      case 'baseDataPage':
        showPage(baseDataPage);
        if (isAdminish()) initBaseConfig();
        break;
      case 'userManagementPage':
        showPage(userManagementPage);
        if (isSystemAdmin()) loadUsers();
        break;
      case 'resourcesPage':
        showPage(resourcesPage);
        setResourceTabs();
        loadResources();
        break;
      case 'dashboardPage':
        showPage(dashboardPage);
        if (isAdminish()) loadDashboard(); // ← اجازه به defense-admin
        break;
    }
  });
});

/* ======================= Bootstrap ======================= */
function bootstrap() {
  setupPager('mine');
  setupPager('all');
  // از همان ابتدا هم جای Pager را زیر جدول ببریم
  movePagerBelowTable('mine');
  movePagerBelowTable('all');

  // اطمینان از مخفی بودن دکمه بالایی از ابتدا
  if (navIncidentBtnTop) {
    navIncidentBtnTop.style.display = 'none';
    navIncidentBtnTop.classList.add('hidden');
  }

  const hasSession = loadSession();
  if (hasSession && currentUser) {
    loginView?.classList.add('hidden');
    mainContent?.classList.remove('hidden');
    displayNameSpan.textContent = escapeHtml(currentUser.fullname || currentUser.username);

    updateRoleBasedUI();
    // 🔁 دکمه افزودن منابع: یک‌بار دیگر مطمئن شو وصل/نمایش درست است
    try { setupAddResourceBtnOnce(); refreshAddResourceBtnVisibility(); } catch {}

    Promise.all([
      initBaseConfig(),
      setupReporterFilter(),
      loadMyIncidents(),
      (isAdminish() ? loadAllIncidents() : Promise.resolve()),
      loadResources(),
    ])
    .catch(() => {})
    .finally(() => {
      showPage(homePage);
      applyFabSafeAreaDebounced();
    });
  } else {
    mainContent?.classList.add('hidden');
    loginView?.classList.remove('hidden');
    showPage(null);
  }
}
bootstrap();


// === expose selected functions (safe) ===
try { if (typeof updateRoleBasedUI === 'function' && !window.updateRoleBasedUI) window.updateRoleBasedUI = updateRoleBasedUI; } catch(e){}
try { if (typeof renderResources   === 'function' && !window.renderResources)   window.renderResources   = renderResources;   } catch(e){}
try { if (typeof normalizeRole     === 'function' && !window.normalizeRole)     window.normalizeRole     = normalizeRole;     } catch(e){}

// === bootstrap role after DOM ready (silent & single-endpoint for :3000/api) ===
(function () {
  // خواندن کاربر از localStorage
  function readLocalUser() {
    try {
      const u = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (!u) return null;
      return { ...u, role: normalizeRole(u.role) };
    } catch {
      return null;
    }
  }

  // خواندن نقش از JWT (base64url safe)
  function readRoleFromJWT() {
    try {
      const t = localStorage.getItem('accessToken');
      if (!t) return null;
      const part = t.split('.')[1];
      if (!part) return null;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(b64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(json);
      const role =
        normalizeRole(payload?.role || payload?.claims?.role || payload?.permissions?.role || '');
      return role ? { role } : null;
    } catch {
      return null;
    }
  }

  function hasAuthSignal() {
    try {
      return !!localStorage.getItem('accessToken');
    } catch {
      return false;
    }
  }

  // اگر در دسترس بود: گرفتن me از API
  async function getMeIfAuthenticated() {
    if (!hasAuthSignal()) return null;
    try {
      if (api?.getMe) {
        const me = await api.getMe();
        if (!me) return null;
        return { ...me, role: normalizeRole(me.role) };
      }
      return null;
    } catch {
      return null;
    }
  }

  async function bootstrapRole() {
    // 1) ترجیحاً از سرور
    let me = await getMeIfAuthenticated();
    // 2) اگر نشد، از localStorage/JWT
    if (!me) me = readLocalUser() || readRoleFromJWT();

    // 3) اگر هیچ سیگنالی نداریم، اصلاً UI را دست‌کاری نکنیم
    const prev = (window.currentUser || window.currentUser === 0) ? window.currentUser : (typeof currentUser !== 'undefined' ? currentUser : null);
    const candidate = me || prev;
    if (!candidate) return;

    // 4) ادغام بدون داون‌گرید نقش
    const merged = { ...(prev || {}), ...(me || {}) };
    const incomingRole = normalizeRole(merged.role || '');
    const prevRole = normalizeRole((prev && prev.role) || '');
    merged.role = incomingRole || prevRole; // اگر ورودی خالی بود، نقش قبلی حفظ شود

    // 5) ست در هر دو محل
    window.currentUser = merged;
    if (typeof currentUser !== 'undefined') currentUser = merged;

    // 6) تنها نقطه‌ی اعمال روی UI
    if (typeof updateRoleBasedUI === 'function') updateRoleBasedUI();

    // آپدیت نمایش دکمه افزودن منابع (بدون دست‌کاری مستقیم DOM‌های نقش)
    try { refreshAddResourceBtnVisibility(); } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapRole);
  } else {
    bootstrapRole();
  }
})();


