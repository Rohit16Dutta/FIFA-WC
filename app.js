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
