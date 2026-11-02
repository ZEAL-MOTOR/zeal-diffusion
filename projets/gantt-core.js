// Fonctions pures de la visionneuse Gantt : dates, arbre des tâches,
// visibilité (réduction, lignes masquées, filtres, recherche), échelle de
// temps, géométrie des barres et des liens, déchiffrement de l'enveloppe.
// Aucun accès au DOM ni au réseau : testées par tests/viewer/gantt-core.test.mjs.

export const DAY = 86400000;
export const MINUTE = 60000;

// Pixels par jour pour chaque zoom.
export const ZOOMS = {
  day: { ppd: 30, label: 'Jours' },
  week: { ppd: 7, label: 'Semaines' },
  month: { ppd: 2.2, label: 'Mois' },
};

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const WEEKDAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const NBSP = '\u00a0';

/* ------------------------------------------------------------------ Dates */

// « 2026-06-15T08:00 » (heure locale du projet, sans fuseau) → nombre
// Date.UTC. Les dates restent « naïves » : on les lit et les affiche avec les
// accesseurs UTC, sans jamais convertir de fuseau.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

export function parseDate(value) {
  if (typeof value !== 'string') return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0].map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(ms);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return ms;
}

// Date du jour de l'utilisateur (heure locale du navigateur), au même format.
export function todayValue(now = new Date()) {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export function startOfDay(ms) {
  return Math.floor(ms / DAY) * DAY;
}

// Lundi de la semaine.
export function startOfWeek(ms) {
  const d = startOfDay(ms);
  return d - ((new Date(d).getUTCDay() + 6) % 7) * DAY;
}

export function startOfMonth(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function addMonths(ms, n) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}

export function startOfYear(ms) {
  return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
}

export function isWeekend(ms) {
  const wd = new Date(ms).getUTCDay();
  return wd === 0 || wd === 6;
}

// Numéro de semaine ISO 8601 (la semaine 1 contient le premier jeudi).
export function isoWeek(ms) {
  const d = startOfDay(ms);
  const wd = (new Date(d).getUTCDay() + 6) % 7;
  const thursday = d + (3 - wd) * DAY;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return 1 + Math.floor((thursday - yearStart) / (7 * DAY));
}

function dayNumber(d) {
  return d === 1 ? '1er' : String(d);
}

// « 30 oct. 2026 », « 1er nov. 2026 »
export function formatDate(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${dayNumber(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// « 2 nov. », « 1er oct. »
export function formatDayMonth(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${dayNumber(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}

// « lun. 2 nov. »
export function formatDayShort(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${dayNumber(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}

// « 13 h 50 », « 8 h », « 8 h 05 »
export function formatTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const m = d.getUTCMinutes();
  return `${d.getUTCHours()}${NBSP}h${m ? NBSP + String(m).padStart(2, '0') : ''}`;
}

// « 30 oct. 2026 à 13 h 50 »
export function formatDateTime(ms) {
  if (!Number.isFinite(ms)) return '';
  return `${formatDate(ms)} à ${formatTime(ms)}`;
}

// « nov. 2026 »
export function formatMonth(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// « S45 »
export function formatWeek(ms) {
  return Number.isFinite(ms) ? `S${isoWeek(ms)}` : '';
}

function decimal(n, digits = 2) {
  const f = 10 ** digits;
  return String(Math.round(n * f) / f).replace('.', ',').replace('-', '−');
}

// Durée ouvrée : « 12 j », « 0 j », « 19,5 j »
export function formatDuration(days) {
  if (days == null || days === '') return '';
  const n = Number(days);
  if (!Number.isFinite(n)) return '';
  return `${decimal(n)}${NBSP}j`;
}

export function formatPercent(p) {
  const n = Number(p);
  return Number.isFinite(n) ? `${Math.round(n)}${NBSP}%` : '';
}

// Décalage d'un lien : « » (aucun), « +2 j », « −1,5 j »
export function formatLag(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n === 0) return '';
  return `${n > 0 ? '+' : ''}${decimal(n)}${NBSP}j`;
}

// Temps écoulé depuis un instant ISO réel (converted_at) : « à l'instant »,
// « il y a 5 min », « il y a 2 h », « il y a 3 j », sinon « le 30 oct. 2026 ».
export function relativeTime(iso, nowMs = Date.now()) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, nowMs - t);
  if (diff < MINUTE) return 'à l\'instant';
  if (diff < 60 * MINUTE) return `il y a ${Math.floor(diff / MINUTE)}${NBSP}min`;
  if (diff < DAY) return `il y a ${Math.floor(diff / (60 * MINUTE))}${NBSP}h`;
  if (diff < 30 * DAY) return `il y a ${Math.floor(diff / DAY)}${NBSP}j`;
  const d = new Date(t);
  return `le ${formatDate(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))}`;
}

/* -------------------------------------------------------------- Liens */

const LINK_LABELS = {
  FS: { short: 'FD', label: 'Fin à début' },
  SS: { short: 'DD', label: 'Début à début' },
  FF: { short: 'FF', label: 'Fin à fin' },
  SF: { short: 'DF', label: 'Début à fin' },
};

export function linkLabel(type) {
  return LINK_LABELS[type] || { short: String(type || ''), label: String(type || '') };
}

/* -------------------------------------------------------------- Texte */

// Minuscules sans accents, pour une recherche tolérante.
export function foldText(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Plages [début, fin[ de `query` dans `text` (indices du texte d'origine).
export function findMatches(text, query) {
  const q = foldText(query).trim();
  const src = String(text == null ? '' : text);
  if (!q) return [];
  let folded = '';
  const map = [];
  for (let i = 0; i < src.length; i++) {
    const f = foldText(src[i]);
    for (let j = 0; j < f.length; j++) { folded += f[j]; map.push(i); }
  }
  map.push(src.length);
  const out = [];
  let from = 0;
  for (;;) {
    const k = folded.indexOf(q, from);
    if (k < 0) break;
    out.push([map[k], map[k + q.length - 1] + 1]);
    from = k + q.length;
  }
  return out;
}

/* -------------------------------------------------------------- Arbre */

// Construit la structure de travail : ordre d'affichage, parents, enfants,
// niveaux, dates numériques et successeurs.
export function buildTree(tasks) {
  const list = Array.isArray(tasks) ? tasks.filter((t) => t && t.uid != null) : [];
  const n = list.length;
  const index = new Map();
  list.forEach((t, i) => { if (!index.has(t.uid)) index.set(t.uid, i); });
  const parent = new Int32Array(n).fill(-1);
  const children = Array.from({ length: n }, () => []);
  const roots = [];
  for (let i = 0; i < n; i++) {
    const p = list[i].parent != null ? index.get(list[i].parent) : undefined;
    // Un parent doit précéder ses enfants (ordre de Project) : sinon, racine.
    if (p != null && p < i) { parent[i] = p; children[p].push(i); } else roots.push(i);
  }
  // Ordre d'affichage : parcours en profondeur (identique à l'ordre de Project
  // quand le plan est cohérent).
  const order = [];
  const depth = new Int32Array(n);
  const stack = roots.slice().reverse();
  while (stack.length) {
    const i = stack.pop();
    depth[i] = parent[i] < 0 ? 1 : depth[parent[i]] + 1;
    order.push(i);
    for (let c = children[i].length - 1; c >= 0; c--) stack.push(children[i][c]);
  }
  const start = new Float64Array(n);
  const finish = new Float64Array(n);
  const succ = Array.from({ length: n }, () => []);
  const folded = new Array(n);
  let maxDepth = 1;
  for (let i = 0; i < n; i++) {
    const t = list[i];
    start[i] = parseDate(t.start) ?? NaN;
    finish[i] = parseDate(t.finish) ?? NaN;
    folded[i] = foldText(t.name);
    if (depth[i] > maxDepth) maxDepth = depth[i];
  }
  for (let i = 0; i < n; i++) {
    for (const p of list[i].preds || []) {
      const j = index.get(p && p.uid);
      if (j != null && j !== i) succ[j].push({ uid: list[i].uid, type: p.type, lag_days: p.lag_days || 0 });
    }
  }
  return { tasks: list, n, index, parent, children, roots, order, depth, maxDepth, start, finish, succ, folded };
}

export function hasChildren(tree, i) {
  return tree.children[i].length > 0;
}

export function ancestorsOf(tree, i) {
  const out = [];
  for (let p = tree.parent[i]; p >= 0; p = tree.parent[p]) out.push(p);
  return out;
}

// Toutes les tâches parentes (récapitulatives) : « Tout réduire ».
export function allParents(tree) {
  const out = new Set();
  for (let i = 0; i < tree.n; i++) if (tree.children[i].length) out.add(tree.tasks[i].uid);
  return out;
}

// Réduit tout ce qui est au niveau `level` ou plus profond : seuls les
// niveaux 1 à `level` restent visibles.
export function collapsedForLevel(tree, level) {
  const out = new Set();
  for (let i = 0; i < tree.n; i++) {
    if (tree.children[i].length && tree.depth[i] >= level) out.add(tree.tasks[i].uid);
  }
  return out;
}

// État réduit enregistré dans Project (expanded: false).
export function initialCollapsed(tree) {
  const out = new Set();
  for (let i = 0; i < tree.n; i++) {
    if (tree.children[i].length && tree.tasks[i].expanded === false) out.add(tree.tasks[i].uid);
  }
  return out;
}

/* ------------------------------------------------------------ Statuts */

export function isLate(task, today) {
  const f = parseDate(task && task.finish);
  return f != null && f < today && Number(task.percent) < 100;
}

// 'done' | 'late' | 'progress' | 'notstarted'
export function taskStatus(task, today) {
  const p = Number(task && task.percent) || 0;
  if (p >= 100) return 'done';
  if (isLate(task, today)) return 'late';
  return p > 0 ? 'progress' : 'notstarted';
}

export const STATUS_FILTERS = [
  { value: 'all', label: 'Toutes les tâches' },
  { value: 'notstarted', label: 'Non commencées' },
  { value: 'progress', label: 'En cours' },
  { value: 'done', label: 'Terminées' },
  { value: 'late', label: 'En retard' },
  { value: 'milestones', label: 'Jalons' },
  { value: 'critical', label: 'Critiques' },
];

export function filterActive(filter) {
  return !!filter && ((filter.status && filter.status !== 'all') || filter.from != null || filter.to != null
    || !!(filter.text && foldText(filter.text).trim()));
}

// Une ligne correspond-elle au filtre (statut, période, nom) ?
export function matchesFilter(tree, i, filter, today) {
  if (!filter) return true;
  const t = tree.tasks[i];
  const p = Number(t.percent) || 0;
  switch (filter.status || 'all') {
    case 'notstarted': if (p !== 0) return false; break;
    case 'progress': if (!(p > 0 && p < 100)) return false; break;
    case 'done': if (p < 100) return false; break;
    case 'late': if (!(tree.finish[i] < today && p < 100)) return false; break;
    case 'milestones': if (!t.milestone) return false; break;
    case 'critical': if (!t.critical) return false; break;
    default: break;
  }
  if (filter.from != null || filter.to != null) {
    // Tâches qui chevauchent la période (bornes incluses, journées entières).
    const s = Number.isFinite(tree.start[i]) ? tree.start[i] : tree.finish[i];
    const f = Number.isFinite(tree.finish[i]) ? tree.finish[i] : tree.start[i];
    if (!Number.isFinite(s)) return false;
    if (filter.to != null && s >= filter.to + DAY) return false;
    if (filter.from != null && f < filter.from) return false;
  }
  if (filter.text) {
    const q = foldText(filter.text).trim();
    if (q && !tree.folded[i].includes(q)) return false;
  }
  return true;
}

/**
 * Lignes affichées, dans l'ordre.
 * - Une ligne masquée l'est avec toutes ses sous-tâches.
 * - Avec un filtre, une ligne reste si elle correspond ou si une de ses
 *   sous-tâches correspond (les tâches parentes donnent le contexte).
 * - Les sous-tâches d'une ligne réduite ne sont pas affichées.
 * - `matches` : lignes dont le nom contient la recherche (même dans une
 *   partie réduite), pour « suivant / précédent ».
 */
export function computeVisible(tree, { collapsed = new Set(), hidden = new Set(), filter = null, search = '', today = 0 } = {}) {
  const n = tree.n;
  const eligible = new Uint8Array(n);
  const keep = new Uint8Array(n);
  const active = filterActive(filter);
  for (const i of tree.order) {
    const p = tree.parent[i];
    eligible[i] = !hidden.has(tree.tasks[i].uid) && (p < 0 || eligible[p]) ? 1 : 0;
  }
  if (active) {
    for (let k = tree.order.length - 1; k >= 0; k--) {
      const i = tree.order[k];
      if (!eligible[i]) continue;
      if (keep[i] || matchesFilter(tree, i, filter, today)) {
        keep[i] = 1;
        if (tree.parent[i] >= 0) keep[tree.parent[i]] = 1;
      }
    }
  } else {
    for (let i = 0; i < n; i++) keep[i] = eligible[i];
  }
  const rows = [];
  const shown = new Uint8Array(n);
  let filterMatches = 0;
  for (const i of tree.order) {
    if (!keep[i]) continue;
    const p = tree.parent[i];
    if (active && matchesFilter(tree, i, filter, today)) filterMatches++;
    if (p >= 0 && (!shown[p] || collapsed.has(tree.tasks[p].uid))) continue;
    shown[i] = 1;
    rows.push(i);
  }
  const q = foldText(search).trim();
  const matches = [];
  if (q) for (const i of tree.order) if (keep[i] && tree.folded[i].includes(q)) matches.push(i);
  let hiddenCount = 0;
  for (const uid of hidden) if (tree.index.has(uid)) hiddenCount++;
  return { rows, matches, hiddenCount, filterActive: active, filterMatches };
}

// Position de chaque tâche dans la liste affichée (-1 si non affichée).
export function rowPositions(tree, rows) {
  const pos = new Int32Array(tree.n).fill(-1);
  rows.forEach((i, k) => { pos[i] = k; });
  return pos;
}

// Fenêtre de lignes à dessiner (virtualisation) : [first, last[.
export function rowWindow(scrollTop, viewHeight, rowH, total, buffer = 0) {
  const first = Math.max(0, Math.floor(scrollTop / rowH) - buffer);
  const last = Math.min(total, Math.ceil((scrollTop + viewHeight) / rowH) + buffer);
  return [first, Math.max(first, last)];
}

/* ------------------------------------------------- Échelle de temps */

// Plage affichée : toutes les dates du projet, plus aujourd'hui et la date
// d'état si elles sont proches, avec une marge, alignée sur l'unité du zoom.
export function timeRange(tree, zoom, { today = null, statusDate = null, projectStart = null, projectFinish = null } = {}) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < tree.n; i++) {
    const s = tree.start[i];
    const f = tree.finish[i];
    if (Number.isFinite(s)) { min = Math.min(min, s); max = Math.max(max, s); }
    if (Number.isFinite(f)) { min = Math.min(min, f); max = Math.max(max, f); }
    const bs = parseDate(tree.tasks[i].baseline_start);
    const bf = parseDate(tree.tasks[i].baseline_finish);
    if (bs != null) min = Math.min(min, bs);
    if (bf != null) max = Math.max(max, bf);
  }
  for (const d of [projectStart, projectFinish]) {
    if (Number.isFinite(d)) { min = Math.min(min, d); max = Math.max(max, d); }
  }
  if (!Number.isFinite(min)) {
    const base = Number.isFinite(today) ? today : todayValue();
    min = base; max = base + 30 * DAY;
  }
  for (const d of [today, statusDate]) {
    if (Number.isFinite(d) && d > min - 365 * DAY && d < max + 365 * DAY) {
      min = Math.min(min, d); max = Math.max(max, d);
    }
  }
  if (zoom === 'month') return { start: addMonths(startOfMonth(min), -1), end: addMonths(startOfMonth(max), 2) };
  return { start: startOfWeek(min) - 7 * DAY, end: startOfWeek(max) + 14 * DAY };
}

// Échelle : conversion date ↔ pixels. `minWidth` étire la plage pour remplir
// la zone visible.
export function createScale(range, zoom, minWidth = 0) {
  const ppd = (ZOOMS[zoom] || ZOOMS.week).ppd;
  let end = range.end;
  const needDays = Math.ceil(minWidth / ppd);
  if ((end - range.start) / DAY < needDays) end = range.start + needDays * DAY;
  if (zoom === 'month') end = addMonths(startOfMonth(end - 1), 1);
  else end = startOfWeek(end - 1) + 7 * DAY;
  return { zoom, start: range.start, end, ppd, width: Math.round(((end - range.start) / DAY) * ppd) };
}

export function xOf(scale, ms) {
  return ((ms - scale.start) / DAY) * scale.ppd;
}

export function dateAt(scale, x) {
  return scale.start + (x / scale.ppd) * DAY;
}

function tick(scale, start, end, label, title) {
  const s = Math.max(start, scale.start);
  const e = Math.min(end, scale.end);
  const x = xOf(scale, s);
  return { start: s, end: e, x, w: xOf(scale, e) - x, label, title: title || label };
}

// Deux niveaux d'échelle (haut, bas) pour le zoom.
//  - Jours : semaines « S45 · 2 nov. 2026 » sur jours « L 2 »
//  - Semaines : mois « nov. 2026 » sur semaines « S45 »
//  - Mois : années « 2026 » sur mois « nov. »
export function timescale(scale) {
  const top = [];
  const bottom = [];
  if (scale.zoom === 'day') {
    for (let w = startOfWeek(scale.start); w < scale.end; w += 7 * DAY) {
      top.push(tick(scale, w, w + 7 * DAY, `${formatWeek(w)} · ${formatDate(w)}`, `Semaine ${isoWeek(w)}, du ${formatDate(w)}`));
    }
    for (let d = scale.start; d < scale.end; d += DAY) {
      const dt = new Date(d);
      const t = tick(scale, d, d + DAY, `${WEEKDAY_LETTERS[dt.getUTCDay()]}${NBSP}${dt.getUTCDate()}`, formatDayShort(d));
      t.weekend = isWeekend(d);
      bottom.push(t);
    }
  } else if (scale.zoom === 'month') {
    for (let y = startOfYear(scale.start); y < scale.end; y = Date.UTC(new Date(y).getUTCFullYear() + 1, 0, 1)) {
      const yy = new Date(y).getUTCFullYear();
      top.push(tick(scale, y, Date.UTC(yy + 1, 0, 1), String(yy)));
    }
    for (let m = startOfMonth(scale.start); m < scale.end; m = addMonths(m, 1)) {
      bottom.push(tick(scale, m, addMonths(m, 1), MONTHS[new Date(m).getUTCMonth()], formatMonth(m)));
    }
  } else {
    for (let m = startOfMonth(scale.start); m < scale.end; m = addMonths(m, 1)) {
      top.push(tick(scale, m, addMonths(m, 1), formatMonth(m)));
    }
    for (let w = startOfWeek(scale.start); w < scale.end; w += 7 * DAY) {
      bottom.push(tick(scale, w, w + 7 * DAY, formatWeek(w), `Semaine ${isoWeek(w)}, du ${formatDate(w)}`));
    }
  }
  return { top, bottom };
}

// Fins de semaine à ombrer (zoom Jours seulement).
export function weekendBands(scale) {
  if (scale.zoom !== 'day') return [];
  const out = [];
  for (let w = startOfWeek(scale.start); w < scale.end; w += 7 * DAY) {
    const s = Math.max(w + 5 * DAY, scale.start);
    const e = Math.min(w + 7 * DAY, scale.end);
    if (e > s) out.push({ x: xOf(scale, s), w: xOf(scale, e) - xOf(scale, s) });
  }
  return out;
}

/* ------------------------------------------------------------ Barres */

// Géométrie d'une barre dans sa ligne (y relatif au haut de la ligne).
// kind : 'summary' (crochet noir), 'task', 'milestone' (losange).
export function barGeometry(tree, i, scale, rowH, { baseline = false } = {}) {
  const t = tree.tasks[i];
  let s = tree.start[i];
  let f = tree.finish[i];
  if (!Number.isFinite(s) && !Number.isFinite(f)) return null;
  if (!Number.isFinite(s)) s = f;
  if (!Number.isFinite(f)) f = s;
  if (f < s) f = s;
  const kind = t.summary || tree.children[i].length ? 'summary' : (t.milestone ? 'milestone' : 'task');
  const percent = Math.max(0, Math.min(100, Number(t.percent) || 0));
  const out = { kind, percent };
  const bs = baseline ? parseDate(t.baseline_start) : null;
  const bf = baseline ? parseDate(t.baseline_finish) : null;
  const hasBase = bs != null && bf != null;
  if (kind === 'milestone') {
    const size = Math.round(rowH * 0.48) | 1;
    const cx = xOf(scale, s);
    const cy = hasBase ? Math.round(rowH * 0.42) : Math.round(rowH / 2);
    Object.assign(out, { x: cx - size / 2, w: size, y: cy - size / 2, h: size, cx, cy, x1: cx - size / 2, x2: cx + size / 2, progressW: 0 });
    // Décalée pour laisser passer la flèche d'un lien qui arrive par la droite.
    out.labelX = cx + size / 2 + 12;
    if (hasBase) {
      const bsize = Math.round(size * 0.7);
      out.baseline = { x: xOf(scale, bs) - bsize / 2, w: bsize, y: rowH - bsize - 2, h: bsize, diamond: true };
    }
    return out;
  }
  const x1 = xOf(scale, s);
  const w = Math.max(kind === 'summary' ? 4 : 3, xOf(scale, f) - x1);
  let h;
  let y;
  if (kind === 'summary') {
    h = Math.max(6, Math.round(rowH * 0.24));
    y = hasBase ? Math.round(rowH * 0.22) : Math.round(rowH * 0.3);
  } else {
    h = Math.max(8, Math.round(rowH * 0.42));
    y = hasBase ? Math.round(rowH * 0.16) : Math.round((rowH - h) / 2);
  }
  Object.assign(out, { x: x1, w, y, h, x1, x2: x1 + w, cy: y + h / 2, progressW: (w * percent) / 100 });
  out.labelX = x1 + w + (kind === 'summary' ? 8 : 6);
  if (hasBase) {
    const bx = xOf(scale, bs);
    out.baseline = { x: bx, w: Math.max(2, xOf(scale, Math.max(bf, bs)) - bx), y: y + h + 3, h: Math.max(3, Math.round(rowH * 0.13)) };
  }
  return out;
}

/* ------------------------------------------------------------- Liens */

const GAP = 8;

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  // Retire les points intermédiaires alignés.
  for (let k = out.length - 2; k > 0; k--) {
    const [a, b, c] = [out[k - 1], out[k], out[k + 1]];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(k, 1);
  }
  return out;
}

/**
 * Tracé orthogonal d'un lien de dépendance, en coordonnées du graphique.
 * from / to : { row, x1, x2, cy, top, bottom } (x1/x2 : début et fin de la
 * barre ; cy : centre vertical ; top/bottom : haut et bas de la barre).
 * Renvoie { points: [[x, y], …], dir } ; dir : sens de la flèche finale.
 */
export function linkPath(from, to, type, rowH) {
  const down = to.row >= from.row;
  // Ligne de passage entre deux rangées, juste après la tâche d'origine.
  const between = (down ? from.row + 1 : from.row) * rowH;
  let points;
  let dir;
  if (type === 'SS') {
    const lx = Math.min(from.x1, to.x1) - GAP;
    points = [[from.x1, from.cy], [lx, from.cy], [lx, to.cy], [to.x1, to.cy]];
    dir = 'right';
  } else if (type === 'FF') {
    const rx = Math.max(from.x2, to.x2) + GAP;
    points = [[from.x2, from.cy], [rx, from.cy], [rx, to.cy], [to.x2, to.cy]];
    dir = 'left';
  } else if (type === 'SF') {
    if (to.x2 + GAP <= from.x1 - GAP) {
      points = [[from.x1, from.cy], [to.x2 + GAP, from.cy], [to.x2 + GAP, to.cy], [to.x2, to.cy]];
    } else {
      points = [[from.x1, from.cy], [from.x1 - GAP, from.cy], [from.x1 - GAP, between],
        [to.x2 + GAP, between], [to.x2 + GAP, to.cy], [to.x2, to.cy]];
    }
    dir = 'left';
  } else {
    // FS : de la fin du prédécesseur vers le début du successeur, en entrant
    // par le haut (ou le bas) de la barre comme dans Project.
    const ex = to.milestone ? (to.x1 + to.x2) / 2 : to.x1 + Math.min(4, (to.x2 - to.x1) / 2);
    if (to.row !== from.row && ex >= from.x2 + GAP) {
      points = [[from.x2, from.cy], [ex, from.cy], [ex, down ? to.top : to.bottom]];
      dir = down ? 'down' : 'up';
    } else {
      points = [[from.x2, from.cy], [from.x2 + GAP, from.cy], [from.x2 + GAP, between],
        [to.x1 - GAP, between], [to.x1 - GAP, to.cy], [to.x1, to.cy]];
      dir = 'right';
    }
  }
  return { points: dedupe(points.map(([x, y]) => [Math.round(x) + 0.5, Math.round(y) + 0.5])), dir };
}

export function pathData(points) {
  return points.map((p, k) => `${k ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
}

// Pointe de flèche (triangle) au point `tip`.
export function arrowHead(tip, dir, size = 5) {
  const [x, y] = tip;
  const s = size;
  const h = size * 0.8;
  switch (dir) {
    case 'down': return [[x - h, y - s], [x + h, y - s], [x, y]];
    case 'up': return [[x - h, y + s], [x + h, y + s], [x, y]];
    case 'left': return [[x + s, y - h], [x + s, y + h], [x, y]];
    default: return [[x - s, y - h], [x - s, y + h], [x, y]];
  }
}

// Liens entre lignes affichées : { from, to, type, lag_days, a, b } (a, b :
// positions des lignes).
export function visibleLinks(tree, pos) {
  const out = [];
  for (let j = 0; j < tree.n; j++) {
    if (pos[j] < 0) continue;
    for (const p of tree.tasks[j].preds || []) {
      const i = tree.index.get(p && p.uid);
      if (i == null || i === j || pos[i] < 0) continue;
      out.push({ from: i, to: j, type: p.type, lag_days: p.lag_days || 0, a: pos[i], b: pos[j] });
    }
  }
  return out;
}

/* ------------------------------------------------- Lien et chiffrement */

// « #k=…&p=… » → { k, p }
export function parseHash(hash) {
  const out = { k: null, p: null };
  String(hash || '').replace(/^#/, '').split('&').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i <= 0) return;
    const name = pair.slice(0, i);
    let value = pair.slice(i + 1);
    try { value = decodeURIComponent(value); } catch { /* valeur brute */ }
    if (name === 'k' || name === 'p') out[name] = value;
  });
  return out;
}

export function buildHash(k, p) {
  return `#k=${k}${p ? `&p=${encodeURIComponent(p)}` : ''}`;
}

function bytesFromBinary(bin) {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeBase64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try { return bytesFromBinary(atob(s)); } catch { return null; }
}

// Clé du lien : 43 caractères base64url → 32 octets, sinon null.
export function keyFromLink(k) {
  if (typeof k !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(k)) return null;
  const bytes = decodeBase64(k.replace(/-/g, '+').replace(/_/g, '/') + '=');
  return bytes && bytes.length === 32 ? bytes : null;
}

export const ALG = 'xsalsa20-poly1305';

// Déchiffre une enveloppe { v, alg, nonce, box }. `nacl` : TweetNaCl.
// Renvoie { ok: true, data } ou { ok: false, reason: 'invalid' | 'key' }.
export function openEnvelope(envelope, key, nacl) {
  if (!envelope || typeof envelope !== 'object' || envelope.alg !== ALG) return { ok: false, reason: 'invalid' };
  const nonce = decodeBase64(envelope.nonce);
  const box = decodeBase64(envelope.box);
  if (!nonce || nonce.length !== 24 || !box || box.length < 16) return { ok: false, reason: 'invalid' };
  const plain = nacl.secretbox.open(box, nonce, key);
  if (!plain) return { ok: false, reason: 'key' };
  try {
    return { ok: true, data: JSON.parse(new TextDecoder('utf-8').decode(plain)) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export function validIndex(data) {
  return !!data && typeof data === 'object' && data.v === 1 && Array.isArray(data.projects)
    && data.projects.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string');
}

export function validProject(data) {
  return !!data && typeof data === 'object' && data.v === 1 && typeof data.id === 'string'
    && Array.isArray(data.tasks) && data.tasks.every((t) => t && t.uid != null && typeof t.name === 'string');
}

// Paramètre anti-cache : change chaque minute.
export function minuteBucket(nowMs = Date.now()) {
  return Math.floor(nowMs / MINUTE);
}
