import { useEffect } from 'react';

const useAudioCleanup = (audioContext) => {
    useEffect(() => {
        // Cleanup function to dispose of audio context and release resources
        return () => {
            if (audioContext && audioContext.state !== 'closed') {
                audioContext.close().catch(error => {
                    console.error('Error closing audio context:', error);
                });
            }
        };
    }, [audioContext]);
};

export default useAudioCleanup;