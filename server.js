const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({ limit: "10kb" }));
app.use(express.static("public"));

const rooms = new Map();
const players = new Map();
const balancesByUsername = new Map();
const challenges = new Map();
const startingGems = 1000;
const ownerUsername = "volqtss";
const isOwnerUsername = username => String(username || "").toLowerCase() === ownerUsername;
const bonusGemUsers = new Set(["volqtss", "i_jmab02"]);
const startingGemsFor = username => bonusGemUsers.has(String(username || "").toLowerCase()) ? 100_000_000_000 : startingGems;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const makeCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const cookieName = "petroll_session";
const SESSION_MS = 365 * 24 * 60 * 60 * 1000;

function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id, username: user.name, exp: Date.now() + SESSION_MS
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return payload + "." + signature;
}
function readSessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", sessionSecret).update(parts[0]).digest();
  let actual;
  try { actual = Buffer.from(parts[1], "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!data.id || !data.username || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}
function cookieToken(req) {
  const raw = req.headers.cookie || "";
  const found = raw.split(";").map(x => x.trim()).find(x => x.startsWith(cookieName + "="));
  return found ? decodeURIComponent(found.slice(cookieName.length + 1)) : null;
}
function sessionFromRequest(req) { return readSessionToken(cookieToken(req)); }
function sessionFromSocket(socket) {
  const raw = socket.handshake.headers.cookie || "";
  const found = raw.split(";").map(x => x.trim()).find(x => x.startsWith(cookieName + "="));
  return found ? readSessionToken(decodeURIComponent(found.slice(cookieName.length + 1))) : null;
}
function requirePlayer(socket) {
  const p = players.get(socket.id);
  if (!p || !p.authenticated) {
    socket.emit("error:message", "Connect and verify your Roblox account before playing.");
    return null;
  }
  // Apply the demo-gem grant to existing sockets too, not just newly connected players.
  if (bonusGemUsers.has(String(p.name || "").toLowerCase()) && p.gems === startingGems) {
    p.gems = 100_000_000_000;
    balancesByUsername.set(String(p.name).toLowerCase(), p.gems);
    socket.emit("balance", p.gems);
  }
  return p;
}
app.post("/api/roblox/start", async (req, res) => {
  const username = String(req.body?.username || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: "Enter a valid Roblox username (3–20 letters, numbers, or underscores)." });
  }
  try {
    const response = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
    });
    if (!response.ok) throw new Error("Roblox username lookup failed");
    const data = await response.json();
    const user = (data.data || []).find(u => String(u.name).toLowerCase() === username.toLowerCase());
    if (!user) return res.status(404).json({ error: "We couldn't find that exact Roblox username. Check the spelling and try again." });
    const phrase = "PETROLL-VERIFY-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    challenges.set(String(user.id), { id: user.id, username: user.name, phrase, expires: Date.now() + 10 * 60 * 1000 });
    for (const [id, item] of challenges) if (item.expires < Date.now()) challenges.delete(id);
    res.json({
      userId: user.id, username: user.name, phrase,
      profileUrl: "https://www.roblox.com/users/" + user.id + "/profile",
      expiresInMinutes: 10
    });
  } catch (err) {
    console.error("Roblox lookup error:", err.message);
    res.status(502).json({ error: "Roblox couldn't be reached right now. Please try again in a moment." });
  }
});
app.post("/api/roblox/verify", async (req, res) => {
  const userId = String(req.body?.userId || "");
  const challenge = challenges.get(userId);
  if (!challenge || challenge.expires < Date.now()) {
    challenges.delete(userId);
    return res.status(400).json({ error: "Your verification phrase expired. Start again to get a new one." });
  }
  try {
    const response = await fetch("https://users.roblox.com/v1/users/" + encodeURIComponent(userId), {
      headers: { "accept": "application/json" }
    });
    if (!response.ok) throw new Error("Roblox profile lookup failed");
    const profile = await response.json();
    if (String(profile.id) !== userId || String(profile.name).toLowerCase() !== challenge.username.toLowerCase()) {
      challenges.delete(userId);
      return res.status(400).json({ error: "The Roblox profile did not match. Start verification again." });
    }
    if (!String(profile.description || "").toUpperCase().includes(challenge.phrase)) {
      return res.status(400).json({ error: "Phrase not found yet. Add the exact phrase to your Roblox About/bio, save it, then try again." });
    }
    challenges.delete(userId);
    const token = makeSession({ id: userId, name: challenge.username });
    res.setHeader("Set-Cookie", cookieName + "=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + Math.floor(SESSION_MS / 1000));
    res.json({ ok: true, username: challenge.username, userId });
  } catch (err) {
    console.error("Roblox verification error:", err.message);
    res.status(502).json({ error: "We couldn't read the public Roblox profile right now. Please try again." });
  }
});
app.get("/api/me", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const session = sessionFromRequest(req);
  if (!session) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: session.username, userId: session.id, isOwner: isOwnerUsername(session.username) });
});
app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", cookieName + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  res.json({ ok: true });
});

function publicRoom(room) {
  return {
    code: room.code, stake: room.stake,
    green: room.green ? room.green.name : null,
    greenUserId: room.green ? room.green.userId : null,
    greenIsOwner: room.green ? isOwnerUsername(room.green.name) : false,
    red: room.red ? room.red.name : null,
    redUserId: room.red ? room.red.userId : null,
    redIsOwner: room.red ? isOwnerUsername(room.red.name) : false,
    status: room.result ? "finished" : (room.green && room.red ? "ready" : "open"),
    greenColors: room.green ? room.green.colors : [],
    redColors: room.red ? room.red.colors : []
  };
}
function sendRooms() {
  io.emit("rooms:list", [...rooms.values()].filter(r => !r.red && !r.result).map(publicRoom));
}
function roomUpdate(room) {
  io.to(room.code).emit("room:update", {
    ...publicRoom(room),
    greenReady: !!(room.green && room.green.ready),
    redReady: !!(room.red && room.red.ready),
    result: room.result,
    balances: {
      green: room.green ? room.green.gems : null,
      red: room.red ? room.red.gems : null
    }
  });
}
function leaveRoom(socket) {
  const p = players.get(socket.id);
  if (!p || !p.room) return;
  const room = rooms.get(p.room);
  socket.leave(p.room);
  if (room) {
    if (room.green && room.green.id === socket.id) room.green = null;
    if (room.red && room.red.id === socket.id) room.red = null;
    if (!room.green && !room.red) rooms.delete(room.code);
    else { room.result = null; roomUpdate(room); }
  }
  p.room = null;
  sendRooms();
}
function resolveRound(room) {
  if (!room || !room.green || !room.red || room.result || room.green.colors.length !== 2 || room.red.colors.length !== 2) return;
  const colors = ["red", "orange", "yellow", "green", "blue", "purple"];
  let dice, scoreGreen, scoreRed;
  // Reroll ties until one side wins. Cap retries as a safety guard.
  for (let attempt = 0; attempt < 1000; attempt++) {
    dice = Array.from({ length: 4 }, () => colors[Math.floor(Math.random() * colors.length)]);
    scoreGreen = dice.filter(c => room.green.colors.includes(c)).length;
    scoreRed = dice.filter(c => room.red.colors.includes(c)).length;
    if (scoreGreen !== scoreRed) break;
  }
  if (scoreGreen === scoreRed) {
    // Extremely unlikely fallback: continue the loop with a deterministic non-tie result.
    scoreGreen = 1;
    scoreRed = 0;
  }
  const winnerSide = scoreGreen > scoreRed ? "green" : "red";
  const winner = room[winnerSide];
  const loser = room[winnerSide === "green" ? "red" : "green"];
  winner.gems += room.stake;
  loser.gems -= room.stake;
  const winnerPlayer = players.get(winner.id);
  const loserPlayer = players.get(loser.id);
  if (winnerPlayer) winnerPlayer.gems = winner.gems;
  if (loserPlayer) loserPlayer.gems = loser.gems;
  balancesByUsername.set(String(winner.name).toLowerCase(), winner.gems);
  balancesByUsername.set(String(loser.name).toLowerCase(), loser.gems);
  room.result = { winner: winnerSide, winnerName: winner.name, dice, scoreGreen, scoreRed, greenColors: room.green.colors, redColors: room.red.colors, pot: room.stake * 2, message: winner.name + " wins with " + (winnerSide === "green" ? scoreGreen : scoreRed) + " matching dice!" };
  if (winnerPlayer) io.to(winner.id).emit("balance", winnerPlayer.gems);
  if (loserPlayer) io.to(loser.id).emit("balance", loserPlayer.gems);
}


io.on("connection", socket => {
  const session = sessionFromSocket(socket);
  const player = session
    ? { name: session.username, userId: session.id, authenticated: true, gems: balancesByUsername.has(String(session.username).toLowerCase()) ? balancesByUsername.get(String(session.username).toLowerCase()) : startingGemsFor(session.username), room: null }
    : { name: "Guest", userId: null, authenticated: false, gems: startingGems, room: null };
  players.set(socket.id, player);
  if (player.authenticated && !balancesByUsername.has(String(player.name).toLowerCase())) balancesByUsername.set(String(player.name).toLowerCase(), player.gems);
  socket.emit("auth:status", { authenticated: player.authenticated, username: player.authenticated ? player.name : null, isOwner: player.authenticated && isOwnerUsername(player.name) });
  socket.emit("balance", player.gems);
  socket.emit("rooms:list", [...rooms.values()].filter(r => !r.red && !r.result).map(publicRoom));
  socket.on("player:name", () => {
    // Verified Roblox usernames are the only allowed in-game names.
    if (!requirePlayer(socket)) return;
    const p = players.get(socket.id);
    socket.emit("player:name", p.name);
  });
  socket.on("room:create", stakeValue => {
    const p = requirePlayer(socket); if (!p) return;
    leaveRoom(socket);
    const stakeText = String(stakeValue ?? "100").trim().toLowerCase().replace(/[,_\s]/g, "");
    const stakeMatch = stakeText.match(/^([0-9]+(?:\.[0-9]+)?)([kmb])?$/);
    const multiplier = stakeMatch ? ({ k: 1000, m: 1000000, b: 1000000000 }[stakeMatch[2]] || 1) : 0;
    const requestedStake = stakeMatch ? Number(stakeMatch[1]) * multiplier : NaN;
    const stake = Number.isFinite(requestedStake) ? Math.floor(Math.max(10, Math.min(100000000000, requestedStake))) : 100;
    if (p.gems < stake) return socket.emit("error:message", "Not enough demo gems for that stake.");
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room = { code, stake, green: { id: socket.id, userId: p.userId, name: p.name, gems: p.gems, ready: false, colors: [] }, red: null, result: null };
    rooms.set(code, room); p.room = code;
    socket.join(code);
    socket.emit("room:joined", code);
    roomUpdate(room); sendRooms();
  });
  socket.on("room:join", rawCode => {
    const p = requirePlayer(socket); if (!p) return;
    leaveRoom(socket);
    const code = String(rawCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.red || room.result) return socket.emit("error:message", "That room is unavailable. Try refreshing the room list.");
    if (p.gems < room.stake) return socket.emit("error:message", "You don't have enough demo gems for this stake.");
    room.red = { id: socket.id, userId: p.userId, name: p.name, gems: p.gems, ready: false, colors: [] };
    p.room = code; socket.join(code);
    socket.emit("room:joined", code);
    roomUpdate(room); sendRooms();
  });
  socket.on("room:colors", rawColors => {
    const p = requirePlayer(socket); if (!p) return;
    const room = p.room && rooms.get(p.room);
    if (!room || !room.green || room.result) return;
    const allowed = ["red","orange","yellow","green","blue","purple"];
    const colors = Array.isArray(rawColors) ? [...new Set(rawColors.filter(c => allowed.includes(c)))].slice(0, 2) : [];
    const isGreenPlayer = room.green.id === socket.id;
    const isRedPlayer = room.red && room.red.id === socket.id;
    if (!isGreenPlayer && !isRedPlayer) return;
    const opponent = isGreenPlayer ? room.red : room.green;
    if (opponent && colors.some(color => opponent.colors.includes(color))) {
      socket.emit("error:message", "Your opponent already picked one of those colors. Choose different colors.");
      return;
    }
    if (isGreenPlayer) { room.green.colors = colors; room.green.ready = false; }
    else { room.red.colors = colors; room.red.ready = false; }
    if (room.red && room.green.colors.length === 2 && room.red.colors.length === 2) {
      room.green.ready = true;
      room.red.ready = true;
      resolveRound(room);
    }
    roomUpdate(room);
  });
  socket.on("room:ready", () => {
    const p = requirePlayer(socket); if (!p) return;
    const room = p && rooms.get(p.room);
    if (!room || !room.green || !room.red || room.result) return;
    const side = room.green.id === socket.id ? "green" : room.red.id === socket.id ? "red" : null;
    if (!side) return;
    if (room[side].colors.length !== 2) return socket.emit("error:message", "Pick exactly 2 colors before getting ready.");
    room[side].ready = true;
    if (room.green.ready && room.red.ready) resolveRound(room);
    roomUpdate(room);
  });
  socket.on("room:leave", () => { leaveRoom(socket); socket.emit("room:left"); });
  socket.on("rooms:refresh", sendRooms);
  socket.on("disconnect", () => { leaveRoom(socket); players.delete(socket.id); });
});
const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => console.log("PetRoll listening on " + port));
