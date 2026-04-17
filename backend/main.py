import cv2
import base64
import asyncio
import json
from collections import deque
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from cv_modules.pose_analyzer import PoseAnalyzer

app = FastAPI()

# Allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize your BlazePose analyzer
analyzer_room1 = PoseAnalyzer()  # For Laptop Cam
analyzer_room2 = PoseAnalyzer()  # For Phone Cam
# Create ring buffers that hold exactly 3 frames
buffer_room1 = deque(maxlen=3)
buffer_room2 = deque(maxlen=3)
# GPU Fall Detection Flag (Keep False for now)
USE_GPU_FALL_DETECTION = False
if USE_GPU_FALL_DETECTION:
    # from cv_modules.fall_detector import FallDetector
    # fall_detector = FallDetector('models/fall_detection.pkl')
    pass

async def process_and_stream(websocket: WebSocket):
    # Camera 1: Laptop Webcam (Room 104)
    cap_main = cv2.VideoCapture(0)
    cap_main.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap_main.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    print("Main camera initialized!!.")
    # Camera 2: Mobile Phone IP Camera (Room 105)
    # ⚠️ REPLACE WITH YOUR PHONE'S ACTUAL IP URL
    PHONE_IP_URL = "http://192.168.100.83:8080/video" 
    cap_sec = cv2.VideoCapture(PHONE_IP_URL)
    
    try:
        while True:
            ret_main, frame_main = cap_main.read()
            ret_sec, frame_sec = cap_sec.read()

            if not ret_main: break

            all_alerts = []
            status_main = "Normal"

            # --------------------------------------------------
            # PROCESS ROOM 1 (Laptop Camera)
            # --------------------------------------------------
            annotated_main, status_main, alerts_main = analyzer_room1.process_frame(frame_main)
            
            # Encode frame FIRST so we can put it in the buffer
            _, img_encoded_main = cv2.imencode('.jpg', annotated_main, [cv2.IMWRITE_JPEG_QUALITY, 60])
            main_b64 = base64.b64encode(img_encoded_main).decode('utf-8')
            
            # Add the current frame to the rolling memory
            buffer_room1.append(f"data:image/jpeg;base64,{main_b64}")

            for alert in alerts_main:
                alert["patient"] = "Ahmad Khan"
                alert["room"] = "104"
                # Attach a copy of the last 3 frames to the alert
                alert["snapshots"] = list(buffer_room1) 
            all_alerts.extend(alerts_main)

            # --------------------------------------------------
            # PROCESS ROOM 2 (Phone Camera)
            # --------------------------------------------------
            sec_b64 = None
            if ret_sec:
                # Resize to keep performance stable
                frame_sec_resized = cv2.resize(frame_sec, (640, 480))
                
                # Run the exact same AI logic on Patient B
                annotated_sec, status_sec, alerts_sec = analyzer_room2.process_frame(frame_sec_resized)
                
                # Tag these alerts for Patient B
                for alert in alerts_sec:
                    alert["patient"] = "Patient B"
                    alert["room"] = "105"
                all_alerts.extend(alerts_sec)

                # Encode Secondary Camera
                _, buffer_sec = cv2.imencode('.jpg', annotated_sec, [cv2.IMWRITE_JPEG_QUALITY, 70])
                sec_b64 = base64.b64encode(buffer_sec).decode('utf-8')

            # --------------------------------------------------
            # WEBSOCKET PAYLOAD
            # --------------------------------------------------
            payload = {
                "frame": f"data:image/jpeg;base64,{main_b64}",
                "frame_sec": f"data:image/jpeg;base64,{sec_b64}" if sec_b64 else None,
                "status": status_main, # You can update UI logic to track both statuses if needed
                "alerts": all_alerts
            }

            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(0.03) 

    except WebSocketDisconnect:
        print("Dashboard disconnected.")
    finally:
        cap_main.release()
        cap_sec.release()

@app.websocket("/ws/video-stream")
async def video_stream_endpoint(websocket: WebSocket):
    await websocket.accept()
    await process_and_stream(websocket)
    

if __name__ == "__main__":
    import uvicorn
    # Run the server on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)