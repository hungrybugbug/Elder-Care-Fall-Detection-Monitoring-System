import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function App() {
  const [frame, setFrame] = useState(null);
  const [frameSec, setFrameSec] = useState(null);
  const [status, setStatus] = useState('Connecting...');
  const [alerts, setAlerts] = useState([]);
  const [gpuEnabled, setGpuEnabled] = useState(false);
  const [telemetry, setTelemetry] = useState({ temp: 22.5, humidity: 45 });
  const wsRef = useRef(null);
  const [privacyMode, setPrivacyMode] = useState(true); // Defaults to ON for patient dignity

  const [activityData, setActivityData] = useState([
    { time: '-50s', events: 0 }, { time: '-40s', events: 0 },
    { time: '-30s', events: 0 }, { time: '-20s', events: 0 },
    { time: '-10s', events: 0 }, { time: 'Now', events: 0 },
  ]);

  useEffect(() => {
    wsRef.current = new WebSocket('ws://localhost:8000/ws/video-stream');

    wsRef.current.onopen = () => setStatus('Online');

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.frame) setFrame(data.frame);
      if (data.frame_sec) setFrameSec(data.frame_sec);
      if (data.status) setStatus(data.status);

      if (data.alerts && data.alerts.length > 0) {
        setAlerts((prev) => [...data.alerts, ...prev].slice(0, 50));
        
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
    const chartTicker = setInterval(() => {
      setActivityData(prev => {
        const shifted = prev.slice(1);
        const newTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return [...shifted, { time: newTime, events: 0 }];
      });
    }, 10000);
    return () => clearInterval(chartTicker);
  }, []);

  useEffect(() => {
    // If a critical or warning alert happens, strip away privacy mode so staff can see
    if (status === 'Critical' || status === 'Warning') {
      setPrivacyMode(false);
    }
  }, [status]);

  // --- DYNAMIC DISCORD ALERT ---
  const handleContactStaff = async (patientName, roomNum, condition) => {
    // ⚠️ PASTE YOUR DISCORD WEBHOOK URL HERE
    const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1494693407770017953/rd6d0QihI5_8cEHgF1eXFU6UwqmaVf4S3iGLMdYwvvPwxsmP94ZDzASBQH6Na7Z2GkHb";

    const payload = {
      username: "CareVision AI Core",
      avatar_url: "https://cdn-icons-png.flaticon.com/512/8065/8065074.png", 
      embeds: [{
        title: `🚨 MEDICAL ASSISTANCE REQUIRED: ROOM ${roomNum} 🚨`,
        description: "A manual escalation has been triggered from the CareVision Dashboard.",
        color: 16711680, 
        fields: [
          { name: "👤 Patient", value: `**Name:** ${patientName}\n**Condition:** ${condition}`, inline: false },
          { name: "⏱️ Dispatch Time", value: new Date().toLocaleTimeString(), inline: true },
          { name: "📡 System", value: status, inline: true }
        ],
        footer: { text: "CareVision Automated Alerting System" }
      }]
    };

    try {
      const response = await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.ok) alert(`Alert dispatched for ${patientName} (Room ${roomNum})!`);
      else alert("Failed to send alert. Check the console.");
    } catch (error) {
      console.error("Error sending Discord message:", error);
    }
  };

  // --- EXPORTS ---
  const exportCSV = () => {
    if (alerts.length === 0) return alert("No logs to export.");
    let csvContent = "data:text/csv;charset=utf-8,Time,Patient Name,Room,Type,Severity,Message\n";
    csvContent += alerts.map(a => `"${new Date(a.time * 1000).toLocaleTimeString()}","${a.patient || 'Unknown'}","${a.room || 'Unknown'}","${a.type}","${a.severity}","${a.message}"`).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "CareVision_DualRoom_Log.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateHandoverPDF = () => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(20);
      doc.setTextColor(40);
      doc.text("CareVision Multi-Room Shift Handover", 14, 22);
      
      doc.setFontSize(12);
      doc.text("Date Generated: " + new Date().toLocaleString(), 14, 32);
      doc.text(`Total Recorded Incidents: ${alerts.length}`, 14, 40);

      if (alerts.length > 0) {
        autoTable(doc, {
          startY: 50,
          head: [["Time", "Patient", "Room", "Alert Type", "Severity"]],
          body: alerts.map(a => [
            new Date(a.time * 1000).toLocaleTimeString(),
            a.patient || "Unknown",
            a.room || "Unknown",
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
      console.error("PDF Error:", error);
      alert("Failed to generate PDF.");
    }
  };

  // --- UI HELPERS ---
  const getStatusColor = (s) => {
    if (s === 'Critical') return 'bg-red-600 text-white animate-pulse';
    if (s === 'Warning') return 'bg-yellow-500 text-black';
    if (s === 'Online') return 'bg-emerald-500 text-white';
    return 'bg-gray-500 text-white';
  };

  const getAlertColor = (sev) => {
    if (sev === 'Critical') return 'border-red-500 bg-red-900/20 text-red-100';
    if (sev === 'Warning') return 'border-yellow-500 bg-yellow-900/20 text-yellow-100';
    return 'border-blue-500 bg-blue-900/20 text-blue-100';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 font-sans">
      <header className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">ElderVision AI</h1>
          <p className="text-slate-400 text-sm mt-1">Multi-Room Elderly Monitoring</p>
        </div>
        <div className="flex gap-4 items-center">
          <button onClick={exportCSV} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm font-medium transition-colors border border-slate-600">📊 CSV</button>
          <button onClick={generateHandoverPDF} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors shadow-lg">📄 Shift Handover</button>
          <div className={`px-6 py-2 rounded-full font-bold uppercase tracking-wider text-sm shadow-lg ${getStatusColor(status)}`}>System: {status}</div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        
        {/* COLUMN 1: Profiles & IoT */}
        <div className="xl:col-span-1 space-y-4">
          
          {/* Patient 1 */}
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="bg-slate-800 text-xs px-2 py-1 rounded text-slate-400 font-bold">Room 104</span>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 bg-emerald-900/50 rounded-full flex items-center justify-center text-xl border border-emerald-700/50">👴🏽</div>
              <div>
                <p className="font-bold text-base">Ahmad Khan</p>
                <p className="text-xs text-slate-400">Age 78</p>
              </div>
            </div>
            <p className="text-xs mb-3 text-slate-300"><span className="text-slate-500 font-semibold">Risk:</span> Epilepsy, Fall History</p>
            <button 
              onClick={() => handleContactStaff("Ahmad Khan", "104", "Epilepsy, Fall History")}
              className="w-full py-1.5 bg-red-900/50 hover:bg-red-800/80 border border-red-700 rounded text-red-200 text-sm font-medium transition-colors">
              🚨 Escalate Alert
            </button>
          </div>

          {/* Patient 2 */}
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="bg-slate-800 text-xs px-2 py-1 rounded text-slate-400 font-bold">Room 105</span>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 bg-blue-900/50 rounded-full flex items-center justify-center text-xl border border-blue-700/50">🧓🏼</div>
              <div>
                <p className="font-bold text-base">Mohammad Sooban</p>
                <p className="text-xs text-slate-400">Age 82</p>
              </div>
            </div>
            <p className="text-xs mb-3 text-slate-300"><span className="text-slate-500 font-semibold">Risk:</span> Dementia, Wandering</p>
            <button 
              onClick={() => handleContactStaff("Mohammad Sooban", "105", "Dementia, Wandering")}
              className="w-full py-1.5 bg-red-900/50 hover:bg-red-800/80 border border-red-700 rounded text-red-200 text-sm font-medium transition-colors">
              🚨 Escalate Alert
            </button>
          </div>

          {/* IoT Telemetry */}
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-xl">
            <h2 className="text-sm font-semibold mb-3 text-slate-400">Facility Environment</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-3 rounded border border-slate-800 text-center">
                <p className="text-slate-500 text-[10px] uppercase">Avg Temp</p>
                <p className="text-xl font-bold text-emerald-400">{telemetry.temp.toFixed(1)}°C</p>
              </div>
              <div className="bg-slate-950 p-3 rounded border border-slate-800 text-center">
                <p className="text-slate-500 text-[10px] uppercase">Humidity</p>
                <p className="text-xl font-bold text-blue-400">{telemetry.humidity.toFixed(0)}%</p>
              </div>
            </div>
          </div>
        </div>

        {/* COLUMN 2 & 3: Dual Video Feeds (Equal Sizing) */}
        <div className="xl:col-span-2 space-y-4">
          <div className="bg-slate-900 rounded-xl p-4 shadow-xl border border-slate-800">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold flex items-center">
                <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
                Active Surveillance
              </h2>
              <div className="flex items-center gap-3 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                <span className="text-xs text-slate-400 font-medium">GPU Inference</span>
                <button 
                  onClick={() => setGpuEnabled(!gpuEnabled)}
                  className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors ${gpuEnabled ? 'bg-indigo-500' : 'bg-slate-600'}`}>
                  <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${gpuEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
                </button>
              </div>
              {/* NEW HIPAA PRIVACY TOGGLE */}
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-700 shadow-inner">
            <span className="text-xs text-slate-300 font-medium tracking-wide">Privacy Mode</span>
            <button 
              onClick={() => setPrivacyMode(!privacyMode)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${privacyMode ? 'bg-emerald-500' : 'bg-slate-600'}`}>
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${privacyMode ? 'translate-x-4.5' : 'translate-x-1'}`} />
            </button>
            <span className="text-[10px] text-slate-500 uppercase">{privacyMode ? 'Active' : 'Off'}</span>
          </div>

            </div>
            
            {/* The Videos are now in an equally split Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Camera 1 */}
              <div className="bg-slate-950 rounded border border-slate-800 p-2">
                <div className="flex justify-between items-center mb-2 px-1">
                  <span className="text-xs font-semibold text-slate-300">Room 104</span>
                  <span className="text-[10px] bg-emerald-900/50 text-emerald-400 px-1.5 rounded">AI Active</span>
                </div>
                <div className="bg-black aspect-video rounded flex items-center justify-center overflow-hidden">
                  {frame ? (
                    <img 
                      src={frame} 
                      className={`w-full h-full object-cover transition-all duration-500 ${privacyMode ? 'blur-xl opacity-80' : 'blur-none opacity-100'}`} 
                    />
                  ) : <span className="text-slate-600 text-xs">Waiting...</span>}
                </div>
              </div>

              {/* Camera 2 */}
              <div className="bg-slate-950 rounded border border-slate-800 p-2">
                <div className="flex justify-between items-center mb-2 px-1">
                  <span className="text-xs font-semibold text-slate-300">Room 105</span>
                  <span className="text-[10px] bg-emerald-900/50 text-emerald-400 px-1.5 rounded">AI Active</span>
                </div>
                <div className="bg-black aspect-video rounded flex items-center justify-center overflow-hidden">
                  {frame ? (
                    <img 
                      src={frameSec} 
                      className={`w-full h-full object-cover transition-all duration-500 ${privacyMode ? 'blur-xl opacity-80' : 'blur-none opacity-100'}`} 
                    />
                  ) : <span className="text-slate-600 text-xs">Waiting...</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* COLUMN 4: Logs & Analytics */}
        <div className="xl:col-span-1 space-y-4 flex flex-col h-[calc(100vh-120px)]">
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-xl h-48">
            <h2 className="text-xs font-semibold mb-2 text-slate-400 uppercase tracking-wider">Network Activity</h2>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" stroke="#475569" fontSize={9} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '12px' }} />
                <Line type="monotone" dataKey="events" stroke="#3b82f6" strokeWidth={2} dot={true} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-900 rounded-xl p-4 shadow-xl border border-slate-800 flex-1 flex flex-col overflow-hidden">
            <h2 className="text-sm font-semibold mb-3 flex items-center justify-between uppercase tracking-wider">
              Alert Ledger
              <span className="bg-slate-800 text-[10px] py-1 px-2 rounded text-slate-400">{alerts.length} Total</span>
            </h2>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
              {alerts.length === 0 ? (
                <p className="text-slate-500 text-center mt-10 text-xs">System armed. Monitoring rooms...</p>
              ) : (
                alerts.map((alert, index) => (
                  <div key={index} className={`p-3 rounded border-l-4 text-slate-300 text-sm shadow-sm ${getAlertColor(alert.severity)}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-xs">{alert.type}</span>
                        {/* ROOM IDENTIFIER BADGE */}
                        <span className="bg-slate-950 border border-slate-700 text-slate-300 text-[9px] px-1.5 py-0.5 rounded font-mono">
                          Rm {alert.room || "?"}
                        </span>
                      </div>
                      <span className="text-[9px] opacity-70 font-mono">
                        {new Date(alert.time * 1000).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs opacity-90 leading-relaxed">{alert.message}</p>
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