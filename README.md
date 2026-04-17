# Elder Care FYP - Fall Detection & Monitoring System

A real-time computer vision system for monitoring elderly individuals in care facilities, detecting falls, unusual gestures, and prolonged inactivity using BlazePose and FastAPI WebSocket streaming.

## 🎯 Features

- **Dual Camera Support**: Laptop webcam + IP camera (mobile phone)
- **Real-time Pose Analysis**: BlazePose-based fall detection & movement analysis
- **Alert System**: Detects seizures, unusual gestures, and inactivity
- **WebSocket Streaming**: Live video feed to React frontend
- **GPU Support**: Optional PyTorch-based fall detection (currently disabled)
- **CORS Enabled**: Frontend-backend communication

## 📋 Project Structure

```
elder_care_fyp/
├── backend/
│   ├── cv_modules/           # Computer Vision modules
│   │   ├── pose_analyzer.py  # BlazePose + inactivity detection
│   │   └── fall_detector.py  # GPU-based fall detection (disabled)
│   ├── models/               # ML models (add fall_detection.pkl here)
│   ├── main.py              # FastAPI server
│   └── requirements.txt      # Python dependencies
│
└── frontend/
    ├── src/
    │   ├── components/       # React components
    │   ├── App.jsx          # Main app
    │   └── main.jsx         # Entry point
    └── package.json         # Node dependencies
```

## 🛠️ Tech Stack

### Backend
- **FastAPI** - Web framework
- **WebSocket** - Real-time communication
- **OpenCV** - Video processing
- **MediaPipe** - Pose detection (BlazePose)
- **NumPy** - Numerical computing

### Frontend
- **React** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling

## 📦 Installation

### Backend Setup

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### Frontend Setup

```bash
cd frontend
npm install
```

## 🚀 Running the Project

### Backend
```bash
cd backend
python main.py
```
Server runs on `http://localhost:8000`

### Frontend
```bash
cd frontend
npm run dev
```
Frontend runs on `http://localhost:5173`

## 🎮 Configuration

Edit `backend/main.py`:
- Change `PHONE_IP_URL` to your phone's actual IP camera URL
- Adjust camera indices for different USB cameras
- Enable PyTorch fall detection when GPU is available

## 📝 Notes

- **GPU Fall Detection**: Currently disabled. Uncomment when PyTorch + GPU are available.
- **Phone IP Camera**: Requires IP camera app on phone (e.g., IP Webcam)
- **Model Files**: Add `fall_detection.pkl` to `backend/models/` when ready

## 🔧 Troubleshooting

- **No module named 'cv_modules'**: Run `python main.py` from the `backend/` directory
- **Camera not found**: Check camera index (0 for main, 1 for external)
- **WebSocket connection failed**: Ensure frontend and backend are on the same network

## 📄 License

Your license here

## 👥 Authors

- Your Name

---

**Last Updated**: April 2026
