const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const rooms = new Map();
const players = new Map();
const startingGems = 1000;
const makeCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();

function publicRoom(room) {
  return {
    code: room.code, stake: room.stake,
    green: room.green ? room.green.name : null,
    red: room.red ? room.red.name : null,
    status: room.result ? "finished" : (room.green && room.red ? "ready" : "open")
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
io.on("connection", socket => {
  players.set(socket.id, { name: "Player", gems: startingGems, room: null });
  socket.emit("balance", startingGems);
  socket.emit("rooms:list", [...rooms.values()].filter(r => !r.red && !r.result).map(publicRoom));
  socket.on("player:name", name => {
    const p = players.get(socket.id);
    if (p) p.name = String(name || "Player").trim().slice(0, 18) || "Player";
  });
  socket.on("room:create", stakeValue => {
    leaveRoom(socket);
    const p = players.get(socket.id);
    if (!p) return;
    const stake = Math.max(10, Math.min(200, Number(stakeValue) || 100));
    if (p.gems < stake) return socket.emit("error:message", "Not enough demo gems for that stake.");
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room = { code, stake, green: { id: socket.id, name: p.name, gems: p.gems, ready: false }, red: null, result: null };
    rooms.set(code, room); p.room = code;
    socket.join(code);
    socket.emit("room:joined", code);
    roomUpdate(room); sendRooms();
  });
  socket.on("room:join", rawCode => {
    leaveRoom(socket);
    const p = players.get(socket.id);
    const code = String(rawCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!p || !room || room.red || room.result) return socket.emit("error:message", "That room is unavailable. Try refreshing the room list.");
    if (p.gems < room.stake) return socket.emit("error:message", "You don't have enough demo gems for this stake.");
    room.red = { id: socket.id, name: p.name, gems: p.gems, ready: false };
    p.room = code; socket.join(code);
    socket.emit("room:joined", code);
    roomUpdate(room); sendRooms();
  });
  socket.on("room:ready", () => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.green || !room.red || room.result) return;
    if (room.green.id === socket.id) room.green.ready = true;
    if (room.red.id === socket.id) room.red.ready = true;
    if (room.green.ready && room.red.ready) {
      const roll = Math.random() < 0.5 ? "green" : "red";
      const winner = room[roll];
      const loser = room[roll === "green" ? "red" : "green"];
      winner.gems += room.stake;
      loser.gems -= room.stake;
      const winnerPlayer = players.get(winner.id);
      const loserPlayer = players.get(loser.id);
      if (winnerPlayer) winnerPlayer.gems = winner.gems;
      if (loserPlayer) loserPlayer.gems = loser.gems;
      room.result = { winner: roll, winnerName: winner.name, roll: roll === "green" ? "🟢 Green" : "🔴 Red", pot: room.stake * 2 };
      if (winnerPlayer) io.to(winner.id).emit("balance", winnerPlayer.gems);
      if (loserPlayer) io.to(loser.id).emit("balance", loserPlayer.gems);
    }
    roomUpdate(room);
  });
  socket.on("room:leave", () => { leaveRoom(socket); socket.emit("room:left"); });
  socket.on("rooms:refresh", sendRooms);
  socket.on("disconnect", () => { leaveRoom(socket); players.delete(socket.id); });
});
const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => console.log("PetRoll listening on " + port));