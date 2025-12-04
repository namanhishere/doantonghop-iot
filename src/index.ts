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
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

dotenv.config();

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
app.use(cookieParser());

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
    clientRole?: 'esp' | 'kiosk';
}

// Separate Maps for Hardware (ESP) and UI (Kiosk)
const ESPClients: Map<string, IOTClient> = new Map();
const KioskClients: Map<string, IOTClient> = new Map();


// Helper to send data to the Kiosk UI
const broadcastToKiosk = (roomId: string, data: any) => {
    const kiosk = KioskClients.get(roomId);
    if (kiosk && kiosk.readyState === WebSocket.OPEN) {
        kiosk.send(JSON.stringify(data));
    }
};

wss.on("connection", (ws: IOTClient) => {
    console.log("New client connected");

    ws.on("message", async (msg: Buffer) => {
        let data: any;
        try {
            data = JSON.parse(msg.toString());
        } catch (e) {
            console.log("Received non-JSON message:", msg.toString());
            return;
        }

        switch (data.type) {
            case "identification":
                if (data.room) {
                    ws.roomId = data.room;
                    ws.clientRole = data.role || 'esp';

                    if (ws.clientRole === 'kiosk') {
                        KioskClients.set(data.room, ws);
                        console.log(`Kiosk UI connected for room ${data.room}`);
                    } else {
                        ESPClients.set(data.room, ws);
                        console.log(`ESP Hardware connected for room ${data.room}`);
                    }
                }
                break;

            case "get_session_info":
                if (data.room) {
                    try {
                        // Find the next session that hasn't ended yet
                        const [rows]: any[] = await db.execute(
                            `SELECT * FROM qr_session 
                             WHERE room_id = ? AND endtime > NOW() 
                             ORDER BY starttime ASC LIMIT 1`,
                            [data.room]
                        );

                        let sessionData = null;
                        if (rows.length > 0) {
                            sessionData = {
                                title: "Meeting Session", // You might want to add a 'title' column to your DB
                                organizer: "Booked User", // You might want to add 'organizer' to your DB
                                startTime: new Date(rows[0].starttime).toLocaleTimeString(),
                                endTime: new Date(rows[0].endtime).toLocaleTimeString()
                            };
                        }

                        ws.send(JSON.stringify({
                            type: "session_update",
                            payload: sessionData
                        }));
                    } catch (err) {
                        console.error("Error fetching session:", err);
                    }
                }
                break;

            case "rfid":
                if (data.uid && data.room) {
                    try {
                        const [rows]: any[] = await db.execute(
                            `SELECT a.card_uid, a.room_id, c.cardname
                             FROM rfid_access a
                             JOIN rfid_card c ON a.card_uid = c.uid
                             JOIN room r ON a.room_id = r.id
                             WHERE c.uid = ? AND r.id = ?`,
                            [data.uid, data.room]
                        );

                        let status = "DENIED";
                        let userName = "Unknown";

                        if (rows.length > 0) {
                            status = "AUTHORIZED";
                            userName = rows[0].cardname;

                            await db.execute(
                                `INSERT INTO opencloselog (room_id, action, card_uid)
                                 VALUES (?, 'OPEN', ?)`,
                                [rows[0].room_id, rows[0].card_uid]
                            );
                        }

                        // Reply to ESP (to unlock door)
                        ws.send(JSON.stringify({ type: "auth", status }));
                        
                        // Notify Kiosk (to show popup)
                        broadcastToKiosk(data.room, {
                            type: "access_log",
                            method: "RFID",
                            status: status,
                            name: userName,
                            uid: data.uid
                        });

                        console.log(`[RFID] ${data.uid} → ${status}`);

                    } catch (err) {
                        console.error("RFID Error:", err);
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

                        let status = "DENIED";

                        if (rows.length > 0) {
                            status = "AUTHORIZED";
                            const esp = ESPClients.get(data.room);
                            
                            if (esp) {
                                esp.send(JSON.stringify({ type: "auth", status: "AUTHORIZED" }));
                                
                                await db.execute(
                                    `INSERT INTO opencloselog (room_id, action, qr_id)
                                     VALUES (?, 'OPEN', ?)`,
                                    [data.room, rows[0].id]
                                );
                            }
                        }

                        // Notify Kiosk (Popup)
                        broadcastToKiosk(data.room, {
                            type: "access_log",
                            method: "QR",
                            status: status,
                            qrData: data.qrData
                        });

                        console.log(`[QR] ${data.qrData} → ${status}`);

                    } catch (err) {
                        console.error("QR Error:", err);
                    }
                }
                break;
        }
    });

    ws.on("close", () => {
        if (ws.roomId) {
            if (ws.clientRole === 'kiosk') {
                KioskClients.delete(ws.roomId);
                console.log(`Kiosk disconnected: ${ws.roomId}`);
            } else {
                ESPClients.delete(ws.roomId);
                console.log(`ESP disconnected: ${ws.roomId}`);
            }
        }
    });
});


//mid for auth
const PRIVATE_KEY = process.env.PRIVATE_KEY || "coconut";
const COOKIEAUTH_VALUE = process.env.COOKIEAUTH || "cocomelon";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "adminpass";
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = req.headers["x-private-key"] || req.query.key;
    const authCookie = req.cookies?.access_key;

    if (apiKey === PRIVATE_KEY) {
        req.source = "EXTERNAL";
        return next();
    } 
    
    if (authCookie === COOKIEAUTH_VALUE) {
        req.source = "CONSOLE";
        return next();
    }

    console.log(`Blocked unauthorized request from ${req.ip} to ${req.originalUrl}`);
    return res.status(403).json({ error: "Forbidden: Authentication required" });
    
};

// Login Page UI
app.get("/login", (req, res) => {
    const authCookie = req.cookies?.access_key;
    if (authCookie === COOKIEAUTH_VALUE) {
        return res.redirect("/");
    }
    res.render("login"); // Make sure you have a login.ejs view
});

// Process Login
app.post("/login", (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.cookie("access_key", COOKIEAUTH_VALUE, { 
            httpOnly: true, 
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });
        return res.redirect("/");
    }
    
    return res.status(401).json({ error: "Invalid Password" });
});

app.get("/logout", (req, res) => {
    res.clearCookie("access_key");
    res.redirect("/login");
});

app.get("/", requireAuth, (req, res) => { 
    res.render("index");
});

app.get("/api/rooms", requireAuth , async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM room");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err });
    }
});

app.post("/api/rooms", requireAuth , async (req, res) => {
    const { id, roomname } = req.body;
    if (!id || !roomname) return res.status(400).send("Missing id or roomname");
    try {
        await db.execute("INSERT INTO room (id, roomname) VALUES (?, ?)", [id, roomname]);
        res.status(201).send("Room created");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/rooms/:id", requireAuth , async (req, res) => {
    
    try {
        await db.execute("DELETE FROM room WHERE id = ?", [req.params.id]);
        res.send("Room deleted");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
app.get("/api/cards", requireAuth , async (req, res) => {
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

app.post("/api/cards", requireAuth , async (req, res) => {
    const { uid, cardname } = req.body;
    if (!uid || !cardname) return res.status(400).send("Missing uid or cardname");
    try {
        await db.execute("INSERT INTO rfid_card (uid, cardname) VALUES (?, ?)", [uid, cardname]);
        res.status(201).send("Card created");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


app.post("/api/cards/access", requireAuth , async (req, res) => {
    const { uid, room_id } = req.body;
    try {
        await db.execute("INSERT INTO rfid_access (card_uid, room_id) VALUES (?, ?)", [uid, room_id]);
        res.status(201).send("Access granted");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


app.delete("/api/cards/:uid", requireAuth , async (req, res) => {
    try {
        await db.execute("UPDATE opencloselog SET card_uid = NULL WHERE card_uid = ?", [req.params.uid]);
        await db.execute("DELETE FROM rfid_access WHERE card_uid = ?", [req.params.uid]);
        await db.execute("DELETE FROM rfid_card WHERE uid = ?", [req.params.uid]);
        
        res.send("Card deleted");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/cards/access", requireAuth , async (req, res) => {
    const { uid, room_id } = req.body;
    try {
        await db.execute("DELETE FROM rfid_access WHERE card_uid = ? AND room_id = ?", [uid, room_id]);
        res.send("Access revoked");
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


app.get("/api/sessions", requireAuth , async (req, res) => {
    try {
        const [rows] = await db.execute("SELECT * FROM qr_session ORDER BY starttime DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err });
    }
});

app.post("/api/sessions", requireAuth , async (req, res) => {
    const { room_id, duration_minutes, startTime } = req.body;
    if (!room_id || !duration_minutes) return res.status(400).send("Missing room_id or duration");

    const id = uuidv4(); 
    let startTimeInput = new Date();
    if (startTime) startTimeInput = new Date(startTime);

    console.log("Start Time Input:", startTimeInput);

    const endTime = new Date(startTimeInput.getTime() + duration_minutes * 60000);

    try {
        await db.execute(
            "INSERT INTO qr_session (id, starttime, endtime, room_id) VALUES (?, ?, ?, ?)",
            [id, startTimeInput, endTime, room_id]
        );
        res.status(201).json({ message: "Session created", qr_code: id, valid_until: endTime });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});



app.get("/open-door", requireAuth , async (req: express.Request, res: express.Response) => {
    let { room } = req.query;
    if (!room) return res.status(400).send({
        error: "Missing room"
    });
    room = String(room).trim();
    const trigger = req.source || "CONSOLE";

    try {
        const ws = ESPClients.get(room);
        if (ws) {
            ws.send("OPEN_DOOR");
            await db.execute(
                `INSERT INTO opencloselog (room_id, action, web_trigger) VALUES (?, 'OPEN', ?)`,
                [room, trigger]
            );
            
            // Notify Kiosk
            broadcastToKiosk(room, {
                type: "door_status",
                action: "OPEN",
                source: trigger
            });

            res.send({ message: `Door opened for room ${room}` });
        } else {
            res.status(404).send({ error: `ESP not connected for room ${room}` });
        }
    } catch (err) {
        res.status(500).send({ error: "Internal Server Error" });
    }
});

// app.get("/close-door", requireAuth , async (req: express.Request, res: express.Response) => {
//     let { room, source } = req.query;
//     if (!room) return res.status(400).send("Missing room");
//     room = String(room).trim();
//     const trigger = String(source || "CONSOLE").toUpperCase();

//     try {
//         const ws = ESPClients.get(room);
//         if (ws) {
//             ws.send("CLOSE_DOOR");
//             await db.execute(
//                 `INSERT INTO opencloselog (room_id, action, web_trigger) VALUES (?, 'CLOSE', ?)`,
//                 [room, trigger]
//             );

//             // Notify Kiosk
//             broadcastToKiosk(room, {
//                 type: "door_status",
//                 action: "CLOSE",
//                 source: trigger
//             });

//             res.send(`Door closed for room ${room}`);
//         } else {
//             res.status(404).send(`ESP not connected for room ${room}`);
//         }
//     } catch (err) {
//         res.status(500).send("Error");
//     }
// });

app.get("/", (req, res) => {
    res.render("index");
});

server.listen(1836, () => {
    console.log("Server running on port 1836");
});