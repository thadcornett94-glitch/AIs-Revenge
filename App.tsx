import React, { useEffect, useCallback, useRef } from 'react';

function App() {
  const audioSourcesRef = useRef([]);
  const fxRackRef = useRef(null);
  const recorderRef = useRef(null);
  const mediaStreamTracksRef = useRef([]);

  // Proper cleanup function
  const cleanupAudioResources = useCallback(() => {
    // Stop all audio sources
    audioSourcesRef.current.forEach(source => {
      if (source && typeof source.stop === 'function') {
        source.stop();
      }
    });
    audioSourcesRef.current = [];

    // Disconnect FX rack
    if (fxRackRef.current) {
      fxRackRef.current.disconnect();
      fxRackRef.current = null;
    }

    // Stop recorder
    if (recorderRef.current && typeof recorderRef.current.stop === 'function') {
      recorderRef.current.stop();
    }

    // Stop media stream tracks
    mediaStreamTracksRef.current.forEach(track => {
      if (track && typeof track.stop === 'function') {
        track.stop();
      }
    });
    mediaStreamTracksRef.current = [];
  }, []);

  const clearCallState = useCallback(() => {
    // Other state clearing logic goes here...
    cleanupAudioResources(); // Clean up audio resources
  }, [cleanupAudioResources]);

  useEffect(() => {
    // Component mount logic goes here...

    return () => {
      cleanupAudioResources(); // Cleanup on unmount
    };
  }, [cleanupAudioResources]);

  return (
    <div>
      {/* Your component UI goes here... */}
    </div>
  );
}

export default App;
