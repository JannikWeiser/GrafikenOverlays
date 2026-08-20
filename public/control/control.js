(function () {
  const hostSelect = document.getElementById('hostSelect');
  const eventIdInput = document.getElementById('eventIdInput');
  const loadEventBtn = document.getElementById('loadEventBtn');
  const eventStatus = document.getElementById('eventStatus');
  const offAirBtn = document.getElementById('offAirBtn');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const bgColorInput = document.getElementById('bgColorInput');
  const transparentBgInput = document.getElementById('transparentBgInput');
  const cardOpacityInput = document.getElementById('cardOpacityInput');
  const cardOpacityValue = document.getElementById('cardOpacityValue');

  const POLL_MS = 3000;
  const PREVIEW_CANVAS_WIDTH = 1920;
  let currentHost = null;
  let categoryRounds = [];
  let serverLiveState = { type: null, params: {} };
  let latestConfig = { chromaColor: '#00ff00', transparentBackground: false, cardOpacity: 0.82, corners: { left: null, right: null } };
  let ws;

  function scalePreview(col) {
    const width = col.previewBox.getBoundingClientRect().width;
    const factor = width / PREVIEW_CANVAS_WIDTH;
    col.previewStage.style.transform = `scale(${factor})`;
  }

  const columns = {};
  for (const section of document.querySelectorAll('.column')) {
    const type = section.dataset.type;
    const previewBox = section.querySelector('.preview');
    const previewStage = section.querySelector('.previewStage');
    const previewLayer = document.createElement('div');
    previewLayer.className = `go-position go-position--${type}`;
    previewStage.appendChild(previewLayer);

    const col = {
      type,
      el: section,
      categorySelect: section.querySelector('.categorySelect'),
      previewBox,
      previewStage,
      previewLayer,
      goLiveBtn: section.querySelector('.goLiveBtn'),
      bibLeft: section.querySelector('.bibLeft'),
      bibRight: section.querySelector('.bibRight'),
      pageBackBtn: section.querySelector('.pageBackBtn'),
      pageFwdBtn: section.querySelector('.pageFwdBtn'),
      urlInput: section.querySelector('.urlInput'),
      categoryRoundId: null,
      roundData: null,
      page: 0,
      pollTimer: null,
    };
    columns[type] = col;

    new ResizeObserver(() => scalePreview(col)).observe(previewBox);
    scalePreview(col);
  }

  function hasSelection(col) {
    if (col.type === 'browser') return Boolean(col.urlInput && col.urlInput.value.trim());
    return Boolean(col.categoryRoundId);
  }

  function paramsFor(col) {
    if (col.type === 'names') {
      return {
        host: currentHost,
        categoryRoundId: col.categoryRoundId,
        bibLeft: col.bibLeft.value.trim(),
        bibRight: col.bibRight.value.trim(),
      };
    }
    if (col.type === 'results') {
      return { host: currentHost, categoryRoundId: col.categoryRoundId, page: col.page || 0 };
    }
    if (col.type === 'browser') {
      return { url: (col.urlInput?.value || '').trim() };
    }
    return { host: currentHost, categoryRoundId: col.categoryRoundId };
  }

  // Ist diese Spalte gerade die live geschaltete? Fuer die Browser-Spalte
  // reicht der Typ (die URL ist ja genau das Feld, das gerade editiert wird);
  // fuer die anderen muss auch Runde/Host uebereinstimmen.
  function isCurrentlyLive(col) {
    if (serverLiveState.type !== col.type) return false;
    if (col.type === 'browser') return true;
    return serverLiveState.params.host === currentHost &&
      String(serverLiveState.params.categoryRoundId) === String(col.categoryRoundId);
  }

  // Waehrend eine Spalte bereits live ist, sollen Aenderungen (Bib, Seite,
  // URL) sofort auf den Output durchgereicht werden, ohne erneuten
  // Go-Live-Klick.
  function syncIfLive(col) {
    if (!hasSelection(col) || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (isCurrentlyLive(col)) goLive(col);
  }

  function renderPreview(col) {
    if (col.type === 'browser') {
      Renderers.renderBrowserFrame(col.previewLayer, col.urlInput.value);
      return;
    }
    if (!col.roundData) {
      col.previewLayer.innerHTML = '';
      return;
    }
    if (col.type === 'names') {
      Renderers.renderNames(col.previewLayer, {
        roundData: col.roundData,
        bibLeft: col.bibLeft.value.trim(),
        bibRight: col.bibRight.value.trim(),
      });
    } else if (col.type === 'results') {
      Renderers.renderResults(col.previewLayer, col.roundData, { page: col.page || 0 });
    } else if (col.type === 'bracket') {
      Renderers.renderBracket(col.previewLayer, col.roundData);
    }
  }

  async function pollColumn(col) {
    if (!col.categoryRoundId || !currentHost) return;
    try {
      const res = await fetch(`/api/rounds/${currentHost}/${col.categoryRoundId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      col.roundData = await res.json();
      renderPreview(col);
    } catch (err) {
      console.error('Preview poll error', col.type, err);
    }
  }

  function restartPolling(col) {
    if (col.pollTimer) clearInterval(col.pollTimer);
    col.roundData = null;
    renderPreview(col);
    if (!col.categoryRoundId) return;
    pollColumn(col);
    col.pollTimer = setInterval(() => pollColumn(col), POLL_MS);
  }

  function populateCategorySelects() {
    for (const col of Object.values(columns)) {
      if (!col.categorySelect) continue;
      const select = col.categorySelect;
      select.innerHTML = '<option value="">— wählen —</option>';
      let currentGroup = null;
      let currentGroupEl = null;
      for (const cr of categoryRounds) {
        if (cr.dcatName !== currentGroup) {
          currentGroup = cr.dcatName;
          currentGroupEl = document.createElement('optgroup');
          currentGroupEl.label = cr.dcatName;
          select.appendChild(currentGroupEl);
        }
        const opt = document.createElement('option');
        opt.value = cr.id;
        opt.textContent = `${cr.roundName} — ${cr.status}`;
        currentGroupEl.appendChild(opt);
      }
    }
  }

  async function loadEvent() {
    const host = hostSelect.value;
    const eventId = eventIdInput.value.trim();
    if (!eventId) {
      eventStatus.textContent = 'Bitte Wettkampf-ID eingeben.';
      return;
    }
    eventStatus.textContent = 'Lade…';
    try {
      const res = await fetch(`/api/events/${host}/${eventId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const event = await res.json();
      currentHost = host;
      categoryRounds = [];
      for (const dcat of event.d_cats || []) {
        for (const cr of dcat.category_rounds || []) {
          categoryRounds.push({
            id: cr.category_round_id,
            dcatName: dcat.dcat_name,
            roundName: cr.name,
            status: cr.status,
          });
        }
      }
      populateCategorySelects();
      eventStatus.textContent = `${event.name} — ${categoryRounds.length} Runden geladen`;
    } catch (err) {
      eventStatus.textContent = `Fehler: ${err.message}`;
    }
  }

  function updateLiveBadges() {
    for (const col of Object.values(columns)) {
      col.el.classList.toggle('is-live', isCurrentlyLive(col));
    }
  }

  function updateCornerSlots(corners) {
    for (const slot of ['left', 'right']) {
      const slotEl = document.querySelector(`.corner-slot[data-slot="${slot}"]`);
      if (!slotEl) continue;
      const previewEl = slotEl.querySelector('.corner-slot__preview');
      const toggleBtn = slotEl.querySelector('.corner-slot__toggle');
      const scaleInput = slotEl.querySelector('.corner-slot__scale');
      const corner = corners?.[slot];

      previewEl.innerHTML = '';
      if (!corner) {
        previewEl.textContent = 'Kein Bild/Video';
      } else if (corner.kind === 'video') {
        const video = document.createElement('video');
        video.src = corner.url;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        previewEl.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.src = corner.url;
        previewEl.appendChild(img);
      }

      toggleBtn.disabled = !corner;
      toggleBtn.textContent = corner?.visible ? 'Live' : 'Aus';
      toggleBtn.classList.toggle('is-live', Boolean(corner?.visible));
      scaleInput.disabled = !corner;
      if (document.activeElement !== scaleInput) {
        scaleInput.value = corner?.scale || 1;
      }
    }
  }

  // Ist der Output global auf transparent gestellt, zeigt die Vorschau ein
  // Karomuster statt der Chroma-Farbe, damit sofort klar ist, dass hier kein
  // Chroma-Key noetig ist.
  function updatePreviewBackground(col) {
    const wantsTransparent = Boolean(latestConfig.transparentBackground);
    col.previewBox.classList.toggle('preview--transparent-bg', wantsTransparent);
    col.previewBox.style.background = wantsTransparent ? '' : (latestConfig.chromaColor || '#00ff00');
  }

  function applyConfig(config) {
    if (!config) return;
    latestConfig = config;
    bgColorInput.value = config.chromaColor || '#00ff00';
    bgColorInput.disabled = Boolean(config.transparentBackground);
    transparentBgInput.checked = Boolean(config.transparentBackground);

    const opacity = typeof config.cardOpacity === 'number' ? config.cardOpacity : 0.82;
    document.documentElement.style.setProperty('--go-card-opacity', opacity);
    if (document.activeElement !== cardOpacityInput) cardOpacityInput.value = opacity;
    cardOpacityValue.textContent = opacity.toFixed(2);

    for (const col of Object.values(columns)) {
      updatePreviewBackground(col);
      Renderers.renderCorners(col.previewStage, config.corners);
    }
    for (const el of document.querySelectorAll('.corner-slot__preview')) {
      el.classList.toggle('preview--transparent-bg', Boolean(config.transparentBackground));
      el.style.background = config.transparentBackground ? '' : (config.chromaColor || '#00ff00');
    }
    updateCornerSlots(config.corners);
  }

  function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.kind === 'state') {
        serverLiveState = msg.state;
        updateLiveBadges();
      } else if (msg.kind === 'config') {
        applyConfig(msg.config);
      }
    });
    ws.addEventListener('close', () => setTimeout(connectWs, 1000));
    ws.addEventListener('error', () => ws.close());
  }

  function goLive(col) {
    if (!hasSelection(col)) return;
    ws.send(JSON.stringify({ kind: 'setLive', type: col.type, params: paramsFor(col) }));
  }

  loadEventBtn.addEventListener('click', loadEvent);
  offAirBtn.addEventListener('click', () => ws.send(JSON.stringify({ kind: 'clearLive' })));
  bgColorInput.addEventListener('input', () => {
    ws.send(JSON.stringify({ kind: 'setConfig', config: { chromaColor: bgColorInput.value } }));
  });
  transparentBgInput.addEventListener('change', () => {
    ws.send(JSON.stringify({ kind: 'setConfig', config: { transparentBackground: transparentBgInput.checked } }));
  });
  cardOpacityInput.addEventListener('input', () => {
    const value = Number(cardOpacityInput.value);
    cardOpacityValue.textContent = value.toFixed(2);
    document.documentElement.style.setProperty('--go-card-opacity', value);
    ws.send(JSON.stringify({ kind: 'setConfig', config: { cardOpacity: value } }));
  });
  copyLinkBtn.addEventListener('click', async () => {
    const url = `${location.origin}/output/`;
    try {
      await navigator.clipboard.writeText(url);
      eventStatus.textContent = `Link kopiert: ${url}`;
    } catch {
      window.prompt('Output-Link (manuell kopieren):', url);
    }
  });

  for (const col of Object.values(columns)) {
    if (col.categorySelect) {
      col.categorySelect.addEventListener('change', () => {
        col.categoryRoundId = col.categorySelect.value || null;
        col.page = 0;
        restartPolling(col);
        updateLiveBadges();
      });
    }
    col.goLiveBtn.addEventListener('click', () => goLive(col));

    if (col.bibLeft) {
      col.bibLeft.addEventListener('input', () => { renderPreview(col); syncIfLive(col); });
    }
    if (col.bibRight) {
      col.bibRight.addEventListener('input', () => { renderPreview(col); syncIfLive(col); });
    }
    if (col.pageBackBtn) {
      col.pageBackBtn.addEventListener('click', () => {
        col.page = Math.max(0, (col.page || 0) - 1);
        renderPreview(col);
        syncIfLive(col);
      });
    }
    if (col.pageFwdBtn) {
      col.pageFwdBtn.addEventListener('click', () => {
        const total = col.roundData?.ranking?.length || 0;
        const maxPage = Math.max(0, Math.ceil(total / Renderers.RESULTS_ROWS_PER_PAGE) - 1);
        col.page = Math.min(maxPage, (col.page || 0) + 1);
        renderPreview(col);
        syncIfLive(col);
      });
    }
    if (col.urlInput) {
      col.urlInput.addEventListener('input', () => { renderPreview(col); syncIfLive(col); });
    }
  }

  for (const slot of ['left', 'right']) {
    const slotEl = document.querySelector(`.corner-slot[data-slot="${slot}"]`);
    const fileInput = slotEl.querySelector('.corner-slot__file');
    const removeBtn = slotEl.querySelector('.corner-slot__remove');
    const statusEl = slotEl.querySelector('.corner-slot__status');

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      statusEl.textContent = 'Lade hoch…';
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch(`/api/uploads/${slot}`, { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        statusEl.textContent = '';
      } catch (err) {
        statusEl.textContent = `Fehler: ${err.message}`;
      }
    });

    removeBtn.addEventListener('click', async () => {
      statusEl.textContent = '';
      try {
        const res = await fetch(`/api/uploads/${slot}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        statusEl.textContent = `Fehler: ${err.message}`;
      }
    });

    const toggleBtn = slotEl.querySelector('.corner-slot__toggle');
    toggleBtn.addEventListener('click', () => {
      const currentlyVisible = Boolean(latestConfig.corners?.[slot]?.visible);
      ws.send(JSON.stringify({ kind: 'setCornerConfig', slot, patch: { visible: !currentlyVisible } }));
    });

    const scaleInput = slotEl.querySelector('.corner-slot__scale');
    scaleInput.addEventListener('input', () => {
      ws.send(JSON.stringify({ kind: 'setCornerConfig', slot, patch: { scale: Number(scaleInput.value) } }));
    });
  }

  async function init() {
    const res = await fetch('/api/hosts');
    const hosts = await res.json();
    hostSelect.innerHTML = hosts.map((h) => `<option value="${h.key}">${h.label}</option>`).join('');
    connectWs();
  }

  init();
})();
