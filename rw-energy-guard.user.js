// ==UserScript==
// @name         RW Energy Guard
// @namespace    eaglewing.rw.energy.guard
// @version      0.4.0
// @description  Prevents accidental gym training and protects stacked energy when a Ranked War is pending.
// @author       Eaglewing [571041]
// @match        https://www.torn.com/gym.php*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @downloadURL  https://raw.githubusercontent.com/Eaglewing91/rw-energy-guard/main/rw-energy-guard.user.js
// @updateURL    https://raw.githubusercontent.com/Eaglewing91/rw-energy-guard/main/rw-energy-guard.user.js
// @license      MIT
// ==/UserScript==

// Terms of Service
// | Data Storage                 | Data Sharing | Purpose of Use                             | Key Storage & Sharing             | Key Access Level                  |
// |------------------------------|--------------|--------------------------------------------|-----------------------------------|-----------------------------------|
// | No / Only locally (API key,  | Nobody       | Other (mistake prevention: asks for        | Stored locally / Not shared; sent | Public (faction rankedwars,       |
// | faction ID and "don't ask    |              | confirmation before gym training while     | only to api.torn.com              | faction basic)                    |
// | again" time in Tampermonkey; |              | your faction has a pending ranked war)     |                                   |                                   |
// | war status in memory only)   |              |                                            |                                   |                                   |
//
// Network use: only Torn API v2 requests to api.torn.com, sent with the key in
// the Authorization header. War status is fetched in the background (allowed
// for the API); the TRAIN click itself is never repeated or automated. One
// "Train anyway" click causes exactly one click on the TRAIN button you chose.

(function () {
  'use strict';

  /* ----------------- SETTINGS ----------------- */
  const API = 'https://api.torn.com/v2/';
  const REQUEST_TIMEOUT_MS = 10000;
  const REFRESH_MS = 5 * 60 * 1000;          // war status refresh interval
  const SUPPRESS_MS = 30 * 60 * 1000;        // "Don't ask again" duration
  const SCHEDULE_WINDOW_DAYS = 14;           // only wars starting within this window count as pending

  const API_KEY_STORE = 'rw_energy_guard_api_key_v1';
  const SUPPRESS_KEY = 'rw_energy_guard_suppress_until_v1';
  const PROMPTED_KEY = 'rw_energy_guard_key_prompted_v1';
  const FACTION_ID_KEY = 'rw_energy_guard_faction_id_v1';

  // Matches: <button type="button" class="torn-btn" aria-label="Train speed">TRAIN</button>
  const TRAIN_BTN_SELECTOR = 'button.torn-btn[type="button"][aria-label^="Train "]';

  const API_ERRORS = {
    2: 'Incorrect API key.',
    6: 'Faction not found. Join a faction to use the guard.',
    7: 'Your faction\'s ranked wars are not visible to this key.',
    10: 'This key\'s owner is in federal jail.',
    13: 'This key is disabled because its owner has been inactive.',
    16: 'This key\'s access level is too low.',
    18: 'This key is paused.'
  };

  let apiKey = String(GM_getValue(API_KEY_STORE, '') || '').trim();
  let suppressUntil = Number(GM_getValue(SUPPRESS_KEY, 0)) || 0;
  let state = null;          // last war status: { ok, pending, startTs, opponent, reason, at }
  let inFlight = null;       // pending refresh promise
  let bypassOnce = false;    // lets the single confirmed re-click through
  let modalCleanup = null;   // closes the open modal, if any

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
    #rwEG_modal h3 { margin: 0 0 10px; font-size: 16px; letter-spacing: .2px; }
    #rwEG_modal .line { font-size: 13px; line-height: 1.35; color: #d5ffe6; margin: 6px 0; }
    #rwEG_modal .warn { margin-top: 10px; font-size: 12px; color: #ffd28a; opacity: .95; }
    #rwEG_modal .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; flex-wrap: wrap; }
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
    #rwEG_modal .footer { display:flex; align-items:center; justify-content: space-between; margin-top: 10px; gap: 12px; flex-wrap: wrap; }
    #rwEG_modal label { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: #c7ffe0; user-select: none; }
    #rwEG_countdown { font-weight: 900; color: #ff4d4d; font-size: 14px; }
    .rwEG_blocked { opacity: .55 !important; filter: grayscale(25%); }
    #rwEG_toast {
      position: fixed; right: 16px; bottom: 16px; z-index: 1000001;
      max-width: min(360px, 90vw); padding: 10px 12px;
      background: #0b0d0f; color: #ffd28a; border: 1px solid rgba(255,210,138,.35);
      border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.6);
      font: 12px/1.4 Arial, sans-serif;
    }
  `);

  /* ----------------- MENU ----------------- */
  GM_registerMenuCommand('RW Energy Guard: Set API key', setApiKey);
  GM_registerMenuCommand('RW Energy Guard: Clear API key', clearApiKey);
  GM_registerMenuCommand('RW Energy Guard: Reset “Don’t ask again”', resetSuppress);

  function setApiKey() {
    const k = prompt('RW Energy Guard: Enter your Torn API key (a Public key is enough). It is stored locally in Tampermonkey.', apiKey);
    if (k === null) return;
    const t = k.trim();
    if (!/^[A-Za-z0-9]{16}$/.test(t)) return alert('That does not look like a 16-character Torn API key. Not saved.');
    GM_setValue(API_KEY_STORE, t);
    GM_setValue(FACTION_ID_KEY, 0);
    apiKey = t;
    state = null;
    toast('API key saved. Checking ranked war status…');
    refreshState(true);
  }

  function clearApiKey() {
    if (!confirm('RW Energy Guard: Clear stored API key? Gym training will no longer be guarded.')) return;
    GM_setValue(API_KEY_STORE, '');
    GM_setValue(FACTION_ID_KEY, 0);
    apiKey = '';
    state = null;
    toast('API key cleared. Gym training is not being guarded.');
  }

  function resetSuppress() {
    suppressUntil = 0;
    GM_setValue(SUPPRESS_KEY, 0);
    toast('Confirmation will show again when a ranked war is pending.');
  }

  /* ----------------- HELPERS ----------------- */
  function toast(text, ms = 6000) {
    document.getElementById('rwEG_toast')?.remove();
    const el = document.createElement('div');
    el.id = 'rwEG_toast';
    el.setAttribute('role', 'status');
    el.textContent = 'RW Energy Guard: ' + text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // Torn API v2 GET with the key in the Authorization header (never in the URL).
  function api(path, params = {}) {
    const url = new URL(API + path);
    Object.entries({ ...params, comment: 'RWEnergyGuard' }).forEach(([k, v]) => url.searchParams.set(k, v));
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: url.href,
        headers: { Authorization: 'ApiKey ' + apiKey },
        timeout: REQUEST_TIMEOUT_MS,
        onload: (res) => {
          let data = null;
          try { data = JSON.parse(res.responseText); } catch (_) { /* handled below */ }
          if (data?.error) {
            const code = Number(data.error.code);
            return reject(new Error(API_ERRORS[code] || ('API error ' + code + ': ' + (data.error.error || 'request denied'))));
          }
          if (res.status !== 200 || !data) return reject(new Error('Torn API HTTP ' + res.status + '.'));
          resolve(data);
        },
        onerror: () => reject(new Error('Could not reach the Torn API.')),
        ontimeout: () => reject(new Error('The Torn API timed out.'))
      });
    });
  }

  const tct = (ts) => new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' TCT';

  function formatCountdown(seconds) {
    if (seconds <= 0) return 'STARTING NOW';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return (d ? d + 'd ' : '') + `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }

  // The faction list on a war may be an array or an object keyed by faction ID.
  function warFactions(war) {
    const f = war?.factions;
    if (Array.isArray(f)) return f;
    if (f && typeof f === 'object') return Object.entries(f).map(([id, v]) => ({ id: Number(v?.id ?? id), ...v }));
    return [];
  }

  async function ownFactionId() {
    const saved = Number(GM_getValue(FACTION_ID_KEY, 0));
    if (Number.isSafeInteger(saved) && saved > 0) return saved;
    const data = await api('faction/basic');
    const id = Number(data?.basic?.id);
    if (Number.isSafeInteger(id) && id > 0) GM_setValue(FACTION_ID_KEY, id);
    return id > 0 ? id : null;
  }

  /* ----------------- RANKED WAR STATUS ----------------- */
  async function loadState() {
    const data = await api('faction/rankedwars', { sort: 'DESC' });
    if (!Array.isArray(data?.rankedwars)) throw new Error('Torn did not return a ranked wars list.');
    const now = Math.floor(Date.now() / 1000);
    const windowSecs = SCHEDULE_WINDOW_DAYS * 86400;
    const pending = data.rankedwars
      .filter(war => !Number(war?.end) && Number(war?.start) > now && Number(war.start) - now <= windowSecs)
      .sort((a, b) => Number(a.start) - Number(b.start))[0];
    if (!pending) return { ok: true, pending: false, startTs: null, opponent: null, at: Date.now() };

    // Opponent name is cosmetic: any failure here leaves it blank.
    let opponent = null;
    try {
      const factions = warFactions(pending);
      const mine = await ownFactionId();
      const other = factions.find(f => mine && Number(f?.id) !== mine);
      if (other?.name) opponent = String(other.name);
    } catch (_) { /* ignore */ }
    return { ok: true, pending: true, startTs: Number(pending.start), opponent, at: Date.now() };
  }

  function refreshState(announceErrors = false) {
    if (!apiKey) return Promise.resolve(null);
    if (inFlight) return inFlight;
    inFlight = loadState()
      .catch(error => ({ ok: false, reason: String(error?.message || error), at: Date.now() }))
      .then(result => {
        const wasOk = state?.ok;
        state = result;
        if (!result.ok && (announceErrors || wasOk !== false)) {
          toast('Could not check ranked wars (' + result.reason + ') Training is not being guarded.', 9000);
        }
        return result;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  /* ----------------- HARD BLOCK ----------------- */
  function setTrainButtonsBlocked(blocked) {
    for (const btn of document.querySelectorAll(TRAIN_BTN_SELECTOR)) {
      btn.dataset.rwEgBlocked = blocked ? '1' : '';
      btn.style.pointerEvents = blocked ? 'none' : '';
      btn.classList.toggle('rwEG_blocked', blocked);
    }
  }

  function blockEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  /* ----------------- CONFIRM MODAL ----------------- */
  function showConfirmModal(info, trainLabel, onContinue) {
    modalCleanup?.();

    const overlay = document.createElement('div');
    overlay.id = 'rwEG_overlay';
    const modal = document.createElement('div');
    modal.id = 'rwEG_modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const h3 = document.createElement('h3');
    h3.textContent = 'Confirm gym training';
    const clicked = document.createElement('div');
    clicked.className = 'line';
    clicked.append('You clicked: ', Object.assign(document.createElement('b'), { textContent: trainLabel || 'TRAIN' }));
    const pendingLine = document.createElement('div');
    pendingLine.className = 'line';
    pendingLine.append('Your faction has a ', Object.assign(document.createElement('b'), { textContent: 'pending Ranked War' }),
      info.opponent ? ' vs ' : '.', ...(info.opponent ? [Object.assign(document.createElement('b'), { textContent: info.opponent }), '.'] : []));
    const startLine = document.createElement('div');
    startLine.className = 'line';
    const countdown = Object.assign(document.createElement('span'), { id: 'rwEG_countdown' });
    startLine.append(Object.assign(document.createElement('b'), { textContent: 'Starts in: ' }), countdown,
      info.startTs ? ' (' + tct(info.startTs) + ')' : '');
    const warn = Object.assign(document.createElement('div'), { className: 'warn', textContent: 'Training is blocked unless you explicitly confirm.' });
    const footer = document.createElement('div');
    footer.className = 'footer';
    const label = document.createElement('label');
    const suppress = Object.assign(document.createElement('input'), { type: 'checkbox', id: 'rwEG_suppress' });
    label.append(suppress, ' Don’t ask again for 30 minutes');
    footer.append(label);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const cancelBtn = Object.assign(document.createElement('button'), { type: 'button', id: 'rwEG_cancel', textContent: 'Cancel' });
    const continueBtn = Object.assign(document.createElement('button'), { type: 'button', id: 'rwEG_continue', className: 'danger', textContent: 'Train anyway' });
    actions.append(cancelBtn, continueBtn);
    modal.append(h3, clicked, pendingLine, startLine, warn, footer, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Local countdown only; no API calls.
    const tick = () => { countdown.textContent = info.startTs ? formatCountdown(info.startTs - Math.floor(Date.now() / 1000)) : 'soon'; };
    tick();
    const timer = setInterval(tick, 1000);

    const escHandler = (e) => { if (e.key === 'Escape') { blockEvent(e); close(); } };
    function close() {
      clearInterval(timer);
      window.removeEventListener('keydown', escHandler, true);
      overlay.remove();
      setTrainButtonsBlocked(false);
      modalCleanup = null;
    }
    modalCleanup = close;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    cancelBtn.addEventListener('click', close);
    continueBtn.addEventListener('click', () => {
      if (suppress.checked) {
        suppressUntil = Date.now() + SUPPRESS_MS;
        GM_setValue(SUPPRESS_KEY, suppressUntil);
      }
      close();
      onContinue();
    });
    window.addEventListener('keydown', escHandler, true);
    cancelBtn.focus();
  }

  /* ----------------- INTERCEPT TRAIN CLICKS ----------------- */
  // Decides synchronously. Any `await` before blocking would let Torn's own
  // click handler run first and spend the energy.
  function onClick(e) {
    if (bypassOnce) return;
    const btn = e.target?.closest?.(TRAIN_BTN_SELECTOR);
    if (!btn) return;

    if (modalCleanup) { blockEvent(e); return; }
    if (!apiKey || Date.now() < suppressUntil) return;

    if (!state) {
      // Status not known yet: hold this click rather than risk spending energy.
      blockEvent(e);
      toast('Checking ranked war status… click TRAIN again in a moment.', 4000);
      refreshState();
      return;
    }
    if (Date.now() - state.at > REFRESH_MS) refreshState();   // background refresh; uses the last known status now
    if (!state.ok || !state.pending) return;

    blockEvent(e);
    setTrainButtonsBlocked(true);
    const label = (btn.getAttribute('aria-label') || btn.textContent || 'TRAIN').trim();
    showConfirmModal(state, label, () => {
      // One confirmed click → exactly one click on the chosen TRAIN button.
      bypassOnce = true;
      try { btn.click(); } finally { bypassOnce = false; }
    });
  }

  /* ----------------- MAIN ----------------- */
  function main() {
    document.addEventListener('click', onClick, true);
    window.addEventListener('pagehide', () => modalCleanup?.());

    // Background API refreshes do nothing until a key is set.
    setInterval(() => { if (document.visibilityState === 'visible') refreshState(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!modalCleanup) setTrainButtonsBlocked(false);
      if (!state || Date.now() - state.at > REFRESH_MS) refreshState();
    });

    if (apiKey) {
      refreshState();
    } else if (!GM_getValue(PROMPTED_KEY, false)) {
      // Ask once; after that the menu command is the way to add a key.
      GM_setValue(PROMPTED_KEY, true);
      setApiKey();
    } else {
      toast('No API key set, so training is not guarded. Use the Tampermonkey menu → Set API key.', 8000);
    }
  }

  main();
})();
