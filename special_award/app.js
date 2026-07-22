/* Special Awards Allocator — standalone, no server, no build step.
   Data persists in this browser via localStorage (key below). */

const STORAGE_KEY = "specialAwardsData_v1";
const TIERS = ["Banner", "Plaque", "Certificate"];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function emptyState() {
  return {
    teams: [],
    awards: [],
    nominations: [],
    performanceWinners: {},
    manualOverrides: {}
  };
}

let data = loadState();
let ui = { tab: "teams", bannerOpen: true, bannerExpanded: false, nominateAwardId: null };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...emptyState(), ...JSON.parse(raw) };
  } catch (e) {
    console.error("load failed", e);
  }
  return emptyState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("save failed", e);
  }
}

function update(patch) {
  data = { ...data, ...patch };
  saveState();
  render();
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ---------------- Derived data ---------------- */

function getSpecialAwards() { return data.awards.filter(a => a.category === "special"); }
function getPerformanceAwards() { return data.awards.filter(a => a.category === "performance"); }

function getNominationCounts() {
  const out = {};
  data.nominations.forEach(n => {
    out[n.awardId] = out[n.awardId] || {};
    out[n.awardId][n.teamId] = (out[n.awardId][n.teamId] || 0) + 1;
  });
  return out;
}

function allocateAwards(specialAwards, nominationCounts, performanceWinners, manualOverrides) {
  const awardCounts = {};
  Object.values(performanceWinners).forEach(tid => {
    if (tid) awardCounts[tid] = (awardCounts[tid] || 0) + 1;
  });

  const pool = specialAwards.map(a => {
    const counts = nominationCounts[a.id] || {};
    const teamIds = Object.keys(counts);
    return { award: a, teamIds, counts };
  });

  const nominated = pool.filter(p => p.teamIds.length > 0).sort((a, b) => a.teamIds.length - b.teamIds.length);
  const unnominated = pool.filter(p => p.teamIds.length === 0);

  const assigned = {};
  const reasoning = {};

  nominated.forEach(({ award, teamIds, counts }) => {
    const override = manualOverrides[award.id];
    if (override) {
      assigned[award.id] = override;
      awardCounts[override] = (awardCounts[override] || 0) + 1;
      reasoning[award.id] = "Manually assigned";
      return;
    }
    let best = null;
    teamIds.forEach(tid => {
      const current = awardCounts[tid] || 0;
      const nomCount = counts[tid];
      if (!best || current < best.current || (current === best.current && nomCount > best.nomCount)) {
        best = { tid, current, nomCount };
      }
    });
    assigned[award.id] = best.tid;
    awardCounts[best.tid] = (awardCounts[best.tid] || 0) + 1;
    reasoning[award.id] = best.current === 0
      ? "Highest-nominated team with no award yet"
      : "Highest-nominated among least-awarded remaining nominees";
  });

  unnominated.forEach(({ award }) => {
    const override = manualOverrides[award.id];
    if (override) {
      assigned[award.id] = override;
      awardCounts[override] = (awardCounts[override] || 0) + 1;
      reasoning[award.id] = "Manually assigned";
    } else {
      assigned[award.id] = null;
      reasoning[award.id] = "No nominations logged";
    }
  });

  return { assigned, reasoning };
}

function getTeamAwardMap(specialAwards, performanceAwards, allocation) {
  const map = {};
  data.teams.forEach(t => (map[t.id] = []));
  performanceAwards.forEach(a => {
    const tid = data.performanceWinners[a.id];
    if (tid && map[tid]) map[tid].push({ award: a, kind: "performance" });
  });
  specialAwards.forEach(a => {
    const tid = allocation.assigned[a.id];
    if (tid && map[tid]) map[tid].push({ award: a, kind: "special" });
  });
  return map;
}

function teamById(id) { return data.teams.find(t => t.id === id); }

/* ---------------- Render ---------------- */

function render() {
  const specialAwards = getSpecialAwards();
  const performanceAwards = getPerformanceAwards();
  const nominationCounts = getNominationCounts();
  const allocation = allocateAwards(specialAwards, nominationCounts, data.performanceWinners, data.manualOverrides);
  const teamAwardMap = getTeamAwardMap(specialAwards, performanceAwards, allocation);
  const teamsWithNone = data.teams.filter(t => (teamAwardMap[t.id] || []).length === 0);
  const teamsCovered = data.teams.length - teamsWithNone.length;
  const coveragePct = data.teams.length ? Math.round((teamsCovered / data.teams.length) * 100) : 0;
  const unassignedSpecialAwards = specialAwards.filter(a => !allocation.assigned[a.id]);
  const undecidedPerformanceAwards = performanceAwards.filter(a => !data.performanceWinners[a.id]);
  const hasOutstanding = unassignedSpecialAwards.length > 0 || undecidedPerformanceAwards.length > 0 || teamsWithNone.length > 0;

  const app = document.getElementById("app");
  app.innerHTML = `
    ${renderHeader(coveragePct, teamsCovered)}
    ${renderTabs()}
    ${hasOutstanding && ui.bannerOpen ? renderBanner(unassignedSpecialAwards, undecidedPerformanceAwards, teamsWithNone) : ""}
    <main>${renderTabContent(specialAwards, performanceAwards, nominationCounts, allocation, teamAwardMap, teamsWithNone)}</main>
  `;

  attachHandlers(specialAwards, performanceAwards, nominationCounts, allocation, teamAwardMap);
}

function renderHeader(coveragePct, teamsCovered) {
  return `
  <header class="app-header">
    <div class="bc title">SPECIAL AWARDS ALLOCATOR</div>
    <div class="subtitle">Nominate teams, then let the board maximize how many get recognized.</div>
    ${data.teams.length > 0 ? `
    <div class="coverage-wrap">
      <div class="coverage-label"><span>TEAMS RECOGNIZED</span><span>${teamsCovered} / ${data.teams.length} (${coveragePct}%)</span></div>
      <div class="coverage-track"><div class="coverage-fill" style="width:${coveragePct}%"></div></div>
    </div>` : ""}
  </header>`;
}

const TABS = [
  { id: "teams", label: "Teams", icon: "👥" },
  { id: "awards", label: "Awards", icon: "🏆" },
  { id: "nominate", label: "Nominate", icon: "🗳️" },
  { id: "performance", label: "Table Results", icon: "🥇" },
  { id: "allocate", label: "Allocate", icon: "🔀" },
  { id: "export", label: "Summary", icon: "📋" }
];

function renderTabs() {
  return `
  <nav class="tabs">
    ${TABS.map(t => `<button data-tab="${t.id}" class="${ui.tab === t.id ? "active" : ""}"><span>${t.icon}</span>${t.label}</button>`).join("")}
  </nav>`;
}

function renderBanner(unassignedSpecialAwards, undecidedPerformanceAwards, teamsWithNone) {
  const parts = [];
  if (unassignedSpecialAwards.length) parts.push(`${unassignedSpecialAwards.length} special award${unassignedSpecialAwards.length !== 1 ? "s" : ""} not assigned`);
  if (undecidedPerformanceAwards.length) parts.push(`${undecidedPerformanceAwards.length} table award${undecidedPerformanceAwards.length !== 1 ? "s" : ""} not entered`);
  if (teamsWithNone.length) parts.push(`${teamsWithNone.length} team${teamsWithNone.length !== 1 ? "s" : ""} with no award yet`);

  return `
  <div class="banner">
    <button class="banner-toggle" data-action="toggle-banner">
      <span>🔔</span>
      <span class="summary">${parts.join(" · ")}</span>
      <span>${ui.bannerExpanded ? "▲" : "▼"}</span>
      <span class="banner-dismiss" data-action="dismiss-banner">✕</span>
    </button>
    ${ui.bannerExpanded ? `
    <div class="banner-details">
      ${unassignedSpecialAwards.length ? `
        <div class="banner-group">
          <div class="banner-group-title">Special awards not assigned</div>
          ${unassignedSpecialAwards.map(a => `<div class="banner-item">• ${escapeHtml(a.name)}</div>`).join("")}
        </div>` : ""}
      ${undecidedPerformanceAwards.length ? `
        <div class="banner-group">
          <div class="banner-group-title">Table awards not entered</div>
          ${undecidedPerformanceAwards.map(a => `<div class="banner-item">• ${escapeHtml(a.name)}</div>`).join("")}
        </div>` : ""}
      ${teamsWithNone.length ? `
        <div class="banner-group">
          <div class="banner-group-title">Teams without an award</div>
          ${teamsWithNone.map(t => `<div class="banner-item">• ${t.number ? escapeHtml(t.number) + " — " : ""}${escapeHtml(t.name)}</div>`).join("")}
        </div>` : ""}
    </div>` : ""}
  </div>`;
}

function renderTabContent(specialAwards, performanceAwards, nominationCounts, allocation, teamAwardMap, teamsWithNone) {
  switch (ui.tab) {
    case "teams": return renderTeamsTab();
    case "awards": return renderAwardsTab();
    case "nominate": return renderNominateTab(specialAwards, nominationCounts);
    case "performance": return renderPerformanceTab(performanceAwards);
    case "allocate": return renderAllocateTab(specialAwards, nominationCounts, allocation);
    case "export": return renderExportTab(specialAwards, performanceAwards, nominationCounts, allocation, teamAwardMap, teamsWithNone);
    default: return "";
  }
}

/* ---- Teams tab ---- */
function renderTeamsTab() {
  return `
  <div class="card">
    <div class="section-title">Add a team</div>
    <div class="row mb8">
      <input type="text" id="new-team-number" placeholder="Number" style="width:90px;flex:0 0 auto">
      <input type="text" id="new-team-name" placeholder="Team name">
    </div>
    <div class="row">
      <button class="btn-primary" data-action="add-team">➕ Add team</button>
      <button class="btn-secondary" data-action="toggle-bulk">Bulk paste ${ui.showBulk ? "▲" : "▼"}</button>
    </div>
    ${ui.showBulk ? `
    <div style="margin-top:10px">
      <textarea id="bulk-teams" rows="5" placeholder="One team per line: number, name
e.g.
4102, Rolling Thunder
4118, The Wombateers"></textarea>
      <button class="btn-primary" style="margin-top:6px" data-action="add-bulk">Import list</button>
    </div>` : ""}
  </div>
  <div class="card">
    <div class="section-title">Roster (${data.teams.length})</div>
    ${data.teams.length === 0 ? `<div class="empty-state">No teams yet — add the tournament roster above.</div>` : ""}
    ${data.teams.map(t => `
      <div class="list-row">
        <div><span class="team-number">${t.number ? escapeHtml(t.number) : "—"}</span>${escapeHtml(t.name)}</div>
        <button class="icon-btn" data-action="remove-team" data-id="${t.id}">🗑</button>
      </div>`).join("")}
  </div>`;
}

/* ---- Awards tab ---- */
function renderAwardsTab() {
  const special = getSpecialAwards();
  const performance = getPerformanceAwards();
  return `
  <div class="card">
    <div class="section-title">Add an award</div>
    <input type="text" id="new-award-name" placeholder="Award name (e.g. Judges' Choice — Design)" class="mb8">
    <div class="row mb8">
      <select id="new-award-category">
        <option value="special">Judged special award</option>
        <option value="performance">Table/performance award</option>
      </select>
      <select id="new-award-tier">
        ${TIERS.map(t => `<option value="${t}">${t}</option>`).join("")}
      </select>
    </div>
    <button class="btn-primary" data-action="add-award">➕ Add award</button>
    <div class="muted" style="margin-top:8px;line-height:1.4">
      <b>Judged special awards</b> (banners, plaques, certificates) get nominated by judges and are spread out by the allocator.
      <b> Table/performance awards</b> (Champion, division winners, etc.) are results, entered directly under Table Results — they aren't nominated or spread.
    </div>
  </div>
  <div class="card">
    <div class="section-title">Judged special awards (${special.length})</div>
    ${special.length === 0 ? `<div class="empty-state">None yet.</div>` : ""}
    ${special.map(renderAwardRow).join("")}
  </div>
  <div class="card">
    <div class="section-title">Table/performance awards (${performance.length})</div>
    ${performance.length === 0 ? `<div class="empty-state">None yet.</div>` : ""}
    ${performance.map(renderAwardRow).join("")}
  </div>`;
}

function renderAwardRow(a) {
  return `
  <div class="list-row">
    <div>${escapeHtml(a.name)} ${a.tier ? `<span class="tier-badge">${a.tier.toUpperCase()}</span>` : ""}</div>
    <button class="icon-btn" data-action="remove-award" data-id="${a.id}">🗑</button>
  </div>`;
}

/* ---- Nominate tab ---- */
function renderNominateTab(specialAwards, nominationCounts) {
  if (specialAwards.length === 0) {
    return `<div class="card"><div class="empty-state">Add judged special awards first (in the Awards tab) before nominating teams.</div></div>`;
  }
  if (data.teams.length === 0) {
    return `<div class="card"><div class="empty-state">Add teams first (in the Teams tab) before nominating.</div></div>`;
  }
  if (!ui.nominateAwardId || !specialAwards.find(a => a.id === ui.nominateAwardId)) {
    ui.nominateAwardId = specialAwards[0].id;
  }
  const awardId = ui.nominateAwardId;
  const currentNoms = data.nominations.filter(n => n.awardId === awardId);
  const counts = nominationCounts[awardId] || {};
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return `
  <div class="card">
    <div class="section-title">Log a nomination</div>
    <select id="nominate-award-select" class="mb8">
      ${specialAwards.map(a => `<option value="${a.id}" ${a.id === awardId ? "selected" : ""}>${escapeHtml(a.name)}${a.tier ? ` (${a.tier})` : ""}</option>`).join("")}
    </select>
    <select id="nominate-team-select" class="mb8">
      <option value="">Select nominated team…</option>
      ${data.teams.map(t => `<option value="${t.id}">${t.number ? escapeHtml(t.number) + " — " : ""}${escapeHtml(t.name)}</option>`).join("")}
    </select>
    <input type="text" id="nominate-judge" placeholder="Judge name (optional)" class="mb8">
    <button class="btn-primary" data-action="add-nomination">➕ Add nomination</button>
  </div>

  <div class="card">
    <div class="section-title">Nomination tally — ${escapeHtml(specialAwards.find(a => a.id === awardId)?.name || "")}</div>
    ${ranked.length === 0 ? `<div class="empty-state">No nominations logged for this award yet.</div>` : ""}
    ${ranked.map(([tid, count]) => {
      const t = teamById(tid);
      if (!t) return "";
      return `<div class="list-row"><span><span class="team-number">${t.number ? escapeHtml(t.number) : "—"}</span>${escapeHtml(t.name)}</span><span style="font-weight:700;color:var(--navy)">${count} vote${count !== 1 ? "s" : ""}</span></div>`;
    }).join("")}
  </div>

  <div class="card">
    <div class="section-title">All nominations for this award (${currentNoms.length})</div>
    ${currentNoms.length === 0 ? `<div class="empty-state">None yet.</div>` : ""}
    ${currentNoms.map(n => {
      const t = teamById(n.teamId);
      return `<div class="list-row">
        <div>${t ? `${t.number ? escapeHtml(t.number) + " — " : ""}${escapeHtml(t.name)}` : "Unknown team"}${n.judge ? `<span class="muted"> · judge: ${escapeHtml(n.judge)}</span>` : ""}</div>
        <button class="icon-btn" data-action="remove-nomination" data-id="${n.id}">🗑</button>
      </div>`;
    }).join("")}
  </div>`;
}

/* ---- Performance tab ---- */
function renderPerformanceTab(performanceAwards) {
  if (performanceAwards.length === 0) {
    return `<div class="card"><div class="empty-state">Add table/performance awards first (in the Awards tab), e.g. Level 1 Champion, Open Champion, Overall Champion.</div></div>`;
  }
  return `
  <div class="card">
    <div class="section-title">Enter table results</div>
    <div class="muted mb10">These are recorded so the allocator knows who's already been recognized — they don't affect judged-award spreading logic beyond that.</div>
    ${performanceAwards.map(a => `
      <div class="mb10">
        <label style="font-size:13px;font-weight:600;color:var(--navy);display:block;margin-bottom:4px">${escapeHtml(a.name)}</label>
        <select data-action="set-winner" data-award-id="${a.id}">
          <option value="">— not yet decided —</option>
          ${data.teams.map(t => `<option value="${t.id}" ${data.performanceWinners[a.id] === t.id ? "selected" : ""}>${t.number ? escapeHtml(t.number) + " — " : ""}${escapeHtml(t.name)}</option>`).join("")}
        </select>
      </div>`).join("")}
  </div>`;
}

/* ---- Allocate tab ---- */
function renderAllocateTab(specialAwards, nominationCounts, allocation) {
  if (specialAwards.length === 0) {
    return `<div class="card"><div class="empty-state">Add judged special awards and nominations first.</div></div>`;
  }
  const hasOverrides = Object.keys(data.manualOverrides).length > 0;
  return `
  <div class="card">
    <div class="section-title">How this works</div>
    <div class="muted" style="line-height:1.5">
      Awards with the fewest nominees are settled first, so a small pool doesn't get skipped over. For each award, the team with
      the most nominations <i>among those holding the fewest awards so far</i> wins it — this pushes recognition toward teams with
      nothing yet, without ignoring the judges' input. You can override any single result below; overrides are respected on the next run.
    </div>
  </div>
  <div class="card">
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:4px">
      <div class="section-title" style="margin-bottom:0">Allocation results</div>
      ${hasOverrides ? `<button class="btn-link" data-action="clear-overrides">Clear overrides</button>` : ""}
    </div>
    ${specialAwards.map(a => {
      const counts = nominationCounts[a.id] || {};
      const winnerId = allocation.assigned[a.id];
      const winner = winnerId ? teamById(winnerId) : null;
      const isOverridden = !!data.manualOverrides[a.id];
      return `
      <div class="award-block">
        <div class="award-name">${escapeHtml(a.name)} ${a.tier ? `<span style="font-size:10px;color:var(--gold)">· ${a.tier}</span>` : ""}</div>
        ${winner ? `
        <div class="winner-line">
          <span>✅</span>
          <span style="font-weight:600">${winner.number ? escapeHtml(winner.number) + " — " : ""}${escapeHtml(winner.name)}</span>
          <span class="reason-note"> — ${escapeHtml(allocation.reasoning[a.id])}${isOverridden ? " (override)" : ""}</span>
        </div>` : `
        <div class="reason-note" style="margin-bottom:4px">⚠️ No nominations — assign manually below if this award should still be given.</div>`}
        <select data-action="set-override" data-award-id="${a.id}">
          <option value="">— use automatic result —</option>
          ${data.teams.map(t => `<option value="${t.id}" ${data.manualOverrides[a.id] === t.id ? "selected" : ""}>${t.number ? escapeHtml(t.number) + " — " : ""}${escapeHtml(t.name)}${counts[t.id] ? ` (${counts[t.id]} nom${counts[t.id] !== 1 ? "s" : ""})` : ""}</option>`).join("")}
        </select>
      </div>`;
    }).join("")}
  </div>`;
}

/* ---- Export tab ---- */
function renderExportTab(specialAwards, performanceAwards, nominationCounts, allocation, teamAwardMap, teamsWithNone) {
  const teamsWithAwards = data.teams.filter(t => (teamAwardMap[t.id] || []).length > 0);

  const misses = [];
  specialAwards.forEach(a => {
    const counts = nominationCounts[a.id] || {};
    const winnerId = allocation.assigned[a.id];
    Object.entries(counts).forEach(([tid, count]) => {
      if (tid === winnerId) return;
      const hasAward = (teamAwardMap[tid] || []).length > 0;
      if (!hasAward) misses.push({ awardName: a.name, teamId: tid, count });
    });
  });
  const nearMisses = misses.sort((a, b) => b.count - a.count).slice(0, 10);

  const rows = [["Team Number", "Team Name", "Award", "Category"]];
  data.teams.forEach(t => {
    const awards = teamAwardMap[t.id] || [];
    if (awards.length === 0) {
      rows.push([t.number, t.name, "", ""]);
    } else {
      awards.forEach(a => rows.push([t.number, t.name, a.award.name, a.kind]));
    }
  });
  const csv = rows.map(r => r.map(c => `"${String(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");

  return `
  <div class="card">
    <div class="section-title">Teams with an award (${teamsWithAwards.length}/${data.teams.length})</div>
    ${teamsWithAwards.length === 0 ? `<div class="empty-state">None yet — enter results and run an allocation.</div>` : ""}
    ${teamsWithAwards.map(t => `
      <div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div style="font-size:14px;font-weight:700;color:var(--navy)"><span class="team-number">${t.number ? escapeHtml(t.number) : "—"}</span>${escapeHtml(t.name)}</div>
        <div class="muted" style="margin-top:2px">${(teamAwardMap[t.id] || []).map(a => escapeHtml(a.award.name)).join(", ")}</div>
      </div>`).join("")}
  </div>

  <div class="card ${teamsWithNone.length ? "flagged" : ""}">
    <div class="section-title">Teams with nothing yet (${teamsWithNone.length})</div>
    ${teamsWithNone.length === 0
      ? `<div style="font-size:13.5px;color:#2F7D4F;font-weight:600">Every team has been recognized. 🎉</div>`
      : teamsWithNone.map(t => `<div style="font-size:14px;padding:4px 0"><span class="team-number">${t.number ? escapeHtml(t.number) : "—"}</span>${escapeHtml(t.name)}</div>`).join("")}
  </div>

  ${nearMisses.length > 0 ? `
  <div class="card">
    <div class="section-title">Near misses worth a look</div>
    <div class="muted mb8">Un-awarded teams that still picked up nominations — good candidates if you have a spare certificate.</div>
    ${nearMisses.map(m => {
      const t = teamById(m.teamId);
      if (!t) return "";
      return `<div class="list-row" style="padding:4px 0"><span><span class="team-number">${t.number ? escapeHtml(t.number) : "—"}</span>${escapeHtml(t.name)}</span><span class="muted">${escapeHtml(m.awardName)} · ${m.count} nom${m.count !== 1 ? "s" : ""}</span></div>`;
    }).join("")}
  </div>` : ""}

  <div class="card">
    <div class="section-title">Export</div>
    <div class="muted mb8">Select all and copy to paste into a spreadsheet.</div>
    <textarea class="mono" rows="8" readonly>${escapeHtml(csv)}</textarea>
  </div>`;
}

/* ---------------- Event handling ---------------- */

function attachHandlers() {
  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => { ui.tab = btn.dataset.tab; render(); });
  });

  const bannerToggle = document.querySelector('[data-action="toggle-banner"]');
  if (bannerToggle) bannerToggle.addEventListener("click", (e) => {
    if (e.target.closest('[data-action="dismiss-banner"]')) return;
    ui.bannerExpanded = !ui.bannerExpanded;
    render();
  });
  const bannerDismiss = document.querySelector('[data-action="dismiss-banner"]');
  if (bannerDismiss) bannerDismiss.addEventListener("click", (e) => {
    e.stopPropagation();
    ui.bannerOpen = false;
    render();
  });

  // Teams
  const addTeamBtn = document.querySelector('[data-action="add-team"]');
  if (addTeamBtn) addTeamBtn.addEventListener("click", () => {
    const number = document.getElementById("new-team-number").value.trim();
    const name = document.getElementById("new-team-name").value.trim();
    if (!number && !name) return;
    update({ teams: [...data.teams, { id: uid(), number, name: name || "Unnamed" }] });
  });
  const toggleBulkBtn = document.querySelector('[data-action="toggle-bulk"]');
  if (toggleBulkBtn) toggleBulkBtn.addEventListener("click", () => {
    ui.showBulk = !ui.showBulk;
    render();
  });
  const addBulkBtn = document.querySelector('[data-action="add-bulk"]');
  if (addBulkBtn) addBulkBtn.addEventListener("click", () => {
    const raw = document.getElementById("bulk-teams").value;
    const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
    const newTeams = lines.map(line => {
      const parts = line.split(/,|\t/).map(p => p.trim());
      if (parts.length >= 2) return { id: uid(), number: parts[0], name: parts.slice(1).join(", ") };
      return { id: uid(), number: "", name: line };
    });
    ui.showBulk = false;
    update({ teams: [...data.teams, ...newTeams] });
  });
  document.querySelectorAll('[data-action="remove-team"]').forEach(btn => {
    btn.addEventListener("click", () => update({ teams: data.teams.filter(t => t.id !== btn.dataset.id) }));
  });

  // Awards
  const addAwardBtn = document.querySelector('[data-action="add-award"]');
  if (addAwardBtn) addAwardBtn.addEventListener("click", () => {
    const name = document.getElementById("new-award-name").value.trim();
    const category = document.getElementById("new-award-category").value;
    const tier = document.getElementById("new-award-tier").value;
    if (!name) return;
    update({ awards: [...data.awards, { id: uid(), name, category, tier: category === "special" ? tier : null }] });
  });
  document.querySelectorAll('[data-action="remove-award"]').forEach(btn => {
    btn.addEventListener("click", () => update({ awards: data.awards.filter(a => a.id !== btn.dataset.id) }));
  });

  // Nominate
  const nomAwardSelect = document.getElementById("nominate-award-select");
  if (nomAwardSelect) nomAwardSelect.addEventListener("change", () => {
    ui.nominateAwardId = nomAwardSelect.value;
    render();
  });
  const addNomBtn = document.querySelector('[data-action="add-nomination"]');
  if (addNomBtn) addNomBtn.addEventListener("click", () => {
    const awardId = document.getElementById("nominate-award-select").value;
    const teamId = document.getElementById("nominate-team-select").value;
    const judge = document.getElementById("nominate-judge").value.trim();
    if (!awardId || !teamId) return;
    ui.nominateAwardId = awardId;
    update({ nominations: [...data.nominations, { id: uid(), awardId, teamId, judge }] });
  });
  document.querySelectorAll('[data-action="remove-nomination"]').forEach(btn => {
    btn.addEventListener("click", () => update({ nominations: data.nominations.filter(n => n.id !== btn.dataset.id) }));
  });

  // Performance
  document.querySelectorAll('[data-action="set-winner"]').forEach(sel => {
    sel.addEventListener("change", () => {
      const awardId = sel.dataset.awardId;
      const teamId = sel.value;
      const next = { ...data.performanceWinners };
      if (teamId) next[awardId] = teamId; else delete next[awardId];
      update({ performanceWinners: next });
    });
  });

  // Allocate
  document.querySelectorAll('[data-action="set-override"]').forEach(sel => {
    sel.addEventListener("change", () => {
      const awardId = sel.dataset.awardId;
      const teamId = sel.value;
      const next = { ...data.manualOverrides };
      if (teamId) next[awardId] = teamId; else delete next[awardId];
      update({ manualOverrides: next });
    });
  });
  const clearOverridesBtn = document.querySelector('[data-action="clear-overrides"]');
  if (clearOverridesBtn) clearOverridesBtn.addEventListener("click", () => update({ manualOverrides: {} }));
}

render();
