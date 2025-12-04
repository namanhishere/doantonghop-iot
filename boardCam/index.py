import cv2
import json
import time
import websocket 
from pyzbar.pyzbar import decode
from flask import Flask, Response, render_template 
from flask_sock import Sock 
import threading
import queue


REMOTE_WS_URL = "wss://doantonghopiot.namanhishere.com/ws"
ROOM_ID = "101" 
FLASK_PORT = 5000 


qr_queue = queue.Queue(maxsize=5) 
local_clients = [] 
remote_ws = None   

app = Flask(__name__)
sock = Sock(app)   


@sock.route('/local-ws')
def local_ws(ws):
    """
    Handles connection from dashboard.html and scanner.html
    """
    print("[Local WS] UI Connected")
    local_clients.append(ws)
    try:
        while True:
            
            
            data = ws.receive() 
    except Exception as e:
        print(f"[Local WS] UI Disconnected: {e}")
    finally:
        if ws in local_clients:
            local_clients.remove(ws)

def broadcast_to_ui(message_dict):
    """Sends JSON data to all connected local HTML pages"""
    json_msg = json.dumps(message_dict)
    dead_clients = []
    for client in local_clients:
        try:
            client.send(json_msg)
        except:
            dead_clients.append(client)
    
    for c in dead_clients:
        if c in local_clients:
            local_clients.remove(c)


def remote_websocket_thread():
    global remote_ws
    last_qr_data = None
    last_scan_time = 0

    while True:
        try:
            print(f"[Remote WS] Connecting to {REMOTE_WS_URL}...")
            remote_ws = websocket.create_connection(REMOTE_WS_URL)
            print("[Remote WS] Connected!")

            
            ident_payload = {
                "type": "identification", 
                "role": "kiosk", 
                "room": ROOM_ID
            }
            remote_ws.send(json.dumps(ident_payload))
            
            
            remote_ws.send(json.dumps({"type": "get_session_info", "room": ROOM_ID}))

            remote_ws.settimeout(0.1) 

            while True:
                
                try:
                    message = remote_ws.recv()
                    if message:
                        print(f"[Remote WS] Received: {message}")
                        
                        try:
                            data = json.loads(message)
                            broadcast_to_ui(data)
                        except:
                            pass
                except websocket.WebSocketTimeoutException:
                    pass 
                except Exception as e:
                    raise e 

                
                if not qr_queue.empty():
                    qr_data = qr_queue.get()
                    
                    
                    current_time = time.time()
                    if qr_data == last_qr_data and (current_time - last_scan_time) < 5:
                        continue
                    
                    last_qr_data = qr_data
                    last_scan_time = current_time

                    payload = {
                        "type": "qr_scan",
                        "qrData": qr_data,
                        "room": ROOM_ID
                    }
                    remote_ws.send(json.dumps(payload))
                    print(f"[Remote WS] Sent QR: {qr_data}")

        except Exception as e:
            print(f"[Remote WS] Connection Error: {e}. Retrying in 5s...")
            if remote_ws:
                try:
                    remote_ws.close()
                except:
                    pass
            remote_ws = None
            time.sleep(5)


try:
    camera = cv2.VideoCapture(0)
    if not camera.isOpened():
        raise IOError("Cannot open webcam")
except Exception as e:
    print(f"Camera Error: {e}")
    exit()

def generate_frames():
    while True:
        success, frame = camera.read()
        if not success:
            break
        
        detected_qrs = decode(frame)
        for qr in detected_qrs:
            qr_data = qr.data.decode('utf-8')
            
            
            (x, y, w, h) = qr.rect
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 3)

            
            if not qr_queue.full():
                qr_queue.put(qr_data)

        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.03)


@app.route('/')
def dashboard():
    return render_template('dashboard.html')

@app.route('/scanner')
def scanner():
    return render_template('scanner.html')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

if __name__ == '__main__':
    ws_thread = threading.Thread(target=remote_websocket_thread, daemon=True)
    ws_thread.start()
    app.run(host='0.0.0.0', port=FLASK_PORT, debug=False, threaded=True)