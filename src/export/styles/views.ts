export const VIEWS_CSS = `
/* --- Calendar view (Views API "calendar") -------------------------------- */
.inline-db.calendar .calendar-months {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 0.4rem 0 0.6rem;
}
.calendar-month {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-subtle);
}
.calendar-month-head {
  padding: 0.55rem 0.8rem;
  font-weight: 600;
  font-size: 0.9rem;
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
}
.calendar-dows {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: var(--bg-subtle);
}
.calendar-dow {
  padding: 0.3rem 0.4rem;
  font-size: 0.74rem;
  color: var(--fg-muted);
  text-align: center;
  font-weight: 600;
}
.calendar-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  background: var(--border);
}
.calendar-cell {
  background: var(--bg);
  min-height: 5.5rem;
  padding: 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  overflow: hidden;
}
.calendar-cell-empty { background: var(--bg-subtle); min-height: 0; }
.calendar-daynum {
  font-size: 0.74rem;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
.calendar-event {
  display: block;
  font-size: 0.78rem;
  line-height: 1.25;
  padding: 0.12rem 0.3rem;
  border-radius: 4px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  text-decoration: none;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calendar-event:hover { background: var(--border); }

/* --- Timeline view (Views API "timeline") -------------------------------- */
.inline-db.timeline .timeline-axis {
  display: flex;
  justify-content: space-between;
  font-size: 0.76rem;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  padding: 0.3rem 0 0.4rem;
  border-bottom: 1px solid var(--border);
}
.inline-db.timeline .timeline-bars {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0 0.6rem;
}
.timeline-row {
  position: relative;
  height: 1.7rem;
  background: var(--bg-subtle);
  border-radius: 5px;
}
.timeline-bar {
  position: absolute;
  top: 0;
  height: 100%;
  min-width: 0.5rem;
  box-sizing: border-box;
  background: var(--accent, var(--border));
  border: 1px solid var(--border);
  border-radius: 5px;
  display: flex;
  align-items: center;
  padding: 0 0.45rem;
  overflow: hidden;
}
.timeline-bar-link {
  font-size: 0.78rem;
  line-height: 1.2;
  color: var(--fg);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* --- List view (Views API "list") ---------------------------------------- */
.inline-db-list .db-list {
  list-style: none;
  margin: 0;
  padding: 0.3rem 0 0.5rem;
  display: flex;
  flex-direction: column;
}
.db-list-row {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.4rem 0.2rem;
  border-bottom: 1px solid var(--border);
}
.db-list-row:last-child { border-bottom: 0; }
.db-list-link {
  text-decoration: none;
  color: var(--fg);
  font-weight: 500;
}
.db-list-link:hover { text-decoration: underline; }
.db-list-meta {
  color: var(--fg-muted);
  font-size: 0.84rem;
  margin-left: auto;
  display: flex;
  gap: 0.35rem;
  align-items: baseline;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* --- Multi-view tabs (Views API) — CSS-only radio tabs ------------------- */
/* Structure: N hidden radios (one per view), a .view-tabs chip row of labels,
   then .view-panels of full inline-db sections. The checked radio reveals the
   matching panel via nth-of-type/nth-child rules (capped at MAX_VIEWS=16 in
   the renderer). No JS. */
.inline-db-tabbed > .view-tab-radio {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.view-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0.2rem 0 0.6rem;
}
.view-tab {
  cursor: pointer;
  font-size: 0.84rem;
  padding: 0.25rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--fg-muted);
  user-select: none;
  white-space: nowrap;
}
.view-tab:hover { background: var(--border); }
.view-panel { display: none; }
/* Reveal the checked view's panel + highlight its tab. One pair per index. */
.inline-db-tabbed > .view-tab-radio:nth-of-type(1):checked ~ .view-panels > .view-panel:nth-child(1),
.inline-db-tabbed > .view-tab-radio:nth-of-type(2):checked ~ .view-panels > .view-panel:nth-child(2),
.inline-db-tabbed > .view-tab-radio:nth-of-type(3):checked ~ .view-panels > .view-panel:nth-child(3),
.inline-db-tabbed > .view-tab-radio:nth-of-type(4):checked ~ .view-panels > .view-panel:nth-child(4),
.inline-db-tabbed > .view-tab-radio:nth-of-type(5):checked ~ .view-panels > .view-panel:nth-child(5),
.inline-db-tabbed > .view-tab-radio:nth-of-type(6):checked ~ .view-panels > .view-panel:nth-child(6),
.inline-db-tabbed > .view-tab-radio:nth-of-type(7):checked ~ .view-panels > .view-panel:nth-child(7),
.inline-db-tabbed > .view-tab-radio:nth-of-type(8):checked ~ .view-panels > .view-panel:nth-child(8),
.inline-db-tabbed > .view-tab-radio:nth-of-type(9):checked ~ .view-panels > .view-panel:nth-child(9),
.inline-db-tabbed > .view-tab-radio:nth-of-type(10):checked ~ .view-panels > .view-panel:nth-child(10),
.inline-db-tabbed > .view-tab-radio:nth-of-type(11):checked ~ .view-panels > .view-panel:nth-child(11),
.inline-db-tabbed > .view-tab-radio:nth-of-type(12):checked ~ .view-panels > .view-panel:nth-child(12),
.inline-db-tabbed > .view-tab-radio:nth-of-type(13):checked ~ .view-panels > .view-panel:nth-child(13),
.inline-db-tabbed > .view-tab-radio:nth-of-type(14):checked ~ .view-panels > .view-panel:nth-child(14),
.inline-db-tabbed > .view-tab-radio:nth-of-type(15):checked ~ .view-panels > .view-panel:nth-child(15),
.inline-db-tabbed > .view-tab-radio:nth-of-type(16):checked ~ .view-panels > .view-panel:nth-child(16) {
  display: block;
}
.inline-db-tabbed > .view-tab-radio:nth-of-type(1):checked ~ .view-tabs > .view-tab:nth-child(1),
.inline-db-tabbed > .view-tab-radio:nth-of-type(2):checked ~ .view-tabs > .view-tab:nth-child(2),
.inline-db-tabbed > .view-tab-radio:nth-of-type(3):checked ~ .view-tabs > .view-tab:nth-child(3),
.inline-db-tabbed > .view-tab-radio:nth-of-type(4):checked ~ .view-tabs > .view-tab:nth-child(4),
.inline-db-tabbed > .view-tab-radio:nth-of-type(5):checked ~ .view-tabs > .view-tab:nth-child(5),
.inline-db-tabbed > .view-tab-radio:nth-of-type(6):checked ~ .view-tabs > .view-tab:nth-child(6),
.inline-db-tabbed > .view-tab-radio:nth-of-type(7):checked ~ .view-tabs > .view-tab:nth-child(7),
.inline-db-tabbed > .view-tab-radio:nth-of-type(8):checked ~ .view-tabs > .view-tab:nth-child(8),
.inline-db-tabbed > .view-tab-radio:nth-of-type(9):checked ~ .view-tabs > .view-tab:nth-child(9),
.inline-db-tabbed > .view-tab-radio:nth-of-type(10):checked ~ .view-tabs > .view-tab:nth-child(10),
.inline-db-tabbed > .view-tab-radio:nth-of-type(11):checked ~ .view-tabs > .view-tab:nth-child(11),
.inline-db-tabbed > .view-tab-radio:nth-of-type(12):checked ~ .view-tabs > .view-tab:nth-child(12),
.inline-db-tabbed > .view-tab-radio:nth-of-type(13):checked ~ .view-tabs > .view-tab:nth-child(13),
.inline-db-tabbed > .view-tab-radio:nth-of-type(14):checked ~ .view-tabs > .view-tab:nth-child(14),
.inline-db-tabbed > .view-tab-radio:nth-of-type(15):checked ~ .view-tabs > .view-tab:nth-child(15),
.inline-db-tabbed > .view-tab-radio:nth-of-type(16):checked ~ .view-tabs > .view-tab:nth-child(16) {
  background: var(--accent, var(--fg));
  color: var(--bg);
  border-color: var(--accent, var(--fg));
}

/* Shared: collapsible undated/no-date list under calendar + timeline. */
.db-undated {
  margin-top: 0.6rem;
  font-size: 0.84rem;
}
.db-undated summary {
  cursor: pointer;
  color: var(--fg-muted);
}
.db-undated-list {
  margin: 0.4rem 0 0;
  padding-left: 1.2rem;
}
`;
