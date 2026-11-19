/**
 * Explicit instrument adapters for the shared music editor.
 *
 * Piano and guitar share notation, transport and practice modules, but their
 * editor tools and assessment policy differ. Keeping those differences in small
 * named adapters avoids one configuration object describing every instrument.
 */
export type MusicInstrumentId = 'piano' | 'guitar';

export type InstrumentAdapter = {
  id: MusicInstrumentId;
  label: string;
  rubricVersion: string;
  inputModes: readonly ('midi' | 'microphone')[];
  supportsChords: boolean;
  supportsTab: boolean;
  supportsStrumHud: boolean;
  defaultStaffMode: 'grand' | 'guitar-both' | 'guitar-tab';
  editorTools: readonly string[];
  practiceModes: readonly ('watch' | 'practice' | 'challenge')[];
};

const PIANO: InstrumentAdapter = {
  id: 'piano',
  label: 'Piano',
  rubricVersion: 'piano-midi-v1',
  inputModes: ['midi', 'microphone'],
  supportsChords: false,
  supportsTab: false,
  supportsStrumHud: false,
  defaultStaffMode: 'grand',
  editorTools: ['notes', 'hands', 'notation', 'velocity', 'pedal', 'alignment', 'sections'],
  practiceModes: ['watch', 'practice', 'challenge'],
};

const GUITAR: InstrumentAdapter = {
  id: 'guitar',
  label: 'Guitar',
  rubricVersion: 'guitar-notes-v1',
  inputModes: ['midi', 'microphone'],
  supportsChords: true,
  supportsTab: true,
  supportsStrumHud: true,
  defaultStaffMode: 'guitar-both',
  editorTools: ['notes', 'positions', 'tab', 'chords', 'tuning', 'capo', 'alignment', 'sections'],
  // Guitar has no challenge mode in this product; do not advertise one.
  practiceModes: ['watch', 'practice'],
};

const ADAPTERS: Record<MusicInstrumentId, InstrumentAdapter> = {piano: PIANO, guitar: GUITAR};

/** Resolve an instrument adapter, or null for an unknown subject. No fallback. */
export function instrumentAdapter(subject: string | null | undefined): InstrumentAdapter | null {
  if (subject !== 'piano' && subject !== 'guitar') return null;
  return ADAPTERS[subject];
}

export function instrumentAdapters(): InstrumentAdapter[] {
  return [PIANO, GUITAR];
}
