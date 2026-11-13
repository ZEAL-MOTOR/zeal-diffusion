// Visionneuse « Avancement des projets » (lecture seule).
// Déchiffre dans le navigateur les fichiers publiés avec la clé du lien
// (#k=…), affiche le Gantt et vérifie les mises à jour chaque minute.
// Rien n'est envoyé nulle part : seules les préférences d'affichage (lignes
// masquées, zoom, colonnes, options) restent dans ce navigateur. Les lignes
// ouvertes ne sont pas gardées : chaque ouverture repart du niveau 1.
import * as G from './gantt-core.js';

const REFRESH_MS = 60 * 1000;
const STORE = 'zeal-projets:';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const SVG_NS = 'http://www.w3.org/2000/svg';
const RENDER_BUFFER = 24;

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'), nav: $('nav'), navList: $('navList'), navToggle: $('navToggle'), navClose: $('navClose'),
  navBackdrop: $('navBackdrop'), sync: $('sync'), syncText: $('syncText'),
  phead: $('phead'), pName: $('pName'), pMeta: $('pMeta'), pPct: $('pPct'), pBar: $('pBar'),
  toolbar: $('toolbar'), q: $('q'), qCount: $('qCount'), qPrev: $('qPrev'), qNext: $('qNext'), qFilter: $('qFilter'),
  moreBtn: $('moreBtn'), moreDot: $('moreDot'), tools: $('tools'), toolsClose: $('toolsClose'), toolsBackdrop: $('toolsBackdrop'),
  fStatus: $('fStatus'), fFrom: $('fFrom'), fTo: $('fTo'), fReset: $('fReset'),
  periodBtn: $('periodBtn'), periodMenu: $('periodMenu'), periodLabel: $('periodLabel'),
  levelBtn: $('levelBtn'), levelMenu: $('levelMenu'), levels: $('levels'),
  expandAll: $('expandAll'), collapseAll: $('collapseAll'), groupsOnly: $('groupsOnly'), zoomSeg: $('zoomSeg'), todayBtn: $('todayBtn'),
  viewBtn: $('viewBtn'), viewMenu: $('viewMenu'), optDeps: $('optDeps'), optBaseline: $('optBaseline'),
  optCritical: $('optCritical'), colSection: $('colSection'), colOptions: $('colOptions'),
  hiddenWrap: $('hiddenWrap'), hiddenBtn: $('hiddenBtn'), hiddenLabel: $('hiddenLabel'), hiddenMenu: $('hiddenMenu'), hiddenList: $('hiddenList'),
  restoreAll: $('restoreAll'), notice: $('notice'), gantt: $('gantt'), sc: $('sc'), canvas: $('canvas'),
  ghead: $('ghead'), thead: $('thead'), body: $('body'), gbody: $('gbody'), cbody: $('cbody'), cgrid: $('cgrid'),
  hl: $('hl'), markers: $('markers'), links: $('links'), bars: $('bars'), splitter: $('splitter'),
  detail: $('detail'), state: $('state'), stateCard: $('stateCard'),
};

const state = {
  link: null, // { k, key } : la clé ne quitte jamais cette page
  pid: null,
  index: null,
  project: null,
  tree: null,
  prefs: null,
  ui: loadStored('ui') || {},
  filter: { status: 'all', from: null, to: null },
  q: '',
  qFilter: false,
  filterSig: null, // dernier filtre appliqué (voir openFilterResults)
  cur: -1,
  vis: null,
  pos: null,
  links: [],
  scale: null,
  ticks: null,
  cols: [],
  gw: 0,
  rowH: 30,
  hh: 22,
  phone: false,
  selected: -1,
  detail: false,
  rendered: [0, 0],
  today: G.todayValue(),
  offline: false,
  busy: false,
  lastCheck: 0,
  generation: 0,
};

/* ------------------------------------------------------------ Outils */

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : String(c));
  }
  return node;
}

function icon(name, cls = 'ico') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  return node;
}

function px(node, props) {
  for (const [k, v] of Object.entries(props)) node.style[k] = `${Math.round(v * 10) / 10}px`;
  return node;
}

function setVar(name, value) {
  document.documentElement.style.setProperty(name, value);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Heure locale de l'appareil, au format « 14 h 05 ».
function localTime(d = new Date()) {
  return G.formatTime(Date.UTC(2000, 0, 1, d.getHours(), d.getMinutes()));
}

function minibar(percent, extra = '') {
  const fill = h('span');
  fill.style.width = `${clamp(Number(percent) || 0, 0, 100)}%`;
  return h('span', { class: `minibar${extra}` }, fill);
}

/* ---------------------------------------------- Préférences (navigateur) */

function loadStored(name) {
  try {
    const raw = window.localStorage.getItem(STORE + name);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function saveStored(name, value) {
  try { window.localStorage.setItem(STORE + name, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

function saveUi() {
  saveStored('ui', state.ui);
}

function defaultZoom(tree) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < tree.n; i++) {
    if (Number.isFinite(tree.start[i])) min = Math.min(min, tree.start[i]);
    if (Number.isFinite(tree.finish[i])) max = Math.max(max, tree.finish[i]);
  }
  const days = (max - min) / G.DAY;
  if (!Number.isFinite(days) || days <= 45) return 'day';
  return days <= 540 ? 'week' : 'month';
}

function loadPrefs(project, tree) {
  const raw = loadStored(`p:${project.id}`) || {};
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    // Chaque ouverture commence au niveau 1 du plan (tâches regroupées), quel que
    // soit l'état laissé à la visite précédente : menu Niveaux pour en ouvrir plus.
    collapsed: G.collapsedForLevel(tree, 1),
    hidden: new Set(list(raw.hidden)),
    zoom: G.ZOOMS[raw.zoom] ? raw.zoom : defaultZoom(tree),
    cols: new Set(list(raw.cols).filter((c) => typeof c === 'string')),
    deps: raw.deps !== false,
    baseline: raw.baseline === true,
    critical: raw.critical === true,
    gw: Number(raw.gw) > 0 ? Number(raw.gw) : null,
  };
}

function savePrefs() {
  if (!state.project || !state.prefs) return;
  const known = (set) => [...set].filter((uid) => state.tree.index.has(uid));
  const p = state.prefs;
  saveStored(`p:${state.project.id}`, {
    v: 3, // lignes réduites non gardées : voir loadPrefs
    hidden: known(p.hidden), zoom: p.zoom, cols: [...p.cols],
    deps: p.deps, baseline: p.baseline, critical: p.critical, gw: p.gw,
  });
}

/* ------------------------------------------------------------- Réseau */

class ViewerError extends Error {
  constructor(kind, status) {
    super(kind);
    this.kind = kind; // network | notfound | key | invalid
    this.status = status || 0;
  }
}

async function fetchSealed(path) {
  let res;
  try {
    res = await fetch(`${path}?t=${G.minuteBucket()}`, { cache: 'no-store', credentials: 'omit' });
  } catch {
    throw new ViewerError('network');
  }
  if (res.status === 404) throw new ViewerError('notfound', 404);
  if (!res.ok) throw new ViewerError('network', res.status);
  let envelope;
  try {
    envelope = await res.json();
  } catch {
    throw new ViewerError('invalid');
  }
  const out = G.openEnvelope(envelope, state.link.key, window.nacl);
  if (!out.ok) throw new ViewerError(out.reason);
  return out.data;
}

/* ------------------------------------------------- Écrans d'état et avis */

const ERRORS = {
  link: {
    icon: 'i-lock', title: 'Lien incomplet',
    text: 'Ce lien ne contient pas la clé d\'accès aux plannings. Ouvrez le lien complet reçu de votre gestionnaire : il se termine par « #k= » suivi d\'une longue suite de caractères.',
  },
  key: {
    icon: 'i-lock', title: 'Ce lien ne fonctionne plus',
    text: 'La clé d\'accès aux plannings a été changée. Demandez le nouveau lien à votre gestionnaire.',
  },
  empty: {
    icon: 'i-folder', title: 'Aucun projet publié',
    text: 'Aucun planning n\'est publié pour le moment. Cette page vérifie chaque minute ; revenez plus tard.',
  },
  missing: {
    icon: 'i-folder', title: 'Projet introuvable',
    text: 'Ce projet n\'est plus publié ou le lien est incorrect. Choisissez un projet ci-dessous.',
  },
  network: {
    icon: 'i-cloud-off', title: 'Connexion impossible',
    text: 'Le planning n\'a pas pu être téléchargé. Vérifiez votre connexion Internet, puis réessayez.',
    action: 'retry',
  },
  invalid: {
    icon: 'i-alert', title: 'Planning illisible',
    text: 'Les données reçues sont incomplètes ou dans un format inattendu. Rechargez la page ; si le problème persiste, prévenez votre gestionnaire.',
    action: 'reload',
  },
  newer: {
    icon: 'i-refresh', title: 'Page à mettre à jour',
    text: 'Ce planning utilise un format plus récent que cette page. Rechargez la page pour obtenir la dernière version.',
    action: 'reload',
  },
  page: {
    icon: 'i-alert', title: 'Page incomplète',
    text: 'Un fichier de la page n\'a pas pu être chargé. Rechargez la page.',
    action: 'reload',
  },
};

function showMain(visible) {
  el.phead.hidden = !visible;
  el.toolbar.hidden = !visible;
  el.gantt.hidden = !visible;
  el.state.hidden = visible;
  if (!visible) {
    closeSheet();
    closeMenus();
  }
}

function showLoading(text = 'Chargement du planning…') {
  showMain(false);
  el.stateCard.replaceChildren(h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', { class: 'state-text' }, text));
}

function showError(kind) {
  const e = ERRORS[kind] || ERRORS.invalid;
  state.project = null;
  state.tree = null;
  closeDetail();
  showMain(false);
  clearNotice();
  document.title = 'Avancement des projets · Zeal Motor';
  const red = kind === 'key' || kind === 'link';
  const children = [
    h('div', { class: `state-icon${red ? ' red' : ''}` }, icon(e.icon)),
    h('h2', null, e.title),
    h('p', { class: 'state-text' }, e.text),
  ];
  const actions = h('div', { class: 'state-actions' });
  if (e.action === 'retry') actions.append(h('button', { type: 'button', class: 'btn primary', on: { click: () => start() } }, 'Réessayer'));
  if (e.action === 'reload') actions.append(h('button', { type: 'button', class: 'btn primary', on: { click: () => window.location.reload() } }, 'Recharger la page'));
  if (actions.childNodes.length) children.push(actions);
  if (kind === 'missing' && state.index && state.index.projects.length) {
    children.push(h('ul', { class: 'state-projects' }, state.index.projects.map((p) => h('li', null,
      h('button', { type: 'button', class: 'btn', on: { click: () => openProject(p.id) } },
        h('span', null, p.name), h('span', { class: 'nav-pct' }, G.formatPercent(p.percent_complete)))))));
  }
  el.stateCard.replaceChildren(...children);
  renderNav();
  renderSync();
}

function setNotice(text, { iconName = 'i-cloud-off', action = null } = {}) {
  const parts = [icon(iconName), h('span', null, text)];
  if (action) parts.push(h('button', { type: 'button', class: 'btn', on: { click: action.run } }, action.label));
  el.notice.replaceChildren(...parts);
  el.notice.hidden = false;
}

function clearNotice() {
  el.notice.hidden = true;
  el.notice.replaceChildren();
}

let toastTimer = 0;
function toast(text) {
  let node = document.querySelector('.toast');
  if (!node) {
    node = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(node);
  }
  node.textContent = text;
  requestAnimationFrame(() => node.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 4000);
}

function renderSync() {
  if (!state.link || !state.lastCheck) { el.sync.hidden = true; return; }
  el.sync.hidden = false;
  el.sync.classList.toggle('offline', state.offline);
  el.sync.classList.toggle('busy', state.busy);
  el.syncText.textContent = state.offline ? 'Hors ligne' : `Vérifié à ${localTime(new Date(state.lastCheck))}`;
}

/* ------------------------------------------------------------ Chargement */

async function start() {
  const link = G.parseHash(window.location.hash);
  const key = G.keyFromLink(link.k);
  state.generation++;
  state.index = null;
  state.project = null;
  state.offline = false;
  clearNotice();
  if (!window.nacl || !window.nacl.secretbox) { showError('page'); return; }
  if (!key) { state.link = null; showError('link'); return; }
  // withProject : lien ouvert avec « &p= » (lien d'un projet précis). Sinon, l'adresse
  // reste exactement le lien partagé : elle n'est jamais réécrite (dernier projet vu
  // gardé dans ce navigateur).
  state.link = { k: link.k, key, withProject: Boolean(link.p) };
  state.pid = link.p && ID_RE.test(link.p) ? link.p : (link.p ? '\u0000' : null);
  showLoading();
  await loadIndex({ openAfter: true });
}

// Télécharge l'index. Renvoie false si une erreur a été affichée.
async function loadIndex({ openAfter }) {
  const gen = state.generation;
  let index;
  try {
    index = await fetchSealed('data/index.json');
  } catch (err) {
    if (gen !== state.generation) return false;
    state.lastCheck = Date.now();
    handleLoadError(err, 'index');
    return false;
  }
  if (gen !== state.generation) return false;
  state.lastCheck = Date.now();
  if (!G.validIndex(index)) { showError(index && index.v > 1 ? 'newer' : 'invalid'); return false; }
  state.index = index;
  setOffline(false);
  renderNav();
  if (!index.projects.length) { showError('empty'); return false; }
  if (!openAfter) return true;
  let id = state.pid;
  if (id && !index.projects.some((p) => p.id === id)) { showError('missing'); return false; }
  if (!id) {
    const last = state.ui.last;
    id = index.projects.some((p) => p.id === last) ? last : index.projects[0].id;
  }
  await openProject(id);
  return true;
}

function handleLoadError(err, what) {
  const kind = err instanceof ViewerError ? err.kind : 'invalid';
  if (kind === 'network' && state.project) { setOffline(true); return; }
  if (kind === 'network') { showError('network'); return; }
  if (kind === 'notfound') { showError(what === 'index' ? 'empty' : 'missing'); return; }
  if (kind === 'invalid' && state.project) {
    setNotice('Les dernières données reçues sont illisibles : affichage de la version précédente.', { iconName: 'i-alert' });
    return;
  }
  showError(kind === 'key' ? 'key' : 'invalid');
}

async function openProject(id, { preserve = false } = {}) {
  if (!ID_RE.test(id)) { showError('missing'); return; }
  const gen = ++state.generation;
  const switching = !state.project || state.project.id !== id;
  if (switching) {
    closeNav();
    closeDetail();
    showLoading();
  }
  let data;
  try {
    data = await fetchSealed(`data/${encodeURIComponent(id)}.json`);
  } catch (err) {
    if (gen !== state.generation) return;
    if (switching) state.project = null;
    state.pid = id;
    handleLoadError(err, 'project');
    return;
  }
  if (gen !== state.generation) return;
  if (!G.validProject(data)) { showError(data && data.v > 1 ? 'newer' : 'invalid'); return; }
  applyProject(data, preserve && !switching);
}

function setOffline(offline) {
  state.offline = offline;
  if (offline && state.project) {
    const when = G.relativeTime(state.project.converted_at);
    setNotice(`Hors ligne : affichage des dernières données reçues (publiées ${when}). Nouvel essai automatique chaque minute.`,
      { action: { label: 'Réessayer', run: () => checkUpdates() } });
  } else if (!offline) {
    clearNotice();
  }
  renderSync();
}

function setHashProject(id) {
  if (!state.link.withProject) return;
  const hash = G.buildHash(state.link.k, id);
  if (window.location.hash !== hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
  }
}

/* --------------------------------------------------- Projet et affichage */

function metrics() {
  const phone = window.matchMedia('(max-width: 759px)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return { phone, rowH: phone || coarse ? 40 : 30, hh: phone || coarse ? 24 : 22 };
}

function applyProject(data, preserve) {
  const view = preserve ? captureView() : null;
  const previous = state.tree;
  state.project = data;
  state.pid = data.id;
  state.tree = G.buildTree(data.tasks);
  if (!preserve) {
    state.prefs = loadPrefs(data, state.tree);
    state.selected = -1;
    state.cur = -1;
    // Filtre gardé d'un projet à l'autre : ses résultats doivent rester visibles.
    state.filterSig = null;
    openFilterResults();
  } else {
    const i = view.selectedUid != null ? state.tree.index.get(view.selectedUid) : undefined;
    state.selected = i != null ? i : -1;
    // Nouveau groupe (projet ajouté à une vue fusionnée, nouvelle tâche récapitulative) :
    // fermé, comme à l'ouverture, au lieu d'arriver tout développé.
    const t = state.tree;
    for (let k = 0; k < t.n; k++) {
      if (t.children[k].length && !(previous && previous.index.has(t.tasks[k].uid))) state.prefs.collapsed.add(t.tasks[k].uid);
    }
  }
  state.ui.last = data.id;
  saveUi();
  setHashProject(data.id);

  showMain(true);
  if (!state.offline) clearNotice();
  const m = metrics();
  Object.assign(state, m);
  setVar('--rh', `${state.rowH}px`);
  setVar('--hh', `${state.hh}px`);
  el.app.classList.toggle('phone', state.phone);

  buildColumns();
  renderHeader();
  renderNav();
  renderToolbar();
  fitToolbar();
  computeGridWidth();
  computeScale();
  computeRows();
  renderAll();

  if (view) {
    restoreView(view);
  } else {
    el.sc.scrollTop = 0;
    scrollToStart();
  }
  renderWindow(true);
  if (state.detail) renderDetail();
  renderSync();
}

function captureView() {
  const t = state.tree;
  return {
    top: el.sc.scrollTop,
    leftDate: state.scale ? G.dateAt(state.scale, el.sc.scrollLeft) : null,
    selectedUid: state.selected >= 0 && t ? t.tasks[state.selected].uid : null,
    detail: state.detail,
  };
}

function restoreView(view) {
  if (state.selected < 0) closeDetail();
  el.sc.scrollTop = view.top;
  if (view.leftDate != null) el.sc.scrollLeft = Math.max(0, G.xOf(state.scale, view.leftDate));
}

function scrollToStart() {
  const p = state.project;
  const s = G.parseDate(p.start);
  const f = G.parseDate(p.finish);
  if (s != null && f != null && state.today >= s && state.today <= f) scrollToDate(state.today, 0.3);
  else scrollToDate(s != null ? s - 2 * G.DAY : state.scale.start, 0);
}

function chartViewWidth() {
  return Math.max(0, el.sc.clientWidth - state.gw);
}

function scrollToDate(ms, fraction) {
  el.sc.scrollLeft = Math.max(0, G.xOf(state.scale, ms) - fraction * chartViewWidth());
}

// Colonnes possibles ; prio : ordre de conservation quand la liste est étroite
// (0 = toujours affichée).
function buildColumns() {
  const p = state.project;
  const prefs = state.prefs;
  const cols = [{ key: 'id', label: 'N°', w: state.phone ? 40 : 44, num: true, prio: 0 }, { key: 'name', label: 'Nom de la tâche', prio: 0 }];
  if (!state.phone) {
    cols.push(
      { key: 'start', label: 'Début', w: 106, prio: 3 },
      { key: 'finish', label: 'Fin', w: 106, prio: 2 },
      { key: 'dur', label: 'Durée', w: 66, num: true, prio: 4 },
      { key: 'pct', label: '% achevé', w: 100, prio: 1 },
    );
    let prio = 5;
    if (prefs.cols.has('resources')) cols.push({ key: 'resources', label: 'Ressources', w: 170, prio: prio++ });
    for (const c of p.columns || []) {
      if (c && prefs.cols.has(`c:${c.key}`)) cols.push({ key: `c:${c.key}`, label: c.label, w: 104, custom: c.key, prio: prio++ });
    }
  }
  state.allCols = cols;
  state.fixedW = cols.reduce((s, c) => s + (c.w || 0), 0);
  state.colSig = '';
}

// Colonnes qui tiennent dans la largeur de la liste : celles qui ne tiennent
// pas sont retirées (les moins utiles d'abord) plutôt que coupées.
// Renvoie true si la liste des colonnes a changé.
function fitColumns() {
  const nameMin = state.phone ? 110 : 150;
  let room = state.gw - nameMin;
  const keep = new Set();
  for (const c of state.allCols.filter((x) => x.prio === 0)) { keep.add(c.key); room -= c.w || 0; }
  for (const c of state.allCols.filter((x) => x.prio > 0).sort((a, b) => a.prio - b.prio)) {
    if (c.w <= room) { keep.add(c.key); room -= c.w; }
  }
  const cols = state.allCols.filter((c) => keep.has(c.key));
  const sig = cols.map((c) => c.key).join(',');
  if (sig === state.colSig) return false;
  state.colSig = sig;
  state.cols = cols;
  setVar('--cols', cols.map((c) => (c.w ? `${c.w}px` : `minmax(${nameMin}px, 1fr)`)).join(' '));
  return true;
}

function gridBounds() {
  const avail = el.gantt.clientWidth || window.innerWidth;
  const min = state.phone ? 150 : 220;
  const max = Math.max(min, Math.min(avail - (state.phone ? 110 : 180), state.fixedW + 640));
  return { avail, min, max };
}

function computeGridWidth() {
  const { avail, min, max } = gridBounds();
  let w;
  if (state.phone) w = Math.min(state.fixedW + 160, Math.round(avail * 0.5));
  else w = state.prefs.gw || clamp(state.fixedW + 220, 360, Math.round(avail * 0.54));
  state.gw = Math.round(clamp(w, min, max));
  setVar('--gw', `${state.gw}px`);
  fitColumns();
  el.splitter.setAttribute('aria-valuenow', String(state.gw));
  el.splitter.setAttribute('aria-valuemin', String(min));
  el.splitter.setAttribute('aria-valuemax', String(max));
}

function computeScale() {
  const p = state.project;
  const range = G.timeRange(state.tree, state.prefs.zoom, {
    today: state.today,
    statusDate: G.parseDate(p.status_date),
    projectStart: G.parseDate(p.start),
    projectFinish: G.parseDate(p.finish),
  });
  const minWidth = Math.max(0, (el.gantt.clientWidth || window.innerWidth) - state.gw);
  state.scale = G.createScale(range, state.prefs.zoom, minWidth);
  state.ticks = G.timescale(state.scale);
}

function activeFilter() {
  return { ...state.filter, text: state.qFilter ? state.q : '' };
}

function computeRows() {
  const p = state.prefs;
  state.vis = G.computeVisible(state.tree, {
    collapsed: p.collapsed, hidden: p.hidden, filter: activeFilter(), search: state.q, today: state.today,
  });
  state.pos = G.rowPositions(state.tree, state.vis.rows);
  state.links = G.visibleLinks(state.tree, state.pos);
  if (state.cur >= state.vis.matches.length) state.cur = -1;
}

function layout() {
  const n = state.vis.rows.length;
  const height = n ? n * state.rowH : 140;
  state.canvasH = state.hh * 2 + height;
  el.canvas.style.width = `${state.gw + state.scale.width}px`;
  el.canvas.style.height = `${state.canvasH}px`;
  el.body.style.height = `${height}px`;
  el.cbody.style.width = `${state.scale.width}px`;
  el.thead.style.width = `${state.scale.width}px`;
  el.sc.setAttribute('aria-rowcount', String(n + 1));
}

function renderAll() {
  layout();
  renderGridHeader();
  renderScale();
  renderMarkers();
  renderWindow(true);
}

// Après un changement de lignes affichées (réduction, filtre, recherche…).
function refreshRows() {
  computeRows();
  layout();
  // Liste raccourcie (Tout réduire, filtre…) : ne pas rester sous la dernière ligne.
  const maxTop = Math.max(0, state.canvasH - el.sc.clientHeight);
  if (el.sc.scrollTop > maxTop) el.sc.scrollTop = maxTop;
  renderWindow(true);
  updateSearchUi();
  updateHiddenUi();
  updateFilterUi();
  if (state.detail) {
    if (state.selected >= 0 && state.pos[state.selected] < 0 && isHiddenOrFiltered(state.selected)) closeDetail();
    else renderDetail();
  }
}

function isHiddenOrFiltered(i) {
  // Ligne exclue (masquée ou filtrée), et non simplement repliée.
  const t = state.tree;
  for (let a = i; a >= 0; a = t.parent[a]) if (state.prefs.hidden.has(t.tasks[a].uid)) return true;
  return G.filterActive(activeFilter()) && !G.matchesFilter(t, i, activeFilter(), state.today);
}

/* ---------------------------------------------------------- En-tête */

function renderHeader() {
  const p = state.project;
  if (!p) return;
  el.pName.textContent = p.name;
  el.pName.title = p.title && p.title !== p.name ? `${p.name} (${p.title})` : p.name;
  const s = G.parseDate(p.start);
  const f = G.parseDate(p.finish);
  const items = [];
  if (s != null || f != null) items.push(h('span', null, h('b', null, `${G.formatDate(s)} → ${G.formatDate(f)}`)));
  // Vue fusionnée : plusieurs projets réunis, un groupe par projet.
  const merged = Array.isArray(p.merged_from) ? p.merged_from.filter((m) => m && typeof m.name === 'string') : null;
  if (merged) {
    items.push(h('span', { class: 'merged', title: merged.map((m) => m.name).join(' · ') },
      `Vue fusionnée : ${merged.length} projet${merged.length > 1 ? 's' : ''}`));
  }
  const saved = G.parseDate(p.saved_at);
  if (saved != null) {
    items.push(h('span', { class: 'opt' }, `${merged ? 'Dernier enregistrement' : 'Enregistré'} dans Project le ${G.formatDateTime(saved)}`));
  }
  const published = G.relativeTime(p.converted_at);
  if (published) items.push(h('span', null, `Publié ${published}`));
  const status = G.parseDate(p.status_date);
  if (status != null) items.push(h('span', { class: 'opt status-date' }, `Date d'état : ${G.formatDate(status)}`));
  el.pMeta.replaceChildren(...items);
  const pct = clamp(Number(p.percent_complete) || 0, 0, 100);
  el.pPct.textContent = G.formatPercent(pct);
  el.pBar.style.width = `${pct}%`;
  el.pBar.parentElement.setAttribute('role', 'progressbar');
  el.pBar.parentElement.setAttribute('aria-valuenow', String(pct));
  el.pBar.parentElement.setAttribute('aria-label', 'Avancement global');
  document.title = `${p.name} · Avancement des projets`;
}

function renderNav() {
  const list = state.index ? state.index.projects : [];
  const wide = isWide();
  if (state.ui.nav == null && wide) el.app.classList.toggle('nav-collapsed', list.length < 2);
  el.navList.replaceChildren(...list.map((p) => {
    const current = state.project ? state.project.id === p.id : state.pid === p.id;
    const f = G.parseDate(p.finish);
    const late = f != null && f < state.today && Number(p.percent_complete) < 100;
    const published = G.relativeTime(p.converted_at);
    const merged = Number(p.merged_count) > 0 ? `Vue fusionnée · ${p.merged_count} projet${p.merged_count > 1 ? 's' : ''}` : null;
    const sub = [merged, f != null ? `Fin : ${G.formatDate(f)}` : null, published ? `publié ${published}` : null].filter(Boolean).join(' · ');
    return h('li', null, h('button', {
      type: 'button', class: 'nav-item', 'aria-current': current ? 'page' : null, dataset: { id: p.id },
      on: { click: () => { if (!state.project || state.project.id !== p.id) openProject(p.id); else closeNav(); } },
    },
    h('span', { class: 'nav-name' }, p.name),
    h('span', { class: 'nav-prog' }, minibar(p.percent_complete, Number(p.percent_complete) >= 100 ? ' done' : (late ? ' late' : '')),
      h('span', { class: 'nav-pct' }, G.formatPercent(p.percent_complete))),
    sub ? h('span', { class: 'nav-sub' }, sub) : null));
  }));
  if (!list.length) el.navList.replaceChildren(h('li', { class: 'nav-sub' }, '—'));
}

/* ------------------------------------------------- Barre d'outils */

function renderToolbar() {
  const t = state.tree;
  const p = state.prefs;
  if (!el.fStatus.options.length) {
    el.fStatus.replaceChildren(...G.STATUS_FILTERS.map((f) => h('option', { value: f.value }, f.label)));
  }
  el.fStatus.value = state.filter.status;
  const levels = [];
  for (let l = 1; l < t.maxDepth; l++) {
    levels.push(h('button', {
      type: 'button', class: 'btn', dataset: { level: l },
      title: l === 1 ? 'Niveau 1 seulement' : `Niveaux 1 à ${l}`, 'aria-label': l === 1 ? 'Niveau 1 seulement' : `Niveaux 1 à ${l}`,
    }, String(l)));
  }
  el.levels.replaceChildren(...levels);
  el.levels.hidden = !levels.length;
  $('levelTitle').hidden = !levels.length;
  for (const b of el.zoomSeg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.zoom === p.zoom));
  el.optDeps.checked = p.deps;
  el.optBaseline.checked = p.baseline;
  el.optCritical.checked = p.critical;
  const cols = [{ key: 'resources', label: 'Ressources' }, ...(state.project.columns || []).map((c) => ({ key: `c:${c.key}`, label: c.label }))];
  el.colOptions.replaceChildren(...cols.map((c) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', dataset: { col: c.key }, checked: p.cols.has(c.key) }), h('span', null, c.label))));
  el.colSection.hidden = state.phone;
  updateSearchUi();
  updateHiddenUi();
  updateFilterUi();
}

function periodText(f) {
  if (f.from != null && f.to != null) return `${G.formatDayMonth(f.from)} → ${G.formatDayMonth(f.to)}`;
  if (f.from != null) return `Depuis le ${G.formatDayMonth(f.from)}`;
  if (f.to != null) return `Jusqu'au ${G.formatDayMonth(f.to)}`;
  return 'Période';
}

function updateFilterUi() {
  const f = state.filter;
  const any = f.status !== 'all' || f.from != null || f.to != null;
  el.fReset.hidden = !any;
  el.fStatus.parentElement.classList.toggle('active', f.status !== 'all');
  el.periodBtn.classList.toggle('active', f.from != null || f.to != null);
  const label = periodText(f);
  if (el.periodLabel.textContent !== label) {
    el.periodLabel.textContent = label;
    fitToolbar();
  }
  el.moreDot.hidden = !any;
}

// Barre d'outils sur une seule ligne si possible : sinon, certains boutons
// n'affichent plus que leur icône (le texte reste dans l'infobulle).
function fitToolbar() {
  const tb = el.toolbar;
  tb.classList.remove('compact', 'compact2');
  if (tb.hidden || state.phone) return;
  const oneRow = () => tb.clientHeight <= el.q.parentElement.offsetHeight + 20;
  if (oneRow()) return;
  tb.classList.add('compact');
  if (oneRow()) return;
  tb.classList.add('compact2');
  // Deux lignes de toute façon : on garde les libellés.
  if (!oneRow()) tb.classList.remove('compact', 'compact2');
}

function updateSearchUi() {
  const m = state.vis ? state.vis.matches : [];
  const q = state.q.trim();
  el.qCount.classList.toggle('none', !!q && !m.length);
  el.qCount.textContent = !q ? '' : (!m.length ? 'Aucun résultat' : (state.cur >= 0 ? `${state.cur + 1} / ${m.length}` : `${m.length} résultat${m.length > 1 ? 's' : ''}`));
  el.qPrev.disabled = !m.length;
  el.qNext.disabled = !m.length;
  el.qFilter.setAttribute('aria-pressed', String(state.qFilter));
}

function updateHiddenUi() {
  const t = state.tree;
  const uids = [...state.prefs.hidden].filter((uid) => t.index.has(uid));
  el.hiddenLabel.textContent = `(${uids.length})`;
  el.hiddenBtn.setAttribute('aria-label', `Lignes masquées (${uids.length})`);
  el.hiddenBtn.title = `Lignes masquées (${uids.length})`;
  const changed = el.hiddenWrap.hidden !== !uids.length;
  el.hiddenWrap.hidden = !uids.length;
  if (changed) fitToolbar();
  if (!uids.length) closeMenu(el.hiddenBtn, el.hiddenMenu);
  uids.sort((a, b) => t.index.get(a) - t.index.get(b));
  el.hiddenList.replaceChildren(...uids.map((uid) => {
    const task = t.tasks[t.index.get(uid)];
    return h('li', null,
      h('span', { class: 'hl-id' }, String(task.id)),
      h('span', { class: 'hl-name', title: task.name }, task.name),
      h('button', { type: 'button', class: 'btn', on: { click: () => restoreRows([uid]) } }, icon('i-eye'), 'Réafficher'));
  }));
}

/* --------------------------------------------------------- Échelle */

function renderGridHeader() {
  el.ghead.replaceChildren(...state.cols.map((c) => h('div', {
    class: `hc${c.num ? ' num' : ''}`, role: 'columnheader', title: c.label,
  }, c.label)));
}

function tickNode(t, extra = '') {
  const node = h('div', { class: `tk${extra}`, title: t.title });
  px(node, { left: t.x, width: t.w });
  return node;
}

function renderScale() {
  const { top, bottom } = state.ticks;
  const tierTop = h('div', { class: 'tier top' });
  const tierBottom = h('div', { class: 'tier bottom' });
  for (const t of top) {
    const node = tickNode(t);
    node.append(h('span', null, t.label));
    tierTop.append(node);
  }
  for (const t of bottom) {
    const now = state.today >= t.start && state.today < t.end;
    const node = tickNode(t, `${t.weekend ? ' we' : ''}${now ? ' now' : ''}`);
    node.textContent = t.label;
    tierBottom.append(node);
  }
  el.thead.replaceChildren(tierTop, tierBottom);
  const frag = document.createDocumentFragment();
  for (const band of G.weekendBands(state.scale)) frag.append(px(h('div', { class: 'we-band' }), { left: band.x, width: band.w }));
  for (const t of bottom) frag.append(px(h('div', { class: 'gl' }), { left: t.x }));
  for (const t of top) frag.append(px(h('div', { class: 'gl major' }), { left: t.x }));
  el.cgrid.replaceChildren(frag);
}

function renderMarkers() {
  const lines = [];
  const tags = [];
  const s = state.scale;
  const inRange = (ms) => ms != null && ms >= s.start && ms <= s.end;
  let todayTag = null;
  let todayX = null;
  if (inRange(state.today)) {
    todayX = G.xOf(s, state.today);
    lines.push(px(h('div', { class: 'mk', title: `Aujourd'hui : ${G.formatDate(state.today)}` }), { left: todayX - 1 }));
    todayTag = px(h('div', { class: 'mk-tag' }, 'Aujourd\'hui'), { left: todayX });
    tags.push(todayTag);
  }
  const status = G.parseDate(state.project.status_date);
  if (inRange(status)) {
    const x = G.xOf(s, status);
    lines.push(px(h('div', { class: 'mk status', title: `Date d'état : ${G.formatDate(status)}` }), { left: x - 1 }));
    const tag = px(h('div', { class: 'mk-tag status' }, 'Date d\'état'), { left: x });
    // Étiquettes proches : chacune se place de son côté de sa ligne.
    if (todayTag && Math.abs(todayX - x) < 110) {
      const [first, second] = x <= todayX ? [tag, todayTag] : [todayTag, tag];
      first.classList.add('to-left');
      second.classList.add('to-right');
    }
    tags.push(tag);
  }
  el.markers.replaceChildren(...lines);
  el.thead.append(...tags);
}

/* ------------------------------------------------- Lignes (virtualisées) */

function emptyNode() {
  const filtered = state.vis.filterActive;
  const node = h('div', { class: 'empty-rows' },
    h('span', null, filtered ? 'Aucune tâche ne correspond aux filtres.' : 'Aucune tâche à afficher.'));
  if (filtered) node.append(h('button', { type: 'button', class: 'btn', on: { click: resetFilters } }, 'Effacer les filtres'));
  else if (state.vis.hiddenCount) node.append(h('button', { type: 'button', class: 'btn', on: { click: () => restoreRows([...state.prefs.hidden]) } }, 'Réafficher les lignes masquées'));
  return node;
}

function viewRows() {
  return Math.max(1, el.sc.clientHeight - state.hh * 2);
}

function renderWindow(force) {
  if (!state.vis || el.gantt.hidden) return;
  const n = state.vis.rows.length;
  const R = state.rowH;
  const top = Math.max(0, el.sc.scrollTop);
  const [v0, v1] = G.rowWindow(top, viewRows(), R, n, 0);
  const [r0, r1] = state.rendered;
  const margin = 4;
  if (!force && v0 >= r0 && v1 <= r1 && (v0 - r0 >= margin || r0 === 0) && (r1 - v1 >= margin || r1 === n)) return;
  const win = G.rowWindow(top, viewRows(), R, n, RENDER_BUFFER);
  state.rendered = win;
  renderGridRows(win[0], win[1]);
  renderBars(win[0], win[1]);
  renderLinks(win[0], win[1]);
  updateSelectionDom();
}

function currentMatch() {
  return state.cur >= 0 && state.vis.matches.length ? state.vis.matches[state.cur] : -1;
}

function renderGridRows(r0, r1) {
  const frag = document.createDocumentFragment();
  for (let k = r0; k < r1; k++) frag.append(gridRow(k));
  if (!state.vis.rows.length) frag.append(emptyNode());
  el.gbody.replaceChildren(frag);
}

function nameNode(name) {
  const node = h('span', { class: 'name-text' });
  const ranges = state.q.trim() ? G.findMatches(name, state.q) : [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) node.append(name.slice(at, a));
    node.append(h('mark', null, name.slice(a, b)));
    at = b;
  }
  if (at < name.length) node.append(name.slice(at));
  return node;
}

function gridRow(k) {
  const tr = state.tree;
  const i = state.vis.rows[k];
  const t = tr.tasks[i];
  const parent = tr.children[i].length > 0;
  const collapsed = parent && state.prefs.collapsed.has(t.uid);
  const status = G.taskStatus(t, state.today);
  const cls = ['row', `lvl${tr.depth[i]}`];
  if (parent || t.summary) cls.push('summary');
  if (status === 'done') cls.push('done');
  if (i === currentMatch()) cls.push('cur');
  const row = h('div', {
    class: cls.join(' '), role: 'row', id: `row-${t.uid}`, 'aria-level': tr.depth[i], 'aria-rowindex': k + 2,
    'aria-selected': 'false', 'aria-expanded': parent ? String(!collapsed) : null, dataset: { k },
  });
  row.style.top = `${k * state.rowH}px`;
  for (const c of state.cols) {
    let cell;
    switch (c.key) {
      case 'id':
        cell = h('div', { class: 'cell num c-id', role: 'gridcell' }, String(t.id));
        break;
      case 'name': {
        cell = h('div', { class: 'cell c-name ind', role: 'gridcell', title: t.name });
        cell.style.setProperty('--ind', `${(tr.depth[i] - 1) * (state.phone ? 12 : 16)}px`);
        if (parent) {
          cell.append(h('button', {
            type: 'button', class: `chev${collapsed ? '' : ' open'}`, tabindex: '-1', dataset: { act: 'toggle' },
            'aria-label': collapsed ? 'Développer' : 'Réduire', title: collapsed ? 'Développer' : 'Réduire',
          }, icon('i-chev', '')));
        } else {
          cell.append(h('span', { class: 'chev-sp' }));
        }
        if (status === 'late') cell.append(h('span', { class: 'ind-late', title: 'En retard' }));
        else if (t.milestone) cell.append(h('span', { class: 'ind-ms', title: 'Jalon' }));
        cell.append(nameNode(t.name));
        break;
      }
      case 'start':
        cell = h('div', { class: 'cell c-date', role: 'gridcell' }, G.formatDate(tr.start[i]));
        break;
      case 'finish':
        cell = h('div', { class: 'cell c-date', role: 'gridcell' }, G.formatDate(tr.finish[i]));
        break;
      case 'dur':
        cell = h('div', { class: 'cell num c-dur', role: 'gridcell' }, G.formatDuration(t.duration_days));
        break;
      case 'pct':
        cell = h('div', { class: 'cell c-pct', role: 'gridcell' }, h('span', { class: 'pct' },
          h('span', { class: 'pct-val' }, G.formatPercent(t.percent)),
          minibar(t.percent, status === 'done' ? ' done' : (status === 'late' ? ' late' : ''))));
        break;
      case 'resources': {
        const text = (t.resources || []).join(', ');
        cell = h('div', { class: 'cell c-res', role: 'gridcell', title: text || null }, text);
        break;
      }
      default: {
        const text = c.custom && t.custom ? (t.custom[c.custom] ?? '') : '';
        cell = h('div', { class: 'cell c-cus', role: 'gridcell', title: text || null }, text);
      }
    }
    row.append(cell);
  }
  return row;
}

function geometry(i) {
  return G.barGeometry(state.tree, i, state.scale, state.rowH, { baseline: state.prefs.baseline });
}

function barTitle(t, i) {
  const tr = state.tree;
  const range = t.milestone ? G.formatDate(tr.start[i]) : `${G.formatDate(tr.start[i])} → ${G.formatDate(tr.finish[i])}`;
  return `${t.id} · ${t.name}\n${range} · ${G.formatPercent(t.percent)}`;
}

function renderBars(r0, r1) {
  const frag = document.createDocumentFragment();
  const tr = state.tree;
  const R = state.rowH;
  const cur = currentMatch();
  for (let k = r0; k < r1; k++) {
    const i = state.vis.rows[k];
    const g = geometry(i);
    if (!g) continue;
    const t = tr.tasks[i];
    const top = k * R;
    const late = G.isLate(t, state.today);
    const crit = state.prefs.critical && t.critical;
    if (g.baseline) {
      const b = g.baseline;
      const node = h('div', { class: `base${b.diamond ? ' dia' : ''}` });
      if (b.diamond) {
        const side = b.w * 0.7071;
        px(node, { left: b.x + (b.w - side) / 2, top: top + b.y + (b.h - side) / 2, width: side, height: side });
      } else {
        px(node, { left: b.x, top: top + b.y, width: b.w, height: b.h });
      }
      frag.append(node);
    }
    let node;
    if (g.kind === 'milestone') {
      const side = g.w * 0.7071;
      node = h('div', { class: `ms${crit ? ' crit' : ''}${late ? ' late' : ''}${i === cur ? ' cur' : ''}` });
      px(node, { left: g.cx - side / 2, top: top + g.cy - side / 2, width: side, height: side });
    } else {
      const kind = g.kind === 'summary' ? 'sum' : 'bar';
      const cls = [kind];
      if (kind === 'bar') {
        if (crit) cls.push('crit');
        if (t.manual) cls.push('manual');
        if (late) cls.push('late');
      } else if (g.w < 16) cls.push('narrow');
      if (i === cur) cls.push('cur');
      node = h('div', { class: cls.join(' ') });
      px(node, { left: g.x, top: top + g.y, width: g.w, height: g.h });
      if (g.progressW > 0) node.append(px(h('div', { class: 'prog' }), { width: g.progressW }));
    }
    node.title = barTitle(t, i);
    frag.append(node);
    let x = g.labelX;
    const cy = top + g.cy;
    if (late) {
      frag.append(px(h('div', { class: 'late-tag', title: 'En retard' }, '!'), { left: x, top: cy }));
      x += 19;
    }
    const label = g.kind === 'milestone' ? G.formatDayShort(tr.start[i]) : (g.kind === 'task' ? (t.resources || []).join(', ') : '');
    if (label) frag.append(px(h('div', { class: `lbl${g.kind === 'milestone' ? ' ms-lbl' : ''}` }, label), { left: x, top: cy }));
  }
  el.bars.replaceChildren(frag);
}

function anchor(i, k) {
  const g = geometry(i);
  if (!g) return null;
  const top = k * state.rowH;
  return {
    row: k, x1: g.x1, x2: g.x2, cy: top + g.cy, top: top + g.y, bottom: top + g.y + g.h,
    milestone: g.kind === 'milestone',
  };
}

function renderLinks(r0, r1) {
  const node = el.links;
  if (!state.prefs.deps || !state.links.length) {
    // Taille remise à zéro : l'ancienne agrandirait la zone de défilement (hauteur et largeur).
    node.replaceChildren();
    node.style.top = '0px';
    node.setAttribute('width', '1');
    node.setAttribute('height', '1');
    return;
  }
  const R = state.rowH;
  const yOff = r0 * R;
  node.style.top = `${yOff}px`;
  node.setAttribute('width', String(state.scale.width));
  node.setAttribute('height', String(Math.max(1, (r1 - r0) * R)));
  const normal = svg('g');
  const critical = svg('g', { class: 'crit' });
  const tasks = state.tree.tasks;
  for (const L of state.links) {
    if (Math.max(L.a, L.b) < r0 || Math.min(L.a, L.b) >= r1) continue;
    const A = anchor(L.from, L.a);
    const B = anchor(L.to, L.b);
    if (!A || !B) continue;
    const { points, dir } = G.linkPath(A, B, L.type, R);
    const pts = points.map(([x, y]) => [x, y - yOff]);
    const group = state.prefs.critical && tasks[L.from].critical && tasks[L.to].critical ? critical : normal;
    group.append(svg('path', { d: G.pathData(pts) }));
    group.append(svg('polygon', { points: G.arrowHead(pts[pts.length - 1], dir, 5).map((p) => p.join(',')).join(' ') }));
  }
  node.replaceChildren(normal, critical);
}

/* -------------------------------------------------------- Sélection */

function updateSelectionDom() {
  const k = state.selected >= 0 ? state.pos[state.selected] : -1;
  for (const row of el.gbody.children) {
    const sel = Number(row.dataset.k) === k;
    row.classList.toggle('sel', sel);
    row.setAttribute('aria-selected', String(sel));
  }
  if (k >= 0) {
    el.hl.hidden = false;
    el.hl.style.top = `${k * state.rowH}px`;
    const id = `row-${state.tree.tasks[state.selected].uid}`;
    if (document.getElementById(id)) el.sc.setAttribute('aria-activedescendant', id);
    else el.sc.removeAttribute('aria-activedescendant');
  } else {
    el.hl.hidden = true;
    el.sc.removeAttribute('aria-activedescendant');
  }
}

function scrollRowIntoView(k) {
  const R = state.rowH;
  const y = k * R;
  const view = viewRows();
  if (y < el.sc.scrollTop) el.sc.scrollTop = y;
  else if (y + R > el.sc.scrollTop + view) el.sc.scrollTop = y + R - view;
}

// Fait défiler le diagramme jusqu'à la barre, si elle est hors de vue.
function scrollToTask(i) {
  const g = geometry(i);
  if (!g) return;
  const left = el.sc.scrollLeft;
  const width = chartViewWidth();
  if (g.x1 < left + 8 || g.x1 > left + width - 40) el.sc.scrollLeft = Math.max(0, g.x1 - Math.min(80, width * 0.15));
}

function select(i, { open = false, scroll = true } = {}) {
  state.selected = i;
  if (open) state.detail = true;
  if (scroll && i >= 0 && state.pos[i] >= 0) scrollRowIntoView(state.pos[i]);
  renderWindow(false);
  updateSelectionDom();
  if (state.detail) renderDetail();
}

/* ----------------------------------------------------------- Actions */

function toggleRow(i, expand) {
  const uid = state.tree.tasks[i].uid;
  const set = state.prefs.collapsed;
  const collapsed = set.has(uid);
  const want = expand == null ? !collapsed : !expand;
  if (want === collapsed || !state.tree.children[i].length) return;
  if (want) set.add(uid); else set.delete(uid);
  savePrefs();
  refreshRows();
  if (state.selected >= 0 && state.pos[state.selected] < 0 && G.ancestorsOf(state.tree, state.selected).includes(i)) select(i, { scroll: false });
}

function setCollapsed(set) {
  state.prefs.collapsed = set;
  savePrefs();
  refreshRows();
  if (state.selected >= 0 && state.pos[state.selected] < 0) {
    const visibleAncestor = G.ancestorsOf(state.tree, state.selected).find((a) => state.pos[a] >= 0);
    if (visibleAncestor != null) select(visibleAncestor, { scroll: false });
  }
}

function hideRow(i) {
  const k = state.pos[i];
  state.prefs.hidden.add(state.tree.tasks[i].uid);
  savePrefs();
  closeDetail();
  refreshRows();
  const rows = state.vis.rows;
  state.selected = rows.length ? rows[clamp(k, 0, rows.length - 1)] : -1;
  updateSelectionDom();
  toast('Ligne masquée. « Lignes masquées » permet de la réafficher.');
  el.sc.focus({ preventScroll: true });
}

function restoreRows(uids) {
  for (const uid of uids) state.prefs.hidden.delete(uid);
  savePrefs();
  // Lignes réaffichées : un filtre actif doit aussi montrer leurs résultats.
  state.filterSig = null;
  openFilterResults();
  refreshRows();
}

// Filtre appliqué (statut, période, nom), pour reconnaître un geste qui ne le
// change pas : il ne doit pas rouvrir les groupes refermés par l'utilisateur.
function filterSignature() {
  const f = activeFilter();
  return G.filterActive(f) ? [f.status, f.from, f.to, G.foldText(f.text || '').trim()].join('|') : '';
}

// Après un changement de filtre : ouvre les groupes qui cachent ses résultats.
function openFilterResults() {
  const sig = filterSignature();
  if (sig === state.filterSig) return;
  state.filterSig = sig;
  const p = state.prefs;
  const next = G.openForFilter(state.tree, p.collapsed, { hidden: p.hidden, filter: activeFilter(), today: state.today });
  if (next === p.collapsed) return;
  p.collapsed = next;
  savePrefs();
}

function resetFilters() {
  state.filter = { status: 'all', from: null, to: null };
  el.fStatus.value = 'all';
  el.fFrom.value = '';
  el.fTo.value = '';
  if (state.qFilter) { state.qFilter = false; }
  openFilterResults();
  refreshRows();
}

// Après un changement de filtre : haut de la liste, et diagramme amené sur la
// période choisie ou sur la première tâche trouvée.
function revealFilterResult() {
  const f = activeFilter();
  if (!G.filterActive(f)) return;
  el.sc.scrollTop = 0;
  if (f.from != null || f.to != null) {
    scrollToDate(f.from != null ? f.from : f.to - 7 * G.DAY, 0.05);
    return;
  }
  const t = state.tree;
  const first = state.vis.rows.find((i) => !t.children[i].length && G.matchesFilter(t, i, f, state.today));
  if (first != null) scrollToTask(first);
}

function goMatch(n) {
  const m = state.vis.matches;
  if (!m.length) { updateSearchUi(); return; }
  state.cur = ((n % m.length) + m.length) % m.length;
  const i = m[state.cur];
  // Développe les tâches parentes pour montrer le résultat.
  let changed = false;
  for (const a of G.ancestorsOf(state.tree, i)) {
    const uid = state.tree.tasks[a].uid;
    if (state.prefs.collapsed.delete(uid)) changed = true;
  }
  if (changed) { savePrefs(); computeRows(); layout(); }
  select(i, { scroll: true });
  scrollToTask(i);
  renderWindow(true);
  updateSearchUi();
}

function setZoom(zoom) {
  if (!G.ZOOMS[zoom] || !state.scale) return;
  const center = G.dateAt(state.scale, el.sc.scrollLeft + chartViewWidth() / 2);
  state.prefs.zoom = zoom;
  savePrefs();
  computeScale();
  renderAll();
  el.sc.scrollLeft = Math.max(0, G.xOf(state.scale, center) - chartViewWidth() / 2);
  for (const b of el.zoomSeg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.zoom === zoom));
}

function goToday() {
  const s = state.scale;
  if (state.today < s.start || state.today > s.end) {
    toast('Aujourd\'hui est en dehors de la période du planning.');
    scrollToDate(state.today < s.start ? s.start : s.end, state.today < s.start ? 0 : 1);
    return;
  }
  scrollToDate(state.today, 0.3);
}

function setGridWidth(w, commit) {
  const { min, max } = gridBounds();
  state.gw = Math.round(clamp(w, min, max));
  setVar('--gw', `${state.gw}px`);
  el.canvas.style.width = `${state.gw + state.scale.width}px`;
  el.splitter.setAttribute('aria-valuenow', String(state.gw));
  if (fitColumns()) { renderGridHeader(); renderWindow(true); }
  if (commit) {
    state.prefs.gw = state.gw;
    savePrefs();
    if (state.scale.width < chartViewWidth()) { computeScale(); renderAll(); }
  }
}

/* --------------------------------------------------- Détails de la tâche */

function closeDetail() {
  state.detail = false;
  el.detail.hidden = true;
  el.detail.replaceChildren();
}

function depButton(uid, type, lag) {
  const t = state.tree;
  const i = t.index.get(uid);
  if (i == null) return null;
  const task = t.tasks[i];
  const label = G.linkLabel(type);
  const lagText = G.formatLag(lag);
  const reachable = !isHiddenOrFiltered(i);
  return h('li', null, h('button', {
    type: 'button', class: 'dep', disabled: !reachable, title: reachable ? 'Afficher cette tâche' : 'Ligne masquée ou filtrée',
    on: { click: () => revealTask(i) },
  },
  h('span', { class: 'dep-id' }, String(task.id)),
  h('span', { class: 'dep-name' }, task.name),
  h('span', { class: 'dep-type' }, `${label.label} (${label.short})${lagText ? ` · décalage ${lagText}` : ''}`)));
}

function revealTask(i) {
  let changed = false;
  for (const a of G.ancestorsOf(state.tree, i)) if (state.prefs.collapsed.delete(state.tree.tasks[a].uid)) changed = true;
  if (changed) { savePrefs(); refreshRows(); }
  if (state.pos[i] < 0) return;
  select(i, { scroll: true });
  scrollToTask(i);
}

function dateLine(label, ms) {
  return [h('dt', null, label), h('dd', null, ms != null ? G.formatDateTime(ms) : '—')];
}

function renderDetail() {
  const i = state.selected;
  if (i < 0 || !state.tree || i >= state.tree.n) { closeDetail(); return; }
  const tr = state.tree;
  const t = tr.tasks[i];
  const status = G.taskStatus(t, state.today);
  const badges = [];
  if (tr.children[i].length || t.summary) badges.push(['Tâche récapitulative', 'dark']);
  if (t.milestone) badges.push(['Jalon', 'dark']);
  badges.push(status === 'done' ? ['Terminée', 'ok'] : status === 'late' ? ['En retard', 'red'] : status === 'progress' ? ['En cours', ''] : ['Non commencée', '']);
  if (t.critical) badges.push(['Critique', 'red']);
  if (t.manual) badges.push(['Planifiée manuellement', '']);

  const head = h('div', { class: 'd-head' },
    h('div', { class: 'd-titles' },
      h('div', { class: 'd-ref' }, `N° ${t.id}${t.wbs ? ` · WBS ${t.wbs}` : ''}`),
      h('h2', { class: 'd-name', id: 'detailTitle' }, t.name),
      h('div', { class: 'badges' }, badges.map(([text, cls]) => h('span', { class: `badge${cls ? ` ${cls}` : ''}` }, text)))),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer les détails', title: 'Fermer (Échap)', on: { click: () => { closeDetail(); el.sc.focus({ preventScroll: true }); } } }, icon('i-close')));

  const body = h('div', { class: 'd-body' });
  body.append(h('div', { class: 'd-prog' }, h('strong', null, G.formatPercent(t.percent)),
    minibar(t.percent, status === 'done' ? ' done' : (status === 'late' ? ' late' : '')), h('span', { class: 'd-none' }, 'achevé')));

  const main = h('dl', { class: 'd-grid' },
    dateLine('Début', G.parseDate(t.start)),
    dateLine('Fin', G.parseDate(t.finish)),
    h('dt', null, 'Durée'), h('dd', null, G.formatDuration(t.duration_days) || '—'),
    dateLine('Début réel', G.parseDate(t.actual_start)),
    dateLine('Fin réelle', G.parseDate(t.actual_finish)));
  for (const c of state.project.columns || []) {
    const v = t.custom ? t.custom[c.key] : null;
    if (v != null && v !== '') main.append(h('dt', null, c.label), h('dd', null, v));
  }
  body.append(h('section', { class: 'd-sec' }, main));

  const bs = G.parseDate(t.baseline_start);
  const bf = G.parseDate(t.baseline_finish);
  body.append(h('section', { class: 'd-sec' }, h('h3', null, 'Planification initiale'),
    bs != null || bf != null
      ? h('dl', { class: 'd-grid' }, dateLine('Début prévu', bs), dateLine('Fin prévue', bf))
      : h('p', { class: 'd-none' }, 'Aucune planification initiale enregistrée.')));

  body.append(h('section', { class: 'd-sec' }, h('h3', null, 'Ressources'),
    (t.resources || []).length
      ? h('div', { class: 'chips' }, t.resources.map((r) => h('span', { class: 'chip' }, r)))
      : h('p', { class: 'd-none' }, 'Aucune ressource affectée.')));

  const preds = (t.preds || []).map((p) => depButton(p.uid, p.type, p.lag_days)).filter(Boolean);
  body.append(h('section', { class: 'd-sec' }, h('h3', null, `Prédécesseurs (${preds.length})`),
    preds.length ? h('ul', { class: 'dep-list' }, preds) : h('p', { class: 'd-none' }, 'Aucun.')));
  const succs = tr.succ[i].map((s) => depButton(s.uid, s.type, s.lag_days)).filter(Boolean);
  body.append(h('section', { class: 'd-sec' }, h('h3', null, `Successeurs (${succs.length})`),
    succs.length ? h('ul', { class: 'dep-list' }, succs) : h('p', { class: 'd-none' }, 'Aucun.')));

  if (t.notes) body.append(h('section', { class: 'd-sec' }, h('h3', null, 'Notes'), h('p', { class: 'notes' }, t.notes)));

  body.append(h('div', { class: 'd-actions' }, h('button', {
    type: 'button', class: 'btn', on: { click: () => hideRow(i) },
  }, icon('i-eye-off'), 'Masquer cette ligne')));

  el.detail.setAttribute('aria-labelledby', 'detailTitle');
  el.detail.replaceChildren(head, body);
  el.detail.hidden = false;
}

/* ------------------------------------------- Menus, tiroir et feuille */

function isWide() {
  return window.matchMedia('(min-width: 1200px)').matches;
}

function closeNav() {
  el.app.classList.remove('nav-open');
  el.navBackdrop.hidden = true;
  if (!isWide()) el.navToggle.setAttribute('aria-expanded', 'false');
}

function toggleNav() {
  if (isWide()) {
    const collapsed = !el.app.classList.contains('nav-collapsed');
    el.app.classList.toggle('nav-collapsed', collapsed);
    state.ui.nav = !collapsed;
    saveUi();
    el.navToggle.setAttribute('aria-expanded', String(!collapsed));
  } else {
    const open = !el.app.classList.contains('nav-open');
    el.app.classList.toggle('nav-open', open);
    el.navBackdrop.hidden = !open;
    el.navToggle.setAttribute('aria-expanded', String(open));
    if (open) (el.navList.querySelector('[aria-current]') || el.navClose).focus();
  }
}

function openMenu(btn, menu) {
  closeMenus();
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  // Aligné à droite du bouton s'il dépasserait de l'écran.
  menu.classList.remove('menu-right');
  if (!state.phone && menu.getBoundingClientRect().right > window.innerWidth - 8) menu.classList.add('menu-right');
}

function closeMenu(btn, menu) {
  menu.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
}

const MENUS = [['periodBtn', 'periodMenu'], ['levelBtn', 'levelMenu'], ['viewBtn', 'viewMenu'], ['hiddenBtn', 'hiddenMenu']];

function closeMenus() {
  for (const [b, m] of MENUS) closeMenu(el[b], el[m]);
}

function anyMenuOpen() {
  return MENUS.some(([, m]) => !el[m].hidden);
}

function openSheet() {
  el.tools.classList.add('open');
  el.toolsBackdrop.hidden = false;
  el.moreBtn.setAttribute('aria-expanded', 'true');
  el.toolsClose.focus();
}

function closeSheet() {
  if (!el.tools.classList.contains('open')) return;
  el.tools.classList.remove('open');
  el.toolsBackdrop.hidden = true;
  el.moreBtn.setAttribute('aria-expanded', 'false');
}

/* ------------------------------------------------------ Mises à jour */

async function checkUpdates() {
  if (!state.link || state.busy) return;
  const today = G.todayValue();
  if (today !== state.today) {
    state.today = today;
    if (state.project) { computeScale(); computeRows(); renderAll(); }
  }
  state.busy = true;
  renderSync();
  try {
    if (!state.project) {
      // Erreur précédente (réseau, aucun projet…) : nouvel essai, sans
      // écran de chargement tant que rien de nouveau n'est disponible.
      await loadIndex({ openAfter: true });
      return;
    }
    const gen = state.generation;
    let index;
    try {
      index = await fetchSealed('data/index.json');
    } catch (err) {
      if (gen === state.generation) handleLoadError(err, 'index');
      return;
    }
    if (gen !== state.generation || !state.project) return;
    if (!G.validIndex(index)) { handleLoadError(new ViewerError('invalid'), 'index'); return; }
    state.index = index;
    setOffline(false);
    if (!index.projects.length) { showError('empty'); return; }
    const meta = index.projects.find((p) => p.id === state.project.id);
    if (!meta) { state.pid = state.project.id; showError('missing'); return; }
    // Version du contenu (rev) si publiée, sinon date de lecture : un changement recharge la page ouverte.
    const version = (p) => p.rev || p.converted_at;
    if (version(meta) !== version(state.project)) {
      await openProject(meta.id, { preserve: true });
      if (state.project && version(state.project) === version(meta)) toast('Planning mis à jour');
    }
    renderNav();
    renderHeader();
  } finally {
    state.busy = false;
    state.lastCheck = Date.now();
    renderSync();
  }
}

/* ------------------------------------------------------- Événements */

function onGridKey(e) {
  if (!state.vis || e.altKey || e.ctrlKey || e.metaKey) return;
  const rows = state.vis.rows;
  if (!rows.length) return;
  const tr = state.tree;
  const sel = state.selected;
  const k = sel >= 0 ? state.pos[sel] : -1;
  const page = Math.max(1, Math.floor(viewRows() / state.rowH) - 1);
  const go = (n) => select(rows[clamp(n, 0, rows.length - 1)]);
  switch (e.key) {
    case 'ArrowDown': go(k < 0 ? 0 : k + 1); break;
    case 'ArrowUp': go(k < 0 ? 0 : k - 1); break;
    case 'PageDown': go(k + page); break;
    case 'PageUp': go(k - page); break;
    case 'Home': go(0); break;
    case 'End': go(rows.length - 1); break;
    case 'ArrowRight':
      if (sel < 0) { go(0); break; }
      if (tr.children[sel].length && state.prefs.collapsed.has(tr.tasks[sel].uid)) toggleRow(sel, true);
      else if (tr.children[sel].length) go(k + 1);
      break;
    case 'ArrowLeft':
      if (sel < 0) { go(0); break; }
      if (tr.children[sel].length && !state.prefs.collapsed.has(tr.tasks[sel].uid)) toggleRow(sel, false);
      else if (tr.parent[sel] >= 0 && state.pos[tr.parent[sel]] >= 0) select(tr.parent[sel]);
      break;
    case 'Enter':
    case ' ':
      if (sel < 0) { go(0); break; }
      if (tr.children[sel].length) toggleRow(sel);
      else select(sel, { open: true });
      break;
    default:
      return;
  }
  e.preventDefault();
}

function onEscape() {
  if (anyMenuOpen()) { closeMenus(); return true; }
  if (el.tools.classList.contains('open')) { closeSheet(); el.moreBtn.focus(); return true; }
  if (el.app.classList.contains('nav-open')) { closeNav(); el.navToggle.focus(); return true; }
  if (state.detail) { closeDetail(); el.sc.focus({ preventScroll: true }); return true; }
  return false;
}

let searchTimer = 0;
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = el.q.value;
    state.cur = -1;
    if (state.qFilter) openFilterResults();
    refreshRows();
    if (state.q.trim() && state.vis.matches.length) goMatch(0);
  }, 180);
}

function bind() {
  el.navToggle.addEventListener('click', toggleNav);
  el.navClose.addEventListener('click', () => (isWide() ? toggleNav() : closeNav()));
  el.navBackdrop.addEventListener('click', closeNav);
  el.sync.addEventListener('click', () => checkUpdates());

  el.q.addEventListener('input', onSearchInput);
  el.q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(searchTimer);
    if (state.q !== el.q.value) {
      state.q = el.q.value;
      state.cur = -1;
      if (state.qFilter) openFilterResults();
      refreshRows();
    }
    goMatch(state.cur < 0 ? 0 : state.cur + (e.shiftKey ? -1 : 1));
  });
  el.qNext.addEventListener('click', () => goMatch(state.cur + 1));
  el.qPrev.addEventListener('click', () => goMatch(state.cur < 0 ? -1 : state.cur - 1));
  el.qFilter.addEventListener('click', () => {
    state.qFilter = !state.qFilter;
    state.cur = -1;
    openFilterResults();
    refreshRows();
  });

  el.moreBtn.addEventListener('click', () => (el.tools.classList.contains('open') ? closeSheet() : openSheet()));
  el.toolsClose.addEventListener('click', () => { closeSheet(); el.moreBtn.focus(); });
  el.toolsBackdrop.addEventListener('click', closeSheet);

  el.fStatus.addEventListener('change', () => {
    state.filter.status = el.fStatus.value;
    state.cur = -1;
    openFilterResults();
    refreshRows();
    revealFilterResult();
  });
  const onDate = () => {
    state.filter.from = G.parseDate(el.fFrom.value);
    state.filter.to = G.parseDate(el.fTo.value);
    state.cur = -1;
    openFilterResults();
    refreshRows();
    revealFilterResult();
  };
  el.fFrom.addEventListener('change', onDate);
  el.fTo.addEventListener('change', onDate);
  el.fReset.addEventListener('click', resetFilters);

  el.expandAll.addEventListener('click', () => { closeMenus(); setCollapsed(new Set()); });
  el.collapseAll.addEventListener('click', () => { closeMenus(); setCollapsed(G.allParents(state.tree)); });
  el.groupsOnly.addEventListener('click', () => { closeMenus(); setCollapsed(G.groupsOnlyCollapsed(state.tree)); });
  el.levels.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-level]');
    if (!b) return;
    closeMenus();
    setCollapsed(G.collapsedForLevel(state.tree, Number(b.dataset.level)));
  });

  el.zoomSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-zoom]');
    if (b) setZoom(b.dataset.zoom);
  });
  el.zoomSeg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const order = ['day', 'week', 'month'];
    const n = clamp(order.indexOf(state.prefs.zoom) + (e.key === 'ArrowRight' ? 1 : -1), 0, 2);
    setZoom(order[n]);
    el.zoomSeg.querySelector(`[data-zoom="${order[n]}"]`).focus();
    e.preventDefault();
  });
  el.todayBtn.addEventListener('click', goToday);

  for (const [b, m] of MENUS) el[b].addEventListener('click', () => (el[m].hidden ? openMenu(el[b], el[m]) : closeMenus()));
  el.restoreAll.addEventListener('click', () => { restoreRows([...state.prefs.hidden]); closeMenus(); });
  const option = (name, fn) => el[name].addEventListener('change', () => { fn(el[name].checked); savePrefs(); });
  option('optDeps', (v) => { state.prefs.deps = v; renderWindow(true); });
  option('optBaseline', (v) => { state.prefs.baseline = v; renderWindow(true); });
  option('optCritical', (v) => { state.prefs.critical = v; renderWindow(true); });
  el.colOptions.addEventListener('change', (e) => {
    const key = e.target.dataset.col;
    if (!key) return;
    const before = state.fixedW;
    if (e.target.checked) state.prefs.cols.add(key); else state.prefs.cols.delete(key);
    buildColumns();
    setGridWidth(state.gw + state.fixedW - before, true);
    fitColumns();
    renderGridHeader();
    renderWindow(true);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.menu-wrap')) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && onEscape()) e.preventDefault();
  });

  el.sc.addEventListener('scroll', () => {
    if (state.scrollFrame) return;
    state.scrollFrame = requestAnimationFrame(() => { state.scrollFrame = 0; renderWindow(false); });
  }, { passive: true });
  el.sc.addEventListener('keydown', onGridKey);
  el.gbody.addEventListener('mousedown', (e) => {
    if (e.target.closest('.row')) { e.preventDefault(); el.sc.focus({ preventScroll: true }); }
  });
  el.gbody.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const i = state.vis.rows[Number(row.dataset.k)];
    if (i == null) return;
    if (e.target.closest('[data-act="toggle"]')) { state.selected = i; toggleRow(i); updateSelectionDom(); return; }
    select(i, { open: true, scroll: false });
  });
  el.cbody.addEventListener('click', (e) => {
    const k = Math.floor((e.clientY - el.body.getBoundingClientRect().top) / state.rowH);
    if (k >= 0 && k < state.vis.rows.length) select(state.vis.rows[k], { open: true, scroll: false });
  });

  el.splitter.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = state.gw;
    el.splitter.setPointerCapture(e.pointerId);
    el.splitter.classList.add('dragging');
    document.body.classList.add('resizing');
    const move = (ev) => setGridWidth(startW + ev.clientX - startX, false);
    const up = () => {
      el.splitter.removeEventListener('pointermove', move);
      el.splitter.removeEventListener('pointerup', up);
      el.splitter.removeEventListener('pointercancel', up);
      el.splitter.classList.remove('dragging');
      document.body.classList.remove('resizing');
      setGridWidth(state.gw, true);
    };
    el.splitter.addEventListener('pointermove', move);
    el.splitter.addEventListener('pointerup', up);
    el.splitter.addEventListener('pointercancel', up);
  });
  el.splitter.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === 'ArrowLeft') setGridWidth(state.gw - step, true);
    else if (e.key === 'ArrowRight') setGridWidth(state.gw + step, true);
    else return;
    e.preventDefault();
  });

  let resizeFrame = 0;
  const onResize = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (!state.project || el.gantt.hidden) return;
      const m = metrics();
      const center = G.dateAt(state.scale, el.sc.scrollLeft + chartViewWidth() / 2);
      const modeChanged = m.phone !== state.phone || m.rowH !== state.rowH;
      let top = null;
      if (modeChanged) {
        top = state.selected >= 0 && state.pos[state.selected] >= 0 ? state.pos[state.selected] : Math.floor(el.sc.scrollTop / state.rowH);
        Object.assign(state, m);
        setVar('--rh', `${state.rowH}px`);
        setVar('--hh', `${state.hh}px`);
        el.app.classList.toggle('phone', state.phone);
        el.colSection.hidden = state.phone;
        buildColumns();
      }
      if (isWide()) { closeNav(); closeSheet(); }
      fitToolbar();
      computeGridWidth();
      computeScale();
      renderAll();
      // Après renderAll (nouvelle hauteur du diagramme) : sinon le navigateur ramène
      // la position dans l'ancienne hauteur et la ligne choisie sort de l'écran.
      if (top != null) {
        el.sc.scrollTop = top * state.rowH;
        renderWindow(true);
      }
      el.sc.scrollLeft = Math.max(0, G.xOf(state.scale, center) - chartViewWidth() / 2);
    });
  };
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(el.gantt);
  else window.addEventListener('resize', onResize);

  window.addEventListener('hashchange', () => {
    const link = G.parseHash(window.location.hash);
    if (!state.link || link.k !== state.link.k) { start(); return; }
    // Adresse modifiée à la main : un lien sans « &p= » redevient le lien partagé, jamais réécrit.
    state.link.withProject = Boolean(link.p);
    if (link.p && link.p !== state.pid && ID_RE.test(link.p)) openProject(link.p);
  });
  window.addEventListener('online', () => checkUpdates());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.lastCheck > REFRESH_MS) checkUpdates();
  });
  setInterval(() => {
    if (document.hidden) return;
    checkUpdates();
  }, REFRESH_MS);
  // Les durées « il y a … » de l'en-tête restent à jour même sans nouvelle version.
  setInterval(() => { if (state.project) { renderHeader(); renderNav(); } renderSync(); }, 30 * 1000);
}

function initNav() {
  const wide = isWide();
  if (state.ui.nav === false) el.app.classList.add('nav-collapsed');
  el.navToggle.setAttribute('aria-expanded', String(wide ? state.ui.nav !== false : false));
}

bind();
initNav();
start();
