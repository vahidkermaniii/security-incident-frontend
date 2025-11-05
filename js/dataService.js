// public/js/dataService.js
// 🔗 وقتی فرانت روی GitHub Pages است، باید مستقیماً به بک‌اند Render وصل شویم.
const BACKEND_RENDER_URL = "https://security-incident-backend.onrender.com";

const RUNTIME_API_BASE =
  (typeof window !== "undefined" && window.API_BASE) ||
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE) ||
  // اگر روی GitHub Pages هستیم → مستقیم به بک‌اند Render
  ((typeof window !== "undefined" && /\.github\.io$/.test(window.location.hostname))
    ? BACKEND_RENDER_URL
    : "/api"
  );

class DataService {
  constructor() {
    this.API_BASE = RUNTIME_API_BASE.replace(/\/+$/, "");
    this.token = localStorage.getItem("accessToken") || "";
  }

  setToken(t) {
    this.token = t || "";
    try {
      if (this.token) localStorage.setItem("accessToken", this.token);
      else localStorage.removeItem("accessToken");
    } catch {}
  }

  /* ----------------------------- Internals ----------------------------- */
  _headers(json = true) {
    const h = { Accept: "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async _handle(res) {
    let data = null, text = null;
    try { data = await res.json(); } catch { try { text = await res.text(); } catch {} }

    if (res.status === 401) {
      try {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("currentUser");
      } catch {}
    }

    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || (text && text.trim()) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = data || text;
      throw err;
    }
    return data ?? (text ? { message: text } : null);
  }

  _endpointFor(type) {
    const t = String(type || "").toLowerCase().trim();
    if (!t) return t;
    if (t === "cyber" || t === "physical" || t === "title" || t === "titles") return "title";
    if (t === "locations")  return "location";
    if (t === "priorities") return "priority";
    if (t === "statuses")   return "status";
    if (t === "location" || t === "priority" || t === "status") return t;
    return t;
  }

  /* ------------------------------- Auth -------------------------------- */
  async login(username, password) {
    const res = await fetch(`${this.API_BASE}/auth/login`, {
      method: "POST",
      headers: this._headers(true),
      body: JSON.stringify({ username, password })
    });
    const data = await this._handle(res);
    const token = data?.accessToken || data?.token;
    if (token) this.setToken(token);
    return { ok: !!token, user: data?.user, accessToken: data?.accessToken, refreshToken: data?.refreshToken, token };
  }

  // تغییر رمز مخصوص حالت منقضی‌شده (بدون توکن)
  async changePasswordExpired(username, current_password, new_password) {
    const res = await fetch(`${this.API_BASE}/auth/password/expired-change`, {
      method: "POST",
      headers: this._headers(true),
      body: JSON.stringify({ username, current_password, new_password })
    });
    return this._handle(res);
  }

  async me() {
    const res = await fetch(`${this.API_BASE}/auth/me`, {
      method: "GET",
      headers: this._headers(false)
    });
    return this._handle(res);
  }

  /* ------------------------------- Config ------------------------------ */
  async fetchConfigData() {
    const res = await fetch(`${this.API_BASE}/config`, {
      method: "GET",
      headers: this._headers(false),
    });
    return this._handle(res);
  }

  async fetchTitlesByCategory(categoryId) {
    const res = await fetch(
      `${this.API_BASE}/config/titles?category_id=${encodeURIComponent(categoryId)}`,
      { method: "GET", headers: this._headers(false) }
    );
    return this._handle(res);
  }

  // type: 'location' | 'priority' | 'status' | 'title' | 'cyber' | 'physical'
  async createConfigItem(type, name) {
    const body = { name };
    let endpoint = this._endpointFor(type);
    if (type === "cyber" || type === "physical") {
      endpoint = "title";
      body.category_id = (type === "cyber") ? 1 : 2;
    }
    const res = await fetch(`${this.API_BASE}/config/${endpoint}`, {
      method: "POST",
      headers: this._headers(true),
      body: JSON.stringify(body)
    });
    return this._handle(res);
  }

  async updateConfigItem(type, id, name) {
    const endpoint = this._endpointFor(type);
    const res = await fetch(`${this.API_BASE}/config/${endpoint}/${id}`, {
      method: "PUT",
      headers: this._headers(true),
      body: JSON.stringify({ name })
    });
    return this._handle(res);
  }

  async deleteConfigItem(type, id) {
    const endpoint = this._endpointFor(type);
    const res = await fetch(`${this.API_BASE}/config/${endpoint}/${id}`, {
      method: "DELETE",
      headers: this._headers(false),
    });
    return this._handle(res);
  }

  /* ------------------------------ Incidents ---------------------------- */
  async fetchMyIncidents() {
    const res = await fetch(`${this.API_BASE}/incidents/mine`, {
      method: "GET",
      headers: this._headers(false),
    });
    return this._handle(res);
  }

  async fetchAllIncidents(filters = {}) {
    const params = new URLSearchParams();
    if (filters.search)       params.set("search", filters.search);
    if (filters.status_id)    params.set("status_id",   filters.status_id);
    if (filters.priority_id)  params.set("priority_id", filters.priority_id);
    if (filters.location_id)  params.set("location_id", filters.location_id);
    if (filters.reporter_id)  params.set("reporter_id", filters.reporter_id);

    if (filters.category_id) {
      params.set("category_id", String(filters.category_id));
      if (String(filters.category_id) === "1") params.set("category_type", "cyber");
      if (String(filters.category_id) === "2") params.set("category_type", "physical");
    }
    if (filters.category_type) {
      params.set("category_type", filters.category_type);
      if (!params.get("category_id")) {
        if (filters.category_type === "cyber")    params.set("category_id", "1");
        if (filters.category_type === "physical") params.set("category_id", "2");
      }
    }
    const res = await fetch(`${this.API_BASE}/incidents?${params.toString()}`, {
      method: "GET",
      headers: this._headers(false)
    });
    return this._handle(res);
  }

  async fetchIncidentDetails(id) {
    const res = await fetch(`${this.API_BASE}/incidents/${id}`, {
      method: "GET",
      headers: this._headers(false),
    });
    return this._handle(res);
  }

  /* ------------------------------ Actions ------------------------------ */
  async listActions(incidentId) {
    const res = await fetch(`${this.API_BASE}/actions/${incidentId}`, {
      method: "GET",
      headers: this._headers(false)
    });
    return this._handle(res);
  }

  async addIncidentAction(a1, a2) {
    let incident_id, description, action_date_jalali, status_id;
    if (typeof a1 === "object" && a1 !== null) {
      ({ incident_id, description, action_date_jalali, status_id } = a1);
    } else {
      incident_id = a1;
      ({ description, action_date_jalali, status_id } = (a2 || {}));
    }

    if (!incident_id) throw new Error("شناسهٔ حادثه نامعتبر است.");
    if (!description || !String(description).trim()) throw new Error("شرح اقدام الزامی است.");

    const body = { incident_id: Number(incident_id), description: String(description).trim() };
    if (action_date_jalali) {
      const fa = "۰۱۲۳۴۵۶۷۸۹", ar = "٠١٢٣٤٥٦٧٨٩";
      let s = String(action_date_jalali).trim();
      s = s.replace(/[۰-۹]/g, d => String(fa.indexOf(d)))
           .replace(/[٠-٩]/g, d => String(ar.indexOf(d)))
           .replace(/[\/\.]/g, "-");
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m) s = `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
      body.action_date_jalali = s;
    }
    if (status_id) body.status_id = Number(status_id);

    const res = await fetch(`${this.API_BASE}/actions`, {
      method: "POST",
      headers: this._headers(true),
      body: JSON.stringify(body)
    });
    return this._handle(res);
  }

  async updateIncidentAction(id, payload = {}) {
    const body = {};
    if (payload.description !== undefined) body.description = String(payload.description).trim();
    if (payload.status_id !== undefined && payload.status_id !== null) body.status_id = Number(payload.status_id);

    if (payload.action_date_jalali !== undefined) {
      if (payload.action_date_jalali === null) {
        body.action_date_jalali = null;
      } else {
        const fa = "۰۱۲۳۴۵۶۷۸۹", ar = "٠١٢٣٤٥٦٧٨٩";
        let s = String(payload.action_date_jalali).trim();
        s = s.replace(/[۰-۹]/g, d => String(fa.indexOf(d)))
             .replace(/[٠-٩]/g, d => String(ar.indexOf(d)))
             .replace(/[\/\.]/g, "-");
        const m = s.match(/^(\d{4})-(\د{1,2})-(\d{1,2})$/); // ← همان الگوی اصلی شما
        if (m) s = `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
        body.action_date_jalali = s;
      }
    }

    const res = await fetch(`${this.API_BASE}/actions/${id}`, {
      method: "PUT",
      headers: this._headers(true),
      body: JSON.stringify(body)
    });
    return this._handle(res);
  }

  async deleteIncidentAction(id) {
    const res = await fetch(`${this.API_BASE}/actions/${id}`, {
      method: "DELETE",
      headers: this._headers(false)
    });
    return this._handle(res);
  }

  /* ------------------------------ Submit Incident ---------------------- */
  async submitIncident(payload) {
    const body = { ...payload };

    if (body.category_type) {
      body.category_id = (body.category_type === "cyber") ? 1 : 2;
      delete body.category_type;
    }

    if (body.title && !body.title_id && !body.title_text) {
      body.title_text = String(body.title).trim();
      delete body.title;
    }

    if (body.incident_date_jalali) {
      const fa = "۰۱۲۳۴۵۶۷۸۹", ar = "٠١٢٣٤٥٦٧٨٩";
      let s = String(body.incident_date_jalali).trim();
      s = s.replace(/[۰-۹]/g, d => String(fa.indexOf(d)))
           .replace(/[٠-٩]/g, d => String(ar.indexOf(d)))
           .replace(/[\/\.]/g, "-");
      const m = s.match(/^(\d{4})-(\د{1,2})-(\d{1,2})$/); // ← همان الگوی شما
      if (m) s = `${م[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
      body.incident_date_jalali = s;
    }

    const timeRaw = body.incident_time;
    if (timeRaw && /^\d{2}:\d{2}$/.test(timeRaw)) {
      body.incident_time = timeRaw;
    } else {
      const now = new Date();
      body.incident_time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }

    body.status_id = Number(body.status_id || 1);

    const res = await fetch(`${this.API_BASE}/incidents`, {
      method: "POST",
      headers: this._headers(true),
      body: JSON.stringify(body),
    });
    return this._handle(res);
  }

  /* ------------------------------ Resources ---------------------------- */
  static VALID_RESOURCE_TYPES = ["pdf","video","powerpoint","word","excel","image","other"];
  static VALID_DOMAINS = ["cyber","physical"];

  async listResourceTypes() {
    const res = await fetch(`${this.API_BASE}/resources/types`, {
      method: "GET",
      headers: this._headers(false),
    });
    return this._handle(res);
  }

  async listResources(params = {}) {
    const q = new URLSearchParams();
    if (params.domain && DataService.VALID_DOMAINS.includes(String(params.domain).toLowerCase())) {
      q.set("domain", String(params.domain).toLowerCase());
    }
    const res = await fetch(`${this.API_BASE}/resources${q.toString() ? `?${q.toString()}` : ""}`, {
      method: "GET",
      headers: this._headers(false),
    });
    return this._handle(res);
  }

  _normalizeResourceCategory(category, category_id) {
    let cat = (category ?? "").toString().trim().toLowerCase();
    if (!cat && (category_id !== undefined && category_id !== null)) {
      const cid = String(category_id).toLowerCase().trim();
      if (DataService.VALID_RESOURCE_TYPES.includes(cid)) cat = cid;
    }
    return cat;
  }

  async createResource({ title, category, category_id, file, domain }) {
    const fd = new FormData();
    fd.append("title", String(title || "").trim());

    const cat = this._normalizeResourceCategory(category, category_id);
    if (cat) fd.append("category", cat);

    if (domain && DataService.VALID_DOMAINS.includes(String(domain).toLowerCase())) {
      fd.append("domain", String(domain).toLowerCase());
    }

    if (file) fd.append("file", file);

    const res = await fetch(`${this.API_BASE}/resources`, {
      method: "POST",
      headers: this._headers(false), // بدون Content-Type → تا مرورگر boundary بسازد
      body: fd
    });
    return this._handle(res);
  }

  async updateResource(id, { title, category, category_id, file, domain }) {
    const fd = new FormData();
    if (title !== undefined) fd.append("title", String(title || "").trim());

    const cat = this._normalizeResourceCategory(category, category_id);
    if (cat) fd.append("category", cat);

    if (domain !== undefined && domain !== null &&
        DataService.VALID_DOMAINS.includes(String(domain).toLowerCase())) {
      fd.append("domain", String(domain).toLowerCase());
    }

    if (file) fd.append("file", file);

    const res = await fetch(`${this.API_BASE}/resources/${id}`, {
      method: "PUT",
      headers: this._headers(false),
      body: fd
    });
    return this._handle(res);
  }

  async deleteResource(id) {
    const res = await fetch(`${this.API_BASE}/resources/${id}`, {
      method: "DELETE",
      headers: this._headers(false),
    });
    return this._handle(res);
  }

  /* ------------------------------ Users (sys-admin) -------------------- */
  async fetchUsersList() {
    const res = await fetch(`${this.API_BASE}/users`, {
      method: "GET",
      headers: this._headers(false),
    });
    return this._handle(res);
  }

  async createUser(payload) {
    const res = await fetch(`${this.API_BASE}/users`, {
      method: "POST",
      headers: this._headers(true),
      body: JSON.stringify(payload)
    });
    return this._handle(res);
  }

  async updateUser(id, payload) {
    const res = await fetch(`${this.API_BASE}/users/${id}`, {
      method: "PUT",
      headers: this._headers(true),
      body: JSON.stringify(payload)
    });
    return this._handle(res);
  }

  async deleteUser(id) {
    const res = await fetch(`${this.API_BASE}/users/${id}`, {
      method: "DELETE",
      headers: this._headers(false),
    });
    return this._handle(res);
  }

  // ← جدید: تغییر رمز توسط مدیر برای یک کاربر
  async changeUserPassword(id, password) {
    const res = await fetch(`${this.API_BASE}/users/${id}/password`, {
      method: "PATCH",
      headers: this._headers(true),
      body: JSON.stringify({ password })
    });
    return this._handle(res);
  }

  // ← تغییر رمز توسط خود کاربر (وقتی لاگین است)
  async changeMyPassword(current_password, new_password) {
    const res = await fetch(`${this.API_BASE}/users/me/password`, {
      method: "PATCH",
      headers: this._headers(true),
      body: JSON.stringify({ current_password, new_password })
    });
    return this._handle(res);
  }
}

const api = new DataService();
export default api;
