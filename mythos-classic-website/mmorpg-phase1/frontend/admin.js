import { io } from "socket.io-client";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function timeNow() { return new Date().toLocaleTimeString(); }

export async function renderAdmin(app, { token, user, apiUrl, onLogout }) {
  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar"><div class="brand-inline"><div class="brand-mark">M</div>MYTHOS <span class="role-pill">OWNER CONSOLE</span></div>
      <div class="topbar-right"><span>${escapeHtml(user.username)}</span><button class="ghost-button" id="logout-button">Sign out</button></div></header>
      <section class="page-heading"><div><p class="eyebrow">REAL-TIME OPERATIONS</p><h1>Realm control</h1><p>Live infrastructure, player sessions, and world events.</p></div><span class="role-pill" id="connection-status">CONNECTING</span></section>
      <section class="panel-grid">
        <article class="panel span-3"><div class="subtle-label">ACTIVE PLAYER SESSIONS</div><div class="metric-value" id="metric-players">—</div><div class="metric-note">Authenticated game sockets</div><div class="meter"><span id="meter-players"></span></div></article>
        <article class="panel span-3"><div class="subtle-label">PROCESS MEMORY</div><div class="metric-value" id="metric-memory">—</div><div class="metric-note" id="memory-note">Waiting for telemetry</div><div class="meter"><span id="meter-memory"></span></div></article>
        <article class="panel span-3"><div class="subtle-label">CPU UTILIZATION</div><div class="metric-value" id="metric-cpu">—</div><div class="metric-note" id="cpu-note">Host CPU sample</div><div class="meter"><span id="meter-cpu"></span></div></article>
        <article class="panel span-3"><div class="subtle-label">SERVER UPTIME</div><div class="metric-value" id="metric-uptime">—</div><div class="metric-note" id="socket-count">Socket connections: —</div></article>
        <article class="panel span-7"><div class="panel-heading"><h3>Live player management</h3><span class="subtle-label" id="player-count">0 connected</span></div><div class="player-list" id="player-list"><div class="empty-state">Waiting for players to connect.</div></div><p class="status-line" id="player-status">Kick disconnects a session; ban also persists a user ban; mute marks the user muted for the chat phase.</p></article>
        <article class="panel span-5"><div class="panel-heading"><h3>World control deck</h3><span class="subtle-label">GLOBAL BROADCASTS</span></div>
          <label class="subtle-label" for="alert-message">Broadcast alert</label><div class="control-row" style="margin:8px 0 18px"><input class="control-input" id="alert-message" maxlength="240" placeholder="Message to all connected players"/><button class="small-button" id="send-alert">Send</button></div>
          <label class="subtle-label" for="event-name">Trigger world event</label><div class="control-row" style="margin:8px 0 18px"><input class="control-input" id="event-name" maxlength="80" value="Double XP Weekend"/><button class="small-button" id="trigger-event">Trigger</button></div>
          <label class="subtle-label" for="entity-kind">Spawn entity</label><div class="control-row" style="margin:8px 0 0"><select class="control-input" id="entity-kind"><option value="training_dummy">Training dummy</option><option value="treasure_chest">Treasure chest</option><option value="healing_orb">Healing orb</option></select><button class="small-button" id="spawn-entity">Spawn</button></div>
          <p class="status-line" id="world-status" role="status"></p>
        </article>
        <article class="panel span-5"><div class="panel-heading"><h3>World state</h3><span class="subtle-label">CURRENT</span></div><div class="world-state" id="world-state"><div class="state-item">No world state received yet.</div></div></article>
        <article class="panel span-7"><div class="panel-heading"><h3>Operations log</h3><span class="subtle-label">LATEST ACTIVITY</span></div><div class="log-list" id="ops-log"><div class="log-entry">Console initialized.</div></div></article>
      </section>
    </main>`;
  document.querySelector("#logout-button").addEventListener("click", onLogout);
  const socket = io(`${apiUrl}/admin`, { auth: { token }, transports: ["websocket", "polling"], reconnection: true });
  const logs = [];
  let players = [];

  function log(message) {
    logs.unshift({ time: timeNow(), message });
    logs.splice(30);
    document.querySelector("#ops-log").innerHTML = logs.map((entry) =>
      `<div class="log-entry"><time>${escapeHtml(entry.time)}</time>${escapeHtml(entry.message)}</div>`).join("");
  }
  function setStatus(id, message, ok) {
    const element = document.querySelector(`#${id}`);
    element.textContent = message;
    element.className = `status-line ${ok ? "good" : "bad"}`;
  }
  function adminAction(payload) {
    return new Promise((resolve) => {
      if (!socket.connected) return resolve({ ok: false, message: "Admin socket is disconnected." });
      socket.timeout(5000).emit("admin:action", payload, (error, result) => {
        if (error) return resolve({ ok: false, message: "Server did not acknowledge the action." });
        resolve(result || { ok: false, message: "No action response." });
      });
    });
  }
  function renderPlayers() {
    document.querySelector("#player-count").textContent = `${players.length} connected`;
    document.querySelector("#metric-players").textContent = String(players.length);
    document.querySelector("#meter-players").style.width = `${Math.min(100, players.length * 5)}%`;
    const list = document.querySelector("#player-list");
    if (!players.length) {
      list.innerHTML = `<div class="empty-state">No active player sessions. Join from a player account to test moderation.</div>`;
      return;
    }
    list.innerHTML = players.map((player) => `<div class="player-row">
      <div><div class="player-name">${escapeHtml(player.username)}</div><div class="player-id">Socket ${escapeHtml(player.socketId)} · User ${escapeHtml(player.userId)}</div><div class="player-id">Position ${player.position ? `${Number(player.position.x).toFixed(1)}, ${Number(player.position.y).toFixed(1)}, ${Number(player.position.z).toFixed(1)}` : "unknown"}</div></div>
      <div class="player-actions"><button class="small-button" data-action="mute" data-id="${escapeHtml(player.socketId)}">Mute</button><button class="small-button" data-action="kick" data-id="${escapeHtml(player.socketId)}">Kick</button><button class="small-button danger" data-action="ban" data-id="${escapeHtml(player.socketId)}">Ban</button></div>
    </div>`).join("");
  }
  document.querySelector("#player-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    button.disabled = true;
    const result = await adminAction({ action: button.dataset.action, targetSocketId: button.dataset.id });
    setStatus("player-status", result.message, result.ok);
    log(result.message);
    button.disabled = false;
  });
  document.querySelector("#send-alert").addEventListener("click", async () => {
    const message = document.querySelector("#alert-message").value.trim();
    const result = await adminAction({ action: "alert", message });
    setStatus("world-status", result.message, result.ok);
    if (result.ok) document.querySelector("#alert-message").value = "";
    log(result.message);
  });
  document.querySelector("#trigger-event").addEventListener("click", async () => {
    const eventName = document.querySelector("#event-name").value.trim();
    const result = await adminAction({ action: "event", eventName });
    setStatus("world-status", result.message, result.ok);
    log(result.message);
  });
  document.querySelector("#spawn-entity").addEventListener("click", async () => {
    const kind = document.querySelector("#entity-kind").value;
    const result = await adminAction({ action: "spawn", kind });
    setStatus("world-status", result.message, result.ok);
    log(result.message);
  });

  socket.on("connect", () => {
    document.querySelector("#connection-status").textContent = "LIVE";
    document.querySelector("#connection-status").style.background = "#26372b";
    log("Secure owner socket connected.");
  });
  socket.on("disconnect", (reason) => {
    document.querySelector("#connection-status").textContent = "DISCONNECTED";
    log(`Admin socket disconnected: ${reason}`);
  });
  socket.on("connect_error", (error) => {
    document.querySelector("#connection-status").textContent = "AUTH ERROR";
    log(`Admin socket connection failed: ${error.message}`);
    if (/invalid|expired|forbidden/i.test(error.message)) {
      localStorage.removeItem("mmorpgToken");
      localStorage.removeItem("mmorpgUser");
      onLogout();
    }
  });
  socket.on("admin:metrics", (metrics) => {
    document.querySelector("#metric-memory").textContent = formatBytes(metrics.processMemory.rssBytes);
    document.querySelector("#memory-note").textContent = `Heap ${formatBytes(metrics.processMemory.heapUsedBytes)} / ${formatBytes(metrics.processMemory.heapTotalBytes)}`;
    const memoryPercent = metrics.processMemory.heapTotalBytes ? metrics.processMemory.heapUsedBytes / metrics.processMemory.heapTotalBytes * 100 : 0;
    document.querySelector("#meter-memory").style.width = `${Math.min(100, memoryPercent)}%`;
    document.querySelector("#metric-cpu").textContent = `${metrics.system.cpuUsagePercent}%`;
    document.querySelector("#cpu-note").textContent = `${metrics.system.cpuCores} CPU cores · ${metrics.system.loadAverage.map((n) => n.toFixed(2)).join(" / ")} load`;
    document.querySelector("#meter-cpu").style.width = `${metrics.system.cpuUsagePercent}%`;
    document.querySelector("#metric-uptime").textContent = `${Math.floor(metrics.uptimeSeconds / 3600)}h ${Math.floor(metrics.uptimeSeconds % 3600 / 60)}m`;
    document.querySelector("#socket-count").textContent = `Socket connections: ${metrics.connectedSockets}`;
  });
  socket.on("admin:players", (nextPlayers) => { players = nextPlayers; renderPlayers(); });
  socket.on("admin:actionResult", (result) => { log(result.message); });
  socket.on("admin:worldState", (state) => {
    const items = [];
    items.push(`<div class="state-item"><strong>Last alert:</strong> ${state.lastAlert ? escapeHtml(state.lastAlert.message) : "None"}</div>`);
    items.push(`<div class="state-item"><strong>Active event:</strong> ${state.event ? escapeHtml(state.event.name) : "None"}</div>`);
    items.push(`<div class="state-item"><strong>Spawned entities:</strong> ${state.entities ? state.entities.length : 0}</div>`);
    document.querySelector("#world-state").innerHTML = items.join("");
  });
  log(`Owner console ready for ${user.username}.`);
  return () => socket.disconnect();
}