//                            _
//                         _ooOoo_
//                        o8888888o
//                        88" . "88
//                        (| -_- |)
//                        O\  =  /O
//                     ____/`---'\____
//                   .'  \\|     |//  `.
//                  /  \\|||  :  |||//  \
//                 /  _||||| -:- |||||_  \
//                 |   | \\\  -  /'| |   |
//                 | \_|  `\`---'//  |_/ |
//                 \  .-\__ `-. -'__/-.  /
//               ___`. .'  /--.--\  `. .'___
//            ."" '<  `.___\_<|>_/___.' _> \"".
//           | | :  `- \`. ;`. _/; .'/ /  .' ; |
//           \  \ `-.   \_\_`. _.'_/_/  -' _.' /
// ===========`-.`___`-.__\ \___  /__.-'_.'_.-'================
//                         `=--=-'                            
// hope it not fail


import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import path from "path";
import mysql from "mysql2/promise";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid"; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = process.cwd();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("views", path.resolve("views"));
app.set("view engine", "ejs");
app.use(express.static(path.resolve("public")));


const db = await mysql.createConnection({
    host: "localhost",
    port: 1307,
    user: "user",
    password: "userpass",
    database: "mydb",
});

try {
    console.log("MySQL connected successfully!");
} catch (err) {
    console.error("MySQL connection failed:", err);
}



interface IOTClient extends WebSocket {
    roomId?: string;
}
const IOTClients: Map<string, IOTClient> = new Map();

wss.on("connection", (ws: IOTClient) => {
    console.log("New client connected");

    ws.on("message", async (msg: Buffer) => {
        let data: any;
        try {
            data = JSON.parse(msg.toString());
            console.log("Received:", data);
        } catch (e) {
            console.log("Received non-JSON message:", msg.toString());
            return;
        }

        switch (data.type) {
            case "identification":
                if (data.room) {
                    ws.roomId = data.room;
                    
                    // Only add to the Map if it is the ESP/Hardware (NOT the kiosk)
                    // Assuming your ESP doesn't send a role, or sends 'esp'
                    if (data.role !== 'kiosk') { 
                        IOTClients.set(data.room, ws);
                        console.log(`ESP Client for room ${data.room} registered.`);
                    } else {
                        console.log(`Kiosk connected for room ${data.room} (Not registered as Door Controller).`);
                    }
                }
                break;

            case "rfid":
                if (data.uid && data.room) {
                    try {
                        const [rows]: any[] = await db.execute(
                            `SELECT a.card_uid, a.room_id
                             FROM rfid_access a
                             JOIN rfid_card c ON a.card_uid = c.uid
                             JOIN room r ON a.room_id = r.id
                             WHERE c.uid = ? AND r.id = ?`,
                            [data.uid, data.room]
                        );

                        let status = "DENIED";

                        if (rows.length > 0) {
                            status = "AUTHORIZED";
                            await db.execute(
                                `INSERT INTO opencloselog (room_id, action, card_uid)
                                 VALUES (?, 'OPEN', ?)`,
                                [rows[0].room_id, rows[0].card_uid]
                            );
                        }
                        ws.send(JSON.stringify({ type: "auth", status }));
                        console.log(`[RFID] ${data.uid} → ${status}`);

                    } catch (err) {
                        console.error("Failed to check or log RFID access:", err);
                        ws.send(JSON.stringify({ type: "auth", status: "ERROR" }));
                    }
                }
                break;

            case "qr_scan":
                if (data.qrData && data.room) {
                    try {
                        const [rows]: any[] = await db.execute(
                            `SELECT s.id, s.room_id
                             FROM qr_session s 
                             WHERE s.id = ? AND s.room_id = ?`,
                            [data.qrData, data.room]
                        );

                        if (rows.length > 0) {
                            // console.log(esp);
                            const esp = IOTClients.get(data.room);
                            console.log(IOTClients);
                            if (esp) {
                                esp.send(JSON.stringify({ type: "auth", status: "AUTHORIZED" }));
                                console.log(`[QR] ${data.qrData} → AUTHORIZED for room ${data.room}`);

                                await db.execute(
                                    `INSERT INTO opencloselog (room_id, action, qr_id)
                                     VALUES (?, 'OPEN', ?)`,
                                    [data.room, rows[0].id]
                                );
                            } else {
                                console.warn(`[QR] Auth OK but ESP not found for room ${data.room}`);
                            }
                        } else {
                            console.log(`[QR] ${data.qrData} → DENIED for room ${data.room}`);
                        }
                    } catch (err) {
                        console.error("Error processing QR scan:", err);
                    }
                }
                break;

            default:
                console.log("Unknown message type:", data.type);
        }
    });

    ws.on("close", () => {
        if (ws.roomId) {
            const storedClient = IOTClients.get(ws.roomId);
            
            // Only delete if the disconnected client is the one currently stored
            if (storedClient === ws) {
                IOTClients.delete(ws.roomId);
                console.log(`ESP Client for room ${ws.roomId} disconnected.`);
            } else {
                console.log(`Auxiliary client (Kiosk/UI) for room ${ws.roomId} disconnected.`);
            }
        }
    });
});




app.get("/api/rooms", async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM room");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err });
    }
});

app.post("/api/rooms", async (req, res) => {
    const { id, roomname } = req.body;
    if (!id || !roomname) return res.status(400).send("Missing id or roomname");
    try {
        await db.execute("INSERT INTO room (id, roomname) VALUES (?, ?)", [id, roomname]);
        res.status(201).send("Room created");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/rooms/:id", async (req, res) => {
    
    try {
        await db.execute("DELETE FROM room WHERE id = ?", [req.params.id]);
        res.send("Room deleted");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
app.get("/api/cards", async (req, res) => {
    try {
        const query = `
            SELECT c.uid, c.cardname, GROUP_CONCAT(a.room_id) as access_rooms
            FROM rfid_card c
            LEFT JOIN rfid_access a ON c.uid = a.card_uid
            GROUP BY c.uid
        `;
        const [rows] = await db.execute(query);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err });
    }
});

app.post("/api/cards", async (req, res) => {
    const { uid, cardname } = req.body;
    if (!uid || !cardname) return res.status(400).send("Missing uid or cardname");
    try {
        await db.execute("INSERT INTO rfid_card (uid, cardname) VALUES (?, ?)", [uid, cardname]);
        res.status(201).send("Card created");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


app.post("/api/cards/access", async (req, res) => {
    const { uid, room_id } = req.body;
    try {
        await db.execute("INSERT INTO rfid_access (card_uid, room_id) VALUES (?, ?)", [uid, room_id]);
        res.status(201).send("Access granted");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


app.delete("/api/cards/access", async (req, res) => {
    const { uid, room_id } = req.body;
    try {
        await db.execute("DELETE FROM rfid_access WHERE card_uid = ? AND room_id = ?", [uid, room_id]);
        res.send("Access revoked");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


app.get("/api/sessions", async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM qr_session ORDER BY starttime DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err });
    }
});

app.post("/api/sessions", async (req, res) => {
    const { room_id, duration_minutes } = req.body;
    if (!room_id || !duration_minutes) return res.status(400).send("Missing room_id or duration");

    const id = uuidv4(); 
    
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + duration_minutes * 60000);

    try {
        await db.execute(
            "INSERT INTO qr_session (id, starttime, endtime, room_id) VALUES (?, ?, ?, ?)",
            [id, startTime, endTime, room_id]
        );
        res.status(201).json({ message: "Session created", qr_code: id, valid_until: endTime });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});



app.get("/open-door", async (req: express.Request, res: express.Response) => {
    let { room, source } = req.query;
    if (!room || !source) return res.status(400).send("Missing parameters");

    room = String(room).trim();
    source = String(source).trim();
    const trigger = source.toUpperCase() === "EXTERNAL" ? "EXTERNAL" : "CONSOLE";

    try {
        const ws = IOTClients.get(room);
        if (ws) {
            ws.send("OPEN_DOOR");
            await db.execute(
                `INSERT INTO opencloselog (room_id, action, web_trigger) VALUES (?, 'OPEN', ?)`,
                [room, trigger]
            );
            res.send(`Door opened for room ${room}`);
        } else {
            res.status(404).send(`No active ESP client for room ${room}`);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

app.get("/close-door", async (req: express.Request, res: express.Response) => {
    let { room, source } = req.query;
    if (!room || !source) return res.status(400).send("Missing parameters");

    room = String(room).trim();
    source = String(source).trim();
    const trigger = source.toUpperCase() === "EXTERNAL" ? "EXTERNAL" : "CONSOLE";

    try {
        const ws = IOTClients.get(room);
        if (ws) {
            ws.send("CLOSE_DOOR");
            await db.execute(
                `INSERT INTO opencloselog (room_id, action, web_trigger) VALUES (?, 'CLOSE', ?)`,
                [room, trigger]
            );
            res.send(`Door closed for room ${room}`);
        } else {
            res.status(404).send(`No active ESP client for room ${room}`);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

app.get("/", (req, res) => {
    res.render("index");
});

server.listen(1836, () => {
    console.log("Server running on port 1836");
});