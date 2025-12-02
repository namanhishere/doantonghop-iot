
import cv2
import json
import time
import websocket 
from pyzbar.pyzbar import decode
from flask import Flask, Response, render_template 
import threading
import queue

# WS_URL = "wss://doantonghopiot.namanhishere.com/ws"
WS_URL = "ws://localhost:1836/ws" 
ROOM_ID = "101" 
FLASK_PORT = 5000 


qr_queue = queue.Queue(maxsize=5) 


def websocket_thread_func():
    ws = None
    last_qr_data = None
    last_scan_time = 0

    def connect():
        print(f"[Thread WS] Đang cố gắng kết nối tới {WS_URL}...")
        try:
            ws_conn = websocket.create_connection(WS_URL) 
            print(f"[Thread WS] Đã kết nối WebSocket thành công!")
            return ws_conn
        except Exception as e:
            print(f"[Thread WS] Kết nối WebSocket thất bại: {e}")
            return None

    while True:
        try:
            if ws is None:
                ws = connect()
                if ws is None:
                    time.sleep(5) 
                    continue 

            qr_data = qr_queue.get() 

            current_time = time.time()
            if qr_data == last_qr_data and (current_time - last_scan_time) < 5:
                continue
            
            print(f"[Thread WS] Phát hiện QR: {qr_data}")
            last_qr_data = qr_data
            last_scan_time = current_time

            payload = {
                "type": "qr_scan",
                "qrData": qr_data,
                "room": ROOM_ID
            }
            ws.send(json.dumps(payload))
            print(f"[Thread WS] Đã gửi payload: {json.dumps(payload)}")

        except websocket.WebSocketConnectionClosedException as e:
            print(f"[Thread WS] Mất kết nối WebSocket: {e}. Đang thử kết nối lại...")
            ws = None 
        except Exception as e:
            print(f"[Thread WS] Lỗi: {e}")
            if ws:
                ws.close()
            ws = None
            time.sleep(5)

app = Flask(__name__)

try:
    camera = cv2.VideoCapture(0)
    if not camera.isOpened():
        raise IOError("Không thể mở camera.")
    print("[Thread Chính] Đã khởi động camera thành công.")
except Exception as e:
    print(f"[Thread Chính] Lỗi camera nghiêm trọng: {e}")
    exit()


def generate_frames():
    print("[Thread Chính] Bắt đầu luồng video...")
    while True:
        success, frame = camera.read()
        if not success:
            break
        else:
            detected_qrs = decode(frame)
            for qr in detected_qrs:
                qr_data = qr.data.decode('utf-8')
                if not qr_queue.full():
                    qr_queue.put_nowait(qr_data) 
                
                (x, y, w, h) = qr.rect
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 3)
                # cv2.putText(frame, qr_data, (x, y - 10), 
                #             cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

            ret, buffer = cv2.imencode('.jpg', frame)
            if not ret:
                continue
            
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
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')




if __name__ == '__main__':
    print("[Hệ thống] Khởi động thread WebSocket (chạy ngầm)...")
    ws_thread = threading.Thread(target=websocket_thread_func, daemon=True)
    ws_thread.start()
    
    print(f"[Hệ thống] Khởi động Flask server (chính) trên http://0.0.0.0:{FLASK_PORT}")
    print(f"[Hệ thống] Truy cập Kiosk tại: http://localhost:{FLASK_PORT}")
    app.run(host='0.0.0.0', port=FLASK_PORT, debug=False, threaded=True)