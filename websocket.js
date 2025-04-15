const setupWebsocket = (app, server) => {
  const RaidBoss = require("./Models/raid.js");
  const WebSocket = require("ws");
  const url = require("url");

  const wss = new WebSocket.Server({ server });
  const WEBHOOK_SECRET = "hamsterHub";

  const raidBoss = new RaidBoss();

  // WebSocket client groups
  let notifyClients = new Set();
  let raidClients = new Map(); // ws => playerId

  function broadcast(clients, payload) {
    const message = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  wss.on("connection", (ws, req) => {
    const { query } = url.parse(req.url, true);
    const { secret, event, playerId } = query;

    if (secret !== WEBHOOK_SECRET) {
      ws.close(1008, "Unauthorized");
      return;
    }

    console.log(`New connection: ${event || "unknown"}`);

    if (event === "raid" && playerId) {
      if (raidBoss.active) {
        raidClients.set(ws, playerId);
        ws.send(
          JSON.stringify({
            e: "RS",
            b: raidBoss.bossPrefabName,
            mH: raidBoss.maxHealth,
            h: raidBoss.health,
          }),
        );
      } else ws.close();
    } else if (event === "notify") {
      notifyClients.add(ws);
      if (raidBoss.active) {
        ws.send(
          JSON.stringify({
            e: "RS",
            b: raidBoss.bossPrefabName,
            mH: raidBoss.maxHealth,
            h: raidBoss.health,
          }),
        );
      }
    } else {
      ws.close();
      return;
    }

    ws.on("message", (message) => {
      let data;
      try {
        data = JSON.parse(message);
      } catch (err) {
        console.error("Invalid message:", message);
        return;
      }

      const { u: userId, s: signal, d: damage } = data;
      if (!raidBoss.active || !userId || !signal) return;

      switch (signal) {
        case "TD":
          if (typeof damage !== "number" || damage <= 0) return;

          const updated = raidBoss.takeDamage(userId, damage);
          console.log(
            `${userId} dealt ${damage} damage. Boss HP: ${raidBoss.health}`,
          );

          if (updated) {
            broadcast(raidClients.keys(), { e: "UBH", h: raidBoss.health });
          }

          if (raidBoss.health <= 0) {
            console.log(`Raid Ended. Players: ${raidBoss.playerJoins.size}`);
            raidBoss.deactivate();
            broadcast(raidClients.keys(), { e: "RE", w: true });
          }
          break;
      }
    });

    ws.on("close", () => {
      notifyClients.delete(ws);
      raidClients.delete(ws);
    });
  });

  // API Routes
  app.post("/notify/start-raid", (req, res) => {
    const { bossPrefabName, maxHealth } = req.body;
    if (!bossPrefabName || !maxHealth) {
      return res.status(400).json({ error: "Missing data" });
    }

    raidBoss.activate(bossPrefabName, maxHealth);
    console.log(`Raid started: ${bossPrefabName} (${maxHealth})`);

    broadcast(notifyClients, { e: "RS", b: bossPrefabName, mH: maxHealth });
    return res.json({ success: true });
  });

  app.post("/notify/stop-raid", (req, res) => {
    raidBoss.deactivate();
    broadcast(notifyClients, { e: "RE", w: false });
    broadcast(raidClients.keys(), { e: "RE", w: false });
    return res.json({ success: true });
  });

  app.post("/notify/broadcast", (req, res) => {
    const { message, color } = req.body;
    if (!message) return res.status(400).json({ error: "Missing message" });

    broadcast(notifyClients, { e: "N", m: message, c: color });
    return res.json({ sent: true });
  });

  app.get("/notify/raid-status", (req, res) => {
    return res.json({ raidBoss });
  });
};

module.exports = setupWebsocket;
