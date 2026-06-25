"use strict";

const WORLD_CUP_API = "https://worldcup26.ir";
const STREAM_API = "https://streamed.pk/api";
const REFRESH_MS = 60_000;

const stageNames = {
  group: "Group stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarterfinals",
  sf: "Semifinals",
  third: "Third place",
  final: "Final",
};

const bracketOrder = [
  ["r32", "Round of 32"],
  ["r16", "Round of 16"],
  ["qf", "Quarterfinals"],
  ["sf", "Semifinals"],
  ["third", "Third"],
  ["final", "Final"],
];

const state = {
  games: [],
  groups: [],
  teams: [],
  stadiums: [],
  streamedMatches: [],
  selectedView: "live",
  selectedMatchId: null,
  selectedStreamId: null,
  streamsByMatch: new Map(),
  streamStatusByMatch: new Map(),
  streamSourceByMatch: new Map(),
  likedMatches: new Set(JSON.parse(localStorage.getItem("wc26-liked-matches") || "[]")),
  filters: {
    search: "",
    stage: "all",
    group: "all",
  },
  loadedAt: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  renderLoading();
  loadAllData();
  window.setInterval(() => loadAllData({ silent: true }), REFRESH_MS);
});

function cacheElements() {
  els.refreshButton = document.querySelector("[data-refresh]");
  els.statusText = document.querySelector("[data-status-text]");
  els.statMatches = document.querySelector("[data-stat-matches]");
  els.statLive = document.querySelector("[data-stat-live]");
  els.statGroups = document.querySelector("[data-stat-groups]");
  els.teamRibbon = document.querySelector("[data-team-ribbon]");
  els.tabs = [...document.querySelectorAll(".tab[data-view]")];
  els.panels = [...document.querySelectorAll("[data-panel]")];
  els.search = document.querySelector("[data-search]");
  els.stageFilter = document.querySelector("[data-stage-filter]");
  els.groupFilter = document.querySelector("[data-group-filter]");
  els.liveList = document.querySelector("[data-live-list]");
  els.playerPanel = document.querySelector("[data-player-panel]");
  els.theaterPanel = document.querySelector("[data-theater-panel]");
  els.fixtures = document.querySelector("[data-fixtures]");
  els.fixtureCount = document.querySelector("[data-fixture-count]");
  els.groups = document.querySelector("[data-groups]");
  els.bracket = document.querySelector("[data-bracket]");
  els.stadiums = document.querySelector("[data-stadiums]");
  els.refreshNote = document.querySelector("[data-refresh-note]");
  els.themeToggle = document.querySelector("[data-theme-toggle]");
}

function bindEvents() {
  els.refreshButton.addEventListener("click", () => loadAllData());
  els.themeToggle.addEventListener("click", toggleTheme);

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

  els.search.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    renderCurrentView();
  });

  els.stageFilter.addEventListener("change", (event) => {
    state.filters.stage = event.target.value;
    renderCurrentView();
  });

  els.groupFilter.addEventListener("change", (event) => {
    state.filters.group = event.target.value;
    renderCurrentView();
  });

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton && !els.tabs.includes(viewButton)) {
      setView(viewButton.dataset.view);
      return;
    }

    const likeButton = event.target.closest("[data-like-match]");
    if (likeButton) {
      toggleLikedMatch(likeButton.dataset.likeMatch);
      return;
    }

    const retryButton = event.target.closest("[data-retry-stream]");
    if (retryButton) {
      retryStreams(retryButton.dataset.retryStream);
      return;
    }

    const matchButton = event.target.closest("[data-select-match]");
    if (matchButton) {
      selectMatch(matchButton.dataset.selectMatch);
      return;
    }

    const streamButton = event.target.closest("[data-stream-index]");
    if (streamButton) {
      state.selectedStreamId = Number(streamButton.dataset.streamIndex);
      renderPlayer();
      renderTheater();
    }
  });

  const hashView = window.location.hash.replace("#", "");
  if (hashView && document.querySelector(`[data-panel="${hashView}"]`)) {
    setView(hashView);
  }

  window.addEventListener("hashchange", () => {
    const nextView = window.location.hash.replace("#", "");
    if (nextView && nextView !== state.selectedView && document.querySelector(`[data-panel="${nextView}"]`)) {
      setView(nextView);
    }
  });
}

async function loadAllData(options = {}) {
  const { silent = false } = options;
  setRefreshState(true);
  if (!silent) {
    setStatus("Refreshing tournament data");
  }

  const endpoints = [
    ["games", `${WORLD_CUP_API}/get/games`],
    ["groups", `${WORLD_CUP_API}/get/groups`],
    ["teams", `${WORLD_CUP_API}/get/teams`],
    ["stadiums", `${WORLD_CUP_API}/get/stadiums`],
    ["footballStreams", `${STREAM_API}/matches/football`],
    ["liveStreams", `${STREAM_API}/matches/live`],
  ];

  const responses = await Promise.allSettled(endpoints.map(([, url]) => fetchJson(url)));
  const nextData = {};
  const errors = [];

  responses.forEach((result, index) => {
    const key = endpoints[index][0];
    if (result.status === "fulfilled") {
      nextData[key] = result.value;
    } else {
      errors.push(key);
    }
  });

  if (nextData.games) state.games = normalizeArray(nextData.games, "games");
  if (nextData.groups) state.groups = normalizeArray(nextData.groups, "groups");
  if (nextData.teams) state.teams = normalizeArray(nextData.teams, "teams");
  if (nextData.stadiums) state.stadiums = normalizeArray(nextData.stadiums, "stadiums");
  state.streamedMatches = mergeStreamedMatches(
    normalizeArray(nextData.footballStreams, "matches"),
    normalizeArray(nextData.liveStreams, "matches"),
  );
  state.loadedAt = new Date();

  hydrateFilters();
  renderAll();
  setRefreshState(false);

  if (errors.length) {
    setStatus(`Loaded with ${errors.length} source issue${errors.length > 1 ? "s" : ""}`);
    showToast(`Some data sources did not respond: ${errors.join(", ")}.`);
  } else {
    const liveCount = state.games.filter(isLiveGame).length;
    setStatus(liveCount ? `${liveCount} match${liveCount > 1 ? "es" : ""} live now` : "Tournament data is current");
  }
}

async function fetchJson(url) {
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${separator}_=${Date.now()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function normalizeArray(payload, key) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload[key])) return payload[key];
  const firstArray = Object.values(payload).find(Array.isArray);
  return firstArray || [];
}

function mergeStreamedMatches(...lists) {
  const map = new Map();
  lists.flat().forEach((match) => {
    if (match && match.id) map.set(match.id, match);
  });
  return [...map.values()];
}

function renderLoading() {
  const skeleton = document.getElementById("loading-template").innerHTML;
  els.liveList.innerHTML = skeleton.repeat(4);
  els.fixtures.innerHTML = skeleton.repeat(4);
  els.groups.innerHTML = skeleton.repeat(6);
  els.bracket.innerHTML = skeleton.repeat(6);
  els.stadiums.innerHTML = skeleton.repeat(6);
}

function renderAll() {
  renderMetrics();
  renderRibbon();
  renderLive();
  renderFixtures();
  renderGroups();
  renderBracket();
  renderStadiums();
  renderPlayer();
  renderTheater();
  updateRefreshNote();
}

function renderCurrentView() {
  renderLive();
  renderFixtures();
  renderGroups();
  renderBracket();
  renderStadiums();
  renderPlayer();
  renderTheater();
}

function hydrateFilters() {
  const existing = new Set([...els.groupFilter.options].map((option) => option.value));
  const groups = [...new Set(state.teams.map((team) => team.groups).filter(Boolean))].sort();
  groups.forEach((group) => {
    if (!existing.has(group)) {
      const option = document.createElement("option");
      option.value = group;
      option.textContent = `Group ${group}`;
      els.groupFilter.append(option);
    }
  });
}

function renderMetrics() {
  els.statMatches.textContent = String(state.games.length || "--");
  els.statLive.textContent = String(state.games.filter(isLiveGame).length);
  els.statGroups.textContent = String(state.groups.length || "--");
}

function renderRibbon() {
  const teams = state.teams.length ? [...state.teams, ...state.teams.slice(0, 12)] : [];
  els.teamRibbon.innerHTML = teams
    .map(
      (team) => `
        <span class="team-chip">
          ${flagImg(team)}
          ${escapeHtml(team.fifa_code || team.name_en || "TBD")}
        </span>
      `,
    )
    .join("");
}

function renderLive() {
  const liveGames = state.games.filter(isLiveGame).sort(sortByDate);
  const nextGames = state.games.filter((game) => !isFinishedGame(game)).sort(sortByDate);
  const recentGames = state.games.filter(isFinishedGame).sort((a, b) => parseGameDate(b) - parseGameDate(a));
  const displayGames = filterGames(liveGames.length ? liveGames : nextGames.length ? nextGames.slice(0, 10) : recentGames.slice(0, 10));

  if (!displayGames.length) {
    els.liveList.innerHTML = emptyState("No matches found", "Try clearing the search or filter controls.");
    return;
  }

  els.liveList.innerHTML = displayGames.map((game) => matchCard(game, "live")).join("");
}

function renderFixtures() {
  const games = filterGames([...state.games].sort(sortByDate));
  els.fixtureCount.textContent = `${games.length} fixture${games.length === 1 ? "" : "s"}`;

  if (!games.length) {
    els.fixtures.innerHTML = emptyState("No fixtures match this view", "Try another stage, group, or team search.");
    return;
  }

  const grouped = new Map();
  games.forEach((game) => {
    const date = parseGameDate(game);
    const key = Number.isNaN(date.getTime()) ? "Date TBA" : date.toDateString();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(game);
  });

  els.fixtures.innerHTML = [...grouped.entries()]
    .map(([key, dayGames]) => {
      const label = key === "Date TBA" ? key : formatDateLong(parseGameDate(dayGames[0]));
      const liveCount = dayGames.filter(isLiveGame).length;
      return `
        <article class="timeline-day">
          <div class="timeline-date">
            <div>
              <span>${escapeHtml(label)}</span>
              <small>${liveCount ? `${liveCount} running now` : "Matchday feed"}</small>
            </div>
            <span>${dayGames.length} match${dayGames.length === 1 ? "" : "es"}</span>
          </div>
          <div class="timeline-matches">
            ${dayGames.map((game) => fixtureCard(game)).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderGroups() {
  const teamMap = getTeamMap();
  const groups = [...state.groups].sort((a, b) => String(a.name || a.group).localeCompare(String(b.name || b.group)));
  const search = state.filters.search;

  const html = groups
    .map((group) => {
      const groupName = group.name || group.group || "";
      const teams = [...(group.teams || [])]
        .sort(sortStandingRows)
        .map((row, index) => ({ row, team: teamMap.get(String(row.team_id)), index }))
        .filter(({ team }) => !search || normalizeSearch(team?.name_en).includes(search) || normalizeSearch(team?.fifa_code).includes(search));

      if (state.filters.group !== "all" && state.filters.group !== groupName) return "";
      if (!teams.length) return "";

      return `
        <article class="group-card">
          <header>
            <h3>Group ${escapeHtml(groupName)}</h3>
            <span>${teams.length} teams</span>
          </header>
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>MP</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GD</th>
                <th>PTS</th>
              </tr>
            </thead>
            <tbody>
              ${teams
                .map(
                  ({ row, team, index }) => `
                    <tr>
                      <td>
                        <span class="table-team">
                          <span class="rank">${index + 1}</span>
                          ${flagImg(team)}
                          <span>${escapeHtml(team?.name_en || `Team ${row.team_id}`)}</span>
                        </span>
                      </td>
                      <td>${num(row.mp)}</td>
                      <td>${num(row.w)}</td>
                      <td>${num(row.d)}</td>
                      <td>${num(row.l)}</td>
                      <td>${num(row.gd)}</td>
                      <td><strong>${num(row.pts)}</strong></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </article>
      `;
    })
    .join("");

  els.groups.innerHTML = html || emptyState("No group table data", "The standings endpoint is not returning matching rows right now.");
}

function renderBracket() {
  const games = filterGames(state.games.filter((game) => game.type && game.type !== "group").sort(sortByDate));

  els.bracket.innerHTML = bracketOrder
    .map(([type, label]) => {
      const matches = games.filter((game) => game.type === type);
      return `
        <section class="round-column ${type}">
          <header class="round-header">
            <span>${label}</span>
            <strong>${matches.length || 0}</strong>
          </header>
          ${
            matches.length
              ? matches.map((game) => bracketMatch(game)).join("")
              : `<div class="bracket-match empty"><p>No matches yet</p></div>`
          }
        </section>
      `;
    })
    .join("");
}

function renderStadiums() {
  const search = state.filters.search;
  const maxCapacity = Math.max(...state.stadiums.map((stadium) => Number(stadium.capacity) || 0), 1);
  const stadiums = state.stadiums
    .filter((stadium) => {
      const text = normalizeSearch(`${stadium.name_en} ${stadium.city_en} ${stadium.country_en} ${stadium.region}`);
      return !search || text.includes(search);
    })
    .sort((a, b) => String(a.country_en).localeCompare(String(b.country_en)) || String(a.city_en).localeCompare(String(b.city_en)));

  if (!stadiums.length) {
    els.stadiums.innerHTML = emptyState("No stadiums found", "Try a different city, country, or stadium name.");
    return;
  }

  els.stadiums.innerHTML = stadiums
    .map((stadium) => {
      const capacity = Number(stadium.capacity) || 0;
      const width = Math.max(8, Math.round((capacity / maxCapacity) * 100));
      return `
        <article class="stadium-card">
          <h3>${escapeHtml(stadium.fifa_name || stadium.name_en)}</h3>
          <p>${escapeHtml(stadium.name_en)} in ${escapeHtml(stadium.city_en)}, ${escapeHtml(stadium.country_en)}</p>
          <div class="capacity-bar" title="${capacity.toLocaleString()} capacity">
            <span style="width: ${width}%"></span>
          </div>
          <div class="mini-tags">
            <span>${capacity.toLocaleString()} seats</span>
            <span>${escapeHtml(stadium.region || "Host")}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function matchCard(game, context = "default") {
  const id = String(game.id);
  const selected = state.selectedMatchId === id;
  const home = getSide(game, "home");
  const away = getSide(game, "away");
  const stadium = getStadiumMap().get(String(game.stadium_id));
  const status = gameStatus(game);

  return `
    <article class="match-card ${selected ? "active" : ""} ${status.key} ${context}" data-match-id="${escapeHtml(id)}">
      <div class="match-time">
        <span class="status-pill ${status.key}">${escapeHtml(status.label)}</span>
        <span>${escapeHtml(formatTime(parseGameDate(game)))}</span>
      </div>
      <div class="teams">
        ${teamLine(home, game.home_score, shouldShowScore(game))}
        ${teamLine(away, game.away_score, shouldShowScore(game))}
      </div>
      <div class="match-meta">
        <span>${escapeHtml(stageNames[game.type] || game.group || "Match")}</span>
        <span>${escapeHtml(stadium?.city_en || "Venue TBA")}</span>
        <div class="match-actions">
          ${likeButton(game)}
          <button class="watch-btn" type="button" data-select-match="${escapeHtml(id)}">Open</button>
        </div>
      </div>
    </article>
  `;
}

function fixtureCard(game) {
  const id = String(game.id);
  const selected = state.selectedMatchId === id;
  const home = getSide(game, "home");
  const away = getSide(game, "away");
  const stadium = getStadiumMap().get(String(game.stadium_id));
  const status = gameStatus(game);
  const date = parseGameDate(game);
  const showScore = shouldShowScore(game);
  const sourceMatch = findStreamedMatch(game);

  return `
    <article class="fixture-card ${selected ? "active" : ""} ${status.key}" data-match-id="${escapeHtml(id)}">
      <div class="fixture-rail">
        <span class="fixture-no">M${escapeHtml(String(game.id).padStart(3, "0"))}</span>
        <span class="status-pill ${status.key}">${escapeHtml(status.label)}</span>
        <strong>${escapeHtml(formatTime(date))}</strong>
        <small>${escapeHtml(formatShortDate(date))}</small>
      </div>
      <div class="fixture-duel">
        ${fixtureTeam(home, game.home_score, showScore, "home")}
        <div class="versus-line">
          <span></span>
          <b>VS</b>
          <span></span>
        </div>
        ${fixtureTeam(away, game.away_score, showScore, "away")}
      </div>
      <div class="fixture-info">
        <span>${escapeHtml(stageNames[game.type] || `Group ${game.group || ""}`)}</span>
        <strong>${escapeHtml(stadium?.fifa_name || stadium?.name_en || "Venue TBA")}</strong>
        <small>${escapeHtml(stadium?.city_en || "Host city TBA")}</small>
      </div>
      <div class="fixture-signal">
        <span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i></span>
        <strong>${sourceMatch ? "Stream indexed" : status.key === "live" ? "Live signal" : "Scheduled"}</strong>
        <small>${escapeHtml(game.group ? `Group ${game.group}` : stageNames[game.type] || "World Cup")}</small>
      </div>
      <div class="fixture-actions">
        ${likeButton(game)}
        <button class="watch-btn" type="button" data-select-match="${escapeHtml(id)}">Open stream</button>
      </div>
    </article>
  `;
}

function fixtureTeam(team, score, showScore, side) {
  return `
    <div class="fixture-team ${escapeHtml(side)}">
      ${flagImg(team)}
      <strong>${escapeHtml(team?.name_en || team?.label || "TBD")}</strong>
      <span>${showScore ? escapeHtml(String(score ?? 0)) : "-"}</span>
    </div>
  `;
}

function bracketMatch(game) {
  const home = getSide(game, "home");
  const away = getSide(game, "away");
  const date = parseGameDate(game);
  const status = gameStatus(game);
  const stadium = getStadiumMap().get(String(game.stadium_id));
  return `
    <button class="bracket-match ${status.key}" type="button" data-select-match="${escapeHtml(String(game.id))}">
      <div class="bracket-meta">
        <span>M${escapeHtml(String(game.id).padStart(3, "0"))}</span>
        <span>${escapeHtml(formatShortDate(date))}</span>
      </div>
      ${teamLine(home, game.home_score, shouldShowScore(game))}
      ${teamLine(away, game.away_score, shouldShowScore(game))}
      <div class="bracket-venue">
        <span>${escapeHtml(formatTime(date))}</span>
        <strong>${escapeHtml(stadium?.city_en || "Venue TBA")}</strong>
      </div>
    </button>
  `;
}

function teamLine(team, score, showScore) {
  return `
    <div class="team-row">
      ${flagImg(team)}
      <span class="team-name">${escapeHtml(team?.name_en || team?.label || "TBD")}</span>
      <span class="score">${showScore ? escapeHtml(String(score ?? 0)) : "-"}</span>
    </div>
  `;
}

function likeButton(game) {
  if (!isLiveGame(game)) return "";
  const id = String(game.id);
  const liked = state.likedMatches.has(id);
  return `
    <button class="like-btn ${liked ? "liked" : ""}" type="button" data-like-match="${escapeHtml(id)}" aria-pressed="${liked}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 1 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />
      </svg>
      <span>${liked ? "Liked" : "Like"}</span>
    </button>
  `;
}

function toggleLikedMatch(matchId) {
  const id = String(matchId);
  if (state.likedMatches.has(id)) {
    state.likedMatches.delete(id);
  } else {
    state.likedMatches.add(id);
  }
  localStorage.setItem("wc26-liked-matches", JSON.stringify([...state.likedMatches]));
  renderLive();
  renderFixtures();
  renderPlayer();
  renderTheater();
}

function selectMatch(matchId) {
  state.selectedMatchId = String(matchId);
  state.selectedStreamId = null;
  renderLive();
  renderFixtures();
  renderBracket();
  renderPlayer();
  renderTheater();
  setView("watch");

  const match = state.games.find((game) => String(game.id) === state.selectedMatchId);
  if (match) {
    loadStreamsForMatch(match);
  }
}

async function loadStreamsForMatch(game) {
  const id = String(game.id);
  if (state.streamsByMatch.has(id) || state.streamStatusByMatch.get(id) === "loading") return;

  state.streamStatusByMatch.set(id, "loading");
  renderPlayer();
  renderTheater();

  const streamedMatch = findStreamedMatch(game);
  if (!streamedMatch || !Array.isArray(streamedMatch.sources) || !streamedMatch.sources.length) {
    state.streamStatusByMatch.set(id, "empty");
    state.streamsByMatch.set(id, []);
    renderPlayer();
    renderTheater();
    return;
  }

  state.streamSourceByMatch.set(id, streamedMatch);
  const streamResponses = await Promise.allSettled(
    streamedMatch.sources.map((source) => fetchSourceStreams(source).catch(() => [])),
  );
  const streams = streamResponses
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((stream) => stream && isSafeUrl(stream.embedUrl));

  state.streamsByMatch.set(id, dedupeStreams(streams));
  state.streamStatusByMatch.set(id, streams.length ? "ready" : "empty");
  state.selectedStreamId = streams.length ? 0 : null;
  renderPlayer();
  renderTheater();
}

async function fetchSourceStreams(source) {
  if (!source?.source || !source?.id) return [];
  const response = await fetch(`${STREAM_API}/stream/${encodeURIComponent(source.source)}/${encodeURIComponent(source.id)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function renderPlayer() {
  const game = state.games.find((item) => String(item.id) === state.selectedMatchId);
  if (!game) {
    els.playerPanel.innerHTML = `
      <div class="empty-player">
        <span class="play-icon"></span>
        <h3>Select a match</h3>
        <p>Choose any World Cup fixture to find available streams and match details.</p>
      </div>
    `;
    return;
  }

  const id = String(game.id);
  const streams = state.streamsByMatch.get(id) || [];
  const status = state.streamStatusByMatch.get(id) || "idle";
  const streamIndex = Number.isInteger(state.selectedStreamId) ? state.selectedStreamId : 0;
  const activeStream = streams[streamIndex];
  const home = getSide(game, "home");
  const away = getSide(game, "away");
  const stadium = getStadiumMap().get(String(game.stadium_id));
  const sourceMatch = state.streamSourceByMatch.get(id);

  els.playerPanel.innerHTML = `
    <div class="player-frame">
      ${
        activeStream
          ? `<iframe src="${escapeAttribute(activeStream.embedUrl)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="no-referrer"></iframe>`
          : `<div class="player-placeholder">
              <div>
                <span class="play-icon"></span>
                <h3>${status === "loading" ? "Finding streams" : "No stream selected"}</h3>
                <p>${playerMessage(status, sourceMatch)}</p>
              </div>
            </div>`
      }
    </div>
    <div class="player-body">
      <div>
        <p class="eyebrow">${escapeHtml(stageNames[game.type] || game.group || "Match")}</p>
        <h3>${escapeHtml(home.name_en || home.label)} vs ${escapeHtml(away.name_en || away.label)}</h3>
      </div>
      <div class="stream-list">
        ${likeButton(game)}
        ${streamButtons(streams, streamIndex, status)}
      </div>
      <div class="detail-grid">
        <div><span>Date</span><strong>${escapeHtml(formatDateLong(parseGameDate(game)))}</strong></div>
        <div><span>Kickoff</span><strong>${escapeHtml(formatTime(parseGameDate(game)))}</strong></div>
        <div><span>Venue</span><strong>${escapeHtml(stadium?.fifa_name || stadium?.name_en || "TBA")}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(gameStatus(game).label)}</strong></div>
      </div>
    </div>
  `;
}

function renderTheater() {
  if (!els.theaterPanel) return;
  const game = state.games.find((item) => String(item.id) === state.selectedMatchId);
  if (!game) {
    els.theaterPanel.innerHTML = `
      <div class="empty-player theater-empty">
        <span class="play-icon"></span>
        <h3>Select a match</h3>
        <p>Open any fixture or live card to launch a focused live stream page with match context.</p>
      </div>
    `;
    return;
  }

  const id = String(game.id);
  const streams = state.streamsByMatch.get(id) || [];
  const status = state.streamStatusByMatch.get(id) || "idle";
  const streamIndex = Number.isInteger(state.selectedStreamId) ? state.selectedStreamId : 0;
  const activeStream = streams[streamIndex];
  const home = getSide(game, "home");
  const away = getSide(game, "away");
  const stadium = getStadiumMap().get(String(game.stadium_id));
  const sourceMatch = state.streamSourceByMatch.get(id);
  const gameDate = parseGameDate(game);
  const gameStatusData = gameStatus(game);

  els.theaterPanel.innerHTML = `
    <article class="theater-card ${gameStatusData.key}">
      <div class="theater-topline">
        <div>
          <span class="status-pill ${gameStatusData.key}">${escapeHtml(gameStatusData.label)}</span>
          <span>${escapeHtml(stageNames[game.type] || `Group ${game.group || ""}`)}</span>
        </div>
        <button class="watch-btn compact" type="button" data-view="fixtures">Back to fixtures</button>
      </div>
      <div class="theater-player">
        ${
          activeStream
            ? `<iframe src="${escapeAttribute(activeStream.embedUrl)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="no-referrer"></iframe>`
            : `<div class="player-placeholder">
                <div>
                  <span class="play-icon"></span>
                  <h3>${status === "loading" ? "Finding live sources" : "Stream waiting"}</h3>
                  <p>${playerMessage(status, sourceMatch)}</p>
                </div>
              </div>`
        }
      </div>
      <div class="theater-matchbar">
        <div class="theater-team">
          ${flagImg(home)}
          <strong>${escapeHtml(home.name_en || home.label)}</strong>
          <span>${shouldShowScore(game) ? escapeHtml(String(game.home_score ?? 0)) : "-"}</span>
        </div>
        <div class="theater-vs">VS</div>
        <div class="theater-team away">
          ${flagImg(away)}
          <strong>${escapeHtml(away.name_en || away.label)}</strong>
          <span>${shouldShowScore(game) ? escapeHtml(String(game.away_score ?? 0)) : "-"}</span>
        </div>
      </div>
      <div class="theater-controls">
        <div class="stream-list">
          ${likeButton(game)}
          ${streamButtons(streams, streamIndex, status)}
        </div>
        <div class="detail-grid theater-details">
          <div><span>Date</span><strong>${escapeHtml(formatDateLong(gameDate))}</strong></div>
          <div><span>Kickoff</span><strong>${escapeHtml(formatTime(gameDate))}</strong></div>
          <div><span>Venue</span><strong>${escapeHtml(stadium?.fifa_name || stadium?.name_en || "TBA")}</strong></div>
          <div><span>City</span><strong>${escapeHtml(stadium?.city_en || "Host city TBA")}</strong></div>
        </div>
      </div>
    </article>
  `;
}

function streamButtons(streams, activeIndex, status) {
  if (status === "loading") {
    return `<span class="stream-btn active">Searching sources</span>`;
  }
  if (!streams.length) {
    return `<button class="retry-btn" type="button" data-retry-stream="${escapeHtml(state.selectedMatchId)}">Retry streams</button>`;
  }
  return streams
    .map(
      (stream, index) => `
        <button class="stream-btn ${index === activeIndex ? "active" : ""}" type="button" data-stream-index="${index}">
          ${escapeHtml(stream.language || "Stream")} ${stream.hd ? "HD" : "SD"} ${stream.streamNo ? `#${stream.streamNo}` : ""}
        </button>
      `,
    )
    .join("");
}

function retryStreams(matchId) {
  const id = String(matchId);
  const match = state.games.find((game) => String(game.id) === id);
  state.streamsByMatch.delete(id);
  state.streamStatusByMatch.delete(id);
  state.streamSourceByMatch.delete(id);
  state.selectedStreamId = null;
  if (match) loadStreamsForMatch(match);
}

function playerMessage(status, sourceMatch) {
  if (status === "loading") return "Checking all available football sources for this fixture.";
  if (sourceMatch) return "The stream source was found, but it did not return playable embeds right now.";
  return "This fixture does not currently match a Streamed football listing.";
}

function findStreamedMatch(game) {
  const home = getSide(game, "home");
  const away = getSide(game, "away");
  const homeName = normalizeTeamName(home.name_en || home.label);
  const awayName = normalizeTeamName(away.name_en || away.label);
  const gameTime = parseGameDate(game).getTime();

  let best = null;
  let bestScore = 0;

  state.streamedMatches.forEach((match) => {
    const title = normalizeTeamName(match.title);
    const streamedHome = normalizeTeamName(match.teams?.home?.name);
    const streamedAway = normalizeTeamName(match.teams?.away?.name);
    const streamedTime = Number(match.date) || 0;
    const dateDiffHours = streamedTime && gameTime ? Math.abs(streamedTime - gameTime) / 36e5 : 999;

    let score = 0;
    if (title.includes(homeName) && title.includes(awayName)) score += 8;
    if (title.includes(awayName) && title.includes(homeName)) score += 8;
    if (streamedHome === homeName || streamedAway === awayName) score += 4;
    if (streamedHome === awayName || streamedAway === homeName) score += 4;
    if (dateDiffHours < 4) score += 4;
    else if (dateDiffHours < 36) score += 2;
    if (match.category === "football") score += 1;

    if (score > bestScore) {
      best = match;
      bestScore = score;
    }
  });

  return bestScore >= 8 ? best : null;
}

function filterGames(games) {
  const search = state.filters.search;
  return games.filter((game) => {
    if (state.filters.stage !== "all" && game.type !== state.filters.stage) return false;
    if (state.filters.group !== "all" && game.type === "group" && game.group !== state.filters.group) return false;
    if (!search) return true;

    const home = getSide(game, "home");
    const away = getSide(game, "away");
    const stadium = getStadiumMap().get(String(game.stadium_id));
    const text = normalizeSearch(
      `${home.name_en || home.label} ${away.name_en || away.label} ${stadium?.name_en || ""} ${stadium?.city_en || ""} ${game.group}`,
    );
    return text.includes(search);
  });
}

function getSide(game, side) {
  const teamMap = getTeamMap();
  const id = side === "home" ? game.home_team_id : game.away_team_id;
  const label = side === "home" ? game.home_team_label : game.away_team_label;
  const embeddedName = side === "home" ? game.home_team_name_en : game.away_team_name_en;
  const team = teamMap.get(String(id));
  if (team) return team;
  return {
    id,
    name_en: embeddedName || label || "TBD",
    label: embeddedName || label || "TBD",
    flag: "",
  };
}

function getTeamMap() {
  if (!state.teamMap) {
    state.teamMap = new Map(state.teams.map((team) => [String(team.id), team]));
  }
  return state.teamMap;
}

function getStadiumMap() {
  if (!state.stadiumMap) {
    state.stadiumMap = new Map(state.stadiums.map((stadium) => [String(stadium.id), stadium]));
  }
  return state.stadiumMap;
}

function setView(view) {
  state.selectedView = view;
  document.body.classList.toggle("watch-mode", view === "watch");
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === view));
  history.replaceState(null, "", `#${view}`);
  const activePanel = document.querySelector(`[data-panel="${view}"]`);
  if (activePanel) {
    requestAnimationFrame(() => activePanel.scrollIntoView({ block: "start" }));
  }
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("wc26-theme", next);
}

function setRefreshState(isLoading) {
  els.refreshButton.classList.toggle("is-loading", isLoading);
  els.refreshButton.disabled = isLoading;
  state.teamMap = null;
  state.stadiumMap = null;
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function updateRefreshNote() {
  if (!state.loadedAt) return;
  els.refreshNote.textContent = `Updated ${state.loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Auto refresh every 60s`;
}

function showToast(message) {
  const oldToast = document.querySelector(".toast");
  if (oldToast) oldToast.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 5200);
}

function gameStatus(game) {
  if (isLiveGame(game)) return { key: "live", label: "Live" };
  if (isFinishedGame(game)) return { key: "finished", label: "FT" };
  return { key: "upcoming", label: "Upcoming" };
}

function isFinishedGame(game) {
  return String(game.finished).toLowerCase() === "true" || String(game.time_elapsed).toLowerCase() === "finished";
}

function isLiveGame(game) {
  const elapsed = String(game.time_elapsed || "").toLowerCase();
  if (isFinishedGame(game)) return false;
  if (elapsed && !["notstarted", "not started", "null", "undefined"].includes(elapsed)) return true;

  const start = parseGameDate(game).getTime();
  const now = Date.now();
  return Number.isFinite(start) && now >= start && now <= start + 2.25 * 60 * 60 * 1000;
}

function shouldShowScore(game) {
  return isFinishedGame(game) || isLiveGame(game) || Number(game.home_score) > 0 || Number(game.away_score) > 0;
}

function parseGameDate(game) {
  const raw = String(game.local_date || "").trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return new Date(Number.NaN);
  const [, month, day, year, hour, minute] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function sortByDate(a, b) {
  return parseGameDate(a) - parseGameDate(b) || Number(a.id) - Number(b.id);
}

function sortStandingRows(a, b) {
  return (
    num(b.pts) - num(a.pts) ||
    num(b.gd) - num(a.gd) ||
    num(b.gf) - num(a.gf) ||
    num(a.team_id) - num(b.team_id)
  );
}

function formatDateLong(date) {
  if (Number.isNaN(date.getTime())) return "Date TBA";
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(date) {
  if (Number.isNaN(date.getTime())) return "TBA";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatTime(date) {
  if (Number.isNaN(date.getTime())) return "TBA";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function flagImg(team) {
  if (!team?.flag) return `<span class="flag"></span>`;
  return `<img class="flag" src="${escapeAttribute(team.flag)}" alt="" loading="lazy" />`;
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dedupeStreams(streams) {
  const seen = new Set();
  return streams.filter((stream) => {
    const key = stream.embedUrl || stream.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSafeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeTeamName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSearch(value = "") {
  return normalizeTeamName(value);
}

function emptyState(title, message) {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value);
}
