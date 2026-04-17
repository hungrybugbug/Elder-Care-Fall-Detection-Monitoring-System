import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function App() {
  const [frame, setFrame] = useState(null);
  const [frameSec, setFrameSec] = useState(null); // NEW: Secondary Camera State
  const [status, setStatus] = useState('Connecting...');
  const [alerts, setAlerts] = useState([]);
  const [gpuEnabled, setGpuEnabled] = useState(false); // GPU Hardware Toggle
  
  // Simulated IoT Data State
  const [telemetry, setTelemetry] = useState({ temp: 22.5, humidity: 45 });
  const wsRef = useRef(null);

  // 1. Change the static array to React State
  const [activityData, setActivityData] = useState([
    { time: 'T-5m', events: 0 }, { time: 'T-4m', events: 0 },
    { time: 'T-3m', events: 0 }, { time: 'T-2m', events: 0 },
    { time: 'T-1m', events: 0 }, { time: 'Now', events: 0 },
  ]);

  useEffect(() => {
    // Connect to the FastAPI WebSocket
    wsRef.current = new WebSocket('ws://localhost:8000/ws/video-stream');

    wsRef.current.onopen = () => {
      setStatus('Normal');
    };

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.frame) setFrame(data.frame);
      if (data.frame_sec) setFrameSec(data.frame_sec); // NEW
      if (data.status) setStatus(data.status);

      if (data.alerts && data.alerts.length > 0) {
        setAlerts((prev) => [...data.alerts, ...prev].slice(0, 50));
        
        // Add the alerts to the current 'Now' bucket
        setActivityData(prevData => {
          const newData = [...prevData];
          const lastIndex = newData.length - 1;
          newData[lastIndex] = { 
            ...newData[lastIndex], 
            events: newData[lastIndex].events + data.alerts.length 
          };
          return newData;
        });
      }
    };

    wsRef.current.onclose = () => setStatus('Disconnected');

    // Simulate slight fluctuations in IoT data for the demo
    const iotInterval = setInterval(() => {
      setTelemetry(prev => ({
        temp: prev.temp + (Math.random() * 0.4 - 0.2),
        humidity: prev.humidity + (Math.random() * 1 - 0.5)
      }));
    }, 3000);

    return () => {
      if (wsRef.current) wsRef.current.close();
      clearInterval(iotInterval);
    };
  }, []);

  useEffect(() => {
    // This makes the chart "roll" forward every 10 seconds for the live demo
    const chartTicker = setInterval(() => {
      setActivityData(prev => {
        const shifted = prev.slice(1); // Remove the oldest data point
        const newTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return [...shifted, { time: newTime, events: 0 }]; // Add a fresh bucket for 'Now'
      });
    }, 10000); // 10,000 ms = 10 seconds

    return () => clearInterval(chartTicker);
  }, []);

  const handleContactStaff = async () => {
    // ⚠️ PASTE YOUR DISCORD WEBHOOK URL HERE
    const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1494693407770017953/rd6d0QihI5_8cEHgF1eXFU6UwqmaVf4S3iGLMdYwvvPwxsmP94ZDzASBQH6Na7Z2GkHb";

    // Building a professional Discord Embed payload
    const payload = {
      username: "CareVision AI Core",
      // Optional: A red cross/hospital icon URL for the bot's profile picture
      avatar_url: "https://cdn-icons-png.flaticon.com/512/8065/8065074.png", 
      embeds: [
        {
          title: "🚨 IMMEDIATE MEDICAL ASSISTANCE REQUIRED 🚨",
          description: "A critical event has been manually escalated from the ElderShield Dashboard.",
          color: 16711680, // This is the decimal value for Red (#FF0000)
          fields: [
            {
              name: "👤 Patient Details",
              value: "**Name:** Ahmad Khan\n**Location:** Room 104\n**Condition:** Epilepsy, Fall Risk",
              inline: false
            },
            {
              name: "⏱️ Time of Dispatch",
              value: new Date().toLocaleTimeString(),
              inline: true
            },
            {
              name: "📡 System Status",
              value: status, // Pulls the current system status from your React state
              inline: true
            }
          ],
          footer: {
            text: "ElderShield Automated Alerting System"
          }
        }
      ]
    };

    try {
      const response = await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        alert("Alert successfully dispatched to the Operations Center!");
      } else {
        alert("Failed to send alert. Check the console.");
        console.error("Discord API Error:", response.status);
      }
    } catch (error) {
      console.error("Error sending Discord message:", error);
    }
  };

  // --- NEW FEATURE: CSV Export Logic ---
  // --- UPDATED CSV EXPORT ---
  // --- UPDATED CSV EXPORT (Columns Fixed) ---
  const exportCSV = () => {
    if (alerts.length === 0) return alert("No logs to export.");
    
    let csvContent = "data:text/csv;charset=utf-8,";
    // Headers now include Patient Name and Room
    csvContent += "Time,Patient Name,Room,Type,Severity,Message\n";
    
    csvContent += alerts.map(a => {
      const timeStr = new Date(a.time * 1000).toLocaleTimeString();
      // Using data from the alert, or defaulting to Ahmad Khan if missing
      const patientName = a.patient || "Ahmad Khan";
      const roomNum = a.room || "104";
      return `"${timeStr}","${patientName}","${roomNum}","${a.type}","${a.severity}","${a.message}"`;
    }).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "CareVision_Incident_Log.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- FIXED SHIFT HANDOVER PDF ---
  const generateHandoverPDF = () => {
    try {
      const doc = new jsPDF();
      
      doc.setFontSize(20);
      doc.setTextColor(40);
      doc.text("ElderShield Shift Handover Report", 14, 22);
      
      doc.setFontSize(12);
      doc.text("Date Generated: " + new Date().toLocaleString(), 14, 32);
      doc.text(`Total Recorded Incidents: ${alerts.length}`, 14, 40);

      if (alerts.length > 0) {
        // We use the imported autoTable function directly
        autoTable(doc, {
          startY: 50,
          head: [["Time", "Patient", "Room", "Alert Type", "Severity"]],
          body: alerts.map(a => [
            new Date(a.time * 1000).toLocaleTimeString(),
            a.patient || "Ahmad Khan",
            a.room || "104",
            a.type,
            a.severity
          ]),
          theme: 'striped',
          headStyles: { fillColor: [41, 128, 185] }
        });
      } else {
        doc.text("No incidents recorded during this shift.", 14, 50);
      }
      
      doc.save(`Shift_Handover_${Date.now()}.pdf`);
    } catch (error) {
      console.error("PDF Generation Error:", error);
      alert("Failed to generate PDF. Check console for details.");
    }
  };

  // --- NEW FEATURE: GPU Toggle Logic ---
  const handleGpuToggle = () => {
    const newState = !gpuEnabled;
    setGpuEnabled(newState);
    // In the future, send this via WebSocket to backend:
    // wsRef.current.send(JSON.stringify({ command: "TOGGLE_GPU", value: newState }));
    console.log(`Hardware Inference switched to: ${newState ? 'Dedicated GPU' : 'CPU'}`);
  };

  // UI Helpers
  const getStatusColor = (s) => {
    if (s === 'Critical') return 'bg-red-600 text-white animate-pulse';
    if (s === 'Warning') return 'bg-yellow-500 text-black';
    if (s === 'Normal') return 'bg-green-500 text-white';
    return 'bg-gray-500 text-white';
  };

  const getAlertColor = (sev) => {
    if (sev === 'Critical') return 'border-red-500 bg-red-900/20 text-red-100';
    if (sev === 'Warning') return 'border-yellow-500 bg-yellow-900/20 text-yellow-100';
    return 'border-blue-500 bg-blue-900/20 text-blue-100';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 font-sans">
      {/* Header */}
      <header className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">ElderShield</h1>
          <p className="text-slate-400 text-sm mt-1">Intelligent Elderly Monitoring System</p>
        </div>
        <div className="flex gap-4 items-center">
          <button 
            onClick={exportCSV}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm font-medium transition-colors"
          >
            📊 CSV
          </button>
          <button 
            onClick={generateHandoverPDF}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors shadow-lg"
          >
            📄 Shift Handover
          </button>
          <div className={`px-6 py-2 rounded-full font-bold uppercase tracking-wider text-sm shadow-lg ${getStatusColor(status)}`}>
            System: {status}
          </div>
        </div>
      </header>

      {/* Main 3-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        
        {/* COLUMN 1: Patient Profile & IoT (Left) */}
        <div className="lg:col-span-1 space-y-4">
          {/* Patient Card */}
          <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 shadow-xl">
            <h2 className="text-lg font-semibold mb-4 text-slate-300">Patient Profile</h2>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 bg-slate-700 rounded-full flex items-center justify-center text-2xl">👤</div>
              <div>
                <p className="font-bold text-lg">Ahmad Khan</p>
                <p className="text-sm text-slate-400">Room 104 • Age 78</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <p><span className="text-slate-500">Condition:</span> Epilepsy, Fall Risk</p>
              <p><span className="text-slate-500">Emergency:</span> Dr. Sarah (Ext 402)</p>
            </div>
            <button 
              onClick={handleContactStaff}
              className="w-full mt-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-medium transition-colors">
              📞 Contact Staff
            </button>
          </div>

          {/* IoT Telemetry */}
          <div className="bg-slate-900 rounded-xl p-5 border border-slate-800 shadow-xl">
            <h2 className="text-lg font-semibold mb-4 text-slate-300">Environment (IoT)</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded border border-slate-800 text-center">
                <p className="text-slate-500 text-xs uppercase mb-1">Temperature</p>
                <p className={`text-2xl font-bold ${telemetry.temp > 28 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {telemetry.temp.toFixed(1)}°C
                </p>
              </div>
              <div className="bg-slate-950 p-4 rounded border border-slate-800 text-center">
                <p className="text-slate-500 text-xs uppercase mb-1">Humidity</p>
                <p className="text-2xl font-bold text-blue-400">{telemetry.humidity.toFixed(0)}%</p>
              </div>
            </div>
          </div>
        </div>

        {/* COLUMN 2: Main Video Feed & Hardware Control (Center) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900 rounded-xl p-4 shadow-xl border border-slate-800">
            {/* Primary AI Camera */}
            <h2 className="text-lg font-semibold flex items-center mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
              Primary Camera (AI Active)
            </h2>
            <div className="bg-black rounded-lg aspect-video flex items-center justify-center overflow-hidden border border-slate-800 relative mb-4">
              {frame ? (
                <img src={frame} alt="Live Stream" className="w-full h-full object-contain" />
              ) : (
                <span className="text-slate-600 font-mono text-sm">Awaiting WebSocket Data...</span>
              )}
            </div>

            {/* Secondary CCTV Camera */}
            <h2 className="text-sm font-semibold flex items-center text-slate-400 mb-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span>
              Secondary View (Overview)
            </h2>
            <div className="bg-black rounded-lg h-48 flex items-center justify-center overflow-hidden border border-slate-800">
              {frameSec ? (
                <img src={frameSec} alt="Secondary Feed" className="w-full h-full object-cover" />
              ) : (
                <span className="text-slate-600 font-mono text-xs">Secondary IP Camera Offline...</span>
              )}
            </div>
          </div>
        </div>

        {/* COLUMN 3: Logs & Analytics (Right) */}
        <div className="lg:col-span-1 space-y-4 flex flex-col h-[calc(100vh-120px)]">
          
          {/* Analytics Chart */}
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-xl h-48">
            <h2 className="text-sm font-semibold mb-2 text-slate-400">Activity Trends (Live)</h2>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: 'none', borderRadius: '4px' }} />
                {/* FIX: Changed dataKey from "movements" to "events" */}
                <Line type="monotone" dataKey="events" stroke="#3b82f6" strokeWidth={2} dot={true} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Incident Ledger */}
          <div className="bg-slate-900 rounded-xl p-4 shadow-xl border border-slate-800 flex-1 flex flex-col overflow-hidden">
            <h2 className="text-lg font-semibold mb-3 flex items-center justify-between">
              Alert Ledger
              <span className="bg-slate-800 text-xs py-1 px-2 rounded text-slate-400">{alerts.length} Records</span>
            </h2>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
              {alerts.length === 0 ? (
                <p className="text-slate-500 text-center mt-10 text-sm">System armed. Monitoring...</p>
              ) : (
                alerts.map((alert, index) => (
                  <div key={index} className={`p-3 rounded border-l-4 text-slate-300 text-sm shadow-sm ${getAlertColor(alert.severity)}`}>
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-white">{alert.type}</span>
                      <span className="text-[10px] opacity-70 font-mono">
                        {new Date(alert.time * 1000).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs opacity-90">{alert.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;