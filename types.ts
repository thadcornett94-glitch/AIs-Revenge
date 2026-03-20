
export interface PrankScenario {
  id: string;
  name: string;
  description: string;
  systemInstruction: string;
  callerId: string;
  avatar: string;
  color: string;
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
}

export enum CallStatus {
  IDLE = 'IDLE',
  DIALING = 'DIALING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface TranscriptionItem {
  role: 'user' | 'model';
  text: string;
  id: string;
}

export interface CallRecording {
  id: string;
  scenarioName: string;
  timestamp: number;
  duration: number;
  blobUrl: string;
}

export interface TriggerEvent {
  id: string;
  type: 'Keyword' | 'Tone';
  label: string;
  timestamp: number;
}
