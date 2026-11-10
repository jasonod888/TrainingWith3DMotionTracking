// Installed react-piano 3.1.3 has no declarations. Shared production/spike public surface.
declare module 'react-piano' {
  import type {ComponentType,ReactNode} from 'react';
  export type PianoProps={
    noteRange:{first:number;last:number};activeNotes?:number[];width?:number;
    playNote:(pitch:number)=>void;stopNote:(pitch:number)=>void;
    onPlayNoteInput?:(pitch:number,previous:unknown)=>void;onStopNoteInput?:(pitch:number,previous:unknown)=>void;
    keyboardShortcuts?:{key:string;midiNumber:number}[];disabled?:boolean;className?:string;keyWidthToHeight?:number;
    renderNoteLabel?:(note:{midiNumber:number;isActive:boolean;isAccidental:boolean;keyboardShortcut:string|null})=>ReactNode;
  };
  export const Piano:ComponentType<PianoProps>;
  export const ControlledPiano:ComponentType<PianoProps>;
}
