import {useCallback, useEffect, useRef, useState} from 'react';
import {voiceControl, type ControlState} from '../../../../packages/learning-engine/practice-capabilities';
import {PracticeVoice, type PracticeVoiceCommand, type PracticeVoiceStatus} from './practice-voice';

export type PracticeVoiceApi = {
  status: PracticeVoiceStatus;
  error: string;
  supported: boolean;
  listening: boolean;
  control: ControlState;
  start: () => boolean;
  stop: () => void;
  toggle: () => void;
};

/** React binding; the controller itself owns recognition and retry policy. */
export function usePracticeVoice(onCommand: (command: PracticeVoiceCommand) => void): PracticeVoiceApi {
  const [status, setStatus] = useState<PracticeVoiceStatus>('checking');
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(false);
  const controller = useRef<PracticeVoice | null>(null);
  const command = useRef(onCommand);
  command.current = onCommand;
  useEffect(() => {
    const voice = new PracticeVoice({
      onCommand: value => command.current(value),
      onStatus: value => setStatus(value),
      onError: message => setError(message),
    });
    controller.current = voice;
    void voice.initialize().then(() => {
      if (controller.current === voice) {
        setStatus(voice.status);
        setSupported(voice.supported);
      }
    });
    return () => {
      controller.current = null;
      voice.destroy();
    };
  }, []);
  const start = useCallback(() => {
    const value = controller.current?.start() ?? false;
    if (value) setError('');
    return value;
  }, []);
  const stop = useCallback(() => controller.current?.stop(), []);
  const toggle = useCallback(() => controller.current?.toggle(), []);
  return {
    status,
    error,
    supported: supported || status === 'checking' || status === 'off' || status === 'listening' || status === 'starting' || status === 'reconnecting',
    listening: status === 'listening',
    control: voiceControl(status, error, supported || status !== 'unavailable'),
    start, stop, toggle,
  };
}
