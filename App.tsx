
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob as GenAIBlob } from '@google/genai';
import { 
  Phone, PhoneOff, Mic, MicOff, Volume2, Info, 
  ShieldAlert, Disc, Download, History, 
  Trash2, X, Music, Waves, Zap, Shuffle, BellRing, Target, Activity, Share2,
  Wand2, Radio, Ghost, Cpu, Sliders, Hash, UserPlus, Link2, ChevronLeft, Delete, AlertTriangle,
  Play, Pause, Archive, ContactRound, Loader2
} from 'lucide-react';
import { SCENARIOS } from './constants';
import { PrankScenario, CallStatus, TranscriptionItem, CallRecording, TriggerEvent } from './types';
import { encode, decode, decodeAudioData } from './audioUtils';

// --- Web Audio FX Utilities ---
interface FXState { robotic: number; echo: number; distortion: number; }
interface FXNodes { input: GainNode; output: GainNode; distortionDrive: GainNode; distortion: WaveShaperNode; delay: DelayNode; delayFeedback: GainNode; filter: BiquadFilterNode; roboticMix: GainNode; echoMix: GainNode; distortionMix: GainNode; dryMix: GainNode; }

function createFXRack(ctx: AudioContext): FXNodes {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dryMix = ctx.createGain();
  const distortionDrive = ctx.createGain();
  const distortion = ctx.createWaveShaper();
  const distortionMix = ctx.createGain();
  const curve = new Float32Array(44100);
  for (let i = 0; i < 44100; i++) {
    const x = (i * 2) / 44100 - 1;
    curve[i] = (Math.PI + 20) * x / (Math.PI + 20 * Math.abs(x));
  }
  distortion.curve = curve;
  distortion.oversample = '4x';
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.3;
  const delayFeedback = ctx.createGain();
  const echoMix = ctx.createGain();
  delay.connect(delayFeedback);
  delayFeedback.connect(delay);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  const roboticMix = ctx.createGain();
  input.connect(dryMix);
  dryMix.connect(output);
  input.connect(distortionDrive);
  distortionDrive.connect(distortion);
  distortion.connect(distortionMix);
  distortionMix.connect(output);
  input.connect(delay);
  delay.connect(echoMix);
  echoMix.connect(output);
  input.connect(filter);
  filter.connect(roboticMix);
  roboticMix.connect(output);
  return { input, output, distortionDrive, distortion, delay, delayFeedback, filter, roboticMix, echoMix, distortionMix, dryMix };
}

function updateFXParams(nodes: FXNodes, state: FXState) {
  const robVal = state.robotic / 100;
  nodes.roboticMix.gain.setTargetAtTime(robVal, 0, 0.1);
  nodes.filter.Q.setTargetAtTime(robVal * 30, 0, 0.1);
  const echoVal = state.echo / 100;
  nodes.echoMix.gain.setTargetAtTime(echoVal, 0, 0.1);
  nodes.delayFeedback.gain.setTargetAtTime(echoVal * 0.7, 0, 0.1);
  const distVal = state.distortion / 100;
  nodes.distortionMix.gain.setTargetAtTime(distVal, 0, 0.1);
  nodes.distortionDrive.gain.setTargetAtTime(1 + distVal * 5, 0, 0.1);
  const dryVal = Math.max(0.15, 1 - ((robVal + echoVal + distVal) * 0.6));
  nodes.dryMix.gain.setTargetAtTime(dryVal, 0, 0.1);
}

// --- UI Components ---
const Header = () => (
  <header className="py-6 px-4 text-center relative overflow-hidden">
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-red-500/10 blur-[100px] pointer-events-none"></div>
    <h1 className="text-4xl font-black tracking-tighter text-white mb-1 italic relative z-10">AIs<span className="text-red-500">REVENGE</span></h1>
    <div className="flex items-center justify-center gap-2 relative z-10">
      <Zap size={10} className="text-red-400 animate-pulse" />
      <p className="text-slate-500 text-[9px] uppercase tracking-[0.2em] font-black">Lethal AI Forge Protocol</p>
    </div>
  </header>
);

const ScenarioCard: React.FC<{ scenario: PrankScenario; isSelected: boolean; onSelect: (s: PrankScenario) => void; }> = ({ scenario, isSelected, onSelect }) => (
  <button
    onClick={() => onSelect(scenario)}
    className={`w-full p-4 mb-3 rounded-2xl flex items-center gap-4 transition-all duration-300 text-left border ${isSelected ? 'glass border-red-500/40 ring-2 ring-red-500/10 scale-[1.02]' : 'bg-slate-800/20 border-white/5 hover:bg-slate-800/40'}`}
  >
    <div className={`w-12 h-12 rounded-full overflow-hidden flex-shrink-0 border-2 border-white/10 ${scenario.color}`}>
      <img src={scenario.avatar} alt={scenario.name} className="w-full h-full object-cover opacity-80" />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex justify-between items-start">
        <h3 className="font-bold text-white text-sm truncate">{scenario.name}</h3>
        <span className="text-[7px] uppercase font-black text-white/40 bg-white/5 px-1.5 py-0.5 rounded tracking-tighter">{scenario.voiceName}</span>
      </div>
      <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{scenario.description}</p>
    </div>
  </button>
);

const TranscriptionView: React.FC<{ items: TranscriptionItem[] }> = ({ items }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [items]);
  return (
    <div ref={scrollRef} className="h-24 overflow-y-auto mb-4 px-4 space-y-2 scroll-smooth no-scrollbar">
      {items.length === 0 && <div className="text-center text-slate-700 text-[9px] uppercase tracking-widest font-black mt-6 animate-pulse">Establishing secure link...</div>}
      {items.map((item) => (
        <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-[11px] font-bold leading-tight ${item.role === 'user' ? 'bg-red-600 text-white rounded-tr-none shadow-lg shadow-red-900/20' : 'bg-slate-800/90 text-slate-200 rounded-tl-none border border-white/5'}`}>{item.text}</div>
        </div>
      ))}
    </div>
  );
};

export default function App() {
  const [selectedScenario, setSelectedScenario] = useState<PrankScenario>(SCENARIOS[0]);
  const [targetName, setTargetName] = useState('');
  const [dialNumber, setDialNumber] = useState('');
  const [showDialer, setShowDialer] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showVault, setShowVault] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [status, setStatus] = useState<CallStatus>(CallStatus.IDLE);
  const [isIncoming, setIsIncoming] = useState(false);
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [triggers, setTriggers] = useState<TriggerEvent[]>([]);
  const [timer, setTimer] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fxState, setFxState] = useState<FXState>({ robotic: 0, echo: 0, distortion: 0 });
  const [showFXMenu, setShowFXMenu] = useState(false);
  const [recordings, setRecordings] = useState<CallRecording[]>([]);

  const audioCtxRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const fxRackRef = useRef<FXNodes | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputTranscriptionRef = useRef('');
  const outputTranscriptionRef = useRef('');
  
  // Recording refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recordingDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const KEYWORDS = ["POLICE", "FBI", "WHO", "STOP", "PIZZA", "HELLO"];

  // Handle auto-run if shared link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sId = params.get('scenario');
    const tName = params.get('target');
    if (sId && tName) {
      const scenario = SCENARIOS.find(s => s.id === sId);
      if (scenario) {
        setSelectedScenario(scenario);
        setTargetName(tName);
        setIsIncoming(true);
      }
    }
  }, []);

  const clearCallState = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (sessionRef.current) { try { sessionRef.current.close(); } catch (e) {} sessionRef.current = null; }
    
    // Stop recording
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }

    setTimer(0);
    setTranscriptions([]);
    setTriggers([]);
    nextStartTimeRef.current = 0;
    sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
    sourcesRef.current.clear();
  }, []);

  const handleEndCall = useCallback(() => {
    clearCallState();
    setStatus(CallStatus.IDLE);
    setIsIncoming(false);
  }, [clearCallState]);

  const detectTriggers = (text: string) => {
    const upperText = text.toUpperCase();
    KEYWORDS.forEach(word => {
      if (upperText.includes(word)) {
        setTriggers(prev => [{ id: Math.random().toString(), type: 'Keyword', label: `THREAT: ${word}`, timestamp: Date.now() }, ...prev].slice(0, 3));
      }
    });
  };

  const selectContact = async () => {
    try {
      const props = ['name', 'tel'];
      const opts = { multiple: false };
      const contacts = await (navigator as any).contacts.select(props, opts);
      if (contacts && contacts[0]) {
        const contact = contacts[0];
        setTargetName(contact.name?.[0] || '');
        setDialNumber(contact.tel?.[0]?.replace(/\D/g, '') || '');
      }
    } catch (err) {
      console.log('Contact picker not supported or canceled');
    }
  };

  const initiateLethalLink = () => {
    setShowConfirmation(true);
  };

  const generateLethalLink = async (numberOverride?: string) => {
    const nameToUse = targetName || numberOverride || 'Subject';
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('scenario', selectedScenario.id);
    url.searchParams.set('target', nameToUse);
    
    setIsDispatching(true);
    
    // Simulate high-voltage forging
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const shareData = {
      title: 'INCOMING LETHAL FREQUENCY',
      text: `⚠️ [${selectedScenario.callerId}] is attempting to bridge a secure audio link to your device. TRANSMISSION SOURCE: ${selectedScenario.name}.`,
      url: url.toString()
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        navigator.clipboard.writeText(url.toString());
        alert(`Lethal Link Forged! Frequency copied to clipboard since share was interrupted.`);
      }
    } else {
      navigator.clipboard.writeText(url.toString());
      alert(`Lethal Link Forged for ${nameToUse}! Frequency injected into clipboard.`);
    }

    setIsDispatching(false);
    setShowDialer(false);
    setShowConfirmation(false);
  };

  const handleStartCall = async () => {
    try {
      setStatus(CallStatus.DIALING);
      setIsIncoming(false);
      setErrorMessage(null);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      if (!audioCtxRef.current) {
        audioCtxRef.current = {
          input: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 }),
          output: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 })
        };
      }
      
      const outCtx = audioCtxRef.current.output;
      if (!fxRackRef.current) {
        fxRackRef.current = createFXRack(outCtx);
        fxRackRef.current.output.connect(outCtx.destination);
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      if (!recordingDestRef.current) {
        recordingDestRef.current = outCtx.createMediaStreamDestination();
      }
      
      fxRackRef.current.output.connect(recordingDestRef.current);
      const userSourceInOutCtx = outCtx.createMediaStreamSource(stream);
      userSourceInOutCtx.connect(recordingDestRef.current);

      recorderChunksRef.current = [];
      recorderRef.current = new MediaRecorder(recordingDestRef.current.stream);
      recorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) recorderChunksRef.current.push(e.data);
      };
      recorderRef.current.onstop = () => {
        const blob = new Blob(recorderChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const newRecording: CallRecording = {
          id: Math.random().toString(36).substr(2, 9),
          scenarioName: selectedScenario.name,
          timestamp: Date.now(),
          duration: timer,
          blobUrl: url
        };
        setRecordings(prev => [newRecording, ...prev]);
      };
      recorderRef.current.start();

      const customizedInstruction = selectedScenario.systemInstruction.replace(/{{TARGET_NAME}}/g, targetName || 'you insignificant pulse');

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedScenario.voiceName } } },
          systemInstruction: customizedInstruction,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus(CallStatus.CONNECTED);
            timerIntervalRef.current = setInterval(() => setTimer(prev => prev + 1), 1000);
            const source = audioCtxRef.current!.input.createMediaStreamSource(stream);
            const scriptProcessor = audioCtxRef.current!.input.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then(session => { session.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }); });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioCtxRef.current!.input.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && audioCtxRef.current && fxRackRef.current) {
              const ctx = audioCtxRef.current.output;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(fxRackRef.current.input);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
            if (message.serverContent?.inputTranscription) { detectTriggers(message.serverContent.inputTranscription.text); inputTranscriptionRef.current += message.serverContent.inputTranscription.text; }
            if (message.serverContent?.outputTranscription) outputTranscriptionRef.current += message.serverContent.outputTranscription.text;
            if (message.serverContent?.turnComplete) {
              setTranscriptions(prev => [...prev, { role: 'user', text: inputTranscriptionRef.current, id: Math.random().toString() }, { role: 'model', text: outputTranscriptionRef.current, id: Math.random().toString() }]);
              inputTranscriptionRef.current = ''; outputTranscriptionRef.current = '';
            }
          },
          onerror: () => handleEndCall(),
          onclose: () => handleEndCall()
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err: any) { setErrorMessage(err.message); setStatus(CallStatus.ERROR); }
  };

  const handleFXChange = (type: keyof FXState, value: number) => {
    const newState = { ...fxState, [type]: value };
    setFxState(newState);
    if (fxRackRef.current) updateFXParams(fxRackRef.current, newState);
  };

  const handleDial = (num: string) => {
    if (dialNumber.length < 15) setDialNumber(prev => prev + num);
  };

  const shareRecording = async (rec: CallRecording) => {
    if (navigator.share) {
      try {
        const response = await fetch(rec.blobUrl);
        const blob = await response.blob();
        const file = new File([blob], `revenge-record-${rec.id}.webm`, { type: 'audio/webm' });
        await navigator.share({
          title: 'Lethal AI Record - AIs Revenge',
          text: `Check out this frequency transmission from ${rec.scenarioName}!`,
          files: [file]
        });
      } catch (err) {
        console.error('Share failed', err);
      }
    } else {
      const a = document.createElement('a');
      a.href = rec.blobUrl;
      a.download = `revenge-record-${rec.id}.webm`;
      a.click();
    }
  };

  const formatTime = (s: number) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  return (
    <div className="min-h-screen phone-gradient flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[380px] h-[780px] glass rounded-[3rem] overflow-hidden flex flex-col relative shadow-2xl border-8 border-[#151520] ring-4 ring-white/5">
        <div className="h-10 flex justify-between items-center px-10 text-[10px] text-slate-600 font-black z-[110]">
          <span>9:41</span>
          <div className="flex gap-1.5 items-center"><Waves size={12} className="text-red-500/50" /><ShieldAlert size={10} className="text-red-600" /><span>5G</span><div className="w-5 h-2.5 rounded-sm border border-slate-800 bg-slate-900 flex items-center px-0.5"><div className="h-1.5 w-3 bg-red-600 rounded-px"></div></div></div>
        </div>

        {isIncoming ? (
          <div className="flex-1 flex flex-col items-center justify-between py-24 px-8 animate-in fade-in duration-500 bg-[#0d0d12]/90 backdrop-blur-2xl z-[100]">
            <div className="text-center">
              <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-red-600 mx-auto mb-6 shadow-2xl pulse-red"><img src={selectedScenario.avatar} className="w-full h-full object-cover" alt="" /></div>
              <h2 className="text-3xl font-black text-white mb-2">{selectedScenario.callerId}</h2>
              <p className="text-red-500 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse italic">Lethal Frequency incoming for {targetName || 'Subject'}</p>
            </div>
            <div className="w-full flex justify-around items-center">
              <button onClick={handleEndCall} className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-white shadow-xl active:scale-90 border border-white/5"><PhoneOff size={28} /></button>
              <button onClick={handleStartCall} className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-white shadow-xl active:scale-90 animate-bounce shadow-red-600/20"><Phone size={28} /></button>
            </div>
          </div>
        ) : showVault ? (
          <div className="flex-1 flex flex-col bg-[#0d0d12] animate-in slide-in-from-left duration-300 z-[120]">
            <div className="p-6 flex items-center justify-between border-b border-white/5">
              <button onClick={() => setShowVault(false)} className="text-slate-500 hover:text-white transition-colors"><ChevronLeft size={24} /></button>
              <h3 className="text-white font-black text-xs uppercase tracking-[0.2em]">Lethal Archive (Vault)</h3>
              <Archive size={20} className="text-red-500" />
            </div>
            <div className="flex-1 overflow-y-auto p-6 no-scrollbar space-y-4">
              {recordings.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 space-y-4 px-12 text-center">
                  <Activity size={48} className="opacity-20" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Archive is currently empty. Initiate frequencies to store records.</p>
                </div>
              ) : (
                recordings.map(rec => (
                  <div key={rec.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 animate-in slide-in-from-bottom duration-300">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-white font-black text-xs uppercase">{rec.scenarioName}</h4>
                        <p className="text-[9px] text-slate-500 font-bold">{new Date(rec.timestamp).toLocaleString()}</p>
                      </div>
                      <span className="text-[9px] font-black text-red-500 bg-red-500/10 px-2 py-0.5 rounded uppercase">{formatTime(rec.duration)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <audio controls className="h-8 flex-1 brightness-90 contrast-125 opacity-70 scale-95 origin-left" src={rec.blobUrl} />
                      <button onClick={() => shareRecording(rec)} className="w-10 h-10 rounded-full bg-red-600/20 text-red-500 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all">
                        <Share2 size={16} />
                      </button>
                      <button onClick={() => setRecordings(prev => prev.filter(r => r.id !== rec.id))} className="w-10 h-10 rounded-full bg-white/5 text-slate-500 flex items-center justify-center hover:bg-white/10 transition-all">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : showDialer ? (
          <div className="flex-1 flex flex-col bg-[#0d0d12] animate-in slide-in-from-right duration-300 z-[100] relative">
            <div className="p-6 flex items-center justify-between">
              <button onClick={() => setShowDialer(false)} className="text-slate-500 hover:text-white transition-colors"><ChevronLeft size={24} /></button>
              <h3 className="text-white font-black text-xs uppercase tracking-[0.2em]">Remote Frequency Bridge</h3>
              <button onClick={selectContact} className="text-red-500 hover:text-red-400 p-2 rounded-full glass border-white/5"><ContactRound size={20} /></button>
            </div>
            <div className="flex-1 flex flex-col justify-center px-8">
              <div className="mb-6 text-center h-16 flex flex-col items-center justify-center gap-1">
                {targetName && <span className="text-[10px] font-black text-red-500 uppercase tracking-widest animate-in fade-in">{targetName}</span>}
                <span className="text-4xl font-black text-white tracking-tighter">{dialNumber || "..."}</span>
              </div>
              <div className="grid grid-cols-3 gap-6">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map(val => (
                  <button 
                    key={val} 
                    onClick={() => handleDial(val)}
                    className="w-20 h-20 rounded-full bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center transition-all active:scale-90 border border-white/5 group"
                  >
                    <span className="text-2xl font-bold text-white group-hover:text-red-500 transition-colors">{val}</span>
                    <span className="text-[8px] font-black text-slate-700 uppercase tracking-tighter">
                      {val === "2" ? "ABC" : val === "3" ? "DEF" : val === "4" ? "GHI" : val === "5" ? "JKL" : val === "6" ? "MNO" : val === "7" ? "PQRS" : val === "8" ? "TUV" : val === "9" ? "WXYZ" : ""}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-12 flex justify-center items-center gap-12">
                <div className="w-16"></div>
                <button 
                  onClick={initiateLethalLink} 
                  disabled={!dialNumber}
                  className={`w-20 h-20 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-90 ${dialNumber ? 'bg-red-600 shadow-red-600/20 text-white' : 'bg-slate-800 text-slate-600'}`}
                >
                  <Phone size={32} />
                </button>
                <button onClick={() => setDialNumber(prev => prev.slice(0, -1))} className="text-slate-500 hover:text-white"><Delete size={28} /></button>
              </div>
            </div>
            <p className="p-8 text-[8px] font-black text-slate-800 uppercase text-center tracking-widest leading-relaxed">Warning: Bridging the frequency requires high-voltage precision.<br/>Dispatching to a contact forges a direct Lethal Frequency transmission.</p>

            {(showConfirmation || isDispatching) && (
              <div className="absolute inset-0 bg-[#0d0d12]/98 backdrop-blur-3xl z-[200] flex flex-col items-center justify-center p-8 animate-in zoom-in-95 duration-200">
                {isDispatching ? (
                  <div className="flex flex-col items-center gap-6 animate-pulse">
                    <Loader2 size={64} className="text-red-500 animate-spin" />
                    <div className="text-center space-y-2">
                      <h2 className="text-xl font-black text-white uppercase tracking-tighter">Forging Link...</h2>
                      <p className="text-[10px] font-black text-red-500 uppercase tracking-widest">Bridging Frequency for {targetName || dialNumber}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-24 h-24 bg-red-600/10 rounded-full flex items-center justify-center mb-8 border border-red-500/20 pulse-red">
                      <AlertTriangle size={48} className="text-red-500" />
                    </div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter mb-4 text-center">Neural Link Confirmation</h2>
                    
                    <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4 mb-8">
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Target Identity</p>
                        <p className="text-2xl font-black text-white tracking-tighter">{targetName || dialNumber}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Disclaimer</p>
                        <p className="text-[11px] font-medium text-slate-300 leading-relaxed italic">
                          "You are about to transmit a high-voltage AI persona to this frequency. This link contains raw, unfiltered AI interactions. The Sovereign does not tolerate accidental connections. By proceeding, you confirm this prank is for entertainment only."
                        </p>
                      </div>
                    </div>

                    <div className="w-full space-y-3">
                      <button 
                        onClick={() => generateLethalLink(dialNumber)}
                        className="w-full py-5 bg-red-600 hover:bg-red-500 text-white font-black rounded-3xl transition-all active:scale-95 shadow-xl shadow-red-600/20 uppercase tracking-[0.2em] text-xs italic"
                      >
                        Dispatch Frequency
                      </button>
                      <button 
                        onClick={() => setShowConfirmation(false)}
                        className="w-full py-5 bg-slate-900 border border-white/5 hover:bg-slate-800 text-slate-400 font-black rounded-3xl transition-all active:scale-95 uppercase tracking-[0.2em] text-xs italic"
                      >
                        Abort Link
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : status === CallStatus.IDLE || status === CallStatus.ERROR ? (
          <>
            <Header />
            <div className="flex-1 overflow-y-auto px-6 pb-40 no-scrollbar">
              <div className="flex items-center justify-between mb-4 px-1">
                <div className="flex items-center gap-2 text-slate-600"><Target size={12} /><span className="text-[9px] font-black uppercase tracking-[0.2em]">Lethal Profiles</span></div>
                <button onClick={() => setShowVault(true)} className="flex items-center gap-1.5 text-red-500 hover:text-red-400 transition-colors">
                  <History size={14} />
                  <span className="text-[9px] font-black uppercase tracking-[0.2em]">Archive</span>
                  {recordings.length > 0 && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse ml-0.5"></span>}
                </button>
              </div>
              {SCENARIOS.map(s => <ScenarioCard key={s.id} scenario={s} isSelected={selectedScenario.id === s.id} onSelect={setSelectedScenario} />)}
              {errorMessage && <div className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] text-center font-black">{errorMessage}</div>}
            </div>
            <div className="absolute bottom-10 left-0 right-0 px-6 grid grid-cols-2 gap-3">
              <button onClick={() => setShowDialer(true)} className="py-5 rounded-3xl bg-slate-900 border border-white/5 hover:bg-slate-800 text-white font-black flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl uppercase tracking-[0.1em] text-[10px] italic">DIAL FRIEND</button>
              <button onClick={handleStartCall} className="py-5 rounded-3xl bg-red-600 hover:bg-red-500 text-white font-black flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-red-600/20 uppercase tracking-[0.1em] text-[10px] italic">PROXY CALL</button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col animate-in slide-in-from-bottom duration-500 relative bg-black/40">
            <div className="flex-1 flex flex-col items-center pt-20 px-8">
              <div className={`w-36 h-36 rounded-full overflow-hidden border-4 border-red-500/20 shadow-2xl mb-6 relative pulse-red`}><img src={selectedScenario.avatar} className="w-full h-full object-cover" alt="" /></div>
              <h2 className="text-3xl font-black text-white mb-1 tracking-tighter">{selectedScenario.callerId}</h2>
              <p className="text-red-500 text-[10px] font-black uppercase tracking-widest mb-4">Frequency: {targetName || 'Direct'}</p>
              <p className="text-slate-600 text-[12px] font-black mb-8">{formatTime(timer)}</p>
              <div className="flex flex-wrap justify-center gap-2 mb-2 h-5">{triggers.map(t => <div key={t.id} className="bg-red-500/20 border border-red-500/40 px-2 py-0.5 rounded text-[7px] font-black text-red-500 uppercase animate-in zoom-in">{t.label}</div>)}</div>
              <div className="w-full flex-1 flex flex-col justify-end pb-12">
                <TranscriptionView items={transcriptions} />
                <div className="grid grid-cols-4 gap-4 px-2">
                  <div className="flex flex-col items-center gap-2"><button className="w-12 h-12 rounded-full glass flex items-center justify-center text-slate-500"><MicOff size={20} /></button></div>
                  <div className="flex flex-col items-center gap-2"><button onClick={() => setShowFXMenu(!showFXMenu)} className={`w-12 h-12 rounded-full flex items-center justify-center ${showFXMenu ? 'bg-red-600 text-white shadow-lg' : 'glass text-slate-500'}`}><Sliders size={20} /></button></div>
                  <div className="flex flex-col items-center gap-2"><button onClick={handleEndCall} className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center text-white shadow-xl shadow-red-600/20"><PhoneOff size={20} /></button></div>
                  <div className="flex flex-col items-center gap-2"><button className="w-12 h-12 rounded-full glass flex items-center justify-center text-slate-500"><Volume2 size={20} /></button></div>
                </div>
                {showFXMenu && (
                  <div className="absolute bottom-32 left-4 right-4 bg-[#0d0d12]/95 backdrop-blur-xl border border-white/5 rounded-3xl p-6 flex flex-col gap-6 animate-in slide-in-from-bottom-4 duration-300 shadow-2xl z-[100]">
                    <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em] flex items-center gap-2"><Sliders size={14} className="text-red-500" /> NEURAL MODULATION</h3>
                    <div className="space-y-6">
                      {[ {l:'Robotic', k:'robotic', c:'text-blue-500', a:'accent-blue-600'}, {l:'Echo', k:'echo', c:'text-emerald-500', a:'accent-emerald-600'}, {l:'Drive', k:'distortion', c:'text-red-500', a:'accent-red-600'} ].map(fx => (
                        <div key={fx.k} className="space-y-3">
                          <div className="flex justify-between items-center"><label className={`text-[10px] font-black uppercase flex items-center gap-2 ${fx.c}`}>{fx.l}</label><span className={`text-[10px] font-black ${fx.c}`}>{fxState[fx.k as keyof FXState]}%</span></div>
                          <input type="range" min="0" max="100" value={fxState[fx.k as keyof FXState]} onChange={e => handleFXChange(fx.k as keyof FXState, parseInt(e.target.value))} className={`w-full h-1.5 bg-slate-900 rounded-lg appearance-none cursor-pointer ${fx.a}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
