import websocket
import json
import threading
import time
import sys

class EspSimulator:
    def __init__(self, url, room_id):
        self.url = url
        self.room_id = room_id
        self.ws = None
        self.connected = False

    def on_message(self, ws, message):
        print(f"\n\033[96m[SERVER]\033[0m {message}")
        if '"AUTHORIZED"' in message:
            print("\033[92m>>> RELAY ON (Access Granted)\033[0m")
        elif '"DENIED"' in message:
            print("\033[91m>>> RELAY OFF (Access Denied)\033[0m")
        elif "OPEN_DOOR" in message:
            print("\033[94m>>> REMOTE OPEN\033[0m")
        elif "CLOSE_DOOR" in message:
            print("\033[93m>>> REMOTE CLOSE\033[0m")

    def on_error(self, ws, error):
        print(f"\033[91m[ERROR]\033[0m {error}")

    def on_close(self, ws, close_status_code, close_msg):
        self.connected = False
        print("\033[93m[DISCONNECTED]\033[0m Connection closed")

    def on_open(self, ws):
        self.connected = True
        print(f"\033[92m[CONNECTED]\033[0m Connected to {self.url}")
        identify_msg = json.dumps({"type": "identification", "room": self.room_id})
        ws.send(identify_msg)
        print(f"[SENT] {identify_msg}")

    def send_rfid(self, uid):
        if not self.connected:
            print("Not connected to server!")
            return
        payload = json.dumps({
            "type": "rfid",
            "room": self.room_id,
            "uid": uid.upper()
        })
        self.ws.send(payload)
        print(f"[SENT] {payload}")

    def run(self):
        self.ws = websocket.WebSocketApp(self.url,on_open=self.on_open,on_message=self.on_message,on_error=self.on_error,on_close=self.on_close)
        self.ws.run_forever(ping_interval=15)

if __name__ == "__main__":
    URL = "ws://localhost:1836/ws"
    ROOM = "101"

    sim = EspSimulator(URL, ROOM)
    
    
    t = threading.Thread(target=sim.run)
    t.daemon = True
    t.start()

    print(f"--- ESP8266 SIMULATOR (Room: {ROOM}) ---")
    print("Nhập UID thẻ để gửi (Ví dụ: 3A4B5C6D)")
    print("Gõ 'exit' để thoát.")
    
    time.sleep(1) 

    try:
        while True:
            user_input = input("\n👉 Nhập UID: ").strip()
            if user_input.lower() == "exit":
                break
            if user_input:
                sim.send_rfid(user_input)
    except KeyboardInterrupt:
        print("\nExiting...")