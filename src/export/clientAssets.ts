import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require_ = createRequire(import.meta.url);

/** Copy lunr.min.js out of node_modules into the html/ dir for client-side search. */
export async function writeLunr(htmlDir: string): Promise<string> {
  const lunrPath = require_.resolve("lunr/lunr.min.js");
  const abs = path.join(htmlDir, "lunr.min.js");
  await fsp.copyFile(lunrPath, abs);
  return abs;
}

// Copy katex.min.css next to style.css. Equations are server-rendered to HTML
// at export time so we don't need katex.min.js on the client — only the
// stylesheet to apply the font metrics.
export const KATEX_CSS_FILENAME = "katex.min.css";
export const KATEX_LICENSE_FILENAME = "LICENSE-katex.txt";
export async function writeKatexCss(htmlDir: string): Promise<string> {
  const katexCssPath = require_.resolve("katex/dist/katex.min.css");
  const abs = path.join(htmlDir, KATEX_CSS_FILENAME);
  await fsp.copyFile(katexCssPath, abs);
  // KaTeX's stylesheet references its font files via relative paths
  // (`fonts/KaTeX_…woff2`). Copy the fonts/ dir alongside the CSS so
  // glyphs render with the proper math typeface in the export.
  const fontsSrc = path.join(path.dirname(katexCssPath), "fonts");
  const fontsDest = path.join(htmlDir, "fonts");
  try {
    await fsp.cp(fontsSrc, fontsDest, { recursive: true });
  } catch {
    // Non-fatal: equations still render, just without the custom font metrics.
  }
  // KaTeX is MIT-licensed; the license's "include this copyright notice in
  // all copies or substantial portions" clause arguably applies to the
  // copied CSS (and certainly to the font binaries). Ship the upstream
  // LICENSE alongside so a single file covers every KaTeX artifact we emit.
  // `katex/dist/katex.min.css` resolves to `node_modules/katex/dist/...`,
  // so the LICENSE sits two levels up next to the package root.
  const licenseSrc = path.join(path.dirname(katexCssPath), "..", "LICENSE");
  const licenseDest = path.join(htmlDir, KATEX_LICENSE_FILENAME);
  try {
    await fsp.copyFile(licenseSrc, licenseDest);
  } catch {
    // Non-fatal: the export still works, the notice just isn't shipped.
    // (Mirrors the fonts/ copy posture above — best-effort during tests
    // that mock the node_modules tree.)
  }
  return abs;
}

export const SEARCH_JS = `(() => {
  // Inject a copy button into every <pre><code> block.
  const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const DONE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
  document.querySelectorAll('pre > code').forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.querySelector('.copy-btn')) return;
    pre.classList.add('has-copy');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = COPY_ICON;
    btn.addEventListener('click', async () => {
      const text = code.textContent || '';
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          // file:// fallback for browsers that block clipboard API
          const ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta);
        }
        btn.classList.add('copied');
        btn.innerHTML = DONE_ICON;
        btn.setAttribute('aria-label', 'Copied!');
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = COPY_ICON;
          btn.setAttribute('aria-label', 'Copy code');
        }, 1400);
      } catch (e) {
        console.error('notion-exporter: copy failed', e);
      }
    });
    pre.appendChild(btn);
  });

  // Persist desktop sidebar collapse state across page loads (no-op on mobile).
  const toggle = document.getElementById('ne-sb-toggle');
  if (toggle) {
    toggle.addEventListener('change', () => {
      try {
        if (window.matchMedia('(min-width:900px)').matches) {
          localStorage.setItem('ne-sb-collapsed', toggle.checked ? '1' : '0');
        }
      } catch (_) {}
    });
  }

  // ── Inline DB filter + sort (read-only views, client-side only).
  //
  // Type-aware filters layered on top of the substring input:
  //   • chips for select / status / multi_select columns
  //   • date-range inputs for date columns
  //   • number-range inputs for number columns
  //   • a sort dropdown (mirrors the existing column-header click behaviour)
  //   • Clear-filters button + empty-state message
  //   • URL-hash state so a filtered view is shareable / refresh-stable
  //
  // The DB section can be a table, gallery (cards), or kanban board — each
  // unit-of-iteration is referred to as a "row" below and resolves to a
  // <tr>, .db-card, or .kanban-card respectively. Per-row data-attributes
  // (set during markdown render) let us evaluate filters without re-parsing
  // cell HTML.
  let _dbIdSeq = 0;
  function setupInlineDb(section) {
    const dbId = section.getAttribute('data-db-id') || ('db' + (++_dbIdSeq));
    section.setAttribute('data-db-id', dbId);
    const filter = section.querySelector('[data-inline-db-filter]');
    const table = section.querySelector('table.inline-db-table');
    const cards = Array.from(section.querySelectorAll('.db-card'));
    const kanbanCards = Array.from(section.querySelectorAll('.kanban-card'));
    const filtersRoot = section.querySelector('[data-db-filters]');
    const emptyEl = section.querySelector('[data-empty-state]');
    const clearBtn = section.querySelector('[data-filter-clear]');

    // Filter state: substring text + per-column structured filters. Mutated
    // in place by handlers; URL hash sync drains the state on every change.
    const state = {
      q: '',
      // col -> { type: 'select' | 'date' | 'number', values: Set<string> | { from, to } }
      cols: {},
      sort: null, // { col: string, dir: 'asc'|'desc' } | null
    };

    function rowUnits() {
      if (table) {
        const tbody = table.tBodies[0];
        return tbody ? Array.from(tbody.rows) : [];
      }
      if (kanbanCards.length) return kanbanCards;
      if (cards.length) return cards;
      return [];
    }

    function cellValueFor(unit, col) {
      // Both table TDs and gallery/kanban cards expose the value via
      // [data-col="<name>"] elements with data-filter-* attributes (or, for
      // cards, fall back to descendant text).
      const el = unit.querySelector('[data-col="' + cssEsc(col) + '"]');
      return el;
    }

    function cssEsc(s) {
      return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\\\]/g, '\\\\$&');
    }

    function matchSelect(el, wanted /* Set<string> */) {
      if (!el) return false;
      const raw = el.getAttribute('data-filter-values');
      if (!raw) return false;
      // Contract with filterDataAttrs (markdown.ts): each option name is
      // encodeURIComponent-encoded before joining with the pipe delimiter,
      // so we decode each split piece here. This protects names that
      // contain a literal pipe (e.g. Priority|High) from being
      // false-matched as two options.
      //
      // decodeURIComponent throws URIError on malformed sequences (e.g. lone
      // surrogates). When it throws we keep BOTH the raw and decoded forms in
      // the haystack: the chip's data-filter-value is the raw human-readable
      // name, but if encoding ever silently flipped to a different scheme the
      // raw-piece fallback still gives us a chance at matching.
      const have = [];
      raw.split('|').forEach(function (s) {
        try { have.push(decodeURIComponent(s)); }
        catch (_e) { have.push(s); }
      });
      for (const w of wanted) { if (have.indexOf(w) !== -1) return true; }
      return false;
    }

    function matchDate(el, range /* {from?, to?} */) {
      if (!el) return false;
      const start = el.getAttribute('data-filter-date');
      if (!start) return false;
      if (range.from && start < range.from) return false;
      if (range.to && start > range.to) return false;
      return true;
    }

    function matchNumber(el, range) {
      if (!el) return false;
      const raw = el.getAttribute('data-filter-number');
      if (raw == null || raw === '') return false;
      const n = Number(raw);
      if (Number.isNaN(n)) return false;
      if (range.from != null && n < range.from) return false;
      if (range.to != null && n > range.to) return false;
      return true;
    }

    function applyAll() {
      const needle = state.q.toLowerCase().trim();
      const cols = state.cols;
      const colKeys = Object.keys(cols);
      let visible = 0;
      for (const unit of rowUnits()) {
        let ok = true;
        if (needle && !(unit.textContent || '').toLowerCase().includes(needle)) ok = false;
        if (ok) {
          for (const col of colKeys) {
            const f = cols[col];
            if (!f) continue;
            const el = cellValueFor(unit, col);
            if (f.type === 'select') {
              if (f.values.size === 0) continue;
              if (!matchSelect(el, f.values)) { ok = false; break; }
            } else if (f.type === 'date') {
              if (!f.from && !f.to) continue;
              if (!matchDate(el, f)) { ok = false; break; }
            } else if (f.type === 'number') {
              if (f.from == null && f.to == null) continue;
              if (!matchNumber(el, f)) { ok = false; break; }
            }
          }
        }
        unit.hidden = !ok;
        if (ok) visible++;
      }

      // Sort (table only — gallery/kanban have a natural visual order).
      if (state.sort && table) {
        const headers = table.tHead && table.tHead.querySelectorAll('th[data-col-name]');
        let idx = -1;
        if (headers) headers.forEach((th, i) => {
          if (th.getAttribute('data-col-name') === state.sort.col) idx = i;
        });
        if (idx >= 0) sortTableBy(idx, state.sort.dir);
      }

      // Empty-state + clear button visibility.
      if (emptyEl) emptyEl.hidden = visible !== 0 || !isAnyFilterActive();
      if (clearBtn) clearBtn.hidden = !isAnyFilterActive();
    }

    function isAnyFilterActive() {
      if (state.q) return true;
      if (state.sort) return true;
      for (const col of Object.keys(state.cols)) {
        const f = state.cols[col];
        if (f.type === 'select' && f.values.size) return true;
        if (f.type === 'date' && (f.from || f.to)) return true;
        if (f.type === 'number' && (f.from != null || f.to != null)) return true;
      }
      return false;
    }

    function sortTableBy(col, dir) {
      const tbody = table && table.tBodies[0];
      if (!tbody) return;
      const rows = Array.from(tbody.rows);
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      rows.sort((a, b) => {
        const at = (a.cells[col]?.textContent || '').trim();
        const bt = (b.cells[col]?.textContent || '').trim();
        const cmp = collator.compare(at, bt);
        return dir === 'asc' ? cmp : -cmp;
      });
      for (const r of rows) tbody.appendChild(r);
      const ths = table.tHead && table.tHead.querySelectorAll('th[data-sort-col]');
      if (ths) ths.forEach((o) => o.classList.remove('sorted-asc', 'sorted-desc'));
      if (ths && ths[col]) ths[col].classList.add(dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }

    // ── Wire substring filter
    if (filter) {
      let t = null;
      filter.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { state.q = filter.value; applyAll(); syncHash(); }, 60);
      });
    }

    // ── Wire per-column filter widgets
    if (filtersRoot) {
      filtersRoot.querySelectorAll('.db-filter-group').forEach((group) => {
        const col = group.getAttribute('data-filter-col');
        const type = group.getAttribute('data-filter-type');
        if (!col || !type) return;
        if (type === 'select') {
          state.cols[col] = { type: 'select', values: new Set() };
          group.querySelectorAll('.db-filter-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
              const v = chip.getAttribute('data-filter-value') || '';
              const s = state.cols[col].values;
              if (s.has(v)) { s.delete(v); chip.classList.remove('is-active'); chip.setAttribute('aria-pressed', 'false'); }
              else { s.add(v); chip.classList.add('is-active'); chip.setAttribute('aria-pressed', 'true'); }
              applyAll(); syncHash();
            });
          });
        } else if (type === 'date') {
          state.cols[col] = { type: 'date', from: '', to: '' };
          const from = group.querySelector('.db-filter-from');
          const to = group.querySelector('.db-filter-to');
          if (from) from.addEventListener('change', () => { state.cols[col].from = from.value; applyAll(); syncHash(); });
          if (to) to.addEventListener('change', () => { state.cols[col].to = to.value; applyAll(); syncHash(); });
        } else if (type === 'number') {
          state.cols[col] = { type: 'number', from: null, to: null };
          const from = group.querySelector('.db-filter-from');
          const to = group.querySelector('.db-filter-to');
          if (from) from.addEventListener('input', () => { state.cols[col].from = from.value === '' ? null : Number(from.value); applyAll(); syncHash(); });
          if (to) to.addEventListener('input', () => { state.cols[col].to = to.value === '' ? null : Number(to.value); applyAll(); syncHash(); });
        }
      });
      const sortSel = filtersRoot.querySelector('[data-filter-sort]');
      if (sortSel) {
        sortSel.addEventListener('change', () => {
          const v = sortSel.value;
          if (!v) state.sort = null;
          else {
            const parts = v.split(':');
            state.sort = { col: parts[0], dir: parts[1] === 'desc' ? 'desc' : 'asc' };
          }
          applyAll(); syncHash();
        });
      }
    }

    // Clear button + empty-state link reset everything.
    function clearAll() {
      state.q = '';
      if (filter) filter.value = '';
      for (const col of Object.keys(state.cols)) {
        const f = state.cols[col];
        if (f.type === 'select') f.values.clear();
        else if (f.type === 'date') { f.from = ''; f.to = ''; }
        else if (f.type === 'number') { f.from = null; f.to = null; }
      }
      if (filtersRoot) {
        filtersRoot.querySelectorAll('.db-filter-chip.is-active').forEach((c) => {
          c.classList.remove('is-active'); c.setAttribute('aria-pressed', 'false');
        });
        filtersRoot.querySelectorAll('.db-filter-from, .db-filter-to').forEach((el) => { el.value = ''; });
        const sortSel = filtersRoot.querySelector('[data-filter-sort]');
        if (sortSel) sortSel.value = '';
      }
      state.sort = null;
      applyAll(); syncHash();
    }
    if (clearBtn) clearBtn.addEventListener('click', clearAll);
    const emptyClear = section.querySelector('[data-empty-clear]');
    if (emptyClear) emptyClear.addEventListener('click', (e) => { e.preventDefault(); clearAll(); });

    // Existing column-header click-to-sort (table view only).
    if (table) {
      const thead = table.tHead;
      if (thead) {
        const ths = thead.querySelectorAll('th[data-sort-col]');
        ths.forEach((th) => {
          function go() {
            const col = Number(th.getAttribute('data-sort-col'));
            const dir = th.classList.contains('sorted-asc') ? 'desc' : 'asc';
            const colName = th.getAttribute('data-col-name') || '';
            state.sort = { col: colName, dir };
            sortTableBy(col, dir);
            const sortSel = filtersRoot && filtersRoot.querySelector('[data-filter-sort]');
            if (sortSel) sortSel.value = colName + ':' + dir;
            syncHash();
          }
          th.addEventListener('click', go);
          th.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
          });
        });
      }
    }

    // ── URL hash sync (#db:<id>?q=…&col[Status]=A,B&date[Due]=2024-01-01..)
    function readHash() {
      const h = (location.hash || '').replace(/^#/, '');
      if (!h) return;
      const parts = h.split('|');
      for (const part of parts) {
        const m = /^db:([^?]+)?(.*)$/.exec(part);
        if (!m || m[1] !== dbId) continue;
        const sp = new URLSearchParams(m[2]);
        const q = sp.get('q'); if (q != null) { state.q = q; if (filter) filter.value = q; }
        const sort = sp.get('sort');
        if (sort) {
          const ps = sort.split(':');
          state.sort = { col: ps[0], dir: ps[1] === 'desc' ? 'desc' : 'asc' };
          const sortSel = filtersRoot && filtersRoot.querySelector('[data-filter-sort]');
          if (sortSel) sortSel.value = sort;
        }
        sp.forEach((value, key) => {
          // The square brackets must be escaped — unescaped they parse as a
          // character class. /^col\\[(.+)\\]$/ matches the literal [Status]
          // suffix written by the encode side.
          const ms = /^col[(.+)]$/.exec(key);
          if (ms) {
            const col = ms[1];
            const f = state.cols[col]; if (!f || f.type !== 'select') return;
            value.split(',').filter(Boolean).forEach((v) => {
              f.values.add(v);
              if (filtersRoot) {
                const chip = filtersRoot.querySelector('.db-filter-group[data-filter-col="' + cssEsc(col) + '"] .db-filter-chip[data-filter-value="' + cssEsc(v) + '"]');
                if (chip) { chip.classList.add('is-active'); chip.setAttribute('aria-pressed', 'true'); }
              }
            });
          }
          const ds = /^date[(.+)]$/.exec(key);
          if (ds) {
            const col = ds[1]; const f = state.cols[col]; if (!f || f.type !== 'date') return;
            const range = value.split('..'); f.from = range[0] || ''; f.to = range[1] || '';
            if (filtersRoot) {
              const group = filtersRoot.querySelector('.db-filter-group[data-filter-col="' + cssEsc(col) + '"]');
              const a = group && group.querySelector('.db-filter-from'); if (a) a.value = f.from;
              const b = group && group.querySelector('.db-filter-to'); if (b) b.value = f.to;
            }
          }
          const ns = /^num[(.+)]$/.exec(key);
          if (ns) {
            const col = ns[1]; const f = state.cols[col]; if (!f || f.type !== 'number') return;
            const range = value.split('..');
            f.from = range[0] === '' || range[0] == null ? null : Number(range[0]);
            f.to = range[1] === '' || range[1] == null ? null : Number(range[1]);
            if (filtersRoot) {
              const group = filtersRoot.querySelector('.db-filter-group[data-filter-col="' + cssEsc(col) + '"]');
              const a = group && group.querySelector('.db-filter-from'); if (a) a.value = f.from == null ? '' : String(f.from);
              const b = group && group.querySelector('.db-filter-to'); if (b) b.value = f.to == null ? '' : String(f.to);
            }
          }
        });
      }
    }

    function syncHash() {
      const sp = new URLSearchParams();
      if (state.q) sp.set('q', state.q);
      if (state.sort) sp.set('sort', state.sort.col + ':' + state.sort.dir);
      for (const col of Object.keys(state.cols)) {
        const f = state.cols[col];
        if (f.type === 'select' && f.values.size) sp.set('col[' + col + ']', [...f.values].join(','));
        else if (f.type === 'date' && (f.from || f.to)) sp.set('date[' + col + ']', (f.from || '') + '..' + (f.to || ''));
        else if (f.type === 'number' && (f.from != null || f.to != null)) sp.set('num[' + col + ']', (f.from == null ? '' : f.from) + '..' + (f.to == null ? '' : f.to));
      }
      const mine = sp.toString() ? ('db:' + dbId + '?' + sp.toString()) : '';
      // Merge with hash entries for other DBs on the page.
      const others = (location.hash || '').replace(/^#/, '').split('|').filter((p) => p && !p.startsWith('db:' + dbId + '?') && p !== ('db:' + dbId));
      const next = [mine, ...others].filter(Boolean).join('|');
      const target = next ? '#' + next : (location.pathname + location.search);
      // Use replaceState to avoid polluting browser history on every keystroke.
      try {
        if (next) history.replaceState(null, '', '#' + next);
        else history.replaceState(null, '', target);
      } catch (_) {
        if (next) location.hash = next;
      }
    }

    // Initial state pull from URL, then apply (covers refresh round-trip).
    readHash();
    applyAll();
  }
  document.querySelectorAll('section.inline-db').forEach(setupInlineDb);

  // ── Theme toggle (light/system/dark). The actual mode is pre-applied by
  //    the inline <script> in <head> to avoid a flash; this script wires the
  //    three buttons and keeps localStorage in sync.
  function currentTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return 'system';
  }
  function applyTheme(mode) {
    if (mode === 'system') {
      document.documentElement.removeAttribute('data-theme');
      try { localStorage.removeItem('ne-theme'); } catch (_) {}
    } else {
      document.documentElement.setAttribute('data-theme', mode);
      try { localStorage.setItem('ne-theme', mode); } catch (_) {}
    }
    syncThemeButtons();
  }
  function syncThemeButtons() {
    const active = currentTheme();
    document.querySelectorAll('.theme-btn').forEach((b) => {
      const mode = b.getAttribute('data-theme-set');
      b.classList.toggle('is-active', mode === active);
      b.setAttribute('aria-pressed', mode === active ? 'true' : 'false');
    });
  }
  document.querySelectorAll('.theme-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const mode = b.getAttribute('data-theme-set') || 'system';
      applyTheme(mode);
    });
  });
  syncThemeButtons();

  // ── Hash-anchor + details helpers (registered first so they work on pages
  //    that don't ship the search payload).
  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (_) { return s; }
  }
  function openAncestorDetails(el) {
    // Start at the element itself — the target may be a <details> (e.g. a
    // toggle heading) which also needs opening.
    let n = el;
    while (n) {
      if (n.tagName === 'DETAILS' && !n.open) n.open = true;
      n = n.parentElement;
    }
  }
  function jumpToHash() {
    const id = safeDecode((location.hash || '').slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    openAncestorDetails(el);
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }
  window.addEventListener('hashchange', jumpToHash);
  // Image loads shift layout — re-run once everything's settled.
  window.addEventListener('load', () => { if (location.hash) jumpToHash(); });
  if (location.hash) jumpToHash();
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = safeDecode(a.getAttribute('href').slice(1));
    const el = id && document.getElementById(id);
    if (el) openAncestorDetails(el);
  });
  // Mobile drawer: tapping any sidebar link should close the drawer so the
  // tapped section is actually visible. Desktop (>=900px) ignores the toggle.
  document.addEventListener('click', (e) => {
    const link = e.target && e.target.closest && e.target.closest('aside.sidebar a[href]');
    if (!link) return;
    if (window.matchMedia('(min-width:900px)').matches) return;
    const cb = document.getElementById('ne-sb-toggle');
    if (cb && cb.checked) cb.checked = false;
  });

  // Search wiring is lazy: the bootstrap script in <head> only loads lunr +
  // search-index.js on first interaction with the search input, then calls
  // window.__neInitSearch (defined below). When the user never opens search,
  // we avoid parsing & evaluating the multi-megabyte index entirely.
  const inputs = document.querySelectorAll('[data-ne-search]');
  if (!inputs.length) return;

  let idx;
  let docs = {};
  let initialised = false;

  function initSearch() {
    if (initialised) return true;
    const payload = window.NE_SEARCH_DATA;
    if (!payload || typeof lunr === "undefined") return false;
    try { idx = lunr.Index.load(payload.index); }
    catch (e) { console.error("notion-exporter: search index invalid", e); return false; }
    docs = payload.docs || {};
    initialised = true;
    return true;
  }
  // Expose so the lazy-loader bootstrap can trigger initialisation once both
  // lunr.min.js and search-index.js have finished loading.
  window.__neInitSearch = initSearch;

  function escape(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  function hrefFromRoot(href, fromRoot) {
    // Page hrefs in the index are html-root-relative.
    // On non-index pages we need to prepend ../ for each subdir level.
    return fromRoot + href;
  }

  function render(results, matches, q, fromRoot) {
    if (matches.length === 0) {
      results.hidden = false;
      results.innerHTML = \`<li class="ne-empty">No matches for "\${escape(q)}"</li>\`;
      return;
    }
    results.hidden = false;
    results.innerHTML = matches
      .slice(0, 40)
      .map((m) => {
        const d = docs[m.ref];
        if (!d) return "";
        const icon = d.kind === "database" ? "🗂" : "📄";
        const snippet = d.snippet ? \`<span class="ne-snippet">\${escape(d.snippet)}</span>\` : "";
        return \`<li><a href="\${escape(hrefFromRoot(d.href, fromRoot))}"><span class="ne-icon">\${icon}</span><span class="ne-title">\${escape(d.title)}</span></a>\${snippet}</li>\`;
      })
      .join("");
  }

  // Discover how deep we are below the html root by walking up from
  // location.pathname until we find /index.html or run out of segments.
  function computeFromRoot() {
    const parts = location.pathname.split('/');
    // strip the filename
    parts.pop();
    // count subdirs (anything between html dir and current dir) — use a sentinel:
    // we encode it via a data attribute on the body if available.
    const body = document.body;
    const attr = body && body.getAttribute('data-root-prefix');
    return attr || '';
  }

  const fromRoot = computeFromRoot();

  function setupInput(input) {
    const id = input.id;
    const resultsId = id === 'ne-sidebar-search' ? 'ne-sidebar-results' : 'ne-search-results';
    const results = document.getElementById(resultsId);
    if (!results) return;
    const isSidebar = id === 'ne-sidebar-search';
    const tree = isSidebar
      ? document.querySelector('[data-ne-tree]')
      : document.querySelector('.index-tree');
    const searchingClass = isSidebar ? 'ne-sb-searching' : 'ne-searching';

    function setSearching(on) {
      document.body.classList.toggle(searchingClass, on);
      if (tree) tree.hidden = on;
    }

    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = input.value.trim();
        if (!q) {
          setSearching(false);
          results.hidden = true;
          results.innerHTML = "";
          return;
        }
        setSearching(true);
        // Defensive: bootstrap should have already initialised before the
        // user finished typing, but if the index is still loading show a
        // brief "Loading…" state instead of throwing.
        if (!initSearch()) {
          results.hidden = false;
          results.innerHTML = \`<li class="ne-empty">Loading search…</li>\`;
          return;
        }
        try {
          const matches = idx.search(q.split(/\\s+/).filter(Boolean).map((t) => t + "*").join(" "));
          render(results, matches, q, fromRoot);
        } catch {
          results.hidden = false;
          results.innerHTML = \`<li class="ne-empty">No matches for "\${escape(q)}"</li>\`;
        }
      }, 80);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        setSearching(false);
        results.hidden = true;
        results.innerHTML = '';
        input.blur();
      }
    });
  }

  inputs.forEach(setupInput);
})();`;

export async function writeSearchJs(htmlDir: string): Promise<string> {
  const abs = path.join(htmlDir, "search.js");
  await fsp.writeFile(abs, SEARCH_JS);
  return abs;
}

// Click-to-zoom for body images. A delegated listener on <main> matches any
// <img> that isn't a UI glyph (custom-emoji, sidebar/index/tree/db-card icons,
// or anything explicitly opted out via [data-no-zoom]) and isn't already
// wrapped in an <a>. On match, a single lazy <dialog class="ne-lightbox">
// is created (and reused) and opened via showModal(); ESC + backdrop click
// + close button all close it. Focus trap comes free with <dialog>.
export const LIGHTBOX_JS = `(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const main = document.querySelector('main');
    if (!main) return;
    let dialog = null;
    let dialogImg = null;

    function ensureDialog() {
      if (dialog) return dialog;
      dialog = document.createElement('dialog');
      dialog.className = 'ne-lightbox';
      dialogImg = document.createElement('img');
      dialogImg.alt = '';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'close';
      close.setAttribute('aria-label', 'Close');
      close.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      close.addEventListener('click', () => dialog.close());
      dialog.appendChild(close);
      dialog.appendChild(dialogImg);
      dialog.addEventListener('click', (e) => {
        // Backdrop click: the event target is the dialog itself (the <img>
        // and the close button stop the propagation chain at themselves).
        if (e.target === dialog) dialog.close();
      });
      document.body.appendChild(dialog);
      return dialog;
    }

    main.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || t.tagName !== 'IMG') return;
      if (t.matches('.custom-emoji, .sidebar-home-icon, .index-hero-icon, .tree-icon, .db-card-icon, .page-icon, [data-no-zoom]')) return;
      // If the image is inside an <a>, let the link click win.
      if (t.closest('a')) return;
      e.preventDefault();
      const d = ensureDialog();
      dialogImg.src = t.currentSrc || t.src;
      dialogImg.alt = t.alt || '';
      d.showModal();
    });
  });
})();`;

export async function writeLightboxJs(htmlDir: string): Promise<string> {
  const abs = path.join(htmlDir, "lightbox.js");
  await fsp.writeFile(abs, LIGHTBOX_JS);
  return abs;
}

/**
 * Tiny inline bootstrap that defers loading `lunr.min.js` + `search-index.js`
 * until the user actually engages with a `[data-ne-search]` input. On first
 * focus / keydown / pointerdown we inject both `<script>` tags into `<head>`
 * (with async=false to preserve evaluation order) and, once both have loaded,
 * call `window.__neInitSearch()` and re-fire an `input` event so any text the
 * user already typed runs through the search handler.
 *
 * Marked `window.__NE_BOOT_SEARCH(prefix)` and emitted per-page so the prefix
 * (the html-root-relative path back to the html dir) is baked in at render
 * time — avoiding the need to compute it from `document.body[data-root-prefix]`
 * before any of the search logic loads.
 */
export const SEARCH_BOOTSTRAP_JS = `(() => {
  function boot(prefix) {
    var inputs = document.querySelectorAll('[data-ne-search]');
    if (!inputs.length) return;
    var triggered = false;
    function load() {
      if (triggered) return;
      triggered = true;
      function inject(src) {
        return new Promise(function (resolve, reject) {
          var s = document.createElement('script');
          s.src = prefix + src;
          s.async = false; // preserve order: lunr must evaluate before the index
          s.onload = function () { resolve(); };
          s.onerror = function () { reject(new Error('failed: ' + src)); };
          document.head.appendChild(s);
        });
      }
      Promise.all([inject('lunr.min.js'), inject('search-index.js')]).then(function () {
        if (typeof window.__neInitSearch === 'function') window.__neInitSearch();
        // If the user has already typed before the index finished loading,
        // re-fire an input event so the existing handler picks up their query.
        inputs.forEach(function (el) {
          if (el.value) el.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }).catch(function (e) { console.error('notion-exporter: search load failed', e); });
    }
    inputs.forEach(function (el) {
      // Any of these three signals = "user wants search now".
      el.addEventListener('focus', load, { once: true });
      el.addEventListener('keydown', load, { once: true });
      el.addEventListener('pointerdown', load, { once: true });
    });
  }
  window.__NE_BOOT_SEARCH = boot;
})();`;
