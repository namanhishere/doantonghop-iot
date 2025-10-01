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


const espClients = new Map();

wss.on("connection", (ws) => {
    console.log("New client connected");

    ws.on("message", (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
            console.log("Received:", data);
        } catch (e) {
            console.log("Received non-JSON message:", msg.toString());
            return;
        }

        
        switch (data.type) {

            
            case "identification":
                if (data.room) {
                    ws.roomId = data.room; 
                    espClients.set(data.room, ws); 
                    console.log(`Client for room ${data.room} registered.`);
                }
                break;

            
            case "rfid":
                if (data.uid && data.room) {
                    if (allowedUIDs.has(data.uid + "-" + data.room)) {
                        ws.send(JSON.stringify({ type: "auth", status: "AUTHORIZED" }));
                    } else {
                        ws.send(JSON.stringify({ type: "auth", status: "DENIED" }));
                    }
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


app.get("/open-door", (req, res) => {
    // https://doantonghopiot.namanhishere.com/open-door?room=101
    const { room } = req.query; 

    if (!room) {
        return res.status(400).send("Missing 'room' query parameter");
    }

    const ws = espClients.get(room); 

    if (ws) {
        ws.send("OPEN_DOOR"); 
        console.log(`Sent OPEN_DOOR command to room ${room}`);
        res.send(`'OPEN_DOOR' command sent to room ${room}`);
    } else {
        res.status(404).send(`No active client found for room ${room}`);
    }
});


app.get("/close-door", (req, res) => {
    // https://doantonghopiot.namanhishere.com/close-door?room=101
    const { room } = req.query;

    if (!room) {
        return res.status(400).send("Missing 'room' query parameter");
    }

    const ws = espClients.get(room);

    if (ws) {
        ws.send("CLOSE_DOOR");
        console.log(`Sent CLOSE_DOOR command to room ${room}`);
        res.send(`'CLOSE_DOOR' command sent to room ${room}`);
    } else {
        res.status(404).send(`No active client found for room ${room}`);
    }
});



server.listen(1836, () => {
    console.log("Server running on port 1836");
});