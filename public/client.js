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
$("create").addEventListener("click", () => { sendName(); socket.emit("room:create", $("stake").value.trim()); });
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
      if (next.length === 2) socket.emit("room:ready");
    });
    root.append(b);
  });
  $("colorHint").textContent = "Choose 2 different colors (" + mine.length + "/2). Colors picked by your opponent are unavailable.";
}
$("leave").addEventListener("click", () => socket.emit("room:leave"));
function addChatMessage(message) {
 const root=$("chatMessages"); if(!root)return; const empty=root.querySelector(".chat-empty"); if(empty)empty.remove();
 const row=document.createElement("div"); row.className="chat-message"+(String(message.username).toLowerCase()===String(window.petrollUsername||"").toLowerCase()?" mine":"");
 const author=document.createElement("strong"); author.textContent=message.username||"Player";
 const body=document.createElement("p"); body.textContent=message.text||"";
 const time=document.createElement("small"); time.textContent=new Date(message.time||Date.now()).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
 row.append(author,body,time); root.append(row); while(root.children.length>50)root.firstElementChild.remove(); root.scrollTop=root.scrollHeight;
}
$("chatForm").addEventListener("submit",event=>{event.preventDefault();const text=$("chatInput").value.trim();if(!text||!currentRoom)return;socket.emit("chat:send",text);$("chatInput").value="";});
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
  let rounded = amount.toFixed(suffix === "B" ? 1 : (abs >= 10000000 && abs < 1000000000) || (abs >= 10000 && abs < 1000000) ? 0 : 1);
  if (rounded.endsWith(".0")) rounded = rounded.slice(0, -2);
  return rounded + suffix;
}
socket.on("balance", gems => { $("balance").textContent = formatGems(gems); });
socket.on("error:message", message => toast(message));
socket.on("room:joined", code => {
  currentRoom = code; lastRoom = code; $("chatMessages").innerHTML = '<p class="chat-empty">Say hello to your opponent!</p>'; $("roomBadge").textContent = "MATCH READY";
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
socket.on("chat:history",data=>{if(!currentRoom||data.code!==currentRoom)return;$("chatMessages").innerHTML="";(data.messages||[]).forEach(addChatMessage);if(!data.messages||!data.messages.length)$("chatMessages").innerHTML='<p class="chat-empty">Say hello to your opponent!</p>';});
socket.on("chat:message",message=>{if(currentRoom&&message.code===currentRoom)addChatMessage(message);});
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
  $("matchInfo").textContent = room.result ? "The duel is complete!" : ("Stake: " + room.stake + " demo gems each. Pick 2 colors each — the dice roll automatically when both players finish.");
  $("ready").disabled = !room.green || !room.red || !!room.result || ((room.green === $("name").value && (room.greenReady || (room.greenColors || []).length !== 2)) || (room.red === $("name").value && (room.redReady || (room.redColors || []).length !== 2)));
  if (room.result) {
    $("ready").disabled = true;
    $("result").innerHTML = '<div class="dice-results">' + (room.result.dice || []).map((c,i) => '<span class="die-face die-' + c + '" style="animation-delay:' + (i * 120) + 'ms">' + colorNames[c] + '</span>').join("") + '</div><strong>' + (room.result.message || ((room.result.winnerName || "Player") + " wins!")) + '</strong><div class="scoreline">Green: ' + room.result.scoreGreen + ' · Red: ' + room.result.scoreRed + '</div><small>Pot: ' + room.result.pot + ' demo gems</small>';
    $("result").classList.remove("hidden");
  } else { $("result").classList.add("hidden"); }
});
socket.on("disconnect", () => toast("Connection lost. Reconnect to continue."));


async function loadDeposits() {
  const assetsRoot = $("depositAssets"), requestsRoot = $("depositRequests"), withdrawRoot = $("withdrawRequests");
  if (!assetsRoot) return;
  try {
    const response = await fetch("/api/deposits", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      assetsRoot.innerHTML = '<p class="sub">Verify your Roblox account to submit and view deposits.</p>';
      return;
    }
    assetsRoot.replaceChildren();
    if (!data.assets.length) assetsRoot.innerHTML = '<p class="sub">No verified deposits yet.</p>';
    (data.assets || []).forEach(asset => {
      const row = document.createElement("div"); row.className = "deposit-item";
      const title = document.createElement("strong"); title.textContent = asset.type + ": " + asset.itemName;
      const detail = document.createElement("small"); detail.textContent = (asset.details ? asset.details + " · " : "") + "Verified " + new Date(asset.depositedAt).toLocaleString();
      row.append(title, detail); assetsRoot.append(row);
    });
    requestsRoot.replaceChildren();
    (data.requests || []).forEach(item => {
      const row = document.createElement("div"); row.className = "deposit-item pending";
      const title = document.createElement("strong"); title.textContent = "Pending: " + item.type + " — " + item.itemName;
      const detail = document.createElement("small"); detail.textContent = "Submitted " + new Date(item.createdAt).toLocaleString() + (item.details ? " · " + item.details : "");
      row.append(title, detail); requestsRoot.append(row);
    });
    const admin = $("depositAdmin");
    if ((data.pending && data.pending.length) || (data.pendingWithdrawals && data.pendingWithdrawals.length)) {
      admin.classList.remove("hidden");
      const queue = $("depositQueue"); queue.replaceChildren();
      data.pending.forEach(item => {
        const row = document.createElement("div"); row.className = "deposit-item";
        const title = document.createElement("strong"); title.textContent = item.username + " — " + item.type + ": " + item.itemName;
        const detail = document.createElement("small"); detail.textContent = (item.details ? item.details + " · " : "") + "Submitted " + new Date(item.createdAt).toLocaleString();
        const actions = document.createElement("div"); actions.className = "deposit-actions";
        const approve = document.createElement("button"); approve.className = "small"; approve.textContent = "Verify & add";
        approve.addEventListener("click", async () => {
          const r = await fetch("/api/deposits/" + encodeURIComponent(item.id) + "/approve", { method: "POST" });
          const d = await r.json(); if (!r.ok) { toast(d.error || "Could not verify deposit."); return; }
          toast("Deposit marked verified."); loadDeposits();
        });
        const reject = document.createElement("button"); reject.className = "small ghost"; reject.textContent = "Reject";
        reject.addEventListener("click", async () => {
          const r = await fetch("/api/deposits/" + encodeURIComponent(item.id) + "/reject", { method: "POST" });
          const d = await r.json(); if (!r.ok) { toast(d.error || "Could not reject deposit."); return; }
          toast("Deposit request rejected."); loadDeposits();
        });
        actions.append(approve, reject); row.append(title, detail, actions); queue.append(row);
      });
      const wq=$("withdrawQueue"); wq.replaceChildren();
      (data.pendingWithdrawals || []).forEach(item => {
        const row=document.createElement("div");row.className="deposit-item";
        const title=document.createElement("strong");title.textContent=item.username+" — "+item.itemName;
        const detail=document.createElement("small");detail.textContent=(item.details?item.details+" · ":"")+"Requested "+new Date(item.createdAt).toLocaleString();
        const actions=document.createElement("div");actions.className="deposit-actions";
        const complete=document.createElement("button");complete.className="small";complete.textContent="Mark sent";
        complete.addEventListener("click",async()=>{const r=await fetch("/api/withdrawals/"+encodeURIComponent(item.id)+"/complete",{method:"POST"});const d=await r.json();if(!r.ok){toast(d.error||"Could not complete withdrawal.");return;}toast("Withdrawal marked sent.");loadDeposits();});
        const reject=document.createElement("button");reject.className="small ghost";reject.textContent="Reject";
        reject.addEventListener("click",async()=>{const r=await fetch("/api/withdrawals/"+encodeURIComponent(item.id)+"/reject",{method:"POST"});const d=await r.json();if(!r.ok){toast(d.error||"Could not reject withdrawal.");return;}toast("Withdrawal rejected.");loadDeposits();});
        actions.append(complete,reject);row.append(title,detail,actions);wq.append(row);
      });
    } else if (admin) { admin.classList.add("hidden"); $("depositQueue").replaceChildren(); $("withdrawQueue").replaceChildren(); }
  } catch {
    assetsRoot.innerHTML = '<p class="sub">Could not load deposits right now. Refresh and try again.</p>';
  }
}
$("depositForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("depositMessage"); message.textContent = "Submitting request…";
  try {
    const response = await fetch("/api/deposits/request", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: $("depositType").value, itemName: $("depositItem").value.trim(), details: $("depositDetails").value.trim() })
    });
    const data = await response.json();
    if (!response.ok) { message.textContent = data.error || "Could not submit deposit."; return; }
    message.textContent = "Request submitted. Your pet will appear in verified deposits after the in-game trade is checked.";
    $("depositItem").value = ""; $("depositDetails").value = "";
    loadDeposits();
  } catch { message.textContent = "Connection error. Please try again."; }
});
loadDeposits();

$("withdrawForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const message=$("withdrawMessage"); message.textContent="Submitting withdrawal request…";
  try {
    const response=await fetch("/api/withdrawals/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({itemName:$("withdrawItem").value.trim(),details:$("withdrawDetails").value.trim()})});
    const data=await response.json();
    if(!response.ok){message.textContent=data.error||"Could not submit withdrawal.";return;}
    message.textContent="Withdrawal request submitted. It will be marked complete after the item is sent in PS99.";
    $("withdrawItem").value="";$("withdrawDetails").value="";loadDeposits();
  } catch { message.textContent="Connection error. Please try again."; }
});
