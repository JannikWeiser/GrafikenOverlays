(function () {
  const stage = document.getElementById('stage');
  const mainLayer = document.getElementById('mainLayer');
  const POLL_MS = 3000;

  let liveState = { type: null, params: {} };
  let pollTimer = null;
  let pollKey = null;

  function stateKey(state) {
    if (!state.type) return null;
    if (state.type === 'browser') return 'browser';
    return `${state.type}:${state.params.host}:${state.params.categoryRoundId}`;
  }

  function clearStage() {
    mainLayer.innerHTML = '';
  }

  function ensureLayer(className) {
    let layer = mainLayer.querySelector(`.go-position--${className}`);
    if (!layer) {
      clearStage();
      layer = document.createElement('div');
      layer.className = `go-position go-position--${className}`;
      mainLayer.appendChild(layer);
    }
    return layer;
  }

  async function fetchRound(host, categoryRoundId) {
    const res = await fetch(`/api/rounds/${host}/${categoryRoundId}`);
    if (!res.ok) throw new Error(`round fetch failed: ${res.status}`);
    return res.json();
  }

  async function tick() {
    const { type, params } = liveState;
    if (!type) return;

    if (type === 'browser') {
      Renderers.renderBrowserFrame(ensureLayer('browser'), params.url);
      return;
    }

    if (!params.host || !params.categoryRoundId) return;
    try {
      const roundData = await fetchRound(params.host, params.categoryRoundId);
      if (type === 'names') {
        const layer = ensureLayer('names');
        Renderers.renderNames(layer, { roundData, bibLeft: params.bibLeft, bibRight: params.bibRight });
      } else if (type === 'results') {
        const layer = ensureLayer('results');
        Renderers.renderResults(layer, roundData, { page: params.page || 0 });
      } else if (type === 'bracket') {
        const layer = ensureLayer('bracket');
        Renderers.renderBracket(layer, roundData);
      }
    } catch (err) {
      console.error('Output poll error', err);
    }
  }

  function applyState(state) {
    liveState = state;
    const key = stateKey(state);

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (key !== pollKey) clearStage();
    pollKey = key;

    if (!state.type) return;

    tick();
    pollTimer = setInterval(tick, POLL_MS);
  }

  function applyConfig(config) {
    // background muss auf <html> UND <body> gesetzt werden - CSS setzt es
    // auf beiden Elementen, sonst schimmert das gruene <html> hinter einem
    // transparenten <body> durch und die Checkbox scheint wirkungslos.
    const bg = config?.transparentBackground ? 'transparent' : (config?.chromaColor || '#00ff00');
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
    const opacity = typeof config?.cardOpacity === 'number' ? config.cardOpacity : 0.82;
    document.documentElement.style.setProperty('--go-card-opacity', opacity);
    Renderers.renderCorners(stage, config?.corners);
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.kind === 'state') applyState(msg.state);
      else if (msg.kind === 'config') applyConfig(msg.config);
    });
    ws.addEventListener('close', () => setTimeout(connect, 1000));
    ws.addEventListener('error', () => ws.close());
  }

  connect();
})();
