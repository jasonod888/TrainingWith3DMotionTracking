declare module 'react-piano' {
  import type {ComponentType} from 'react';
  export const Piano: ComponentType<Record<string, unknown>>;
  export const ControlledPiano: ComponentType<Record<string, unknown>>;
  export const KeyboardShortcuts: ComponentType<Record<string, unknown>>;
  export const MidiNumbers: {fromNote: (note: string) => number};
}
