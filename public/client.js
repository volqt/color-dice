const $ = id => document.getElementById(id);
const socket = io();
const avatarCache = new Map();
async function setAvatar(elementId, userId) {
  const img = $(elementId);
  if (!img) return;
  if (!userId) { img.src = "/avatar-placeholder.svg"; img.classList.add("avatar-empty"); return; }
  img.classList.remove("avatar-empty");
  if (avatarCache.has(String(userId))) { img.src = avatarCache.get(String(userId)); return; }
  try {
    const response = await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + encodeURIComponent(userId) + "&size=150x150&format=Png&isCircular=true");
    if (!response.ok) throw new Error("Avatar lookup failed");
    const data = await response.json();
    const imageUrl = data.data && data.data[0] && data.data[0].imageUrl;
    if (imageUrl) { avatarCache.set(String(userId), imageUrl); img.src = imageUrl; }
    else { img.src = "/avatar-placeholder.svg"; img.classList.add("avatar-empty"); }
  } catch { img.src = "/avatar-placeholder.svg"; img.classList.add("avatar-empty"); }
}
let currentRoom = null;
let lastRoom = null;
let toastTimer;
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}
function sendName() {
  const name = $("name").value.trim() || "Player";
  $("name").value = name;
  socket.emit("player:name", name);
  toast("Player name saved.");
}
$("saveName").addEventListener("click", sendName);
$("name").addEventListener("change", () => socket.emit("player:name", $("name").value.trim() || "Player"));
$("create").addEventListener("click", () => { sendName(); socket.emit("room:create", Number($("stake").value)); });
$("refresh").addEventListener("click", () => socket.emit("rooms:refresh"));
$("ready").addEventListener("click", () => socket.emit("room:ready"));
const colorNames = {red:"Red",orange:"Orange",yellow:"Yellow",green:"Green",blue:"Blue",purple:"Purple"};
function renderColorPicker(room) {
  const root = $("colorPicker"); if (!root) return;
  root.innerHTML = "";
  const myId = String(window.petrollUserId || "");
  const isGreen = myId && String(room.greenUserId || "") === myId;
  const isRed = myId && String(room.redUserId || "") === myId;
  const isMineGreen = isGreen || (!myId && String(room.green || "").toLowerCase() === String($("name").value).trim().toLowerCase());
  const mine = isMineGreen ? (room.greenColors || []) : (room.redColors || []);
  const theirs = isMineGreen ? (room.redColors || []) : (room.greenColors || []);
  Object.keys(colorNames).forEach(color => {
    const selected = mine.includes(color);
    const takenByOpponent = theirs.includes(color);
    const b = document.createElement("button"); b.type = "button";
    b.setAttribute("aria-pressed", String(selected));
    b.disabled = takenByOpponent && !selected;
    b.className = "color-choice color-" + color + (selected ? " selected" : "") + (takenByOpponent && !selected ? " unavailable" : "");
    b.textContent = colorNames[color] + (selected ? " ✓" : takenByOpponent ? " Taken" : "");
    b.title = takenByOpponent && !selected ? "Your opponent picked this color" : colorNames[color];
    b.addEventListener("click", () => {
      let next = [...mine];
      const idx = next.indexOf(color);
      if (idx >= 0) next.splice(idx, 1);
      else if (next.length < 2) next.push(color);
      else { toast("Choose only 2 different colors."); return; }
      socket.emit("room:colors", next);
    });
    root.append(b);
  });
  $("colorHint").textContent = "Choose 2 different colors (" + mine.length + "/2). Colors picked by your opponent are unavailable.";
}
$("leave").addEventListener("click", () => socket.emit("room:leave"));
function showMatch() { $("match").classList.remove("hidden"); }
function hideMatch() { $("match").classList.add("hidden"); currentRoom = null; lastRoom = null; $("result").classList.add("hidden"); $("ready").disabled = true; $("ready").textContent = "I'm ready"; }
function formatGems(value) {
  const gems = Number(value) || 0;
  const abs = Math.abs(gems);
  let amount = gems;
  let suffix = "";
  if (abs >= 1000000000) { amount = gems / 1000000000; suffix = "B"; }
  else if (abs >= 1000000) { amount = gems / 1000000; suffix = "M"; }
  else if (abs >= 1000) { amount = gems / 1000; suffix = "K"; }
  if (!suffix) return gems.toLocaleString();
  let rounded = amount.toFixed(abs >= 10000000000 || (abs >= 10000000 && abs < 1000000000) || (abs >= 10000 && abs < 1000000) ? 0 : 1);
  if (rounded.endsWith(".0")) rounded = rounded.slice(0, -2);
  return rounded + suffix;
}
socket.on("balance", gems => { $("balance").textContent = formatGems(gems); });
socket.on("error:message", message => toast(message));
socket.on("room:joined", code => {
  currentRoom = code; lastRoom = code; $("roomBadge").textContent = "MATCH READY";
  $("created").textContent = "You’re in the match! Wait for the other player to join or get ready.";
  $("created").classList.remove("hidden"); showMatch();
});
socket.on("room:left", () => { hideMatch(); toast("You left the room."); });
socket.on("rooms:list", rooms => {
  const root = $("rooms"); root.innerHTML = "";
  if (!rooms.length) { root.innerHTML = '<p class="sub">No open matches right now. Press Create to start one.</p>'; return; }
  rooms.forEach(room => {
    const row = document.createElement("div"); row.className = "room";
    const info = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = (room.green || "Player") + " · Open match";
    const detail = document.createElement("small"); detail.textContent = "💎 " + room.stake + " gems · Waiting for opponent";
    info.append(name, detail);
    const btn = document.createElement("button"); btn.textContent = "Join →";
    btn.addEventListener("click", () => { sendName(); socket.emit("room:join", room.code); });
    row.append(info, btn); root.append(row);
  });
});
socket.on("room:update", room => {
  if (!currentRoom || room.code !== currentRoom) return;
  $("greenName").textContent = room.green || "Waiting for host…";
  $("redName").textContent = room.red || "Waiting for opponent…";
  setAvatar("greenAvatar", room.greenUserId);
  setAvatar("redAvatar", room.redUserId);
  $("greenReady").textContent = room.green ? (room.greenReady ? "Ready ✓" : "Not ready") : "Open seat";
  $("greenPicks").textContent = "Picks: " + ((room.greenColors || []).map(c => colorNames[c]).join(" + ") || "Choosing...");
  $("redPicks").textContent = "Picks: " + ((room.redColors || []).map(c => colorNames[c]).join(" + ") || "Choosing...");
  renderColorPicker(room);
  $("redReady").textContent = room.red ? (room.redReady ? "Ready ✓" : "Not ready") : "Open seat";
  $("matchInfo").textContent = room.result ? "The duel is complete!" : ("Stake: " + room.stake + " demo gems each. Pick 2 colors, then both players get ready.");
  $("ready").disabled = !room.green || !room.red || !!room.result || ((room.green === $("name").value && (room.greenReady || (room.greenColors || []).length !== 2)) || (room.red === $("name").value && (room.redReady || (room.redColors || []).length !== 2)));
  if (room.result) {
    $("ready").disabled = true;
    $("result").innerHTML = '<div class="dice-results">' + (room.result.dice || []).map((c,i) => '<span class="die-face die-' + c + '" style="animation-delay:' + (i * 120) + 'ms">' + colorNames[c] + '</span>').join("") + '</div><strong>' + (room.result.message || ((room.result.winnerName || "Player") + " wins!")) + '</strong><div class="scoreline">Green: ' + room.result.scoreGreen + ' · Red: ' + room.result.scoreRed + '</div><small>Pot: ' + room.result.pot + ' demo gems</small>';
    $("result").classList.remove("hidden");
  } else { $("result").classList.add("hidden"); }
});
socket.on("disconnect", () => toast("Connection lost. Reconnect to continue."));
