const $ = id => document.getElementById(id);
const socket = io();
const avatarCache = new Map();
async function setAvatar(elementId, userId) {
  const img = $(elementId);
  if (!img) return;
  if (!userId) { img.removeAttribute("src"); img.classList.add("avatar-empty"); return; }
  img.classList.remove("avatar-empty");
  if (avatarCache.has(String(userId))) { img.src = avatarCache.get(String(userId)); return; }
  try {
    const response = await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + encodeURIComponent(userId) + "&size=150x150&format=Png&isCircular=true");
    if (!response.ok) throw new Error("Avatar lookup failed");
    const data = await response.json();
    const imageUrl = data.data && data.data[0] && data.data[0].imageUrl;
    if (imageUrl) { avatarCache.set(String(userId), imageUrl); img.src = imageUrl; }
    else img.classList.add("avatar-empty");
  } catch { img.classList.add("avatar-empty"); }
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
$("leave").addEventListener("click", () => socket.emit("room:leave"));
function showMatch() { $("match").classList.remove("hidden"); }
function hideMatch() { $("match").classList.add("hidden"); currentRoom = null; lastRoom = null; $("result").classList.add("hidden"); $("ready").disabled = true; $("ready").textContent = "I'm ready"; }
socket.on("balance", gems => { $("balance").textContent = Number(gems).toLocaleString(); });
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
  $("redReady").textContent = room.red ? (room.redReady ? "Ready ✓" : "Not ready") : "Open seat";
  $("matchInfo").textContent = room.result ? "The duel is complete!" : ("Stake: " + room.stake + " gems each. Both players must be ready to roll.");
  $("ready").disabled = !room.green || !room.red || !!room.result || ((room.green === $("name").value && room.greenReady) || (room.red === $("name").value && room.redReady));
  if (room.result) {
    $("ready").disabled = true;
    $("result").textContent = (room.result.winnerName || "Player") + " wins! " + room.result.roll + " · Prize: " + room.result.pot + " demo gems";
    $("result").classList.remove("hidden");
  } else { $("result").classList.add("hidden"); }
});
socket.on("disconnect", () => toast("Connection lost. Reconnect to continue."));
