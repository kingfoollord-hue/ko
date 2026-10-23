import { io } from "socket.io-client";

const TILE = 32;
const WORLD_W = 90;
const WORLD_H = 90;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const keyOf = (x, y) => `${x},${y}`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Deterministic world generation keeps every player looking at the same map.
function hash(x, y) { let n = (x * 374761393 + y * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return (n ^ (n >>> 16)) >>> 0; }
function tileAt(x, y) {
  const cx = Math.floor(WORLD_W / 2), cy = Math.floor(WORLD_H / 2);
  const dx = x - cx, dy = y - cy;
  if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return "path";
  if (Math.abs(dx) < 2 || Math.abs(dy) < 2) return "path";
  const v = hash(x, y) % 100;
  if ((x < 14 || x > WORLD_W - 15) && v < 14) return "water";
  if (v < 9) return "flowers";
  if (v < 16) return "path";
  if (v < 23) return "tree";
  if (v < 26) return "rock";
  return "grass";
}

export async function renderGame(app, { token, user, apiUrl, onLogout }) {
  let savedCharacter = null;
  try {
    const response = await fetch(`${apiUrl}/api/character`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) savedCharacter = (await response.json()).character;
  } catch { /* The realm remains playable if the character endpoint is temporarily unavailable. */ }
  app.innerHTML = `
    <main class="retro-shell">
      <header class="retro-header"><div class="retro-logo"><span class="pixel-emblem">M</span><div><b>MYTHOS</b><small>THE ONLINE REALM</small></div></div><div class="retro-header-right"><span class="online-dot"></span><span id="game-status">Connecting...</span><span class="retro-user">${escapeHtml(user.username)}</span><button class="retro-button" id="logout-button">Log out</button></div></header>
      <div class="retro-notice"><b>WELCOME TO GREENREACH</b><span>Explore • Gather • Fight • Become a legend</span><span class="retro-coords" id="position-label">X: 45 Y: 45</span></div>
      <div class="retro-game-grid">
        <aside class="retro-panel character-panel"><h2>CHARACTER</h2><div class="character-portrait">♙</div><b class="char-name">${escapeHtml(user.username)}</b><div class="level-line">Combat level <strong id="combat-level">3</strong></div><div class="bar-label"><span>Health</span><span id="hp-text">30 / 30</span></div><div class="retro-bar hp-bar"><span id="hp-fill" style="width:100%"></span></div><div class="bar-label"><span>Mana</span><span id="mp-text">10 / 10</span></div><div class="retro-bar mp-bar"><span style="width:100%"></span></div><h3>SKILLS</h3><div class="skill-list" id="skill-list"><div><span>⚔ Attack</span><b>1</b></div><div><span>🛡 Defence</span><b>1</b></div><div><span>🌲 Woodcutting</span><b>1</b></div><div><span>⛏ Mining</span><b>1</b></div><div><span>🎣 Fishing</span><b>1</b></div></div><button class="retro-button wide" id="skills-button">View skills</button></aside>
        <section class="retro-center"><div class="game-canvas-wrap" id="game-viewport"><canvas id="world-canvas" aria-label="Mythos game world"></canvas><div class="canvas-top-label"><span>GREENREACH VILLAGE</span><span id="world-clock">WORLD 1</span></div><div id="game-events" aria-live="polite"></div><div class="canvas-hint" id="canvas-hint">WASD / arrows to move • Click ground to walk • Click creatures to interact</div></div>
          <div class="retro-bottom-grid"><div class="retro-panel action-panel"><h2>ACTIONS</h2><div class="action-buttons"><button class="action-button selected" data-action="walk">➤<span>Walk</span></button><button class="action-button" data-action="attack">⚔<span>Attack</span></button><button class="action-button" data-action="gather">✦<span>Gather</span></button><button class="action-button" data-action="inspect">⌕<span>Inspect</span></button></div><p id="action-message">You are standing in Greenreach. The world is yours to explore.</p></div><div class="retro-panel minimap-panel"><h2>MINIMAP</h2><canvas id="minimap" width="150" height="120"></canvas><small>GREENREACH & SURROUNDINGS</small></div></div>
        </section>
        <aside class="retro-right"><section class="retro-panel inventory-panel"><div class="panel-title-row"><h2>INVENTORY</h2><span id="inventory-count">4 / 24</span></div><div class="inventory-grid" id="inventory-grid"></div><div class="coin-row">◉ Coins <b id="coins-count">25</b></div><h3>EQUIPMENT</h3><div class="equipment-list"><div>Head <b>None</b></div><div>Body <b>Cloth tunic</b></div><div>Weapon <b>Wooden sword</b></div><div>Shield <b>None</b></div></div></section><section class="retro-panel quest-panel"><h2>QUEST JOURNAL</h2><b id="quest-title">A First Adventure</b><p id="quest-description">Speak with Elder Rowan in the village.</p><div class="quest-progress"><span id="quest-progress-fill"></span></div><small id="quest-progress-text">0 / 1 objectives</small><button class="retro-button wide" id="quest-button">Track quest</button></section><section class="retro-panel players-panel"><h2>PLAYERS ONLINE <span id="online-count">1</span></h2><div id="online-list" class="online-list"><span>Connecting to realm...</span></div></section></aside>
      </div>
      <section class="retro-panel chat-panel"><div class="chat-heading"><h2>REALM CHAT</h2><span id="chat-status">Connected players can talk here</span></div><div id="chat-log" class="chat-log" role="log" aria-live="polite"><p><b class="system-chat">[Realm]</b> Welcome to Greenreach! Be kind to fellow adventurers.</p></div><form id="chat-form"><input id="chat-input" maxlength="240" autocomplete="off" placeholder="Say something to the realm..." aria-label="Chat message"><button class="retro-button" type="submit">SEND</button></form></section>
      <footer class="retro-footer"><span>MYTHOS CLASSIC • BROWSER MMORPG</span><span>Progress saves to your account in supported releases • <span id="ack-status">Syncing character...</span></span></footer>
    </main>`;

  document.querySelector("#logout-button").addEventListener("click", async () => { await saveCharacter(); onLogout(); });
  const canvas = document.querySelector("#world-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const mini = document.querySelector("#minimap");
  const mctx = mini.getContext("2d");
  const viewport = document.querySelector("#game-viewport");
  const socket = io(`${apiUrl}/game`, { auth: { token }, transports: ["websocket", "polling"], reconnection: true });

  const player = { x: savedCharacter?.x ?? 45, y: savedCharacter?.y ?? 45, name: user.username, hp: savedCharacter?.hp ?? 30, maxHp: savedCharacter?.maxHp ?? 30, coins: savedCharacter?.coins ?? 25, xp: savedCharacter?.xp ?? 0, level: savedCharacter?.level ?? 1, facing: 0 };
  const remotePlayers = new Map();
  const keys = new Set();
  const entities = new Map();
  const mobs = [];
  const inventory = Array.isArray(savedCharacter?.inventory) && savedCharacter.inventory.length ? savedCharacter.inventory : [{ name: "Wooden sword", icon: "⚔", count: 1 }, { name: "Bread", icon: "🍞", count: 3 }, { name: "Logs", icon: "▤", count: 2 }, { name: "Health potion", icon: "♜", count: 1 }];
  let connected = false, disposed = false, frame = 0, lastSend = 0, lastSave = 0, target = null, selectedAction = "walk", muted = false, questDone = savedCharacter?.questDone === true;
  let walkTarget = null;
  const cleanup = [];

  // Seed starter creatures in the clearing around the village.
  for (let i = 0; i < 8; i++) mobs.push({ id: `slime-${i}`, type: "slime", name: "Meadow Slime", x: 39 + (i % 4) * 4, y: 38 + Math.floor(i / 4) * 7, hp: 8, maxHp: 8, alive: true, respawn: 0 });
  mobs.push({ id: "elder-rowan", type: "npc", name: "Elder Rowan", x: 47, y: 42, hp: 1, maxHp: 1, alive: true });
  mobs.push({ id: "cow-1", type: "cow", name: "Village Cow", x: 53, y: 48, hp: 5, maxHp: 5, alive: true });

  const palette = { grass: "#67964a", path: "#c6ad76", flowers: "#78a653", water: "#5a9bb5", tree: "#477443", rock: "#8b8a78" };
  function setMessage(message) { document.querySelector("#action-message").textContent = message; }
  function banner(message) { const box = document.querySelector("#game-events"); box.innerHTML = `<div class="retro-event">${escapeHtml(message)}</div>`; window.setTimeout(() => { if (box.textContent === message) box.innerHTML = ""; }, 3200); }
  function worldToScreen(x, y) { return { x: canvas.width / 2 + (x - player.x) * TILE, y: canvas.height / 2 + (y - player.y) * TILE }; }
  function resize() { const rect = viewport.getBoundingClientRect(); const scale = Math.min(window.devicePixelRatio || 1, 1.25); canvas.width = Math.max(320, Math.floor(rect.width * scale)); canvas.height = Math.max(250, Math.floor(rect.height * scale)); canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`; ctx.imageSmoothingEnabled = false; }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(viewport); resize();

  function drawTile(x, y, type) {
    const p = worldToScreen(x, y); const size = TILE;
    if (p.x < -size || p.y < -size || p.x > canvas.width + size || p.y > canvas.height + size) return;
    ctx.fillStyle = palette[type] || palette.grass; ctx.fillRect(p.x, p.y, size + 1, size + 1);
    ctx.strokeStyle = type === "path" ? "#b49a65" : "#598342"; ctx.globalAlpha = 0.22; ctx.strokeRect(p.x + .5, p.y + .5, size, size); ctx.globalAlpha = 1;
    const h = hash(x, y);
    if (type === "flowers") { ctx.fillStyle = h % 2 ? "#f4d67d" : "#e8a6c1"; ctx.fillRect(p.x + 7 + h % 12, p.y + 8 + (h >>> 4) % 12, 3, 3); ctx.fillStyle = "#e9e4bf"; ctx.fillRect(p.x + 19, p.y + 21, 2, 2); }
    if (type === "water") { ctx.fillStyle = "#87c4d0"; ctx.fillRect(p.x + 5, p.y + 10 + h % 12, 11, 2); ctx.fillRect(p.x + 19, p.y + 23, 7, 2); }
    if (type === "tree") { ctx.fillStyle = "#64482d"; ctx.fillRect(p.x + 13, p.y + 15, 7, 14); ctx.fillStyle = "#2d6338"; ctx.fillRect(p.x + 4, p.y + 3, 24, 18); ctx.fillStyle = "#3f7d43"; ctx.fillRect(p.x + 8, p.y + 1, 15, 14); ctx.fillStyle = "#60934b"; ctx.fillRect(p.x + 9, p.y + 4, 5, 4); }
    if (type === "rock") { ctx.fillStyle = "#656d68"; ctx.fillRect(p.x + 7, p.y + 13, 18, 12); ctx.fillStyle = "#a8aca0"; ctx.fillRect(p.x + 11, p.y + 10, 10, 6); }
    if (Math.abs(x - 45) < 3 && Math.abs(y - 45) < 3 && type === "path") { ctx.fillStyle = "#b59b6c"; ctx.fillRect(p.x + 1, p.y + 1, 30, 30); }
  }
  function drawCharacter(x, y, color, name, isLocal = false) {
    const p = worldToScreen(x, y); const s = TILE;
    ctx.fillStyle = "#263326"; ctx.fillRect(p.x + 7, p.y + 23, 7, 5); ctx.fillRect(p.x + 18, p.y + 23, 7, 5);
    ctx.fillStyle = color; ctx.fillRect(p.x + 7, p.y + 12, 18, 13); ctx.fillStyle = isLocal ? "#f0c89a" : "#d8b58c"; ctx.fillRect(p.x + 9, p.y + 3, 14, 12);
    ctx.fillStyle = isLocal ? "#513c2e" : "#5a4030"; ctx.fillRect(p.x + 8, p.y + 1, 16, 5); ctx.fillRect(p.x + 8, p.y + 4, 3, 5);
    ctx.fillStyle = "#2c2b28"; ctx.fillRect(p.x + 12, p.y + 8, 2, 2); ctx.fillRect(p.x + 19, p.y + 8, 2, 2);
    if (isLocal) { ctx.fillStyle = "#f7e9bd"; ctx.fillRect(p.x + 24, p.y + 13, 3, 13); ctx.fillRect(p.x + 22, p.y + 10, 7, 4); }
    ctx.font = "bold 10px monospace"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "#27352b"; ctx.strokeText(name, p.x + 16, p.y - 3); ctx.fillStyle = isLocal ? "#fff1c8" : "#eff5e7"; ctx.fillText(name, p.x + 16, p.y - 3);
  }
  function drawMob(mob) {
    if (!mob.alive) return; const p = worldToScreen(mob.x, mob.y); if (p.x < -50 || p.y < -50 || p.x > canvas.width + 50 || p.y > canvas.height + 50) return;
    if (mob.type === "training_dummy") { ctx.fillStyle = "#65452c"; ctx.fillRect(p.x + 12, p.y + 5, 9, 24); ctx.fillStyle = "#c3a36d"; ctx.fillRect(p.x + 5, p.y + 9, 23, 7); ctx.fillStyle = "#e1bd79"; ctx.fillRect(p.x + 9, p.y + 11, 15, 3); }
    else if (mob.type === "treasure_chest") { ctx.fillStyle = "#6d4429"; ctx.fillRect(p.x + 5, p.y + 13, 24, 15); ctx.fillStyle = "#d1a64e"; ctx.fillRect(p.x + 5, p.y + 11, 24, 6); ctx.fillRect(p.x + 15, p.y + 15, 4, 6); }
    else if (mob.type === "healing_orb") { ctx.fillStyle = "#b8ef92"; ctx.fillRect(p.x + 10, p.y + 7, 12, 18); ctx.fillRect(p.x + 7, p.y + 11, 18, 10); ctx.fillStyle = "#efffd1"; ctx.fillRect(p.x + 14, p.y + 11, 4, 9); }
    else if (mob.type === "npc") { ctx.fillStyle = "#57402b"; ctx.fillRect(p.x + 8, p.y + 11, 16, 16); ctx.fillStyle = "#b8c0a0"; ctx.fillRect(p.x + 7, p.y + 8, 18, 10); ctx.fillStyle = "#d6b78a"; ctx.fillRect(p.x + 10, p.y + 1, 12, 10); ctx.fillStyle = "#e5d4a2"; ctx.fillRect(p.x + 15, p.y - 9, 4, 6); }
    else if (mob.type === "slime") { ctx.fillStyle = "#315b3b"; ctx.fillRect(p.x + 5, p.y + 15, 23, 12); ctx.fillStyle = "#78bb69"; ctx.fillRect(p.x + 7, p.y + 10, 19, 14); ctx.fillStyle = "#eaf5cb"; ctx.fillRect(p.x + 12, p.y + 15, 3, 3); ctx.fillRect(p.x + 20, p.y + 15, 3, 3); }
    else { ctx.fillStyle = "#eee3bf"; ctx.fillRect(p.x + 6, p.y + 10, 22, 15); ctx.fillStyle = "#aa916a"; ctx.fillRect(p.x + 11, p.y + 7, 12, 12); ctx.fillStyle = "#f6e9c8"; ctx.fillRect(p.x + 8, p.y + 5, 4, 8); ctx.fillRect(p.x + 22, p.y + 5, 4, 8); }
    if (target?.id === mob.id) { ctx.strokeStyle = "#ffed8a"; ctx.lineWidth = 2; ctx.strokeRect(p.x + 2, p.y + 3, 30, 27); }
    ctx.font = "10px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#fff0c5"; ctx.fillText(mob.name, p.x + 16, p.y - 4);
    if (mob.type !== "npc" && mob.hp < mob.maxHp) { ctx.fillStyle = "#532e29"; ctx.fillRect(p.x + 5, p.y - 1, 23, 3); ctx.fillStyle = "#db6653"; ctx.fillRect(p.x + 5, p.y - 1, 23 * mob.hp / mob.maxHp, 3); }
  }
  function drawHouse() { const p = worldToScreen(45, 39); ctx.fillStyle = "#9b7145"; ctx.fillRect(p.x - 18, p.y + 5, 68, 52); ctx.fillStyle = "#744637"; ctx.fillRect(p.x - 24, p.y - 7, 80, 23); ctx.fillStyle = "#c3a06c"; ctx.fillRect(p.x - 18, p.y + 12, 68, 5); ctx.fillStyle = "#503a2a"; ctx.fillRect(p.x + 8, p.y + 30, 15, 27); ctx.fillStyle = "#b5d1ce"; ctx.fillRect(p.x - 10, p.y + 23, 10, 10); ctx.fillRect(p.x + 32, p.y + 23, 10, 10); }
  function renderWorld() {
    ctx.fillStyle = "#67964a"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(window.devicePixelRatio || 1, 1.25); const cols = Math.ceil(canvas.width / TILE) + 3; const rows = Math.ceil(canvas.height / TILE) + 3;
    const left = Math.floor(player.x - cols / 2), top = Math.floor(player.y - rows / 2);
    for (let y = top; y < top + rows; y++) for (let x = left; x < left + cols; x++) drawTile(x, y, tileAt(x, y));
    drawHouse();
    for (const mob of mobs) drawMob(mob);
    for (const remote of remotePlayers.values()) drawCharacter(remote.x, remote.y, "#5f8fc5", remote.name, false);
    drawCharacter(player.x, player.y, "#4777a9", player.name, true);
    // Tiny classic pixel-style sparkles, limited to the visible screen.
    ctx.fillStyle = "rgba(255,244,191,.55)"; for (let i = 0; i < 7; i++) { const x = (i * 137 + frame * .2) % canvas.width; const y = (i * 71 + 23) % canvas.height; ctx.fillRect(x, y, 2, 2); }
    drawMinimap();
  }
  function drawMinimap() { const w = mini.width, h = mini.height; mctx.fillStyle = "#293e2e"; mctx.fillRect(0, 0, w, h); const sx = w / WORLD_W, sy = h / WORLD_H; for (let y = 0; y < WORLD_H; y += 2) for (let x = 0; x < WORLD_W; x += 2) { const t = tileAt(x, y); mctx.fillStyle = t === "water" ? "#4e91a9" : t === "path" ? "#c0a56e" : t === "tree" ? "#315b38" : t === "rock" ? "#8c8d7e" : "#648b46"; mctx.fillRect(x * sx, y * sy, sx * 2 + 1, sy * 2 + 1); } mctx.fillStyle = "#fff1a8"; mctx.fillRect(player.x * sx - 2, player.y * sy - 2, 5, 5); }
  function renderInventory() { const el = document.querySelector("#inventory-grid"); const slots = [...inventory]; while (slots.length < 24) slots.push(null); el.innerHTML = slots.map((item, i) => `<button class="inventory-slot ${item ? "has-item" : ""}" data-slot="${i}" title="${item ? escapeHtml(item.name) : "Empty slot"}">${item ? `<span>${item.icon}</span>${item.count > 1 ? `<small>${item.count}</small>` : ""}` : ""}</button>`).join(""); document.querySelector("#inventory-count").textContent = `${inventory.length} / 24`; document.querySelector("#coins-count").textContent = player.coins; el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { const item = inventory[Number(b.dataset.slot)]; if (!item) return; if (item.name === "Bread") { player.hp = Math.min(player.maxHp, player.hp + 8); item.count--; if (!item.count) inventory.splice(inventory.indexOf(item), 1); updateStats(); renderInventory(); setMessage("You eat the bread and recover some health."); } else setMessage(`${item.name}: a useful item for your adventure.`); })); }
  function updateStats() { document.querySelector("#hp-text").textContent = `${player.hp} / ${player.maxHp}`; document.querySelector("#hp-fill").style.width = `${100 * player.hp / player.maxHp}%`; document.querySelector("#combat-level").textContent = player.level + 2; }
  async function saveCharacter() {
    try {
      const response = await fetch(`${apiUrl}/api/character`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ x: player.x, y: player.y, hp: player.hp, maxHp: player.maxHp, coins: player.coins, xp: player.xp, level: player.level, questDone, inventory }) });
      if (response.ok) document.querySelector("#ack-status").textContent = "Progress saved";
    } catch { /* Retry on the next autosave tick. */ }
  }
  function updateRoster() { const list = document.querySelector("#online-list"); const names = [user.username, ...[...remotePlayers.values()].map((p) => p.name)]; document.querySelector("#online-count").textContent = names.length; list.innerHTML = names.slice(0, 8).map((name) => `<div><span class="online-dot"></span>${escapeHtml(name)}${name === user.username ? " <small>(you)</small>" : ""}</div>`).join(""); }
  function addItem(name, icon, count = 1) { const found = inventory.find((item) => item.name === name); if (found) found.count += count; else if (inventory.length < 24) inventory.push({ name, icon, count }); else { setMessage("Your inventory is full!"); return false; } renderInventory(); return true; }
  function doAttack(mob) { if (!mob || !mob.alive || mob.type === "npc") return; target = mob; const damage = 2 + (hash(Math.floor(player.x + frame), Math.floor(player.y)) % 4); mob.hp -= damage; player.xp += damage; setMessage(`You hit ${mob.name} for ${damage} damage.`); if (mob.hp <= 0) { mob.alive = false; player.coins += mob.type === "slime" ? 3 : 1; player.xp += 10; addItem(mob.type === "slime" ? "Slime gel" : "Raw meat", mob.type === "slime" ? "●" : "♨", 1); banner(`${mob.name} defeated! +10 XP`); setMessage(`${mob.name} was defeated. You found a few coins and loot.`); mob.respawn = 9000; if (mobs.filter((m) => m.type === "slime" && m.alive).length === 0) { questDone = true; document.querySelector("#quest-title").textContent = "A First Adventure — Complete"; document.querySelector("#quest-description").textContent = "You defeated the meadow slimes. More quests are coming soon."; document.querySelector("#quest-progress-fill").style.width = "100%"; document.querySelector("#quest-progress-text").textContent = "1 / 1 objectives"; } } updateStats(); renderInventory(); }
  function interact(mob) { target = mob; if (mob.type === "treasure_chest") { mob.alive = false; player.coins += 10; addItem("Treasure", "✧", 1); document.querySelector("#coins-count").textContent = player.coins; setMessage("You open the treasure chest and find 10 coins!"); banner("Treasure found!"); } else if (mob.type === "healing_orb") { mob.alive = false; player.hp = player.maxHp; updateStats(); setMessage("The healing orb restores your health."); banner("Health restored!"); } else if (mob.type === "training_dummy") { doAttack(mob); } else if (mob.type === "npc") { if (!questDone) { setMessage("Elder Rowan: Welcome, traveler! Defeat a Meadow Slime and return stronger. (Quest: A First Adventure)"); banner("Quest started: A First Adventure"); document.querySelector("#quest-button").textContent = "Quest tracked ✓"; } else { setMessage("Elder Rowan: The village is safer thanks to you, adventurer!"); player.coins += 5; document.querySelector("#coins-count").textContent = player.coins; } } else if (mob.type === "slime" || mob.type === "cow") { if (selectedAction === "inspect") setMessage(`${mob.name}: ${mob.hp}/${mob.maxHp} health. ${mob.type === "slime" ? "A weak creature found in the meadows." : "A peaceful farm animal."}`); else if (selectedAction === "attack" || mob.type === "slime") doAttack(mob); else setMessage(`${mob.name} is nearby. Select Attack to fight it.`); } }
  function tileBlocked(x, y) { const t = tileAt(Math.floor(x), Math.floor(y)); return t === "water" || t === "tree" || t === "rock"; }
  function moveToward(dt) { let dx = 0, dy = 0; if (keys.has("KeyA") || keys.has("ArrowLeft")) dx--; if (keys.has("KeyD") || keys.has("ArrowRight")) dx++; if (keys.has("KeyW") || keys.has("ArrowUp")) dy--; if (keys.has("KeyS") || keys.has("ArrowDown")) dy++; if (dx || dy) walkTarget = null; else if (walkTarget) { dx = walkTarget.x - player.x; dy = walkTarget.y - player.y; const dist = Math.hypot(dx, dy); if (dist < .09) { walkTarget = null; return; } dx /= dist; dy /= dist; }
    if (!dx && !dy) return; const length = Math.hypot(dx, dy); dx /= length; dy /= length; const speed = 4.2 * dt; const nx = clamp(player.x + dx * speed, 2, WORLD_W - 3), ny = clamp(player.y + dy * speed, 2, WORLD_H - 3); if (!tileBlocked(nx, player.y)) player.x = nx; if (!tileBlocked(player.x, ny)) player.y = ny; player.facing = Math.atan2(dy, dx); }
  function nearestAt(x, y) { let nearest = null, best = 1.2; for (const mob of mobs) { if (!mob.alive) continue; const d = Math.hypot(mob.x - x, mob.y - y); if (d < best) { best = d; nearest = mob; } } return nearest; }
  function canvasPoint(event) { const r = canvas.getBoundingClientRect(); const sx = canvas.width / r.width, sy = canvas.height / r.height; const px = (event.clientX - r.left) * sx, py = (event.clientY - r.top) * sy; return { x: player.x + (px - canvas.width / 2) / (TILE * Math.min(window.devicePixelRatio || 1, 1.25)), y: player.y + (py - canvas.height / 2) / (TILE * Math.min(window.devicePixelRatio || 1, 1.25)) }; }
  canvas.addEventListener("click", (event) => { const p = canvasPoint(event); const mob = nearestAt(p.x, p.y); if (mob && Math.hypot(mob.x - p.x, mob.y - p.y) < 1.5) { interact(mob); if (selectedAction === "walk") walkTarget = { x: mob.x - .9, y: mob.y + .6 }; } else if (selectedAction === "gather") { const t = tileAt(Math.floor(p.x), Math.floor(p.y)); if (t === "tree") { addItem("Logs", "▤"); setMessage("You gather a log from the tree. (Woodcutting +1)"); } else if (t === "rock") { addItem("Copper ore", "◆"); setMessage("You chip a piece of copper ore from the rock. (Mining +1)"); } else setMessage("There is nothing to gather there."); } else if (selectedAction === "inspect") setMessage(`Grassland tile at ${Math.floor(p.x)}, ${Math.floor(p.y)}. Explore the village to find resources and creatures.`); else walkTarget = { x: clamp(p.x, 2, WORLD_W - 3), y: clamp(p.y, 2, WORLD_H - 3) }; });
  function onKeyDown(e) { if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code) && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) { e.preventDefault(); keys.add(e.code); } }
  function onKeyUp(e) { keys.delete(e.code); }
  function clearKeys() { keys.clear(); }
  window.addEventListener("keydown", onKeyDown); window.addEventListener("keyup", onKeyUp); window.addEventListener("blur", clearKeys);
  cleanup.push(() => window.removeEventListener("keydown", onKeyDown), () => window.removeEventListener("keyup", onKeyUp), () => window.removeEventListener("blur", clearKeys));

  socket.on("connect", () => { connected = true; document.querySelector("#game-status").textContent = "ONLINE"; document.querySelector("#chat-status").textContent = "Realm connection established"; });
  socket.on("disconnect", () => { connected = false; document.querySelector("#game-status").textContent = "RECONNECTING"; document.querySelector("#chat-status").textContent = "Connection lost — retrying"; });
  socket.on("connect_error", (error) => { document.querySelector("#game-status").textContent = "CONNECTION ERROR"; if (/invalid|expired|forbidden/i.test(error.message)) { localStorage.removeItem("mmorpgToken"); localStorage.removeItem("mmorpgUser"); onLogout(); } });
  function addWorldEntity(entity) { if (!entity || mobs.some((m) => m.id === entity.id)) return; const type = ["training_dummy", "treasure_chest", "healing_orb"].includes(entity.kind) ? entity.kind : "training_dummy"; mobs.push({ id: entity.id, type, name: type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), x: Number(entity.x) || 48, y: Number(entity.z) || 45, hp: 12, maxHp: 12, alive: true, respawn: 0 }); }
  socket.on("game:welcome", (data) => { if (data.position && !savedCharacter) { player.x = clamp(Number.isFinite(data.position.x) ? data.position.x : 45, 2, WORLD_W - 3); player.y = clamp(Number.isFinite(data.position.z) ? data.position.z : 45, 2, WORLD_H - 3); } for (const other of data.players || []) remotePlayers.set(other.socketId, { x: other.position.x, y: other.position.z, name: other.username || "Adventurer" }); for (const e of data.worldState?.entities || []) { entities.set(e.id, e); addWorldEntity(e); } updateRoster(); document.querySelector("#ack-status").textContent = "Character connected"; });
  socket.on("game:playerJoined", (data) => { if (data.socketId !== socket.id) remotePlayers.set(data.socketId, { x: data.position.x || 45, y: data.position.z || 45, name: data.username || "Adventurer" }); updateRoster(); banner(`${data.username || "A traveler"} entered the realm`); });
  socket.on("game:playerMoved", (data) => { if (data.socketId === socket.id) return; const p = remotePlayers.get(data.socketId) || { name: data.username || "Adventurer", x: data.position.x, y: data.position.z }; p.x = data.position.x; p.y = data.position.z; p.name = data.username || p.name; remotePlayers.set(data.socketId, p); });
  socket.on("game:playerLeft", (data) => { remotePlayers.delete(data.socketId); updateRoster(); });
  socket.on("world:alert", (alert) => banner(`REALM NOTICE: ${alert.message}`));
  socket.on("world:event", (event) => banner(`WORLD EVENT: ${event.name}`));
  socket.on("world:entitySpawned", (entity) => { entities.set(entity.id, entity); addWorldEntity(entity); banner(`A ${String(entity.kind).replace(/_/g, " ")} appeared nearby`); });
  socket.on("game:moderation", (message) => { if (message.action === "mute") { muted = true; document.querySelector("#chat-status").textContent = message.message; } });
  socket.on("chat:message", (message) => appendChat(message));
  socket.on("chat:system", (message) => appendChat({ username: "Realm", text: message, system: true, at: Date.now() }));
  function appendChat(message) { const log = document.querySelector("#chat-log"); const p = document.createElement("p"); const time = new Date(message.at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); p.innerHTML = `<time>${time}</time> <b class="${message.system || message.username === "Realm" ? "system-chat" : "player-chat"}">[${escapeHtml(message.username || "Adventurer")}]</b> ${escapeHtml(message.text || "")}`; log.appendChild(p); while (log.children.length > 80) log.firstElementChild.remove(); log.scrollTop = log.scrollHeight; }
  document.querySelector("#chat-form").addEventListener("submit", (e) => { e.preventDefault(); const input = document.querySelector("#chat-input"); const text = input.value.trim(); if (!text) return; if (muted) { appendChat({ username: "Realm", text: "You are muted and cannot chat.", system: true }); return; } if (!connected) { appendChat({ username: "Realm", text: "You are offline. Your message was not sent.", system: true }); return; } socket.emit("chat:send", { text }, (result) => { if (result && !result.ok) appendChat({ username: "Realm", text: result.message || "Message could not be sent.", system: true }); }); input.value = ""; });
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => { selectedAction = button.dataset.action; document.querySelectorAll("[data-action]").forEach((b) => b.classList.toggle("selected", b === button)); setMessage(`${selectedAction[0].toUpperCase()}${selectedAction.slice(1)} mode selected. Click the world to use it.`); }));
  document.querySelector("#skills-button").addEventListener("click", () => banner("Skills: Attack 1 • Defence 1 • Woodcutting 1 • Mining 1 • Fishing 1"));
  document.querySelector("#quest-button").addEventListener("click", () => { setMessage(questDone ? "Quest completed! Return to Elder Rowan for a reward." : "Quest tracked: defeat a Meadow Slime, then speak with Elder Rowan."); });

  let last = performance.now();
  function loop(now) { if (disposed) return; const dt = Math.min(.05, (now - last) / 1000); last = now; frame++; moveToward(dt); if (now - lastSave > 15000) { lastSave = now; saveCharacter(); } for (const mob of mobs) { if (!mob.alive && mob.respawn > 0) { mob.respawn -= dt * 1000; if (mob.respawn <= 0) { mob.alive = true; mob.hp = mob.maxHp; } } } renderWorld(); document.querySelector("#position-label").textContent = `X: ${Math.floor(player.x)} Y: ${Math.floor(player.y)}`; if (connected && now - lastSend > 100) { lastSend = now; socket.emit("game:position", { x: Number(player.x.toFixed(2)), y: 0, z: Number(player.y.toFixed(2)) }, (result) => { if (result?.ok) document.querySelector("#ack-status").textContent = "Character synced"; }); } requestAnimationFrame(loop); }
  if (questDone) { document.querySelector("#quest-title").textContent = "A First Adventure — Complete"; document.querySelector("#quest-description").textContent = "You defeated the meadow slimes. More quests are coming soon."; document.querySelector("#quest-progress-fill").style.width = "100%"; document.querySelector("#quest-progress-text").textContent = "1 / 1 objectives"; }
  renderInventory(); updateStats(); updateRoster(); requestAnimationFrame(loop);

  return () => { saveCharacter(); disposed = true; resizeObserver.disconnect(); socket.disconnect(); cleanup.forEach((fn) => fn()); };
}
