import {VoiceCommands} from '../../../../web/dist/voice.js';
import {request} from '../api';
import {localRecognition} from '../local-voice';

export type PracticeVoiceStatus = 'checking' | 'off' | 'starting' | 'listening' | 'reconnecting' | 'unavailable';
export type PracticeVoiceCommand = 'next' | 'back' | 'again' | 'pause' | 'resume' | 'slower' | 'faster' | 'loop' | 'restart-lesson' | 'repeat-section';

type RecognitionConstructor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  abort: () => void;
  onstart?: () => void;
  onend?: () => void;
  onerror?: (event: {error: string; message?: string}) => void;
  onresult?: (event: unknown) => void;
};

export type PracticeVoiceOptions = {
  onCommand: (command: PracticeVoiceCommand) => void;
  onStatus: (status: PracticeVoiceStatus) => void;
  onError: (message: string) => void;
  /** Injectable for tests. */
  browserRecognition?: RecognitionConstructor | null;
  checkLocal?: () => Promise<{available: boolean}>;
  createLocal?: (transcribe: (pcm: string) => Promise<{text: string; confidence: number}>) => RecognitionConstructor;
};

/**
 * One voice lifecycle for every subject.
 *
 * - availability is checked without requesting microphone permission;
 * - "listening" is reported only after recognition actually starts;
 * - duplicate suppression, reconnection bounds and error wording live in the
 *   shared `VoiceCommands` controller;
 * - local app recognition is preferred when available, browser speech is the
 *   fallback, and either provider can be absent.
 */
export class PracticeVoice {
  status: PracticeVoiceStatus = 'checking';
  error = '';
  supported = false;
  private controller: InstanceType<typeof VoiceCommands> | null = null;
  private Recognition: RecognitionConstructor | null = null;
  private readonly options: PracticeVoiceOptions;
  private disposed = false;

  constructor(options: PracticeVoiceOptions) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    if (this.disposed) return;
    let local: {available: boolean} = {available: false};
    try { local = await (this.options.checkLocal ?? (() => request<{available: boolean}>('/voice/capability')))().catch(() => ({available: false})); } catch { local = {available: false}; }
    if (this.disposed) return;
    const browser = this.options.browserRecognition !== undefined
      ? this.options.browserRecognition
      : (globalThis.window as unknown as {SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor})?.SpeechRecognition
        ?? (globalThis.window as unknown as {webkitSpeechRecognition?: RecognitionConstructor})?.webkitSpeechRecognition
        ?? null;
    const canLocal = local.available && typeof navigator !== 'undefined'
      && typeof navigator.mediaDevices?.getUserMedia === 'function'
      && typeof AudioWorkletNode !== 'undefined';
    const Recognition = canLocal
      ? (this.options.createLocal ?? localRecognition)(pcm => request('/voice/recognize', 'POST', {pcm})) as unknown as RecognitionConstructor
      : browser;
    this.Recognition = Recognition ?? null;
    this.supported = Boolean(Recognition);
    if (!Recognition) {
      this.setStatus('unavailable');
      return;
    }
    this.controller = new VoiceCommands({
      Recognition,
      extended: true,
      onCommand: command => {
        this.options.onCommand(command as PracticeVoiceCommand);
      },
      onState: state => {
        if (state === 'listening') this.setStatus('listening');
        else if (state === 'reconnecting') this.setStatus('reconnecting');
        else if (state === 'starting') this.setStatus('starting');
        else if (state === 'off' && this.status !== 'unavailable') this.setStatus('off');
      },
      onError: message => {
        this.error = message;
        this.setStatus('off');
        this.options.onError(message);
      },
    });
    this.setStatus('off');
  }

  private setStatus(status: PracticeVoiceStatus) {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus(status);
  }

  start(): boolean {
    if (this.disposed) return false;
    if (!this.controller || !this.Recognition) {
      this.error = 'Voice recognition is unavailable in this browser.';
      this.setStatus('unavailable');
      this.options.onError(this.error);
      return false;
    }
    this.error = '';
    this.controller.start();
    return true;
  }

  stop() {
    this.controller?.stop();
    if (!this.disposed) this.setStatus(this.supported ? 'off' : 'unavailable');
  }

  toggle() {
    if (this.status === 'listening' || this.status === 'starting' || this.status === 'reconnecting') this.stop();
    else this.start();
  }

  get listening() { return this.status === 'listening'; }

  destroy() {
    this.disposed = true;
    this.controller?.stop();
    this.controller = null;
    this.Recognition = null;
    this.setStatus('off');
  }
}
