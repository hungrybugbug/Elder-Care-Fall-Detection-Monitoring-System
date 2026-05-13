import cv2
import base64
import asyncio
import json
from collections import deque
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from cv_modules.pose_analyzer import PoseAnalyzer
import httpx
import random
from contextlib import asynccontextmanager

ESP32_IP_URL = "http://192.168.1.150/data" 

# Global state to hold the telemetry
iot_telemetry = {
    "104": {"body_temp": 37.0, "spo2": 98.0},
    "105": {"body_temp": 36.8, "spo2": 96.0} 
}

async def fetch_iot_data():
    global iot_telemetry
    print("📡 Medical Wearable Service: Attempting hardware connection...")
    
    async with httpx.AsyncClient(timeout=2.0) as client:
        while True:
            try:
                # 1. TRY THE REAL ESP32 WEARABLE
                response = await client.get(ESP32_IP_URL)
                if response.status_code == 200:
                    real_data = response.json()
                    iot_telemetry["104"]["body_temp"] = real_data.get("body_temp", 37.0)
                    iot_telemetry["104"]["spo2"] = real_data.get("spo2", 98.0)
                    
            except (httpx.ConnectError, httpx.TimeoutException):
                # 2. HARDWARE FAILED -> SIMULATE HUMAN VITALS
                print("⚠️  Medical Wearable Service: Hardware connection failed. Simulating data...")
                current_temp = iot_telemetry["104"]["body_temp"]
                current_spo2 = iot_telemetry["104"]["spo2"]
                
                # Vitals shift very slowly. Temp shifts by 0.1, SpO2 shifts by 1
                iot_telemetry["104"]["body_temp"] = round(current_temp + random.uniform(-0.1, 0.1), 1)
                
                # Keep SpO2 realistic (Oxygen doesn't go over 100%)
                new_spo2 = current_spo2 + random.uniform(-1.0, 1.0)
                iot_telemetry["104"]["spo2"] = round(min(100.0, max(85.0, new_spo2)), 1)
                
            await asyncio.sleep(3)

# 3. Tell FastAPI to run this task in the background when the server starts
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the IoT polling loop
    iot_task = asyncio.create_task(fetch_iot_data())
    yield
    # Clean up when shutting down
    iot_task.cancel()

# Make sure your FastAPI app initialization looks like this now:
app = FastAPI(lifespan=lifespan)
# app = FastAPI()

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
# Toggle the secondary phone camera here:
ENABLE_SECOND_CAMERA = False
analyzer_room2 = PoseAnalyzer() if ENABLE_SECOND_CAMERA else None  # For Phone Cam
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

    cap_sec = None
    if ENABLE_SECOND_CAMERA:
        # Camera 2: Mobile Phone IP Camera (Room 105)
        # ⚠️ REPLACE WITH YOUR PHONE'S ACTUAL IP URL
        PHONE_IP_URL = "http://192.168.100.83:8080/video" 
        cap_sec = cv2.VideoCapture(PHONE_IP_URL)
        print("Secondary phone camera initialized!!.")

    try:
        while True:
            ret_main, frame_main = cap_main.read()
            if cap_sec:
                ret_sec, frame_sec = cap_sec.read()
            else:
                ret_sec, frame_sec = False, None

            if not ret_main:
                break

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
            if ENABLE_SECOND_CAMERA and ret_sec and analyzer_room2 is not None:
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
                "alerts": all_alerts,
                "telemetry": iot_telemetry
            }

            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(0.03) 

    except WebSocketDisconnect:
        print("Dashboard disconnected.")
    finally:
        cap_main.release()
        if cap_sec is not None:
            cap_sec.release()

@app.websocket("/ws/video-stream")
async def video_stream_endpoint(websocket: WebSocket):
    await websocket.accept()
    await process_and_stream(websocket)
    

if __name__ == "__main__":
    import uvicorn
    # Run the server on port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)