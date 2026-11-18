import {useCallback, useEffect, useRef, useState} from 'react';
import type {PracticeVoiceApi} from './usePracticeVoice';

export type VoiceStartStatus = 'idle' | 'asking' | 'requesting' | 'fallback';

/**
 * One shared start/voice coordinator.
 *
 * Start requests voice and waits for observed listening before running the
 * continuation, unless voice is unsupported or the learner explicitly chose
 * "Without voice". Choosing without voice never starts recognition. An explicit
 * off choice is remembered for the session, and cancellation clears the pending
 * continuation so a late provider start cannot begin practice.
 */
export function useVoiceStartCoordinator(voice: PracticeVoiceApi) {
  const [status, setStatus] = useState<VoiceStartStatus>('idle');
  const [decided, setDecided] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const statusRef = useRef(status);
  statusRef.current = status;

  const begin = useCallback(() => {
    const continuation = pending.current;
    pending.current = null;
    setStatus('idle');
    continuation?.();
  }, []);

  const requestStart = useCallback((continuation: () => void, options: {prompt?: boolean} = {}) => {
    const current = voiceRef.current;
    if (!current.supported || decided || options.prompt === false) {
      continuation();
      return;
    }
    if (current.listening) { continuation(); return; }
    pending.current = continuation;
    setStatus('asking');
    current.stop();
  }, [decided]);

  const startWithVoice = useCallback(() => {
    const current = voiceRef.current;
    if (!current.supported) { begin(); return; }
    setStatus('requesting');
    if (!current.start()) {
      setStatus('fallback');
    }
  }, [begin]);

  const chooseWithoutVoice = useCallback(() => {
    // Explicitly never call start() here; this must not open the microphone.
    const current = voiceRef.current;
    if (current.listening || current.status === 'starting' || current.status === 'reconnecting') {
      current.stop();
    }
    setDecided(true);
    begin();
  }, [begin]);

  const retry = useCallback(() => {
    const current = voiceRef.current;
    if (!current.supported) { begin(); return; }
    setStatus('requesting');
    if (!current.start()) setStatus('fallback');
  }, [begin]);

  const cancel = useCallback(() => {
    pending.current = null;
    const current = voiceRef.current;
    if (current.listening || current.status === 'starting' || current.status === 'reconnecting') current.stop();
    setStatus('idle');
  }, []);

  const markOff = useCallback(() => {
    cancel();
    setDecided(true);
  }, [cancel]);

  useEffect(() => {
    if (status !== 'requesting') return;
    if (voice.listening) { setDecided(true); begin(); }
    else if (voice.error) setStatus('fallback');
  }, [status, voice.listening, voice.error, begin]);

  useEffect(() => {
    if (status === 'asking' && voice.status === 'unavailable' && pending.current) setStatus('fallback');
  }, [status, voice.status]);

  return {status, decided, requestStart, startWithVoice, chooseWithoutVoice, retry, cancel, markOff};
}
