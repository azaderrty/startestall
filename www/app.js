/* StarTestAll - UI logic (vanilla JS, no ESM imports) */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const P = (window.Capacitor && window.Capacitor.Plugins) || {};
  const Wifi = P.Wifi || null;
  const NetStore = P.NetStore || null;
  const Share = P.Share || null;
  const Preferences = P.Preferences || null;

  const CF_DOWN = 'https://speed.cloudflare.com/__down';
  const CF_UP = 'https://speed.cloudflare.com/__up';
  const HISTORY_KEY = 'sta_runs';
  const NETS_KEY = 'sta_networks';

  const state = {
    networks: [],
    scan: [],
    runs: [],
    running: false,
    cancelRequested: false,
    editingId: null,
    weather: ''
  };

  // ------------------------------------------------------------------ utils

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function round(value, digits) {
    if (value === null || value === undefined || isNaN(value)) return null;
    const factor = Math.pow(10, digits === undefined ? 1 : digits);
    return Math.round(value * factor) / factor;
  }

  function fmt(value, unit) {
    if (value === null || value === undefined || value === '--') return '--';
    return value + (unit ? ' ' + unit : '');
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label || 'timeout')), ms))
    ]);
  }

  function headerValue(res, name) {
    try {
      if (res.headers && typeof res.headers.get === 'function') return res.headers.get(name);
      if (res.headers) return res.headers[name] || res.headers[name.toLowerCase()] || null;
    } catch (e) { /* ignore */ }
    return null;
  }

  // ------------------------------------------------------------- persistence

  async function loadNetworks() {
    if (NetStore) {
      try {
        const res = await NetStore.list();
        state.networks = (res && res.networks) || [];
        return;
      } catch (e) { /* fallback below */ }
    }
    try {
      state.networks = JSON.parse(localStorage.getItem(NETS_KEY) || '[]');
    } catch (e) {
      state.networks = [];
    }
  }

  async function persistNetworks() {
    if (NetStore) return;
    try {
      localStorage.setItem(NETS_KEY, JSON.stringify(state.networks));
    } catch (e) { /* ignore */ }
  }

  async function saveNetwork(entry) {
    if (NetStore) {
      await NetStore.save(entry);
      return;
    }
    const index = state.networks.findIndex((n) => n.id === entry.id);
    if (index >= 0) state.networks[index] = entry;
    else state.networks.push(entry);
    await persistNetworks();
  }

  async function deleteNetwork(id) {
    if (NetStore) {
      await NetStore.remove({ id: id });
    } else {
      state.networks = state.networks.filter((n) => n.id !== id);
      await persistNetworks();
    }
  }

  async function setNetworkEnabled(id, enabled) {
    if (NetStore) {
      await NetStore.setEnabled({ id: id, enabled: enabled });
      return;
    }
    const item = state.networks.find((n) => n.id === id);
    if (item) item.enabled = enabled;
    await persistNetworks();
  }

  async function reorderNetworks(ids) {
    if (NetStore) {
      await NetStore.reorder({ ids: ids });
      return;
    }
    const map = new Map(state.networks.map((n) => [n.id, n]));
    state.networks = ids.map((id) => map.get(id)).filter(Boolean);
    await persistNetworks();
  }

  async function loadRuns() {
    if (Preferences) {
      try {
        const res = await Preferences.get({ key: HISTORY_KEY });
        state.runs = res && res.value ? JSON.parse(res.value) : [];
        return;
      } catch (e) { /* fallback below */ }
    }
    try {
      state.runs = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch (e) {
      state.runs = [];
    }
  }

  async function saveRuns() {
    const value = JSON.stringify(state.runs);
    if (Preferences) {
      try {
        await Preferences.set({ key: HISTORY_KEY, value: value });
        return;
      } catch (e) { /* fallback below */ }
    }
    try {
      localStorage.setItem(HISTORY_KEY, value);
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------- theme

  function initTheme() {
    let theme = 'dark';
    try { theme = localStorage.getItem('sta_theme') || 'dark'; } catch (e) { /* ignore */ }
    if (theme === 'light') document.body.classList.add('light');
    $('themeToggle').textContent = theme === 'light' ? '☀️' : '🌙';
    $('themeToggle').onclick = () => {
      document.body.classList.toggle('light');
      const next = document.body.classList.contains('light') ? 'light' : 'dark';
      try { localStorage.setItem('sta_theme', next); } catch (e) { /* ignore */ }
      $('themeToggle').textContent = next === 'light' ? '☀️' : '🌙';
    };
  }

  // ------------------------------------------------------------------- tabs

  function initTabs() {
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = $('panel-' + btn.dataset.tab);
        if (panel) panel.classList.add('active');
        if (btn.dataset.tab === 'log') renderLog();
      };
    });
  }

  // ----------------------------------------------------------- shizuku state

  async function refreshStatus() {
    if (!Wifi) {
      $('shizukuInstalled').textContent = 'плагін недоступний';
      $('shizukuRunning').textContent = '--';
      $('shizukuPerm').textContent = '--';
      $('curNet').textContent = '--';
      $('curSignal').textContent = '--';
      return;
    }
    try {
      const st = await Wifi.status();
      $('shizukuInstalled').textContent = st.shizukuInstalled ? 'так' : 'ні';
      $('shizukuRunning').textContent = st.shizukuRunning ? 'так' : 'ні';
      $('shizukuPerm').textContent = st.shizukuPermission ? 'надано' : 'ні';
      $('curNet').textContent = st.ssid || 'не підключено';
      $('curSignal').textContent = st.connected
        ? `${st.rssi} dBm · ${st.linkSpeed} Mbps · ${st.ip || 'без IP'}`
        : '--';
    } catch (e) {
      $('shizukuRunning').textContent = 'помилка';
    }
  }

  // ---------------------------------------------------------- networks tab

  function renderScan() {
    const list = $('scanList');
    list.innerHTML = '';
    if (!state.scan.length) {
      list.innerHTML = '<div class="empty">Нічого не знайдено</div>';
      return;
    }
    state.scan.slice().sort((a, b) => b.rssi - a.rssi).forEach((entry) => {
      const li = document.createElement('li');
      const known = state.networks.find((n) => n.ssid === entry.ssid);
      li.innerHTML =
        `<div class="net-row">
           <div>
             <div class="net-name">${esc(entry.ssid)}</div>
             <div class="net-sub">${esc(entry.security.toUpperCase())} · ${esc(entry.frequency)} МГц</div>
           </div>
           <div style="text-align:right">
             <div class="signal">${entry.rssi} dBm</div>
             ${known ? '<span class="badge on">додано</span>' : ''}
           </div>
         </div>
         <div class="net-actions">
           <button type="button" data-add="${esc(entry.ssid)}" data-security="${esc(entry.security)}">${known ? 'Змінити' : 'Додати'}</button>
         </div>`;
      list.appendChild(li);
    });
    list.querySelectorAll('button[data-add]').forEach((btn) => {
      btn.onclick = () => openModal(btn.dataset.add, btn.dataset.security);
    });
  }

  function renderAuthorized() {
    const list = $('authList');
    list.innerHTML = '';
    if (!state.networks.length) {
      list.innerHTML = '<div class="empty">Список порожній</div>';
      return;
    }
    state.networks.forEach((net, index) => {
      const li = document.createElement('li');
      li.innerHTML =
        `<div class="net-row">
           <div>
             <div class="net-name">${esc(net.label)}</div>
             <div class="net-sub">${esc(net.ssid)} · ${esc((net.security || 'wpa2').toUpperCase())}</div>
           </div>
           <span class="badge ${net.enabled ? 'on' : 'off'}">${net.enabled ? 'увімк' : 'вимк'}</span>
         </div>
         <div class="net-actions">
           <button type="button" data-act="toggle" data-id="${esc(net.id)}">${net.enabled ? 'Вимкнути' : 'Увімкнути'}</button>
           <button type="button" data-act="edit" data-id="${esc(net.id)}">Редагувати</button>
           <button type="button" data-act="up" data-id="${esc(net.id)}" ${index === 0 ? 'disabled' : ''}>↑</button>
           <button type="button" data-act="down" data-id="${esc(net.id)}" ${index === state.networks.length - 1 ? 'disabled' : ''}>↓</button>
           <button type="button" data-act="del" data-id="${esc(net.id)}">Видалити</button>
         </div>`;
      list.appendChild(li);
    });

    list.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const index = state.networks.findIndex((n) => n.id === id);
        if (index < 0) return;
        const net = state.networks[index];
        switch (btn.dataset.act) {
          case 'toggle':
            await setNetworkEnabled(id, !net.enabled);
            break;
          case 'edit':
            openModal(net.ssid, net.security, net);
            return;
          case 'up':
            if (index > 0) {
              const ids = state.networks.map((n) => n.id);
              const tmp = ids[index - 1];
              ids[index - 1] = ids[index];
              ids[index] = tmp;
              await reorderNetworks(ids);
            }
            break;
          case 'down':
            if (index < state.networks.length - 1) {
              const ids = state.networks.map((n) => n.id);
              const tmp = ids[index + 1];
              ids[index + 1] = ids[index];
              ids[index] = tmp;
              await reorderNetworks(ids);
            }
            break;
          case 'del':
            if (!confirm('Видалити «' + net.label + '»?')) return;
            await deleteNetwork(id);
            break;
          default:
            break;
        }
        await loadNetworks();
        renderAuthorized();
      };
    });
  }

  function openModal(ssid, security, existing) {
    state.editingId = existing ? existing.id : null;
    $('modalTitle').textContent = existing ? 'Редагувати мережу' : 'Додати мережу';
    $('fLabel').value = existing ? existing.label : suggestLabel(ssid);
    $('fSsid').value = ssid || '';
    $('fSecurity').value = security || 'wpa2';
    $('fPassword').value = existing ? existing.password : '';
    $('netModal').hidden = false;
  }

  function suggestLabel(ssid) {
    if (!ssid) return '';
    const match = String(ssid).match(/(\d+)\s*$/);
    return match ? 'Starlink ' + match[1] : ssid;
  }

  function closeModal() {
    $('netModal').hidden = true;
    state.editingId = null;
  }

  async function saveModal() {
    const ssid = $('fSsid').value.trim();
    if (!ssid) {
      alert('Вкажіть SSID');
      return;
    }
    const entry = {
      id: state.editingId || (Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
      label: $('fLabel').value.trim() || ssid,
      ssid: ssid,
      security: $('fSecurity').value,
      password: $('fPassword').value,
      enabled: true
    };
    const existing = state.networks.find((n) => n.id === entry.id);
    if (existing) entry.enabled = existing.enabled;
    await saveNetwork(entry);
    await loadNetworks();
    renderAuthorized();
    closeModal();
  }

  async function doScan() {
    if (!Wifi) {
      $('scanStatus').textContent = 'Нативний плагін недоступний';
      return;
    }
    $('scanStatus').textContent = 'Сканування...';
    try {
      const res = await Wifi.scan();
      if (res.needPermission) {
        $('scanStatus').textContent = 'Потрібен дозвіл на доступ до Wi-Fi';
        return;
      }
      state.scan = res.results || [];
      $('scanStatus').textContent = state.scan.length
        ? `Знайдено мереж: ${state.scan.length}`
        : 'Нічого не знайдено (увімкніть геолокацію або зачекайте)';
      renderScan();
    } catch (e) {
      $('scanStatus').textContent = 'Помилка сканування: ' + (e.message || e);
    }
  }

  // ------------------------------------------------------------- run tab

  function initWeather() {
    document.querySelectorAll('#weatherChips .chip').forEach((chip) => {
      chip.onclick = () => {
        document.querySelectorAll('#weatherChips .chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        state.weather = chip.dataset.w;
        $('weatherNote').value = chip.dataset.w;
      };
    });
    $('weatherNote').oninput = (e) => {
      state.weather = e.target.value.trim();
      document.querySelectorAll('#weatherChips .chip').forEach((c) =>
        c.classList.toggle('active', c.dataset.w === state.weather));
    };
  }

  function makeRunCard(title, subtitle) {
    const card = document.createElement('div');
    card.className = 'run-card';
    card.innerHTML =
      `<h4><span>${esc(title)}</span><span class="badge" data-role="state">очікує</span></h4>
       <div class="run-sub" style="color:var(--muted);font-size:.78rem">${esc(subtitle || '')}</div>
       <div class="run-grid">
         <div class="run-metric"><span class="label">Download</span><span class="value" data-role="down">--</span></div>
         <div class="run-metric"><span class="label">Upload</span><span class="value" data-role="up">--</span></div>
         <div class="run-metric"><span class="label">Ping</span><span class="value" data-role="ping">--</span></div>
         <div class="run-metric"><span class="label">Jitter</span><span class="value" data-role="jitter">--</span></div>
         <div class="run-metric"><span class="label">Loss</span><span class="value" data-role="loss">--</span></div>
         <div class="run-metric"><span class="label">RSSI</span><span class="value" data-role="rssi">--</span></div>
       </div>
       <div class="run-state" data-role="msg">--</div>`;
    $('runResults').appendChild(card);
    return {
      el: card,
      state: card.querySelector('[data-role="state"]'),
      msg: card.querySelector('[data-role="msg"]'),
      down: card.querySelector('[data-role="down"]'),
      up: card.querySelector('[data-role="up"]'),
      ping: card.querySelector('[data-role="ping"]'),
      jitter: card.querySelector('[data-role="jitter"]'),
      loss: card.querySelector('[data-role="loss"]'),
      rssi: card.querySelector('[data-role="rssi"]')
    };
  }

  function setCardState(card, text, kind) {
    card.state.textContent = text;
    card.state.className = 'badge' + (kind ? ' ' + kind : '');
    card.msg.className = 'run-state' + (kind === 'error' ? ' error' : kind === 'done' ? ' done' : '');
  }

  async function fetchMeta() {
    const meta = { ip: '--', isp: '--', colo: '--' };
    try {
      const res = await withTimeout(fetch(CF_DOWN + '?bytes=1', { cache: 'no-store' }), 8000);
      meta.ip = headerValue(res, 'cf-meta-ip') || '--';
      meta.isp = headerValue(res, 'cf-meta-asn') || '--';
      meta.colo = headerValue(res, 'cf-meta-colo') || '--';
    } catch (e) { /* ignore */ }
    return meta;
  }

  async function measure(sizeMb, card, onStep) {
    const result = {
      ping: null, jitter: null, loss: null, down: null, up: null,
      ip: '--', isp: '--', colo: '--'
    };

    const meta = await fetchMeta();
    result.ip = meta.ip;
    result.isp = meta.isp;
    result.colo = meta.colo;

    // ---- ping / jitter / loss
    const pings = [];
    let lost = 0;
    for (let i = 0; i < 8; i++) {
      if (state.cancelRequested) throw new Error('cancelled');
      const t0 = performance.now();
      try {
        await withTimeout(fetch(CF_DOWN + '?bytes=1&nocache=' + Date.now(), { cache: 'no-store' }), 5000);
        pings.push(performance.now() - t0);
      } catch (e) {
        lost++;
      }
      if (card) card.ping.textContent = pings.length ? fmt(round(pings[pings.length - 1]), 'ms') : '--';
      if (onStep) onStep('ping', i + 1, 8);
      await sleep(120);
    }
    if (pings.length) {
      const sorted = pings.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
      const variance = sorted.reduce((s, x) => s + (x - mean) * (x - mean), 0) / sorted.length;
      result.ping = round(median);
      result.jitter = round(Math.sqrt(variance));
    }
    result.loss = round((lost / 8) * 100, 1);
    if (card) {
      card.ping.textContent = fmt(result.ping, 'ms');
      card.jitter.textContent = fmt(result.jitter, 'ms');
      card.loss.textContent = fmt(result.loss, '%');
    }

    // ---- download
    const dlChunks = 4;
    const dlChunkBytes = Math.round((sizeMb * 1024 * 1024) / dlChunks);
    const dlSpeeds = [];
    for (let i = 0; i < dlChunks; i++) {
      if (state.cancelRequested) throw new Error('cancelled');
      const t0 = performance.now();
      try {
        await withTimeout(fetch(CF_DOWN + '?bytes=' + dlChunkBytes + '&nocache=' + Date.now(), { cache: 'no-store' }), 120000);
        const seconds = (performance.now() - t0) / 1000;
        if (seconds > 0) dlSpeeds.push((dlChunkBytes * 8) / seconds / 1000000);
      } catch (e) { /* chunk failed */ }
      if (card) card.down.textContent = dlSpeeds.length ? fmt(round(dlSpeeds[dlSpeeds.length - 1]), 'Mbps') : '--';
      if (onStep) onStep('download', i + 1, dlChunks);
    }
    if (dlSpeeds.length) {
      const sorted = dlSpeeds.slice().sort((a, b) => a - b);
      result.down = round(sorted[Math.floor(sorted.length / 2)]);
    }
    if (card) card.down.textContent = fmt(result.down, 'Mbps');

    // ---- upload
    const upTotal = Math.max(3, Math.round(sizeMb * 0.4));
    const upChunks = 3;
    const upChunkBytes = Math.round((upTotal * 1024 * 1024) / upChunks);
    const upSpeeds = [];
    for (let i = 0; i < upChunks; i++) {
      if (state.cancelRequested) throw new Error('cancelled');
      const body = 'A'.repeat(upChunkBytes);
      const t0 = performance.now();
      let ok = false;
      try {
        const res = await withTimeout(fetch(CF_UP, {
          method: 'POST',
          body: body,
          headers: { 'Content-Type': 'text/plain' },
          cache: 'no-store'
        }), 120000);
        ok = !res || typeof res.ok === 'undefined' || res.ok;
      } catch (e) { ok = false; }
      const seconds = (performance.now() - t0) / 1000;
      if (ok && seconds > 0) upSpeeds.push((upChunkBytes * 8) / seconds / 1000000);
      if (card) card.up.textContent = upSpeeds.length ? fmt(round(upSpeeds[upSpeeds.length - 1]), 'Mbps') : '--';
      if (onStep) onStep('upload', i + 1, upChunks);
    }
    if (upSpeeds.length) {
      const sorted = upSpeeds.slice().sort((a, b) => a - b);
      result.up = round(sorted[Math.floor(sorted.length / 2)]);
    }
    if (card) card.up.textContent = fmt(result.up, 'Mbps');

    return result;
  }

  async function connectAndWait(net, mode, card) {
    let current = null;
    try {
      current = await Wifi.current();
    } catch (e) { /* ignore */ }

    if (current && current.ssid === net.ssid) {
      setCardState(card, 'вже підключено', 'ok');
      return true;
    }

    if (mode === 'manual') {
      setCardState(card, 'чекає підключення', 'warn');
      card.msg.textContent = 'Підключіться до «' + net.label + '» у налаштуваннях Wi-Fi';
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (state.cancelRequested) throw new Error('cancelled');
        await sleep(1500);
        try {
          const info = await Wifi.current();
          if (info && info.ssid === net.ssid) {
            setCardState(card, 'підключено', 'ok');
            await sleep(2500);
            return true;
          }
        } catch (e) { /* ignore */ }
      }
      setCardState(card, 'таймаут', 'error');
      card.msg.textContent = 'Не вдалося дочекатися підключення до ' + net.label;
      return false;
    }

    setCardState(card, 'підключення...', 'warn');
    card.msg.textContent = 'Команда: cmd wifi connect-network ' + net.ssid;
    try {
      const res = await Wifi.connect({
        ssid: net.ssid,
        security: net.security || 'wpa2',
        password: net.password || ''
      });
      if (!res.ok) {
        setCardState(card, 'помилка', 'error');
        card.msg.textContent = 'Підключення не вдалося: ' + (res.output || '').split('\n').slice(0, 3).join(' | ');
        return false;
      }
    } catch (e) {
      setCardState(card, 'помилка', 'error');
      card.msg.textContent = 'Помилка підключення: ' + (e.message || e);
      return false;
    }

    setCardState(card, 'очікування...', 'warn');
    let ok = false;
    try {
      const res = await Wifi.waitForSsid({ ssid: net.ssid, timeoutMs: 35000 });
      ok = !!res.ok;
    } catch (e) { /* ignore */ }
    if (ok) {
      setCardState(card, 'підключено', 'ok');
      await sleep(2000);
      return true;
    }
    setCardState(card, 'не підключено', 'error');
    card.msg.textContent = 'Мережа ' + net.ssid + ' не підключилась';
    return false;
  }

  async function runAll() {
    if (state.running) return;
    if (!Wifi) {
      alert('Нативний плагін недоступний');
      return;
    }
    state.running = true;
    state.cancelRequested = false;
    $('btnRun').disabled = true;
    $('btnCancel').hidden = false;

    const mode = $('switchMode').value;
    const sizeMb = Number($('testSize').value) || 40;
    const weather = state.weather || $('weatherNote').value.trim() || 'не вказано';

    $('runResults').innerHTML = '';
    const run = {
      id: Date.now(),
      startedAt: Date.now(),
      weather: weather,
      mode: mode,
      sizeMb: sizeMb,
      results: []
    };

    try {
      $('runStatus').textContent = 'Сканування мереж...';
      const scan = await Wifi.scan();
      const inRange = new Set((scan.results || []).map((r) => r.ssid));
      const enabled = state.networks.filter((n) => n.enabled);
      const targets = enabled.filter((n) => inRange.has(n.ssid));
      const outOfRange = enabled.filter((n) => !inRange.has(n.ssid));

      $('runStatus').textContent = 'У зоні: ' + targets.length + ' із ' + enabled.length;

      if (!targets.length) {
        $('runStatus').textContent = enabled.length
          ? 'Жодної авторизованої мережі немає в зоні досяжності'
          : 'Список авторизованих мереж порожній';
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Немає що тестувати.';
        $('runResults').appendChild(empty);
        state.running = false;
        $('btnRun').disabled = false;
        $('btnCancel').hidden = true;
        return;
      }

      let originalSsid = null;
      try {
        const cur = await Wifi.current();
        originalSsid = cur.ssid;
      } catch (e) { /* ignore */ }

      for (let i = 0; i < targets.length; i++) {
        if (state.cancelRequested) break;
        const net = targets[i];
        $('runStatus').textContent = `Мережа ${i + 1}/${targets.length}: ${net.label}`;
        const card = makeRunCard(net.label, net.ssid);
        setCardState(card, 'старт', '');
        card.msg.textContent = 'Підготовка...';

        const entry = {
          label: net.label,
          ssid: net.ssid,
          security: net.security || 'wpa2',
          rssi: null,
          ping: null,
          jitter: null,
          loss: null,
          down: null,
          up: null,
          ip: '--',
          isp: '--',
          colo: '--',
          status: 'ok',
          error: '',
          startedAt: Date.now()
        };

        let connected = false;
        try {
          connected = await connectAndWait(net, mode, card);
        } catch (e) {
          if (state.cancelRequested) throw e;
          connected = false;
        }

        if (!connected) {
          entry.status = 'error';
          entry.error = card.msg.textContent;
          run.results.push(entry);
          continue;
        }

        try {
          const cur = await Wifi.current();
          entry.rssi = cur.rssi;
          if (card) card.rssi.textContent = fmt(cur.rssi, 'dBm');
        } catch (e) { /* ignore */ }

        try {
          const measured = await measure(sizeMb, card, (phase, index, total) => {
            card.msg.textContent = phase + ' ' + index + '/' + total;
          });
          Object.assign(entry, measured);
          setCardState(card, 'готово', 'done');
          card.msg.textContent = 'IP ' + measured.ip + ' · ' + measured.isp + ' · вузол ' + measured.colo;
        } catch (e) {
          if (state.cancelRequested) throw e;
          entry.status = 'error';
          entry.error = 'Помилка вимірювання: ' + (e.message || e);
          setCardState(card, 'помилка', 'error');
          card.msg.textContent = entry.error;
        }
        run.results.push(entry);
      }

      // skipped networks
      outOfRange.forEach((net) => {
        run.results.push({
          label: net.label,
          ssid: net.ssid,
          security: net.security || 'wpa2',
          rssi: null, ping: null, jitter: null, loss: null, down: null, up: null,
          ip: '--', isp: '--', colo: '--',
          status: 'skipped',
          error: 'Поза зоною досяжності',
          startedAt: Date.now()
        });
      });

      // restore the network we were on before the run
      if (originalSsid && originalSsid !== (targets[targets.length - 1] || {}).ssid && !state.cancelRequested) {
        const restore = state.networks.find((n) => n.ssid === originalSsid && n.enabled);
        if (restore) {
          $('runStatus').textContent = 'Повернення до ' + restore.label + '...';
          try {
            await Wifi.connect({ ssid: restore.ssid, security: restore.security, password: restore.password });
            await Wifi.waitForSsid({ ssid: restore.ssid, timeoutMs: 25000 });
          } catch (e) { /* ignore */ }
        }
      }

      state.runs.unshift(run);
      if (state.runs.length > 100) state.runs.length = 100;
      await saveRuns();
      renderLog();

      $('runStatus').textContent = state.cancelRequested
        ? 'Прогін скасовано'
        : 'Прогін завершено: ' + run.results.filter((r) => r.status === 'ok').length + ' мереж';
    } catch (e) {
      if (e && e.message === 'cancelled') {
        $('runStatus').textContent = 'Прогін скасовано';
      } else {
        $('runStatus').textContent = 'Помилка прогону: ' + (e.message || e);
      }
    } finally {
      state.running = false;
      $('btnRun').disabled = false;
      $('btnCancel').hidden = true;
      await refreshStatus();
    }
  }

  // --------------------------------------------------------------- log tab

  function renderLog() {
    const box = $('logList');
    box.innerHTML = '';
    if (!state.runs.length) {
      box.innerHTML = '<div class="empty">Прогонів поки немає</div>';
      return;
    }
    state.runs.forEach((run, index) => {
      const okCount = run.results.filter((r) => r.status === 'ok').length;
      const el = document.createElement('div');
      el.className = 'log-run' + (index === 0 ? ' open' : '');
      const rows = run.results.map((r) =>
        `<tr>
           <td>${esc(r.label)}</td>
           <td class="num">${fmt(r.down, '')}</td>
           <td class="num">${fmt(r.up, '')}</td>
           <td class="num">${fmt(r.ping, '')}</td>
           <td class="num">${fmt(r.jitter, '')}</td>
           <td>${esc(r.status)}</td>
         </tr>`).join('');
      el.innerHTML =
        `<div class="log-head">
           <div>
             <div class="title">${esc(fmtTime(run.startedAt))} · ${esc(run.weather)}</div>
             <div class="sub">${okCount}/${run.results.length} мереж · ${run.sizeMb} МБ · ${esc(run.mode === 'auto' ? 'авто' : 'вручну')}</div>
           </div>
           <span class="badge">${index === 0 ? 'відкрито' : 'деталі'}</span>
         </div>
         <div class="log-body">
           <table class="log-table">
             <thead><tr><th>Мережа</th><th>↓</th><th>↑</th><th>Ping</th><th>Jit</th><th>Статус</th></tr></thead>
             <tbody>${rows}</tbody>
           </table>
         </div>`;
      el.querySelector('.log-head').onclick = () => el.classList.toggle('open');
      box.appendChild(el);
    });
  }

  function toCsv() {
    const header = ['date', 'time', 'weather', 'label', 'ssid', 'security', 'download_mbps', 'upload_mbps',
      'ping_ms', 'jitter_ms', 'loss_pct', 'rssi_dbm', 'public_ip', 'isp', 'colo', 'status', 'error'];
    const lines = [header.join(',')];
    state.runs.forEach((run) => {
      const d = new Date(run.startedAt);
      const date = d.toISOString().slice(0, 10);
      const time = d.toTimeString().slice(0, 8);
      run.results.forEach((r) => {
        const row = [date, time, run.weather, r.label, r.ssid, r.security,
          r.down === null ? '' : r.down, r.up === null ? '' : r.up,
          r.ping === null ? '' : r.ping, r.jitter === null ? '' : r.jitter,
          r.loss === null ? '' : r.loss, r.rssi === null ? '' : r.rssi,
          r.ip, r.isp, r.colo, r.status, r.error || ''];
        lines.push(row.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','));
      });
    });
    return lines.join('\n');
  }

  async function shareText(title, text, fileName) {
    if (!Share) {
      alert('Експорт недоступний');
      return;
    }
    try {
      await Share.share({ title: title, text: text, dialogTitle: title });
    } catch (e) {
      console.warn(e);
    }
  }

  // ------------------------------------------------------------------- init

  async function init() {
    initTheme();
    initTabs();
    initWeather();

    $('btnRefreshStatus').onclick = refreshStatus;
    $('btnScan').onclick = doScan;
    $('btnPerms').onclick = async () => {
      if (!Wifi) return;
      try {
        const res = await Wifi.requestWifiPermissions();
        $('scanStatus').textContent = res.granted ? 'Дозволи надано' : 'Дозвол не надано';
      } catch (e) {
        $('scanStatus').textContent = 'Помилка: ' + (e.message || e);
      }
    };
    $('btnReqShizuku').onclick = async () => {
      if (!Wifi) return;
      try {
        const res = await Wifi.requestShizukuPermission();
        $('scanStatus').textContent = res.granted ? 'Дозвіл Shizuku надано' : 'Дозвіл не надано';
      } catch (e) {
        $('scanStatus').textContent = 'Shizuku: ' + (e.message || e);
      }
      refreshStatus();
    };
    $('btnOpenShizuku').onclick = async () => {
      if (!Wifi) return;
      try {
        const res = await Wifi.openShizuku();
        if (!res.ok) {
          $('scanStatus').textContent = 'Shizuku не встановлено';
          if (Wifi.openUrl) {
            await Wifi.openUrl({ url: 'https://github.com/RikkaApps/Shizuku/releases' });
          }
        }
      } catch (e) { /* ignore */ }
    };
    $('btnDiag').onclick = async () => {
      const out = $('diagOut');
      out.classList.add('show');
      out.textContent = 'Виконую cmd wifi status...';
      if (!Wifi) {
        out.textContent = 'Плагін недоступний';
        return;
      }
      try {
        const res = await Wifi.shell({ command: 'cmd wifi status' });
        out.textContent = res.output || 'Без відповіді';
      } catch (e) {
        out.textContent = 'Помилка: ' + (e.message || e);
      }
    };

    $('btnCancelModal').onclick = closeModal;
    $('btnSaveNet').onclick = saveModal;
    $('netModal').onclick = (e) => {
      if (e.target === $('netModal')) closeModal();
    };

    $('btnRun').onclick = runAll;
    $('btnCancel').onclick = () => {
      state.cancelRequested = true;
      $('runStatus').textContent = 'Скасування...';
    };

    $('btnExportCsv').onclick = () => shareText('StarTestAll CSV', toCsv());
    $('btnExportJson').onclick = () => shareText('StarTestAll JSON', JSON.stringify(state.runs, null, 2));
    $('btnClearLog').onclick = async () => {
      if (!confirm('Видалити всі записи журналу?')) return;
      state.runs = [];
      await saveRuns();
      renderLog();
    };

    await loadNetworks();
    await loadRuns();
    renderAuthorized();
    renderLog();
    await refreshStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
