import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });


app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));


app.use(express.static(path.join(__dirname, "public")));


const allowedUIDs = new Set(["C1A3B506-101", "C1AB3506-101"]);

wss.on("connection", (ws) => {
  console.log("New client connected");

  ws.on("message", (msg) => {
      const data = JSON.parse(msg);
      console.log(data)
      if (data.type === "rfid") {
        if (allowedUIDs.has(data.uid+"-"+data.room)) {
          ws.send(JSON.stringify({ type: "auth", status: "AUTHORIZED" }));
        } else {
          ws.send(JSON.stringify({ type: "auth", status: "DENIED" }));
        }
      }

  });

  ws.on("close", () => console.log("Client disconnected"));
});

// ==== ROUTES ====
app.get("/", (req, res) => {
  res.render("index");
});

// ==== SERVER START ====
server.listen(1836, () => {
  console.log("Server running on port 1836");
});
