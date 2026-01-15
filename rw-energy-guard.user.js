// ==UserScript==
// @name         RW Energy Guard
// @namespace    eaglewing.rw.energy.guard
// @version      0.3.1
// @description  Prevents accidental gym training and protects stacked energy when a Ranked War is pending.
// @author       Eaglewing [571041]
// @match        https://www.torn.com/gym.php*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_notification
// @connect      api.torn.com
// @downloadURL  https://raw.githubusercontent.com/Eaglewing91/rw-energy-guard/main/rw-energy-guard.user.js
// @updateURL    https://raw.githubusercontent.com/Eaglewing91/rw-energy-guard/main/rw-energy-guard.user.js
// ==/UserScript==


(function () {
  'use strict';

  /* ----------------- SETTINGS ----------------- */
  const API_USER = 'https://api.torn.com/user/';
  const API_FACTION = 'https://api.torn.com/faction/';
  const FETCH_TIMEOUT_MS = 10000;

  const API_KEY_STORE = 'rw_energy_guard_api_key_v1';

  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const SUPPRESS_MS = 30 * 60 * 1000; // 30 minutes
  const SUPPRESS_KEY = 'rw_energy_guard_suppress_until_v1';

  const SCHEDULE_WINDOW_DAYS = 14;

  // Matches: <button type="button" class="torn-btn" aria-label="Train speed">TRAIN</button>
  const TRAIN_BTN_SELECTOR = 'button.torn-btn[type="button"][aria-label^="Train "]';

  let bypassOnce = false;
  let modalOpen = false;

  /* ----------------- STYLES ----------------- */
  GM_addStyle(`
    #rwEG_overlay {
      position: fixed; inset: 0; z-index: 1000000;
      background: rgba(0,0,0,.66);
      display: flex; align-items: center; justify-content: center;
    }
    #rwEG_modal {
      width: min(540px, 92vw);
      background: #0b0d0f;
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 14px;
      box-shadow: 0 18px 60px rgba(0,0,0,.75);
      color: #eafff1;
      font-family: Arial, sans-serif;
      padding: 16px 16px 14px;
    }
    #rwEG_modal h3 {
      margin: 0 0 10px;
      font-size: 16px;
      letter-spacing: .2px;
    }
    #rwEG_modal .line {
      font-size: 13px;
      line-height: 1.35;
      color: #d5ffe6;
      margin: 6px 0;
    }
    #rwEG_modal .warn {
      margin-top: 10px;
      font-size: 12px;
      color: #ffd28a;
      opacity: .95;
    }
    #rwEG_modal .actions {
      display: flex; gap: 10px; justify-content: flex-end;
      margin-top: 14px;
      flex-wrap: wrap;
    }
    #rwEG_modal button {
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,.10);
      background: rgba(40,55,45,.18);
      color: #eafff1;
      padding: 10px 12px;
      cursor: pointer;
      font-weight: 800;
      font-size: 13px;
    }
    #rwEG_modal button.danger {
      background: linear-gradient(180deg, rgba(160,0,0,.92), rgba(120,0,0,.85));
      border-color: rgba(255,70,70,.45);
    }
    #rwEG_modal button:hover { filter: brightness(1.06); }
    #rwEG_modal .footer {
      display:flex; align-items:center; justify-content: space-between;
      margin-top: 10px; gap: 12px; flex-wrap: wrap;
    }
    #rwEG_modal label {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 12px; color: #c7ffe0;
      user-select: none;
    }

    .rwEG_blocked {
      opacity: .55 !important;
      filter: grayscale(25%);
    }
  `);

  /* ----------------- MENU ----------------- */
  GM_registerMenuCommand('RW Energy Guard: Set API key', setApiKey);
  GM_registerMenuCommand('RW Energy Guard: Clear API key', clearApiKey);
  GM_registerMenuCommand('RW Energy Guard: Reset “Don’t ask again”', resetSuppress);

  async function setApiKey() {
    const current = (await GM_getValue(API_KEY_STORE, '')) || '';
    const k = prompt('RW Energy Guard: Enter your Torn API key (stored locally in Tampermonkey).', current);
    if (k === null) return;
    const t = k.trim();
    if (!t) return alert('Empty key — not saved.');
    await GM_setValue(API_KEY_STORE, t);
    GM_notification?.('API key saved (local)', 'RW Energy Guard');
    location.reload();
  }

  async function clearApiKey() {
    if (!confirm('RW Energy Guard: Clear stored API key?')) return;
    await GM_setValue(API_KEY_STORE, '');
    GM_notification?.('API key cleared', 'RW Energy Guard');
    location.reload();
  }

  async function resetSuppress() {
    await GM_setValue(SUPPRESS_KEY, 0);
    GM_notification?.('Confirmation will show again (if applicable).', 'RW Energy Guard');
  }

  /* ----------------- HELPERS ----------------- */
  function fetchWithTimeout(resource, options = {}) {
    const { timeout = FETCH_TIMEOUT_MS } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    return fetch(resource, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
  }

  async function ensureApiKey() {
    const stored = await GM_getValue(API_KEY_STORE, '');
    if (stored && stored.trim()) return stored.trim();

    const k = prompt('RW Energy Guard: Enter your Torn API key to enable Ranked War detection.\n(It will be stored locally.)');
    if (!k || !k.trim()) return null;
    await GM_setValue(API_KEY_STORE, k.trim());
    return k.trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[m]));
  }

  function extractFactionIdFromUserJson(json) {
    if (!json || typeof json !== 'object') return null;
    if (json.faction_id) return json.faction_id;
    if (json.faction && typeof json.faction === 'object' && (json.faction.id || json.faction.faction_id)) {
      return json.faction.id || json.faction.faction_id;
    }
    if (json.profile && json.profile.faction_id) return json.profile.faction_id;
    if (json.basic && json.basic.faction_id) return json.basic.faction_id;
    return null;
  }

  function parseTs(v) {
    if (v == null) return null;
    if (typeof v === 'number' && v > 100000000) return Math.floor(v);
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^\d{9,12}$/.test(s)) return parseInt(s.slice(0, 10), 10);
      const p = Date.parse(s);
      if (!Number.isNaN(p)) return Math.floor(p / 1000);
    }
    return null;
  }

  function getWarTimes(info) {
    if (!info || typeof info !== 'object') return { startTs: null, endTs: null };
    const sF = ['start', 'start_time', 'start_timestamp', 'start_date', 'startDate', 'starts_at', 'begin', 'begin_time', 'begin_timestamp', 'startTime'];
    const eF = ['end', 'end_time', 'end_timestamp', 'end_date', 'endDate', 'ends_at', 'finish', 'finish_time', 'finish_timestamp', 'endTime'];

    let st = null;
    let et = null;

    for (const f of sF) {
      if (Object.prototype.hasOwnProperty.call(info, f)) {
        const p = parseTs(info[f]);
        if (p) { st = p; break; }
      }
    }
    for (const f of eF) {
      if (Object.prototype.hasOwnProperty.call(info, f)) {
        const p = parseTs(info[f]);
        if (p) { et = p; break; }
      }
    }
    return { startTs: st, endTs: et };
  }

  function extractOpponentName(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (const k of Object.keys(obj)) {
      const lk = k.toLowerCase();
      if (/(opponent|opponent_faction|opponent_name|faction_name|enemy)/.test(lk)) {
        const v = obj[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (typeof v === 'object' && v) {
          if (v.faction_name) return v.faction_name;
          if (v.name) return v.name;
        }
      }
    }
    return null;
  }

  function collectWarObjects(root) {
    const res = [];
    function find(node) {
      if (!node || typeof node !== 'object') return;
      const keys = Object.keys(node);
      const low = keys.map((k) => k.toLowerCase());
      const hasTime = low.some((k) => /(start|end|time|timestamp|date)/.test(k));
      const hasStatus = low.some((k) => /(status|state|active|scheduled|match)/.test(k));
      const hasOpponent = low.some((k) => /(opponent|faction_name|enemy)/.test(k));

      if (hasTime || hasStatus || hasOpponent) res.push(node);

      for (const k of keys) {
        const v = node[k];
        if (v && typeof v === 'object') find(v);
      }
    }
    find(root);
    return res;
  }

  function looksPending(obj) {
    const status = (obj?.status || obj?.state || obj?.match_status || obj?.war_status);
    if (status != null) {
      const v = String(status).toLowerCase();
      if (/scheduled|pending|upcoming|planned|ready|not_started/.test(v)) return true;
      if (/active|running|ongoing|in_progress|started|live|current/.test(v)) return false;
    }
    return false;
  }

  function formatDateTimeFromUnix(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} ${hh}:${mm}`;
  }

  async function isSuppressed() {
    const until = Number(await GM_getValue(SUPPRESS_KEY, 0)) || 0;
    return Date.now() < until;
  }

  /* ----------------- HARD BLOCK ----------------- */
  function getTrainButtons() {
    return Array.from(document.querySelectorAll(TRAIN_BTN_SELECTOR));
  }

  function setTrainButtonsBlocked(blocked) {
    const btns = getTrainButtons();
    for (const btn of btns) {
      if (blocked) {
        btn.dataset.rwEgBlocked = '1';
        btn.style.pointerEvents = 'none';
        btn.classList.add('rwEG_blocked');
      } else {
        btn.dataset.rwEgBlocked = '';
        btn.style.pointerEvents = '';
        btn.classList.remove('rwEG_blocked');
      }
    }
  }

  function safeUnblock() {
    modalOpen = false;
    setTrainButtonsBlocked(false);
  }

  /* ----------------- RANKED WAR STATE (cached) ----------------- */
  const rwCache = { ts: 0, data: null };

  async function fetchRWState(apiKey) {
    const nowMs = Date.now();
    if (rwCache.data && (nowMs - rwCache.ts) < CACHE_TTL_MS) return rwCache.data;

    // user -> faction_id
    const uUrl = `${API_USER}?selections=basic,profile&key=${encodeURIComponent(apiKey)}&format=json`;
    const uResp = await fetchWithTimeout(uUrl, { timeout: FETCH_TIMEOUT_MS });
    if (!uResp.ok) {
      const data = { ok: false, reason: `User API HTTP ${uResp.status}` };
      rwCache.ts = nowMs; rwCache.data = data;
      return data;
    }

    const uJson = await uResp.json();
    const factionId = extractFactionIdFromUserJson(uJson);

    if (!factionId) {
      const data = { ok: true, factionId: null, pending: false, startTs: null, opponent: null };
      rwCache.ts = nowMs; rwCache.data = data;
      return data;
    }

    // faction -> ranked wars
    const fUrl = `${API_FACTION}${encodeURIComponent(factionId)}?selections=rankedwars&key=${encodeURIComponent(apiKey)}&format=json`;
    const fResp = await fetchWithTimeout(fUrl, { timeout: FETCH_TIMEOUT_MS });
    if (!fResp.ok) {
      const data = { ok: false, factionId, reason: `Faction API HTTP ${fResp.status}` };
      rwCache.ts = nowMs; rwCache.data = data;
      return data;
    }

    const fJson = await fResp.json();

    const containers = [];
    if (fJson.rankedwars) containers.push(fJson.rankedwars);
    if (fJson.ranked_wars) containers.push(fJson.ranked_wars);
    if (fJson.rankedWars) containers.push(fJson.rankedWars);
    containers.push(fJson);

    const candidates = [];
    for (const c of containers) candidates.push(...collectWarObjects(c));

    // Find the nearest future pending war within window
    const now = Math.floor(Date.now() / 1000);
    const windowSecs = SCHEDULE_WINDOW_DAYS * 24 * 60 * 60;

    let best = null; // { obj, startTs }
    for (const obj of candidates) {
      const { startTs } = getWarTimes(obj);
      const pendingByStatus = looksPending(obj);

      if (startTs && startTs > now && (startTs - now) <= windowSecs) {
        if (!best || startTs < best.startTs) best = { obj, startTs };
        continue;
      }

      if (!startTs && pendingByStatus) {
        if (!best) best = { obj, startTs: null };
      }
    }

    const opponent = best?.obj ? extractOpponentName(best.obj) : null;

    const data = {
      ok: true,
      factionId,
      pending: !!best,
      startTs: best?.startTs || null,
      opponent: opponent || null,
    };

    rwCache.ts = nowMs;
    rwCache.data = data;
    return data;
  }

  /* ----------------- CONFIRM MODAL ----------------- */
  function removeModal() {
    const old = document.getElementById('rwEG_overlay');
    if (old) old.remove();
    modalOpen = false;
  }

  function showConfirmModal(state, trainLabel, onContinue, onCancel) {
    removeModal();
    modalOpen = true;

    const when = state.startTs ? formatDateTimeFromUnix(state.startTs) : 'Scheduled soon';
    const opp = state.opponent ? `vs ${state.opponent}` : '';

    const overlay = document.createElement('div');
    overlay.id = 'rwEG_overlay';

    const modal = document.createElement('div');
    modal.id = 'rwEG_modal';

    modal.innerHTML = `
      <h3>Confirm gym training</h3>
      <div class="line">You clicked: <b>${escapeHtml(trainLabel || 'TRAIN')}</b></div>
      <div class="line">Your faction has a <b>pending Ranked War</b>.</div>
      <div class="line"><b>Start:</b> ${escapeHtml(when)} ${opp ? `<b>(${escapeHtml(opp)})</b>` : ''}</div>
      <div class="warn">Training is blocked unless you explicitly confirm.</div>

      <div class="footer">
        <label><input type="checkbox" id="rwEG_suppress"> Don’t ask again for 30 minutes</label>
      </div>

      <div class="actions">
        <button id="rwEG_cancel">Cancel</button>
        <button class="danger" id="rwEG_continue">Train anyway</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const doCancel = () => {
      try { onCancel?.(); } catch (_) {}
    };

    const doContinue = async () => {
      try {
        const chk = modal.querySelector('#rwEG_suppress');
        if (chk?.checked) {
          await GM_setValue(SUPPRESS_KEY, Date.now() + SUPPRESS_MS);
        }
      } catch (_) {}
      try { onContinue?.(); } catch (_) {}
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) doCancel();
    });

    modal.querySelector('#rwEG_cancel').addEventListener('click', doCancel);
    modal.querySelector('#rwEG_continue').addEventListener('click', doContinue);

    const escHandler = (e) => {
      if (e.key === 'Escape') {
        window.removeEventListener('keydown', escHandler, true);
        doCancel();
      }
    };
    window.addEventListener('keydown', escHandler, true);
  }

  /* ----------------- INTERCEPT ----------------- */
  function getTrainLabel(btn) {
    const aria = btn.getAttribute('aria-label') || '';
    if (aria.trim()) return aria.trim();
    return (btn.textContent || 'TRAIN').trim();
  }

  function installTrainButtonInterceptor(getState) {
    document.addEventListener('click', async (e) => {
      if (bypassOnce) return;

      const btn = e.target?.closest?.(TRAIN_BTN_SELECTOR);
      if (!btn) return;

      if (modalOpen) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        return;
      }

      if (await isSuppressed()) return;

      const state = await getState();
      if (!state?.ok) return;
      if (!state.pending) return;

      setTrainButtonsBlocked(true);

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      const label = getTrainLabel(btn);

      showConfirmModal(
        state,
        label,
        () => {
          removeModal();
          setTrainButtonsBlocked(false);

          bypassOnce = true;
          try {
            btn.click();
          } finally {
            setTimeout(() => (bypassOnce = false), 150);
          }
        },
        () => {
          removeModal();
          setTrainButtonsBlocked(false);
        }
      );
    }, true);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !modalOpen) {
        setTrainButtonsBlocked(false);
      }
    });
  }

  /* ----------------- MAIN ----------------- */
  async function main() {
    const apiKey = await ensureApiKey();
    if (!apiKey) return;

    async function getState() {
      try {
        return await fetchRWState(apiKey);
      } catch (err) {
        return { ok: false, reason: String(err?.message || err) };
      }
    }

    window.addEventListener('beforeunload', () => safeUnblock());

    installTrainButtonInterceptor(getState);

    getState().catch(() => {});
  }

  main().catch(console.error);

})();
