/* static/scripts.js
   Single-file frontend logic for FlatMate.
   - app.auth: login/register/logout/refresh/ensureValidAccessToken
   - app.api: wrappers for backend endpoints
   - app.ui: renderers + event wiring
   Configurable BASE_API_URL via window.BASE_API_URL or config.js.
*/

// --- static helper (clean version) ---
const BASE_API = (window.BASE_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

// convert stored filename / path -> absolute URL served by FastAPI
function staticUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;            // already absolute
  if (path.startsWith("/static/")) return `${BASE_API}${path}`; // already full static path
  if (path.startsWith("/")) return `${BASE_API}${path}`;       // leading slash path
  // assume filename stored in DB under /static/uploads/
  return `${BASE_API}/static/uploads/${path}`;
}

// global img fallback to avoid broken-image alt text
function attachGlobalImageFallback(placeholder = `${BASE_API}/static/placeholder.png`) {
  document.addEventListener("error", function (e) {
    const t = e.target;
    if (t && t.tagName === "IMG") {
      if (!t.dataset._fallback) {
        t.dataset._fallback = "1";
        t.src = placeholder;
      }
    }
  }, true);
}
attachGlobalImageFallback();
// --- end static helper ---

/* CONFIG */
const BASE_API_URL =
  (typeof window !== 'undefined' && window.BASE_API_URL)
    ? window.BASE_API_URL
    : 'http://127.0.0.1:8000';

const DEBUG = false; // set true only during debugging (don't log tokens)

const app = (function () {
  /* -----------------------
     Auth Module
     ----------------------- */
  const auth = {
    getAccessToken() {
      return sessionStorage.getItem('access_token');
    },
    setAccessToken(token) {
      if (!token) sessionStorage.removeItem('access_token');
      else sessionStorage.setItem('access_token', token);
    },
    getRefreshToken() {
      return localStorage.getItem('refresh_token');
    },
    setRefreshToken(token) {
      if (!token) localStorage.removeItem('refresh_token');
      else localStorage.setItem('refresh_token', token);
    },
    getUser() {
      try {
        const raw = sessionStorage.getItem('user_info');
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    setUser(user) {
      if (!user) sessionStorage.removeItem('user_info');
      else sessionStorage.setItem('user_info', JSON.stringify(user));
    },

    // -------- LOGIN --------
    async login(email, password) {
      const res = await fetch(`${BASE_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const payload = await res.json().catch(() => ({ success: false, error: 'Invalid JSON' }));
      if (DEBUG) console.log('login payload', payload);

      // Support multiple shapes:
      // {access_token, refresh_token, user}
      // OR {access, refresh, user}
      const accessToken =
        payload.access_token ||
        payload.access ||
        payload.token ||
        null;
      const refreshToken =
        payload.refresh_token ||
        payload.refresh ||
        null;

      if (!res.ok || !accessToken) {
        const msg =
          payload?.detail ||
          payload?.error ||
          payload?.message ||
          `Login failed (${res.status})`;
        throw new Error(msg);
      }

      this.setAccessToken(accessToken);
      if (refreshToken) this.setRefreshToken(refreshToken);

      const userObj = payload.user || payload.data?.user || null;
      this.setUser(userObj);

      return { access: accessToken, refresh: refreshToken, user: userObj };
    },

    // -------- REGISTER --------
    async register({ name, email, password, phone }) {
      const res = await fetch(`${BASE_API_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, email, password, phone })
      });
      const payload = await res.json().catch(() => ({ success: false, error: 'Invalid JSON' }));
      if (!res.ok) {
        const msg =
          payload?.detail ||
          payload?.error ||
          payload?.message ||
          `Register failed (${res.status})`;
        throw new Error(msg);
      }
      // Signup ke baad tum login page pe redirect kar rahe ho,
      // isliye yahan tokens store karna zaroori nahi hai.
      return payload;
    },

    async logout() {
      // inform server (optional)
      try {
        await withAuthFetch(`${BASE_API_URL}/api/auth/logout`, { method: 'POST' });
      } catch (e) {
        if (DEBUG) console.warn('logout API failed', e);
      }
      this.setAccessToken(null);
      this.setRefreshToken(null);
      this.setUser(null);
      location.href = 'index.html';
    },

    // -------- REFRESH --------
    async refresh() {
      const refresh = this.getRefreshToken();
      console.log('[auth.refresh] stored refresh token:', refresh);
      if (!refresh) throw new Error('No refresh token');

      const res = await fetch(`${BASE_API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh })
      });

      const payload = await res.json().catch(() => ({}));
      console.log('[auth.refresh] response status:', res.status, 'payload:', payload);

      const accessToken =
        payload.access_token ||
        payload.access ||
        payload.token ||
        null;
      const refreshToken =
        payload.refresh_token ||
        payload.refresh ||
        null;

      if (!res.ok || !accessToken) {
        this.setAccessToken(null);
        this.setRefreshToken(null);
        this.setUser(null);
        const msg =
          payload?.detail ||
          payload?.error ||
          payload?.message ||
          'Refresh failed';
        console.warn('[auth.refresh] failed:', msg);
        throw new Error(msg);
      }

      this.setAccessToken(accessToken);
      if (refreshToken) this.setRefreshToken(refreshToken);

      const userObj = payload.user || payload.data?.user || this.getUser();
      if (userObj) this.setUser(userObj);

      console.log('[auth.refresh] stored access_token:', accessToken);
      return { access: accessToken, refresh: refreshToken, user: userObj };
    },

    async ensureValidAccessToken() {
      const token = this.getAccessToken();
      if (!token) {
        await this.refresh().catch(err => { throw err; });
        return;
      }
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(
            atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
          );
          const exp = payload.exp;
          if (exp && Date.now() / 1000 > (exp - 15)) {
            await this.refresh();
          }
        }
      } catch (e) {
        // ignore parsing errors, rely on API 401 to trigger refresh
      }
    }
  };

  /* -----------------------
     Utility: withAuthFetch
     ----------------------- */
  /* --- Debugged withAuthFetch --- */
  async function withAuthFetch(url, opts = {}, retry = true) {
    try {
      await auth.ensureValidAccessToken();
    } catch (err) {
      throw new Error('Authentication required');
    }

    const token = auth.getAccessToken();
    const headers = Object.assign({}, opts.headers || {}, {
      'Accept': 'application/json'
    });

    if (!headers['Authorization'] && token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (DEBUG) console.log('[withAuthFetch] url:', url, 'retry:', retry, 'headers:', headers);

    const res = await fetch(url, Object.assign({}, opts, { headers }));

    if (res.status === 401 && retry) {
      if (DEBUG) console.log('[withAuthFetch] 401 received, attempting refresh...');
      try {
        const r = await auth.refresh();
        if (DEBUG) console.log('[withAuthFetch] refresh result:', r);
        return await withAuthFetch(url, opts, false);
      } catch (e) {
        if (DEBUG) console.error('[withAuthFetch] refresh failed:', e);
        throw new Error('Authentication failed');
      }
    }
    return res;
  }

  /* -----------------------
     API Module
     ----------------------- */
  const api = {
    // Public
    async getCities() {
      const res = await fetch(`${BASE_API_URL}/api/cities`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`Failed to load cities (${res.status})`);
      return await res.json();
    },

    async getProperties(params = {}) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') qs.set(k, v);
      });
      const res = await fetch(
        `${BASE_API_URL}/api/properties?${qs.toString()}`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to load properties (${res.status})`
        );
      }
      return await res.json(); // expected { success, data: { items, total, page, per_page } }
    },

    async getProperty(id) {
      const res = await fetch(
        `${BASE_API_URL}/api/properties/${encodeURIComponent(id)}`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!res.ok) {
        if (res.status === 404) {
          throw Object.assign(new Error('Property not found'), { code: 404 });
        }
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to load property (${res.status})`
        );
      }
      return await res.json(); // expected property object
    },

    // Host
    async createProperty(formData /* FormData */) {
      const res = await withAuthFetch(`${BASE_API_URL}/api/host/properties`, {
        method: 'POST',
        body: formData
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          payload?.error ||
          payload?.message ||
          `Create property failed (${res.status})`
        );
      }
      return payload;
    },

    async updateProperty(id, formData) {
      const res = await withAuthFetch(
        `${BASE_API_URL}/api/host/properties/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          body: formData
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          payload?.error ||
          payload?.message ||
          `Update failed (${res.status})`
        );
      }
      return payload;
    },

    async deletePropertyHost(id) {
      const res = await withAuthFetch(
        `${BASE_API_URL}/api/host/properties/${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          payload?.error ||
          payload?.message ||
          `Delete failed (${res.status})`
        );
      }
      return payload;
    },

    // Bookings
    async createBooking(payload) {
      const res = await withAuthFetch(`${BASE_API_URL}/api/bookings`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Booking failed (${res.status})`
        );
      }
      return body;
    },
    async getBookings() {
      const res = await withAuthFetch(`${BASE_API_URL}/api/bookings`, {
        method: 'GET'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to load bookings (${res.status})`
        );
      }
      return body;
    },

    // Host helpers
    async getHostProperties(params = {}) {
      const qs = new URLSearchParams(params).toString();
      const res = await withAuthFetch(
        `${BASE_API_URL}/api/host/properties${qs ? `?${qs}` : ''}`,
        { method: 'GET' }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to load host properties (${res.status})`
        );
      }
      return body;
    },
    async getHostBookings() {
      const res = await withAuthFetch(`${BASE_API_URL}/api/host/bookings`, {
        method: 'GET'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to load host bookings (${res.status})`
        );
      }
      return body;
    },

    // Admin
    async getAdminUsers() {
      const res = await withAuthFetch(`${BASE_API_URL}/api/admin/users`, {
        method: 'GET'
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to load users (${res.status})`
        );
      }
      return body;
    },
    async getAdminProperties(params = {}) {
      const qs = new URLSearchParams(params).toString();
      const res = await withAuthFetch(
        `${BASE_API_URL}/api/admin/properties${qs ? `?${qs}` : ''}`,
        { method: 'GET' }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to load admin properties (${res.status})`
        );
      }
      return body;
    },
    async deleteAdminProperty(id, reason = '') {
      const res = await withAuthFetch(
        `${BASE_API_URL}/api/admin/properties/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ reason })
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to delete property (${res.status})`
        );
      }
      return body;
    },

    // NEW: Admin pending listings APIs
    async getAdminPendingProperties() {
      const res = await withAuthFetch(
        `${BASE_API_URL}/api/admin/properties/pending`,
        { method: 'GET' }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to load pending properties (${res.status})`
        );
      }
      return body;
    },

    async approveAdminProperty(id) {
      const res = await withAuthFetch(
        `${BASE_API_URL}/api/admin/properties/${encodeURIComponent(
          id
        )}/approve`,
        { method: 'POST' }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to approve property (${res.status})`
        );
      }
      return body;
    },

    async rejectAdminProperty(id) {
      const res = await withAuthFetch(
        `${BASE_API_URL}/api/admin/properties/${encodeURIComponent(
          id
        )}/reject`,
        { method: 'POST' }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Failed to reject property (${res.status})`
        );
      }
      return body;
    },

    // Upload (if used separately)
    async uploadImage(file) {
      const fd = new FormData();
      fd.append('image', file);
      const res = await withAuthFetch(`${BASE_API_URL}/api/upload/image`, {
        method: 'POST',
        body: fd
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error ||
          body?.message ||
          `Upload failed (${res.status})`
        );
      }
      return body;
    }
  };

  /* -----------------------
     UI Module
     ----------------------- */
  const ui = {
    toastEl: null,
    initToast() {
      if (this.toastEl) return;
      this.toastEl = document.createElement('div');
      this.toastEl.id = 'appToast';
      Object.assign(this.toastEl.style, {
        position: 'fixed',
        right: '20px',
        bottom: '24px',
        zIndex: 9999,
        maxWidth: '320px'
      });
      document.body.appendChild(this.toastEl);
    },
    showToast(msg, type = 'info', ttl = 4000) {
      this.initToast();
      const el = document.createElement('div');
      el.textContent = msg;
      el.className = `app-toast app-toast-${type}`;
      Object.assign(el.style, {
        background:
          type === 'error'
            ? '#fde2e2'
            : type === 'success'
              ? '#e6ffef'
              : '#fff',
        color: '#111',
        padding: '10px 12px',
        borderRadius: '8px',
        boxShadow: '0 6px 18px rgba(20,20,40,0.06)',
        marginTop: '8px',
        fontSize: '14px'
      });
      this.toastEl.appendChild(el);
      setTimeout(() => {
        el.remove();
      }, ttl);
    },

    /* Renders cities into the index or cities page */
    renderCities(cities, containerSelector = '#cityGrid') {
      const container = document.querySelector(containerSelector);
      if (!container) return;
      container.innerHTML = '';
      (cities || []).forEach((c) => {
        const card = document.createElement('button');
        card.className = 'city-card';
        card.type = 'button';
        card.style.cursor = 'pointer';
        card.innerHTML = `<div class="city-name">${escapeHtml(
          c.city
        )}</div><div class="city-count" style="font-size:12px;margin-top:6px;color:var(--muted)">${c.count} rooms</div>`;
        card.addEventListener('click', () => {
          const q = encodeURIComponent(c.city);
          location.href = `rooms.html?city=${q}`;
        });
        container.appendChild(card);
      });
    },

    /* Render properties list (rooms.html) */
    renderPropertyList(data, containerSelector = '#results') {
      const container = document.querySelector(containerSelector);
      const pill = document.getElementById('resultsPill');
      const meta = document.getElementById('resultsMeta');
      if (!container) return;
      container.innerHTML = '';
      const items = data?.data?.items || [];
      const total = data?.data?.total || 0;
      const page = data?.data?.page || 1;
      const per_page = data?.data?.per_page || items.length;
      if (pill) pill.textContent = `${total} Results`;
      if (meta)
        meta.textContent = `Showing ${Math.min(
          (page - 1) * per_page + 1,
          total
        )}–${Math.min(page * per_page, total)} of ${total} results`;

      if (!items.length) {
        container.innerHTML =
          '<div style="grid-column:1/-1;padding:24px;text-align:center;color:var(--muted)">No results found</div>';
        return;
      }

      items.forEach((item) => {
        const card = document.createElement('article');
        card.className = 'card property-card';
        const thumb = item.images && item.images[0] ? item.images[0] : '';
        const thumbUrl = staticUrl(thumb);
        card.innerHTML = `
          <div class="avatar"><img src="${escapeAttr(
          thumbUrl
        )}" alt="${escapeAttr(
          item.title
        )}" loading="lazy" style="width:92px;height:92px;object-fit:cover;border-radius:8px"/></div>
          <div class="card-body">
            <div class="card-head">
              <div style="flex:1">
                <div class="name">${escapeHtml(item.title)}</div>
                <div class="meta">${escapeHtml(
          item.locality || ''
        )}, ${escapeHtml(item.city || '')} • ${escapeHtml(
          item.type || ''
        )}</div>
              </div>
              <div class="price">₹${escapeHtml(
          String(item.price || '')
        )}/mo</div>
            </div>
            <div class="tags" style="margin-top:8px">
              <div class="tag">${escapeHtml(item.gender || '')}</div>
            </div>
            <div class="card-foot" style="margin-top:10px">
              <button class="icon-btn view-btn" data-id="${escapeAttr(
          item.id
        )}">View</button>
              ${renderOwnerControls(item)}
            </div>
          </div>
        `;
        container.appendChild(card);
      });

      this.renderPager({ total, page, per_page });

      document.querySelectorAll('.view-btn').forEach((b) =>
        b.addEventListener('click', (ev) => {
          const id = ev.currentTarget.dataset.id;
          location.href = `room.html?id=${encodeURIComponent(id)}`;
        })
      );

      document.querySelectorAll('.prop-edit-btn').forEach((btn) =>
        btn.addEventListener('click', async (ev) => {
          const id = btn.dataset.id;
          location.href = `host.html?edit=${encodeURIComponent(id)}`;
        })
      );
      document.querySelectorAll('.prop-delete-btn').forEach((btn) =>
        btn.addEventListener('click', async (ev) => {
          const id = btn.dataset.id;
          if (!confirm('Delete this property?')) return;
          try {
            await api.deletePropertyHost(id);
            ui.showToast('Property deleted', 'success');
            await autoLoadRoomsFromUrl();
          } catch (err) {
            ui.showToast(err.message || 'Delete failed', 'error');
          }
        })
      );
    },

    renderPager({ total = 0, page = 1, per_page = 20 }) {
      const pager = document.getElementById('pager');
      if (!pager) return;
      pager.innerHTML = '';
      const pages = Math.max(1, Math.ceil(total / per_page));
      const makeBtn = (p) => {
        const b = document.createElement('button');
        b.className = 'page';
        b.textContent = p;
        b.disabled = p === page;
        b.addEventListener('click', () => {
          const params = getQueryParams();
          params.page = p;
          updateQueryParams(params);
          autoLoadRoomsFromUrl();
        });
        return b;
      };
      const start = Math.max(1, page - 2);
      const end = Math.min(pages, page + 2);
      if (page > 1) {
        const prev = document.createElement('button');
        prev.textContent = 'Prev';
        prev.addEventListener('click', () => {
          const params = getQueryParams();
          params.page = Math.max(1, page - 1);
          updateQueryParams(params);
          autoLoadRoomsFromUrl();
        });
        pager.appendChild(prev);
      }
      for (let p = start; p <= end; p++) pager.appendChild(makeBtn(p));
      if (page < pages) {
        const next = document.createElement('button');
        next.textContent = 'Next';
        next.addEventListener('click', () => {
          const params = getQueryParams();
          params.page = Math.min(pages, page + 1);
          updateQueryParams(params);
          autoLoadRoomsFromUrl();
        });
        pager.appendChild(next);
      }
    },

    /* Admin properties renderer */
    renderAdminProperties(list) {
      const container = document.getElementById('adminProperties');
      if (!container) return;
      container.innerHTML = '';
      (list || []).forEach((p) => {
        const el = document.createElement('div');
        el.className = 'admin-property-card card';
        const uploaderPhone = p?.uploader?.phone ? p.uploader.phone : null;
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div style="flex:1">
              <h3 style="margin:0">${escapeHtml(p.title)}</h3>
              <div style="color:var(--muted);font-size:13px">${escapeHtml(
          p.locality || ''
        )}, ${escapeHtml(p.city || '')} • ₹${escapeHtml(
          String(p.price || '')
        )}/mo</div>
              <div style="margin-top:6px;color:var(--muted);font-size:13px">Uploaded by: ${escapeHtml(
          p.uploader?.name || '—'
        )}</div>
              <div style="margin-top:6px;font-size:13px">Phone: ${uploaderPhone
            ? escapeHtml(uploaderPhone)
            : '<span style="color:#999">No phone on file</span>'
          }</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
              <div>
                ${uploaderPhone
            ? `<button class="btn whatsapp-uploader" data-phone="${escapeAttr(
              uploaderPhone
            )}" data-name="${escapeAttr(
              p.uploader?.name || ''
            )}">WhatsApp</button>`
            : ''
          }
              </div>
              <div>
                <button class="admin-delete-btn btn btn-outline" data-id="${escapeAttr(
            p.id
          )}">Delete from site</button>
              </div>
            </div>
          </div>
        `;
        container.appendChild(el);
      });
      container
        .querySelectorAll('.whatsapp-uploader')
        .forEach((b) =>
          b.addEventListener('click', (ev) => {
            const phone = ev.currentTarget.dataset.phone || '';
            const name = ev.currentTarget.dataset.name || 'there';
            if (!phone) {
              ui.showToast('No phone available', 'error');
              return;
            }
            const cleaned = phone.replace(/\+/g, '').replace(/\s+/g, '');
            const message = encodeURIComponent(
              `Hello ${name}, I'm admin verifying property. Please respond.`
            );
            window.open(
              `https://wa.me/${cleaned}?text=${message}`,
              '_blank'
            );
          })
        );
      container
        .querySelectorAll('.admin-delete-btn')
        .forEach((b) =>
          b.addEventListener('click', adminDeletePropertyHandler)
        );
    },

    // NEW: Admin Pending Listings renderer
    renderAdminPendingProperties(list) {
      const container = document.getElementById('adminPendingProperties');
      if (!container) return;
      container.innerHTML = '';
      (list || []).forEach((p) => {
        const uploaderPhone =
          p?.host?.phone || p?.uploader?.phone || null;
        const uploaderName =
          p?.host?.name || p?.uploader?.name || '';
        const el = document.createElement('div');
        el.className = 'admin-property-card card';
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div style="flex:1">
              <h3 style="margin:0">${escapeHtml(p.title)}</h3>
              <div style="color:var(--muted);font-size:13px">${escapeHtml(
          p.locality || ''
        )}, ${escapeHtml(p.city || '')} • ₹${escapeHtml(
          String(p.price || '')
        )}/mo</div>
              <div style="margin-top:6px;color:var(--muted);font-size:13px">
                Uploaded by: ${escapeHtml(uploaderName || '—')}
              </div>
              <div style="margin-top:6px;font-size:13px">
                Phone: ${uploaderPhone
            ? escapeHtml(uploaderPhone)
            : '<span style="color:#999">No phone on file</span>'
          }
              </div>
              <div style="margin-top:6px;font-size:12px;color:var(--muted)">
                Status: ${escapeHtml(p.approval_status || 'pending')}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
              <button class="btn" data-action="approve" data-id="${escapeAttr(
            p.id
          )}">Approve</button>
              <button class="btn btn-outline" data-action="reject" data-id="${escapeAttr(
            p.id
          )}">Reject</button>
            </div>
          </div>
        `;
        container.appendChild(el);
      });

      container
        .querySelectorAll('button[data-action="approve"]')
        .forEach((b) =>
          b.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            const id = btn.dataset.id;
            if (!id) return;
            try {
              btn.disabled = true;
              btn.textContent = 'Approving...';
              await api.approveAdminProperty(id);
              const card = btn.closest('.admin-property-card');
              if (card) card.remove();
              ui.showToast('Listing approved and now live.', 'success');
            } catch (err) {
              ui.showToast(
                err.message || 'Failed to approve listing',
                'error'
              );
              btn.disabled = false;
              btn.textContent = 'Approve';
            }
          })
        );

      container
        .querySelectorAll('button[data-action="reject"]')
        .forEach((b) =>
          b.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            const id = btn.dataset.id;
            if (!id) return;
            const reason = prompt(
              'Reject this listing? You can optionally type a reason here:',
              ''
            );
            if (reason === null) return;
            try {
              btn.disabled = true;
              btn.textContent = 'Rejecting...';
              await api.rejectAdminProperty(id);
              const card = btn.closest('.admin-property-card');
              if (card) card.remove();
              ui.showToast('Listing rejected.', 'success');
            } catch (err) {
              ui.showToast(
                err.message || 'Failed to reject listing',
                'error'
              );
              btn.disabled = false;
              btn.textContent = 'Reject';
            }
          })
        );
    },

    /* Room detail renderer */
    async renderRoomDetail(property) {
      const galleryRoot = document.getElementById('propertyGallery');
      const infoRoot = document.getElementById('propertyInfo');
      if (!galleryRoot || !infoRoot) return;

      document.getElementById('propTitle').textContent =
        property.title || '—';
      document.getElementById(
        'propMeta'
      ).textContent = `${property.locality || ''}, ${property.city || ''} • ₹${property.price || ''
      }`;
      document.getElementById('propDesc').textContent =
        property.description || '';

      const hostContact = document.getElementById('hostContact');
      hostContact.innerHTML = '';
      const user = auth.getUser();
      if (user) {
        if (property.host?.phone) {
          const cleaned = property.host.phone
            .replace(/\+/g, '')
            .replace(/\s+/g, '');
          const waMsg = encodeURIComponent(
            `Hi ${property.host.name || ''}, I'm interested in your property "${property.title
            }" (ID: ${property.id}).`
          );
          const a = document.createElement('a');
          a.href = `https://wa.me/${cleaned}?text=${waMsg}`;
          a.target = '_blank';
          a.rel = 'noopener';
          a.className = 'small-cta';
          a.textContent = 'Chat with owner on WhatsApp';
          hostContact.appendChild(a);
          hostContact.insertAdjacentHTML(
            'beforeend',
            `<div style="margin-top:6px;color:var(--muted)">Owner: ${escapeHtml(
              property.host.name || ''
            )} • ${escapeHtml(property.host.phone || '')}</div>`
          );
        } else {
          hostContact.innerHTML =
            '<div style="color:var(--muted)">Owner contact not available</div>';
        }
      } else {
        hostContact.innerHTML =
          '<div style="color:var(--muted)">Login to view contact</div>';
      }

      // Use original gallery signature: renderGallery(root, images)
      renderGallery(galleryRoot, property.images || []);

      const bookBtn = document.getElementById('bookBtn');
      const bookingResult = document.getElementById('bookingResult');
      if (bookBtn) {
        bookBtn.onclick = async function () {
          bookingResult.textContent = '';
          const me = auth.getUser();
          if (!me) {
            ui.showToast('Login to book', 'error');
            return;
          }
          const start = prompt('Start date (YYYY-MM-DD)');
          if (!start) return;
          const end = prompt('End date (YYYY-MM-DD)');
          if (!end) return;
          try {
            bookBtn.disabled = true;
            bookBtn.textContent = 'Booking...';
            const payload = {
              property_id: property.id,
              start_date: start,
              end_date: end
            };
            await api.createBooking(payload);
            ui.showToast('Booking created', 'success');
            if (bookingResult) {
              bookingResult.innerHTML =
                '<div style="padding:10px;border-radius:8px;background:#f6fffa">Booking confirmed. <br/> <button id="chatOwnerBtn" class="btn">Chat with owner on WhatsApp</button></div>';
              const chatBtn = document.getElementById('chatOwnerBtn');
              if (chatBtn) {
                chatBtn.addEventListener('click', () => {
                  const phone = (property.host?.phone || '')
                    .replace(/\+/g, '')
                    .replace(/\s+/g, '');
                  if (!phone) {
                    ui.showToast('Owner phone not available', 'error');
                    return;
                  }
                  const message = encodeURIComponent(
                    `Hi ${property.host?.name || ''}, I just booked "${property.title
                    }" (ID: ${property.id}) for ${start} to ${end}. My name is ${me.name || ''
                    }. Please confirm availability and next steps.`
                  );
                  window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
                });
              }
            }
          } catch (err) {
            ui.showToast(err.message || 'Booking failed', 'error');
            if (bookingResult) bookingResult.textContent = err.message || 'Booking failed';
          } finally {
            bookBtn.disabled = false;
            bookBtn.textContent = 'Book this property';
          }
        };
      }
    },

    /* Host properties renderer */
    renderHostProperties(list) {
      const container = document.getElementById('hostProperties');
      if (!container) return;
      container.innerHTML = '';
      (list || []).forEach((p) => {
        // NEW: derive approval status badge
        const status = (p.approval_status || 'pending').toLowerCase();
        let statusLabel = 'Pending approval';
        let statusBg = 'rgba(202,138,4,0.1)';
        let statusColor = '#92400e';
        if (status === 'approved') {
          statusLabel = 'Approved (Live)';
          statusBg = 'rgba(22,163,74,0.08)';
          statusColor = '#166534';
        } else if (status === 'rejected') {
          statusLabel = 'Rejected';
          statusBg = 'rgba(220,38,38,0.08)';
          statusColor = '#b91c1c';
        }

        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between">
            <div>
              <strong>${escapeHtml(p.title)}</strong>
              <div style="color:var(--muted)">${escapeHtml(
          p.locality || ''
        )}, ${escapeHtml(p.city || '')}</div>
              <div style="margin-top:6px;display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:12px;font-weight:600;background:${statusBg};color:${statusColor}">
                ${escapeHtml(statusLabel)}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <button class="prop-edit-btn btn" data-id="${escapeAttr(
          p.id
        )}">Edit</button>
              <button class="prop-delete-btn btn btn-outline" data-id="${escapeAttr(
          p.id
        )}">Delete</button>
            </div>
          </div>
        `;
        container.appendChild(el);
      });
      container
        .querySelectorAll('.prop-edit-btn')
        .forEach((b) =>
          b.addEventListener('click', (ev) => {
            const id = ev.currentTarget.dataset.id;
            location.href = `host.html?edit=${encodeURIComponent(id)}`;
          })
        );
      container
        .querySelectorAll('.prop-delete-btn')
        .forEach((b) =>
          b.addEventListener('click', async (ev) => {
            const id = ev.currentTarget.dataset.id;
            if (!confirm('Delete this property?')) return;
            try {
              await api.deletePropertyHost(id);
              ui.showToast('Property deleted', 'success');
              await loadHostProperties();
            } catch (err) {
              ui.showToast(err.message || 'Delete failed', 'error');
            }
          })
        );
    },

    /* ---------- Show create / edit property form (insert into host page) ---------- */
    async renderPropertyForm(editData = null) {
      const container = document.querySelector('.container-card');
      if (!container) return;
      if (document.getElementById('propertyFormWrap')) {
        document.getElementById('propertyFormTitle')?.focus();
        return;
      }

      const wrap = document.createElement('div');
      wrap.id = 'propertyFormWrap';
      wrap.className = 'card';
      wrap.innerHTML = `
    <div class="form-top">
      <div class="form-top-left">
        <h2 id="propertyFormHeading">${editData ? 'Edit listing' : 'Add your requirement'}</h2>
        <div class="form-sub">so that other users can contact you.</div>
      </div>
      <button id="propertyFormClose" class="close-btn" aria-label="Close">✕</button>
    </div>

    <form id="propertyForm" enctype="multipart/form-data" autocomplete="off">
      <div class="grid">
        <div class="field large">
          <label class="label">Title</label>
          <input id="propertyFormTitle" name="title" placeholder="e.g. 1BHK near VIT Bhopal" required />
        </div>

        <div class="field">
          <label class="label">Type</label>
          <div class="pill-box" id="typePills">
            <button type="button" class="pill" data-value="flat">Flat</button>
            <button type="button" class="pill" data-value="pg">PG</button>
            <button type="button" class="pill active" data-value="room">Room</button>
          </div>
          <input type="hidden" id="propertyFormType" name="type" value="room" />
        </div>

        <div class="field">
          <label class="label">City</label>
          <input id="propertyFormCity" name="city" placeholder="City" required />
        </div>

        <div class="field">
          <label class="label">Locality / Area</label>
          <input id="propertyFormLocality" name="locality" placeholder="Locality / Area" />
        </div>

        <div class="field">
          <label class="label">Approx Rent</label>
          <div class="money">
            <span class="rupee">₹</span>
            <input id="propertyFormPrice" name="price" placeholder="5000" inputmode="numeric" />
          </div>
        </div>

        <div class="field">
          <label class="label">Looking For</label>
          <div class="pill-box" id="genderPills">
            <button type="button" class="pill" data-value="male">Male</button>
            <button type="button" class="pill" data-value="female">Female</button>
            <button type="button" class="pill active" data-value="any">Any</button>
          </div>
          <input type="hidden" id="propertyFormGender" name="gender" value="any" />
        </div>


        <div class="field full">
          <label class="label">Description</label>
          <textarea id="propertyFormDesc" name="description" rows="4" placeholder="Describe your requirement (optional)"></textarea>
        </div>

        <div class="field full">
          <label class="label">Images</label>
          <label class="file-drop" for="propertyFormImages">
            <div class="file-drop-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 7l4-4 4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              <span class="fd-text">Click or drop images here</span>
            </div>
            <span class="fd-note">PNG/JPG • up to 6</span>
            <input id="propertyFormImages" name="images" type="file" accept="image/*" multiple />
          </label>
          <div id="imagePreview" class="image-preview"></div>
        </div>

        <div class="field">
          <label class="label">Interested in PG?</label>
          <div class="mini-box">
            <button type="button" class="mini-pill" data-target="propertyFormPG" data-value="yes">Yes</button>
            <button type="button" class="mini-pill active" data-target="propertyFormPG" data-value="no">No</button>
          </div>
          <input type="hidden" id="propertyFormPG" name="pg" value="no" />
        </div>

        <div class="field">
          <label class="label">Make mobile visible?</label>
          <div class="mini-box">
            <button type="button" class="mini-pill" data-target="propertyFormMobileVisible" data-value="yes">Yes</button>
            <button type="button" class="mini-pill active" data-target="propertyFormMobileVisible" data-value="no">No</button>
          </div>
          <input type="hidden" id="propertyFormMobileVisible" name="mobile_visible" value="no" />
        </div>
      </div>

      <div class="actions">
        <button id="propertyFormSubmit" type="submit" class="btn primary">${editData ? 'Update' : 'Create'}</button>
        <button id="propertyFormCancel" type="button" class="btn outline">Cancel</button>
        <div id="propertyFormMsg" class="status"></div>
      </div>
    </form>
  `;

      // insert into DOM
      const hostActions = document.getElementById('hostActions');
      if (hostActions) hostActions.insertAdjacentElement('afterend', wrap);
      else container.insertAdjacentElement('afterbegin', wrap);

      // HIGHLIGHTS (chips)
      const H = ['Working full time', 'College student', '25+ age', '<25 age', 'Working night shifts', 'Have 2 wheeler', 'Have 4 wheeler', 'Will shift immediately', 'Have pets', 'Need no furnishing', 'Pure vegetarian'];
      const hw = document.getElementById('highlightsWrap');
      H.forEach(v => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'chip'; b.textContent = v; b.dataset.value = v;
        b.addEventListener('click', () => b.classList.toggle('selected'));
        hw.appendChild(b);
      });

      // populate editData
      if (editData) {
        document.getElementById('propertyFormTitle').value = editData.title || '';
        document.getElementById('propertyFormCity').value = editData.city || '';
        document.getElementById('propertyFormLocality').value = editData.locality || '';
        document.getElementById('propertyFormPrice').value = editData.price || '';
        document.getElementById('propertyFormDesc').value = editData.description || '';
        if (editData.type) {
          document.getElementById('propertyFormType').value = editData.type;
          wrap.querySelectorAll('#typePills .pill').forEach(p => p.classList.toggle('active', p.dataset.value === editData.type));
        }
        if (editData.gender) {
          document.getElementById('propertyFormGender').value = editData.gender;
          wrap.querySelectorAll('#genderPills .pill').forEach(p => p.classList.toggle('active', p.dataset.value === editData.gender));
        }
        if (editData.highlights) {
          try {
            const sel = Array.isArray(editData.highlights) ? editData.highlights : JSON.parse(editData.highlights);
            hw.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', sel.includes(c.dataset.value)));
          } catch (e) { }
        }
        document.getElementById('propertyFormHeading').textContent = 'Edit listing';
      }

      // close / cancel
      wrap.querySelector('#propertyFormClose').addEventListener('click', () => {
        const el = document.getElementById('propertyFormWrap'); if (el) el.remove();
        const params = getQueryParams(); delete params.create; delete params.edit; updateQueryParams(params);
      });
      wrap.querySelector('#propertyFormCancel').addEventListener('click', () => wrap.querySelector('#propertyFormClose').click());

      // pills handlers
      wrap.querySelectorAll('#typePills .pill').forEach(btn => {
        btn.addEventListener('click', () => {
          wrap.querySelectorAll('#typePills .pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById('propertyFormType').value = btn.dataset.value;
        });
      });
      wrap.querySelectorAll('#genderPills .pill').forEach(btn => {
        btn.addEventListener('click', () => {
          wrap.querySelectorAll('#genderPills .pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById('propertyFormGender').value = btn.dataset.value;
        });
      });

      // mini toggles
      wrap.querySelectorAll('.mini-pill').forEach(p => {
        p.addEventListener('click', () => {
          const t = p.dataset.target;
          wrap.querySelectorAll(`.mini-pill[data-target="${t}"]`).forEach(s => s.classList.remove('active'));
          p.classList.add('active');
          const hid = document.getElementById(t);
          if (hid) hid.value = p.dataset.value;
        });
      });

      // file drop + preview
      const fileInput = wrap.querySelector('#propertyFormImages');
      const preview = wrap.querySelector('#imagePreview');
      const fileDrop = wrap.querySelector('.file-drop');

      fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('dragover'); });
      fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
      fileDrop.addEventListener('drop', e => {
        e.preventDefault(); fileDrop.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files || []).slice(0, 6);
        const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); fileInput.files = dt.files;
        renderPreviews(fileInput.files);
      });
      fileInput.addEventListener('change', () => renderPreviews(fileInput.files));

      function renderPreviews(files) {
        preview.innerHTML = '';
        if (!files) return;
        Array.from(files).slice(0, 6).forEach(f => {
          if (!f.type.startsWith('image/')) return;
          const url = URL.createObjectURL(f);
          const img = document.createElement('img'); img.src = url; img.className = 'preview-img';
          const holder = document.createElement('div'); holder.className = 'preview-item';
          const del = document.createElement('button'); del.type = 'button'; del.className = 'preview-del'; del.textContent = '✕';
          del.addEventListener('click', () => {
            const remaining = Array.from(fileInput.files).filter(x => x !== f);
            const d = new DataTransfer(); remaining.forEach(r => d.items.add(r)); fileInput.files = d.files;
            renderPreviews(fileInput.files);
          });
          holder.appendChild(img); holder.appendChild(del); preview.appendChild(holder);
        });
      }

      // submit
      const form = wrap.querySelector('#propertyForm');
      const msgEl = wrap.querySelector('#propertyFormMsg');
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        try {
          wrap.querySelector('#propertyFormSubmit').disabled = true;
          msgEl.textContent = editData ? 'Updating...' : 'Creating...';

          const fd = new FormData();
          fd.append('title', wrap.querySelector('#propertyFormTitle').value.trim());
          fd.append('city', wrap.querySelector('#propertyFormCity').value.trim());
          fd.append('locality', wrap.querySelector('#propertyFormLocality').value.trim());
          fd.append('price', wrap.querySelector('#propertyFormPrice').value.trim());
          fd.append('type', wrap.querySelector('#propertyFormType').value);
          fd.append('gender', wrap.querySelector('#propertyFormGender').value);
          fd.append('description', wrap.querySelector('#propertyFormDesc').value.trim());
          fd.append('pg', wrap.querySelector('#propertyFormPG')?.value || 'no');
          fd.append('mobile_visible', wrap.querySelector('#propertyFormMobileVisible')?.value || 'no');

          const selected = Array.from(hw.querySelectorAll('.chip.selected')).map(c => c.dataset.value);
          fd.append('highlights', JSON.stringify(selected));

          const files = fileInput.files || [];
          for (let i = 0; i < files.length; i++) fd.append('images', files[i]);

          if (editData && editData.id) {
            await api.updateProperty(editData.id, fd);
            ui.showToast('Property updated', 'success');
          } else {
            await api.createProperty(fd);
            // NEW: show pending approval message
            ui.showToast('Listing created and pending admin approval.', 'success');
          }

          const el = document.getElementById('propertyFormWrap'); if (el) el.remove();
          const params = getQueryParams(); delete params.create; delete params.edit; updateQueryParams(params);
          await loadHostProperties(); await loadHostBookings();
        } catch (err) {
          ui.showToast(err.message || 'Failed to save property', 'error');
          msgEl.textContent = err.message || 'Error';
        } finally {
          wrap.querySelector('#propertyFormSubmit').disabled = false;
        }
      });
    }

  };

  // end ui

  /* -----------------------
     Helper functions
     ----------------------- */
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }
  function renderOwnerControls(item) {
    const me = auth.getUser();
    if (!me) return '';
    if (String(me.id) === String(item.host_id) || me.role === 'admin') {
      return `<div style="margin-left:auto">
                <button class="prop-edit-btn btn" data-id="${escapeAttr(
        item.id
      )}">Edit</button>
                <button class="prop-delete-btn btn btn-outline" data-id="${escapeAttr(
        item.id
      )}">Delete</button>
              </div>`;
    }
    return '';
  }

  function getQueryParams() {
    const qs = new URLSearchParams(location.search);
    const obj = {};
    for (const [k, v] of qs.entries()) obj[k] = v;
    return obj;
  }
  function updateQueryParams(params) {
    const qs = new URLSearchParams(params).toString();
    const base = location.pathname;
    history.pushState({}, '', qs ? `${base}?${qs}` : base);
  }

  /* Auto-load / page wiring functions */
  async function autoLoadIndex() {
    try {
      const cities = await api.getCities();
      ui.renderCities(cities, '#cityGrid');
    } catch (err) {
      if (DEBUG) console.error('cities load error', err);
    }
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', () => {
        const q = searchInput.value.trim();
        if (!q) {
          ui.showToast('Enter a city or locality', 'error');
          return;
        }
        location.href = `cities.html?q=${encodeURIComponent(q)}`;
      });
    }
    updateAuthLinks();
  }

  async function autoLoadCities() {
    try {
      const allCities = await api.getCities();
      const q = getQueryParams().q || '';
      const filtered = q
        ? allCities.filter((c) =>
          c.city.toLowerCase().includes(q.toLowerCase())
        )
        : allCities;
      ui.renderCities(filtered, '#citiesList');
      const input = document.getElementById('citySearch');
      if (input) {
        input.value = q;
        input.addEventListener('input', (ev) => {
          const v = ev.target.value.trim();
          const fin = v
            ? allCities.filter((c) =>
              c.city.toLowerCase().includes(v.toLowerCase())
            )
            : allCities;
          ui.renderCities(fin, '#citiesList');
        });
      }
    } catch (err) {
      ui.showToast(err.message || 'Failed to load cities', 'error');
    }
    updateAuthLinks();
  }

  async function autoLoadRoomsFromUrl() {
    try {
      const params = getQueryParams();
      const city = params.city || '';
      const page = parseInt(params.page || '1', 10) || 1;
      const per_page = parseInt(params.per_page || '20', 10) || 20;
      const apiParams = { city, page, per_page };
      const min = document.getElementById('filter-min')?.value;
      if (min) apiParams.min_price = min;
      const max = document.getElementById('filter-max')?.value;
      if (max) apiParams.max_price = max;
      const type = document.getElementById('filter-type')?.value;
      if (type) apiParams.type = type;
      const gender = document.getElementById('filter-gender')?.value;
      if (gender) apiParams.gender = gender;
      const sort = document.getElementById('filter-sort')?.value;
      if (sort) apiParams.sort = sort;

      const data = await api.getProperties(apiParams);
      ui.renderPropertyList(data);
    } catch (err) {
      ui.showToast(err.message || 'Failed to load rooms', 'error');
    }
    updateAuthLinks();
  }

  async function autoLoadRoomDetail() {
    const params = getQueryParams();
    const id = params.id;
    if (!id) {
      ui.showToast('No property selected', 'error');
      return;
    }
    try {
      const property = await api.getProperty(id);
      const prop = property?.data || property;
      await ui.renderRoomDetail(prop);
    } catch (err) {
      if (err?.code === 404) {
        const card = document.getElementById('propertyDetailCard');
        if (card)
          card.innerHTML =
            '<div style="padding:24px">Property not found</div>';
        return;
      }
      ui.showToast(err.message || 'Failed to load property', 'error');
    }
    updateAuthLinks();
  }

  async function loadHostProperties() {
    try {
      const res = await api.getHostProperties();
      const list = res?.data?.items || res?.items || [];
      ui.renderHostProperties(list);
    } catch (err) {
      ui.showToast(err.message || 'Failed to load host properties', 'error');
    }
    updateAuthLinks();
  }

  async function loadHostBookings() {
    try {
      const res = await api.getHostBookings();
      const list = res?.data?.items || res?.items || [];
      const root = document.getElementById('hostBookings');
      if (!root) return;
      root.innerHTML = '';
      (list || []).forEach((b) => {
        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = `<div><strong>Booking ${b.id
          }</strong><div style="color:var(--muted)">${b.start_date} → ${b.end_date
          }</div></div>`;
        root.appendChild(el);
      });
    } catch (err) {
      ui.showToast(err.message || 'Failed to load host bookings', 'error');
    }
  }


  async function loadProfilePage() {
    const container = document.getElementById('bookedRoomsContainer');
    if (!container) return;

    try {
      const res = await withAuthFetch(
        `${BASE_API_URL}/api/users/booked-rooms`,
        { method: 'GET' }
      );

      const body = await res.json().catch(() => ({}));
      const list = body?.data || [];

      if (!list.length) {
        container.innerHTML = '<p>No booked rooms yet.</p>';
        return;
      }

      container.innerHTML = '';

      list.forEach(b => {
        const el = document.createElement('div');
        el.className = 'card';
        el.style.marginTop = '12px';

        el.innerHTML = `
        <strong>${b.title}</strong>
        <div style="color:var(--muted); margin-top:4px">
          ${b.city}<br/>
          ${b.start_date} → ${b.end_date}<br/>
          Status: ${b.status}
        </div>
      `;

        container.appendChild(el);
      });

    } catch (err) {
      container.innerHTML = '<p>Failed to load booked rooms.</p>';
    }
  }






  async function loadAdminPanel() {
    try {
      const stats = await withAuthFetch(`${BASE_API_URL}/api/admin/stats`, {
        method: 'GET'
      });
      const statsJson = await stats.json().catch(() => null);
      if (stats.ok) {
        const stRoot = document.getElementById('adminStats');
        if (stRoot) {
          stRoot.innerHTML = `<div style="padding:8px">Users: ${statsJson.total_users
            }</div><div style="padding:8px">Properties: ${statsJson.total_properties
            }</div><div style="padding:8px">Bookings: ${statsJson.total_bookings
            }</div>`;
        }
      }
    } catch (err) {
      // ignore stats errors
    }
    try {
      const users = await api.getAdminUsers();
      const ul = document.getElementById('adminUsers');
      if (ul) {
        ul.innerHTML = '';
        (users?.data || users || []).forEach((u) => {
          const el = document.createElement('div');
          el.className = 'card';
          el.innerHTML = `<div style="display:flex;justify-content:space-between"><div>${escapeHtml(
            u.email
          )} <div style="color:var(--muted)">${escapeHtml(
            u.name || ''
          )}</div></div><div><select class="role-select" data-id="${escapeAttr(
            u.id
          )}"><option${u.role === 'user' ? ' selected' : ''
            }>user</option><option${u.role === 'host' ? ' selected' : ''
            }>host</option><option${u.role === 'admin' ? ' selected' : ''
            }>admin</option></select></div></div>`;
          ul.appendChild(el);
        });
        ul.querySelectorAll('.role-select').forEach((sel) =>
          sel.addEventListener('change', async (ev) => {
            const id = ev.currentTarget.dataset.id;
            const role = ev.currentTarget.value;
            try {
              const r = await withAuthFetch(
                `${BASE_API_URL}/api/admin/users/${encodeURIComponent(
                  id
                )}/role`,
                {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ role })
                }
              );
              const body = await r.json().catch(() => null);
              if (!r.ok) {
                throw new Error(
                  body?.error || body?.message || 'Role change failed'
                );
              }
              ui.showToast('Role updated', 'success');
            } catch (err) {
              ui.showToast(
                err.message || 'Failed to update role',
                'error'
              );
            }
          })
        );
      }
    } catch (err) {
      ui.showToast(err.message || 'Failed to load admin users', 'error');
    }

    try {
      const props = await api.getAdminProperties();
      const list = props?.data?.items || props?.items || [];
      ui.renderAdminProperties(list);
    } catch (err) {
      ui.showToast(err.message || 'Failed to load admin properties', 'error');
    }

    // NEW: load pending listings section
    try {
      const pendingRes = await api.getAdminPendingProperties();
      const pendingList =
        pendingRes?.data?.items || pendingRes?.items || [];
      ui.renderAdminPendingProperties(pendingList);
    } catch (err) {
      ui.showToast(
        err.message || 'Failed to load pending listings',
        'error'
      );
    }
  }

  async function adminDeletePropertyHandler(ev) {
    const btn = ev.currentTarget;
    const id = btn.dataset.id;
    if (!id) return;
    const confirmText =
      'Permanently remove this room from the website? This cannot be undone. Type reason (optional) and click OK to confirm, or Cancel to abort.';
    const reason = prompt(confirmText, '');
    if (reason === null) return;
    try {
      btn.disabled = true;
      btn.textContent = 'Removing...';
      await api.deleteAdminProperty(id, reason);
      const card =
        btn.closest('.admin-property-card') ||
        btn.parentElement?.parentElement;
      if (card) card.remove();
      try {
        const cities = await api.getCities();
        ui.renderCities(cities, '#cityGrid');
        ui.renderCities(cities, '#citiesList');
      } catch (err) {
        console.warn('Failed to refresh cities after deletion', err);
      }
      ui.showToast('Room removed from site.', 'success');
    } catch (err) {
      ui.showToast(err.message || 'Failed to remove room', 'error');
      btn.disabled = false;
      btn.textContent = 'Delete from site';
    }
  }

  /* -----------------------
     Gallery implementation (original signature preserved)
     ----------------------- */
  function renderGallery(root, images = []) {
    if (!root) return;
    root.innerHTML = '';
    const main = document.createElement('div');
    main.className = 'gallery-main';
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'gallery-thumbs';
    let currentIndex = 0;

    function setMain(i) {
      currentIndex = i;
      main.innerHTML = '';
      const img = document.createElement('img');
      img.src = staticUrl(images[i] || '');
      img.alt = `Image ${i + 1}`;
      img.loading = 'lazy';
      img.style.maxWidth = '100%';
      img.style.borderRadius = '8px';
      img.style.cursor = 'zoom-in';
      img.onerror = () => { img.src = `${BASE_API}/static/placeholder.png`; };

      const prev = document.createElement('button');
      prev.textContent = '<';
      prev.className = 'gallery-prev';
      const next = document.createElement('button');
      next.textContent = '>';
      next.className = 'gallery-next';
      Object.assign(prev.style, {
        position: 'absolute',
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)'
      });
      Object.assign(next.style, {
        position: 'absolute',
        right: '12px',
        top: '50%',
        transform: 'translateY(-50%)'
      });
      prev.addEventListener('click', () =>
        setMain((currentIndex - 1 + images.length) % images.length)
      );
      next.addEventListener('click', () =>
        setMain((currentIndex + 1) % images.length)
      );
      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative';
      wrapper.appendChild(img);
      if (images.length > 1) {
        wrapper.appendChild(prev);
        wrapper.appendChild(next);
      }
      main.innerHTML = '';
      main.appendChild(wrapper);

      img.addEventListener('click', () => openLightbox(currentIndex));
      thumbWrap.querySelectorAll('img').forEach((t, idx) => {
        t.style.outline =
          idx === i ? '3px solid var(--primary)' : 'none';
      });
    }

    images.forEach((src, idx) => {
      const t = document.createElement('img');
      t.src = staticUrl(src || '');
      t.alt = `Thumb ${idx + 1}`;
      t.loading = 'lazy';
      t.style.width = '72px';
      t.style.height = '54px';
      t.style.objectFit = 'cover';
      t.style.borderRadius = '6px';
      t.style.marginRight = '8px';
      t.style.cursor = 'pointer';
      t.onerror = () => { t.src = `${BASE_API}/static/placeholder.png`; };
      t.addEventListener('click', () => setMain(idx));
      thumbWrap.appendChild(t);
    });

    if (!images.length) {
      main.innerHTML =
        '<div style="padding:24px;background:#f8fafc;border-radius:8px">No images</div>';
    } else {
      setMain(0);
    }

    root.appendChild(main);
    root.appendChild(thumbWrap);

    function openLightbox(start) {
      const overlay = document.createElement('div');
      overlay.className = 'gallery-lightbox';
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999
      });
      let idx = start;
      const img = document.createElement('img');
      img.src = staticUrl(images[idx] || '');
      img.style.maxWidth = '90%';
      img.style.maxHeight = '90%';
      img.onerror = () => { img.src = `${BASE_API}/static/placeholder.png`; };
      overlay.appendChild(img);
      const close = () => {
        document.body.removeChild(overlay);
        window.removeEventListener('keydown', onKey);
      };
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      function onKey(e) {
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') {
          idx = (idx - 1 + images.length) % images.length;
          img.src = staticUrl(images[idx] || '');
        }
        if (e.key === 'ArrowRight') {
          idx = (idx + 1) % images.length;
          img.src = staticUrl(images[idx] || '');
        }
      }
      window.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
    }
  }


  function updateAuthLinks() {
  const logoutBtn = document.getElementById('logoutBtn');
  const loginLink = document.getElementById('auth-link');

  const isLoggedIn = !!app.auth.getAccessToken();

  if (logoutBtn) logoutBtn.style.display = isLoggedIn ? 'inline-block' : 'none';
  if (loginLink) loginLink.style.display = isLoggedIn ? 'none' : 'inline-block';
}



  /* -----------------------
     Page init detection and wiring
     ----------------------- */
  async function init() {
    updateAuthLinks();

    const path = location.pathname.split('/').pop();
    if (path === '' || path === 'index.html') {
      await autoLoadIndex();
    } else if (path === 'cities.html') {
      await autoLoadCities();
    } else if (path === 'rooms.html') {
      document.getElementById('applyFilters')?.addEventListener('click', () => {
        const params = getQueryParams();
        params.page = 1;
        params.min_price =
          document.getElementById('filter-min')?.value || '';
        params.max_price =
          document.getElementById('filter-max')?.value || '';
        params.type =
          document.getElementById('filter-type')?.value || '';
        params.gender =
          document.getElementById('filter-gender')?.value || '';
        params.sort =
          document.getElementById('filter-sort')?.value || '';
        updateQueryParams(params);
        autoLoadRoomsFromUrl();
      });
      document
        .getElementById('resetFilters')
        ?.addEventListener('click', () => {
          document.getElementById('filter-min').value = '';
          document.getElementById('filter-max').value = '';
          document.getElementById('filter-type').value = '';
          document.getElementById('filter-gender').value = '';
          document.getElementById('filter-sort').value = 'recent';
          const params = getQueryParams();
          delete params.min_price;
          delete params.max_price;
          delete params.type;
          delete params.gender;
          delete params.sort;
          params.page = 1;
          updateQueryParams(params);
          autoLoadRoomsFromUrl();
        });
      await autoLoadRoomsFromUrl();
    } else if (path === 'room.html') {
      await autoLoadRoomDetail();
    } else if (path === 'host.html') {
      await loadHostProperties();
      await loadHostBookings();

      const createBtn = document.getElementById('createPropertyBtn');
      if (createBtn) {
        createBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          const params = getQueryParams();
          params.create = '1';
          updateQueryParams(params);
          // open inline form
          app.ui.renderPropertyForm();
        });
      }
      // If page loaded with ?create=1 then open form automatically
      const qparams = getQueryParams();
      if (qparams.create === '1' || qparams.create === 'true') {
        // small timeout to ensure DOM ready and host properties loaded
        setTimeout(() => {
          app.ui.renderPropertyForm();
        }, 80);
      }

    } else if (path === 'adminshyam466116.html') {
      await loadAdminPanel();

    } else if (path === 'profile.html') {
      await loadProfilePage();
    } else if (path === 'login.html') {
      const form = document.getElementById('login-form');
      if (form)
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const email = document
            .getElementById('login-email')
            .value.trim();
          const password =
            document.getElementById('login-password').value;
          const errorEl = document.getElementById('login-error');
          if (errorEl) errorEl.textContent = '';
          try {
            await auth.login(email, password);
            ui.showToast('Login successful', 'success');
            updateAuthLinks();
            location.href = 'index.html';
          } catch (err) {
            const msg = err.message || 'Login failed';
            if (errorEl) errorEl.textContent = msg;
            else ui.showToast(msg, 'error');
          }
        });
    } else if (path === 'signup.html') {
      const form = document.getElementById('signup-form');
      if (form)
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const name = document
            .getElementById('signup-name')
            .value.trim();
          const phone = document
            .getElementById('signup-phone')
            .value.trim();
          const email = document
            .getElementById('signup-email')
            .value.trim();
          const password =
            document.getElementById('signup-password').value;
          const errorEl = document.getElementById('signup-error');
          if (errorEl) errorEl.textContent = '';
          try {
            await auth.register({ name, email, password, phone });
            ui.showToast('Account created. Please login.', 'success');
            location.href = 'login.html';
          } catch (err) {
            const msg = err.message || 'Signup failed';
            if (errorEl) errorEl.textContent = msg;
            else ui.showToast(msg, 'error');
          }
        });
    }

    document
      .getElementById('auth-link')
      ?.addEventListener('click', (ev) => {
        const me = auth.getUser();
        if (!me) return; // default link goes to login
        location.href = 'profile.html';
      });
  }

  function updateAuthLinks() {
    const link = document.getElementById('auth-link');
    const me = auth.getUser();
    if (!link) return;
    if (me) {
      link.textContent = me.name
        ? me.name.length > 16
          ? me.name.slice(0, 14) + '..'
          : me.name
        : 'Profile';
      link.href = 'index.html';// add profile.html here to add profile page by clicking 
    } else {
      link.textContent = 'Login';
      link.href = 'login.html';
    }
  }

  return {
    auth,
    api,
    ui,
    init,
    updateAuthLinks
  };
})();





// room booked feature in profile page 
async function loadBookedRooms() {
  const container = document.getElementById("bookedRoomsContainer");
  if (!container) return;

  try {
    const token = localStorage.getItem("access_token");

    const res = await fetch("/api/user/booked-rooms", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const result = await res.json();

    if (!result.success || result.data.length === 0) {
      container.innerHTML =
        "<p class='empty'>You have not booked any rooms yet.</p>";
      return;
    }

    container.innerHTML = "";

    result.data.forEach((room) => {
      const div = document.createElement("div");
      div.className = "booked-room-card";

      div.innerHTML = `
        <h3>${room.title}</h3>
        <p><strong>City:</strong> ${room.city}</p>
        <p><strong>From:</strong> ${room.start_date}</p>
        <p><strong>To:</strong> ${room.end_date}</p>
        <p><strong>Status:</strong> ${room.status}</p>
      `;

      container.appendChild(div);
    });
  } catch (err) {
    container.innerHTML =
      "<p class='error'>Failed to load booked rooms.</p>";
  }
}

document.addEventListener("DOMContentLoaded", loadBookedRooms);



// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  app
    .init()
    .catch((err) => {
      if (typeof app !== 'undefined' && app.ui) {
        app.ui.showToast(
          'Init error: ' + (err.message || err),
          'error'
        );
      }
      if (DEBUG) console.error('app init error', err);
    });
});


document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'logoutBtn') {
    e.preventDefault();
    app.auth.logout();
  }
});
