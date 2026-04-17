import cv2
import mediapipe as mp
import numpy as np
import time
import math
from collections import deque
from scipy.signal import butter, filtfilt

class PoseAnalyzer:
    def __init__(self):
        # Initialize MediaPipe once
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=False, 
            model_complexity=1,
            smooth_landmarks=True, 
            min_detection_confidence=0.6,
            min_tracking_confidence=0.6
        )
        self.mp_draw = mp.solutions.drawing_utils

        # ================= CONFIGURATIONS =================
        # Inactivity Config
        self.INACTIVITY_THRESHOLD = 10.0  
        self.MOVEMENT_THRESHOLD = 0.015   
        self.HISTORY_MAX = 120            
        self.POSE_STABILITY_TIME = 0.8    

        # Waving Config
        self.WAVE_HISTORY_MAX = 40
        self.MIN_SWING_DIST = 0.05
        self.REQUIRED_SWINGS = 3
        self.WAVE_COOLDOWN = 3.0
        self.HAND_VIS_THRESH = 0.5

        # Shivering Config
        self.SHIVER_WINDOW = 60
        self.SHIVER_FREQ_BAND = (6, 12)
        self.SHIVER_THRESHOLD = 30
        self.PERSISTENCE_THRESH = 77
        self.DECAY_RATE = 2
        self.FILTER_FPS = 30.0 # Assumed stable FPS for filter design
        
        # Alert Cooldown State
        self.ALERT_COOLDOWN = 8.0 # Seconds to wait before repeating the same alert
        self.last_alert_time = {
            "Inactivity": 0,
            "Seizure": 0,
            "Gesture": 0
        }

        # ================= STATE BUFFERS =================
        # Inactivity State
        self.body_keypoints_history = deque(maxlen=self.HISTORY_MAX)
        self.last_movement_time = time.time()
        self.inactive_alert_triggered = False
        self.candidate_pose = "Standing"
        self.candidate_pose_start = time.time()
        self.confirmed_pose = "Standing"

        # Waving State
        self.left_hand_hist = deque(maxlen=self.WAVE_HISTORY_MAX)
        self.right_hand_hist = deque(maxlen=self.WAVE_HISTORY_MAX)
        self.cooldown_end = 0

        # Shivering State
        self.shoulder_positions = []
        self.shiver_counter = 0

    # ---------------- HELPER METHODS ----------------

    @staticmethod
    def calc_angle(a, b, c):
        a, b, c = np.array(a, float), np.array(b, float), np.array(c, float)
        ab, cb = a - b, c - b
        denom = np.linalg.norm(ab) * np.linalg.norm(cb)
        if denom == 0: return 0
        cosval = np.clip(np.dot(ab, cb) / denom, -1.0, 1.0)
        return np.degrees(np.arccos(cosval))

    @staticmethod
    def butter_bandpass(lowcut, highcut, fs, order=3):
        nyq = 0.5 * fs
        low = lowcut / nyq
        high = highcut / nyq
        b, a = butter(order, [low, high], btype='band')
        return b, a

    def detect_posture(self, nose, shoulder_mid, hip_mid, knee_mid, ankle_mid, frame_h):
        torso_vector = hip_mid - shoulder_mid
        body_angle = abs(np.degrees(np.arctan2(torso_vector[0], torso_vector[1])))
        knee_angle = self.calc_angle(hip_mid, knee_mid, ankle_mid)
        hip_ankle_ratio = abs(hip_mid[1] - ankle_mid[1]) / frame_h
        body_height_ratio = abs(nose[1] - ankle_mid[1]) / frame_h
        hip_from_bottom = (frame_h - hip_mid[1]) / frame_h
        
        if body_height_ratio < 0.35 and body_angle > 30: return "Lying"
        if hip_from_bottom < 0.35 and knee_angle < 140 and hip_ankle_ratio < 0.30 and body_angle < 35: return "Sitting"
        if hip_from_bottom > 0.35 and knee_angle > 140 and hip_ankle_ratio > 0.25 and body_angle < 25: return "Standing"
        if hip_from_bottom > 0.4: return "Standing"
        if hip_from_bottom < 0.35 and knee_angle < 140: return "Sitting"
        return "Standing"

    def calculate_movement(self, frame_h, frame_w, window_seconds=2.0):
        if len(self.body_keypoints_history) < 10: return 0.0
        now = self.body_keypoints_history[-1][0]
        cutoff = now - window_seconds
        recent = [(t, pts) for t, pts in self.body_keypoints_history if t >= cutoff]
        if len(recent) < 2: return 0.0
        
        start_pts, end_pts = recent[0][1], recent[-1][1]
        total_movement = 0.0
        for s_pt, e_pt in zip(start_pts, end_pts):
            dx = (e_pt[0] - s_pt[0]) / frame_w
            dy = (e_pt[1] - s_pt[1]) / frame_h
            total_movement += math.sqrt(dx*dx + dy*dy)
        return total_movement / len(start_pts)

    def count_robust_swings(self, history, axis_idx):
        if len(history) < 5: return 0
        vals = [pt[axis_idx] for pt in history]
        smoothed = [sum(vals[max(0, i-2):i+1])/len(vals[max(0, i-2):i+1]) for i in range(len(vals))]
        
        swings, direction = 0, 0
        extreme_val = smoothed[0] 
        for val in smoothed:
            if direction == 0:
                if abs(val - extreme_val) > (self.MIN_SWING_DIST * 0.5):
                    direction = 1 if val > extreme_val else -1
                    extreme_val = val
            elif direction == 1:
                if val > extreme_val: extreme_val = val 
                elif val < (extreme_val - self.MIN_SWING_DIST):
                    swings += 1; direction = -1; extreme_val = val     
            elif direction == -1:
                if val < extreme_val: extreme_val = val 
                elif val > (extreme_val + self.MIN_SWING_DIST):
                    swings += 1; direction = 1; extreme_val = val
        return swings

    def detect_shivering(self):
        if len(self.shoulder_positions) < self.SHIVER_WINDOW: return False
        y = np.array(self.shoulder_positions)
        y = y - np.mean(y)
        try:
            b, a = self.butter_bandpass(self.SHIVER_FREQ_BAND[0], self.SHIVER_FREQ_BAND[1], self.FILTER_FPS)
            y_f = filtfilt(b, a, y)
            power = np.sum(np.abs(np.fft.rfft(y_f)))
            return power > self.SHIVER_THRESHOLD
        except ValueError:
            # Handles edge cases where buffer isn't large enough for filter order
            return False

    # ---------------- MAIN INFERENCE LOOP ----------------

    def process_frame(self, frame):
        """
        Takes raw BGR frame. Returns annotated frame, system status, and a list of active alerts.
        """
        timestamp = time.time()
        h, w = frame.shape[:2]
        alerts = []
        overall_status = "Normal"
        
        # Process MediaPipe
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.pose.process(rgb)

        if results.pose_landmarks:
            lm = results.pose_landmarks.landmark
            def px(pt): return np.array([pt.x*w, pt.y*h])

            # Extract Landmarks
            try:
                ls, rs = px(lm[self.mp_pose.PoseLandmark.LEFT_SHOULDER]), px(lm[self.mp_pose.PoseLandmark.RIGHT_SHOULDER])
                lh, rh = px(lm[self.mp_pose.PoseLandmark.LEFT_HIP]), px(lm[self.mp_pose.PoseLandmark.RIGHT_HIP])
                la, ra = px(lm[self.mp_pose.PoseLandmark.LEFT_ANKLE]), px(lm[self.mp_pose.PoseLandmark.RIGHT_ANKLE])
                lk, rk = px(lm[self.mp_pose.PoseLandmark.LEFT_KNEE]), px(lm[self.mp_pose.PoseLandmark.RIGHT_KNEE])
                lw_lm = lm[self.mp_pose.PoseLandmark.LEFT_WRIST]
                rw_lm = lm[self.mp_pose.PoseLandmark.RIGHT_WRIST]
                nose = px(lm[self.mp_pose.PoseLandmark.NOSE])
            except IndexError:
                return frame, "No Person Detected", alerts

            shoulder_mid = (ls + rs) / 2
            hip_mid = (lh + rh) / 2
            ankle_mid = (la + ra) / 2
            knee_mid = (lk + rk) / 2

            self.mp_draw.draw_landmarks(frame, results.pose_landmarks, self.mp_pose.POSE_CONNECTIONS)

           # ================= 1. INACTIVITY & POSTURE =================
            current_pose = self.detect_posture(nose, shoulder_mid, hip_mid, knee_mid, ankle_mid, h)
            if current_pose != self.candidate_pose:
                self.candidate_pose = current_pose
                self.candidate_pose_start = timestamp
            elif (timestamp - self.candidate_pose_start) >= self.POSE_STABILITY_TIME:
                self.confirmed_pose = current_pose

            keypoints = [nose, shoulder_mid, hip_mid, knee_mid, ankle_mid, px(lw_lm), px(rw_lm)]
            self.body_keypoints_history.append((timestamp, keypoints))
            
            movement = self.calculate_movement(h, w)
            if movement > self.MOVEMENT_THRESHOLD:
                self.last_movement_time = timestamp
                self.inactive_alert_triggered = False

            inactive_duration = timestamp - self.last_movement_time
            if inactive_duration >= self.INACTIVITY_THRESHOLD:
                overall_status = "Warning"
                
                # Check cooldown before sending alert
                if timestamp - self.last_alert_time["Inactivity"] > self.ALERT_COOLDOWN:
                    self.inactive_alert_triggered = True
                    alerts.append({
                        "type": "Inactivity", 
                        "severity": "Warning", 
                        "message": f"Inactive for {int(inactive_duration)}s ({self.confirmed_pose})",
                        "time": timestamp
                    })
                    self.last_alert_time["Inactivity"] = timestamp

            # ================= 2. SHIVERING / SEIZURE =================
            self.shoulder_positions.append(ls[1]) # using left shoulder Y
            if len(self.shoulder_positions) > self.SHIVER_WINDOW:
                self.shoulder_positions.pop(0)

            if self.detect_shivering():
                self.shiver_counter = min(self.shiver_counter + 1, self.PERSISTENCE_THRESH)
            else:
                self.shiver_counter = max(self.shiver_counter - self.DECAY_RATE, 0)

            if self.shiver_counter >= self.PERSISTENCE_THRESH:
                overall_status = "Critical"
                cv2.putText(frame, "SEIZURE DETECTED!", (50, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 4)
                
                # Check cooldown before sending alert
                if timestamp - self.last_alert_time["Seizure"] > self.ALERT_COOLDOWN:
                    alerts.append({
                        "type": "Seizure", 
                        "severity": "Critical", 
                        "message": "Sustained shivering/seizure detected!",
                        "time": timestamp
                    })
                    self.last_alert_time["Seizure"] = timestamp

            # ================= 3. WAVING =================
            if timestamp > self.cooldown_end:
                hands_visible = False
                if lw_lm.visibility > self.HAND_VIS_THRESH:
                    self.left_hand_hist.append((timestamp, lw_lm.x, lw_lm.y))
                    hands_visible = True
                if rw_lm.visibility > self.HAND_VIS_THRESH:
                    self.right_hand_hist.append((timestamp, rw_lm.x, rw_lm.y))
                    hands_visible = True

                if hands_visible:
                    score = max(
                        self.count_robust_swings(self.left_hand_hist, 1),
                        self.count_robust_swings(self.left_hand_hist, 2),
                        self.count_robust_swings(self.right_hand_hist, 1),
                        self.count_robust_swings(self.right_hand_hist, 2)
                    )
                    
                    if score >= self.REQUIRED_SWINGS:
                        self.cooldown_end = timestamp + self.WAVE_COOLDOWN
                        cv2.putText(frame, "WAVE DETECTED!", (50, 130), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 255, 0), 4)
                        
                        # Check cooldown before sending alert
                        if timestamp - self.last_alert_time["Gesture"] > self.ALERT_COOLDOWN:
                            alerts.append({
                                "type": "Gesture", 
                                "severity": "Info", 
                                "message": "Distress Wave Detected",
                                "time": timestamp
                            })
                            self.last_alert_time["Gesture"] = timestamp
        else:
            # Clear buffers if person leaves frame to prevent false logic when they return
            self.last_movement_time = timestamp
            self.inactive_alert_triggered = False
            self.body_keypoints_history.clear()
            self.left_hand_hist.clear()
            self.right_hand_hist.clear()
            self.shoulder_positions.clear()

        # Add visual context for the dashboard
        cv2.putText(frame, f"Status: {overall_status}", (10, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255,255,255), 2)
        
        return frame, overall_status, alerts