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

import mysql from "mysql2/promise";

const db = await mysql.createConnection({
  host: "localhost",
  port: 1307,
  user: "user",
  password: "userpass",
  database: "mydb",
});

try {
  await db.connect();
  console.log("MySQL connected successfully!");


} catch (err) {
  console.error("MySQL connection failed:", err);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));

// const allowedUIDs = new Set(["C1A3B506-101", "C1AB3506-101"]);

const espClients = new Map();

wss.on("connection", (ws) => {
    console.log("New client connected");

    ws.on("message",  async (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
            console.log("Received:", data);
        } catch (e) {
            console.log("Received non-JSON message:", msg.toString());
            return;
        }

        
        switch (data.type) {

            // // No longer this that
            case "identification":
                if (data.room) {
                    ws.roomId = data.room; 
                    espClients.set(data.room, ws); 
                    console.log(`Client for room ${data.room} registered.`);
                }
                break;

                case "rfid":
                    if (data.uid && data.room) {
                        try {
                            // Kiểm tra xem thẻ có quyền mở phòng hay không
                            const [rows] = await db.execute(
                                `SELECT a.card_uid, a.room_id
                                 FROM rfid_access a
                                 JOIN rfid_card c ON a.card_uid = c.uid
                                 JOIN room r ON a.room_id = r.id
                                 WHERE c.uid = ? AND r.id = ?`,
                                [data.uid, data.room]
                            );
                
                            let status = "DENIED";
                
                            console.log("RFID check:", rows, [data.uid, data.room]);
                
                            if (rows.length > 0) {
                                status = "AUTHORIZED";
                
                                // Ghi log mở cửa thành công
                                await db.execute(
                                    `INSERT INTO opencloselog (room_id, action, card_uid)
                                     VALUES (?, 'OPEN', ?)`,
                                    [rows[0].room_id, rows[0].card_uid]
                                );
                            }
                
                            // Gửi phản hồi lại ESP / Client
                            ws.send(JSON.stringify({ type: "auth", status }));
                            console.log(`[RFID] ${data.uid} → ${status}`);
                
                        } catch (err) {
                            console.error("Failed to check or log RFID access:", err);
                            ws.send(JSON.stringify({ type: "auth", status: "ERROR" }));
                        }
                    } else {
                        console.warn("Invalid RFID data received:", data);
                    }
                    break;


            default:
                console.log("Unknown message type:", data.type);
        }
    });

    ws.on("close", () => {
        
        if (ws.roomId) {
            espClients.delete(ws.roomId); 
            console.log(`Client for room ${ws.roomId} disconnected and unregistered.`);
        } else {
            console.log("Client disconnected (was never identified).");
        }
    });
});


app.get("/", (req, res) => {
    res.render("index");
});


app.get("/open-door", async (req, res) => {
    // https://doantonghopiot.namanhishere.com/open-door?room=101&source=CONSOLE
    const { room, source } = req.query;

    if (!room) {
        return res.status(400).send("Missing 'room' query parameter");
    }

    const trigger = source && source.toUpperCase() === "EXTERNAL" ? "EXTERNAL" : "CONSOLE";

    try {
        // Tìm client ESP tương ứng
        const ws = espClients.get(room);

        if (ws) {
            ws.send("OPEN_DOOR");
            console.log(`Sent OPEN_DOOR to room ${room} via ${trigger}`);

            // Ghi log mở cửa
            await db.execute(
                `INSERT INTO opencloselog (room_id, action, web_trigger)
                 VALUES (?, 'OPEN', ?)`,
                [room, trigger]
            );

            res.send(`Door opened for room ${room} (triggered by ${trigger})`);
        } else {
            res.status(404).send(`No active ESP client found for room ${room}`);
        }
    } catch (err) {
        console.error("Failed to open door:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/close-door", async (req, res) => {
    // https://doantonghopiot.namanhishere.com/close-door?room=101&source=EXTERNAL
    const { room, source } = req.query;

    if (!room) {
        return res.status(400).send("Missing 'room' query parameter");
    }

    const trigger = source && source.toUpperCase() === "EXTERNAL" ? "EXTERNAL" : "CONSOLE";

    try {
        const ws = espClients.get(room);

        if (ws) {
            ws.send("CLOSE_DOOR");
            console.log(`Sent CLOSE_DOOR to room ${room} via ${trigger}`);

            // Ghi log đóng cửa
            await db.execute(
                `INSERT INTO opencloselog (room_id, action, web_trigger)
                 VALUES (?, 'CLOSE', ?)`,
                [room, trigger]
            );

            res.send(`Door closed for room ${room} (triggered by ${trigger})`);
        } else {
            res.status(404).send(`No active ESP client found for room ${room}`);
        }
    } catch (err) {
        console.error("Failed to close door:", err);
        res.status(500).send("Internal Server Error");
    }
});



server.listen(1836, () => {
    console.log("Server running on port 1836");
});