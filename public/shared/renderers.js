// Gemeinsame Render-Funktionen fuer Control-Vorschau und Output-Seite.
// Wird als einfaches <script> ohne Bundler eingebunden -> globales `Renderers`.
(function (global) {
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function displayName(entry) {
    if (!entry) return '';
    const last = (entry.lastname || '').toUpperCase();
    const first = entry.firstname || '';
    if (last || first) return `${last} ${first}`.trim();
    return entry.name || '';
  }

  function findByBib(roundData, bib) {
    const needle = String(bib ?? '').trim();
    if (!needle || !roundData) return null;
    const list = roundData.startlist?.length ? roundData.startlist : (roundData.ranking || []);
    return list.find((a) => String(a.bib ?? '').trim() === needle) || null;
  }

  function lastNameOnly(entry) {
    const last = (entry.lastname || '').toUpperCase();
    return last || displayName(entry);
  }

  function athletePanel(entry, side) {
    const el = document.createElement('div');
    el.className = `go-athlete go-athlete--${side}`;
    if (!entry) {
      el.classList.add('go-athlete--empty');
      return el;
    }
    if (entry.bib) {
      const bibEl = document.createElement('span');
      bibEl.className = 'go-athlete__bib';
      bibEl.textContent = `#${entry.bib}`;
      el.appendChild(bibEl);
    }
    if (entry.country) {
      const country = document.createElement('span');
      country.className = 'go-athlete__country';
      country.textContent = entry.country;
      el.appendChild(country);
    }
    const name = document.createElement('span');
    name.className = 'go-athlete__name';
    name.textContent = displayName(entry);
    el.appendChild(name);
    return el;
  }

  // Kuerzt auf den reinen Nachnamen, falls der volle Name im verfuegbaren
  // Platz nicht ohne Abschneiden dargestellt werden kann.
  function fitAthleteName(panelEl, entry) {
    const nameEl = panelEl.querySelector('.go-athlete__name');
    if (!nameEl) return;
    if (nameEl.scrollWidth > nameEl.clientWidth + 1) {
      nameEl.textContent = lastNameOnly(entry);
    }
  }

  function renderNames(container, { roundData, bibLeft, bibRight } = {}) {
    container.innerHTML = '';
    const left = findByBib(roundData, bibLeft);
    const right = findByBib(roundData, bibRight);
    if (!left && !right) return;

    const wrap = document.createElement('div');
    wrap.className = 'go-names';
    const leftPanel = athletePanel(left, 'left');
    const rightPanel = athletePanel(right, 'right');
    wrap.appendChild(leftPanel);
    wrap.appendChild(rightPanel);
    container.appendChild(wrap);

    if (left) fitAthleteName(leftPanel, left);
    if (right) fitAthleteName(rightPanel, right);
  }

  const RESULTS_ROWS_PER_PAGE = 16;

  function renderResults(container, roundData, { page = 0 } = {}) {
    container.innerHTML = '';
    if (!roundData) return;

    const wrap = document.createElement('div');
    wrap.className = 'go-results';

    const header = document.createElement('div');
    header.className = 'go-results__header';
    header.innerHTML = `<span class="go-results__cat">${escapeHtml(roundData.category || '')}</span><span class="go-results__round">${escapeHtml(roundData.round || '')}</span>`;
    wrap.appendChild(header);

    const isSpeed = (roundData.discipline || '').toLowerCase() === 'speed';
    const scoreLabel = isSpeed ? 'Best Time' : 'Pkt.';
    const ranking = roundData.ranking || [];
    const pageCount = Math.max(1, Math.ceil(ranking.length / RESULTS_ROWS_PER_PAGE));
    const clampedPage = Math.max(0, Math.min(page, pageCount - 1));
    const pageRows = ranking.slice(clampedPage * RESULTS_ROWS_PER_PAGE, (clampedPage + 1) * RESULTS_ROWS_PER_PAGE);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'go-results__tablewrap';

    const table = document.createElement('table');
    table.className = 'go-results__table';
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr><th>#</th><th>Name</th><th>Land/Verein</th><th>${escapeHtml(scoreLabel)}</th></tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (!pageRows.length) {
      tbody.innerHTML = '<tr><td class="go-results__empty" colspan="99">Noch keine Ergebnisse</td></tr>';
    }
    for (const entry of pageRows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${entry.rank ?? ''}</td>
        <td>${escapeHtml(displayName(entry))}</td>
        <td>${escapeHtml(entry.country || '')}</td>
        <td>${escapeHtml(entry.score ?? '')}</td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);

    container.appendChild(wrap);
  }

  function heatEl(heat) {
    const el = document.createElement('div');
    el.className = 'go-heat';
    const athletes = heat.athletes || [];
    if (athletes.length === 0) {
      el.classList.add('go-heat--empty');
      el.innerHTML = '<div class="go-heat__row go-heat__row--placeholder">TBD</div><div class="go-heat__row go-heat__row--placeholder">TBD</div>';
      return el;
    }
    for (const a of athletes) {
      const row = document.createElement('div');
      row.className = 'go-heat__row';
      if (a.stage_result?.winner) row.classList.add('go-heat__row--winner');
      const timeText = a.ascents?.[0]?.formatted_ascent_score || a.stage_result?.score || '';
      row.innerHTML = `<span class="go-heat__name">${escapeHtml(displayName(a))}</span><span class="go-heat__time">${escapeHtml(timeText)}</span>`;
      el.appendChild(row);
    }
    return el;
  }

  function stageTitleEl(name) {
    const title = document.createElement('div');
    title.className = 'go-bracket__stage-name';
    title.textContent = name;
    return title;
  }

  function stageColumn(stage) {
    const col = document.createElement('div');
    col.className = 'go-bracket__col';
    col.appendChild(stageTitleEl(stage.stage_name));
    for (const heat of stage.heats || []) col.appendChild(heatEl(heat));
    return col;
  }

  const isFinalStage = (name) => /^final(e)?$/.test((name || '').trim().toLowerCase());
  const isSmallFinalStage = (name) => /small.?final|kleines final/.test((name || '').trim().toLowerCase());

  // Seitlich liegende Pyramide: normale Stages nebeneinander, Finale und
  // Kleines Finale teilen sich eine mittige Spalte (Finale oben, Kleines
  // Finale darunter), alle Spalten vertikal zentriert.
  function renderBracket(container, roundData) {
    container.innerHTML = '';
    if (!roundData) return;

    const wrap = document.createElement('div');
    wrap.className = 'go-bracket';

    const header = document.createElement('div');
    header.className = 'go-bracket__header';
    header.innerHTML = `<span>${escapeHtml(roundData.category || '')}</span><span>${escapeHtml(roundData.round || '')}</span>`;
    wrap.appendChild(header);

    const stages = roundData.speed_elimination_stages || [];
    if (!stages.length) {
      const empty = document.createElement('div');
      empty.className = 'go-bracket__empty';
      empty.textContent = 'Keine Speed-K.o.-Runde geladen.';
      wrap.appendChild(empty);
      container.appendChild(wrap);
      return;
    }

    const finalStage = stages.find((s) => isFinalStage(s.stage_name));
    const smallFinalStage = stages.find((s) => isSmallFinalStage(s.stage_name));
    const otherStages = stages.filter((s) => s !== finalStage && s !== smallFinalStage);

    const cols = document.createElement('div');
    cols.className = 'go-bracket__cols';

    for (const stage of otherStages) cols.appendChild(stageColumn(stage));

    if (finalStage || smallFinalStage) {
      const col = document.createElement('div');
      col.className = 'go-bracket__col go-bracket__col--final';
      if (finalStage) {
        col.appendChild(stageTitleEl(finalStage.stage_name));
        for (const heat of finalStage.heats || []) col.appendChild(heatEl(heat));
      }
      if (smallFinalStage) {
        const title = stageTitleEl(smallFinalStage.stage_name);
        title.classList.add('go-bracket__stage-name--small-final');
        col.appendChild(title);
        for (const heat of smallFinalStage.heats || []) col.appendChild(heatEl(heat));
      }
      cols.appendChild(col);
    }

    wrap.appendChild(cols);
    container.appendChild(wrap);
  }

  // Rendert eine eingebettete Webseite als Live-Grafik. `container` bleibt
  // unveraendert, solange sich die URL nicht aendert, damit die eingebettete
  // Seite nicht bei jedem Poll-Tick neu geladen wird.
  function renderBrowserFrame(container, url) {
    const trimmed = (url || '').trim();
    if (container.dataset.url === trimmed) return;
    container.dataset.url = trimmed;
    container.innerHTML = '';
    if (!trimmed) return;
    const iframe = document.createElement('iframe');
    iframe.src = trimmed;
    iframe.style.cssText = 'width:100%;height:100%;border:0;';
    iframe.allow = 'autoplay; fullscreen';
    container.appendChild(iframe);
  }

  // Ecken-Einblendungen (Sponsor-Logo/Loop) - laufen unabhaengig vom
  // Haupt-Grafik-Zustand, werden also nicht bei jedem Live-Wechsel neu
  // aufgebaut, sondern nur wenn sich die Quelle tatsaechlich aendert.
  function renderCorner(stageEl, slot, corner) {
    let el = stageEl.querySelector(`.go-corner--${slot}`);
    const shouldShow = Boolean(corner && corner.visible && corner.url);
    if (!shouldShow) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = `go-corner go-corner--${slot}`;
      stageEl.appendChild(el);
    }
    el.style.transform = `scale(${corner.scale || 1})`;
    if (el.dataset.src === corner.url) return;
    el.dataset.src = corner.url;
    el.innerHTML = '';
    if (corner.kind === 'video') {
      const video = document.createElement('video');
      video.src = corner.url;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      el.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = corner.url;
      el.appendChild(img);
    }
  }

  function renderCorners(stageEl, corners) {
    renderCorner(stageEl, 'left', corners?.left || null);
    renderCorner(stageEl, 'right', corners?.right || null);
  }

  global.Renderers = {
    escapeHtml,
    displayName,
    findByBib,
    renderNames,
    renderResults,
    renderBracket,
    renderBrowserFrame,
    renderCorners,
    RESULTS_ROWS_PER_PAGE,
  };
})(window);
