import type {Calibration} from '../../../web/dist/pose.js';
export type PracticeFraming={active:boolean;calibrating:boolean;calibration:Calibration|null;videoWidth:number;videoHeight:number;mirrored:boolean;mirrorReference:boolean;composite:boolean;position:number;opacity:number;angle?:number;resetVersion?:number};
export type PracticePreferences={time:number;speed:number;mode:'sections'|'continuous';range:{start:number;end:number}|null;loop:boolean;countdown:number;repetitions:number;rest:number};
