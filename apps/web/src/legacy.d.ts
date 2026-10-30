// Typed boundaries around the accepted MVP's unchanged numerical/runtime modules.
declare module '*web/dist/pose.js' {
 export type Point={x:number;y:number;z:number;visibility?:number;presence?:number};
 export type Calibration={height:number;floor:number;center:number};
 export type Reference={duration:number;times:number[];keypoints:number[][][]};
 export class HeightCalibration{samples:unknown[];reset():void;sample(image:Point[],world:Point[],now:number):{done?:boolean;progress:number;value:Calibration;message:string};}
 export const MP:Record<string,number>;
 export const LINKS:[string,string][];
 export function videoFit(vw:number,vh:number,w:number,h:number):{width:number;height:number;x:number;y:number};
 export function heightPlacement(value:Calibration,vw:number,vh:number,w:number,h:number,frustum:number,avatarHeight:number):{scale:number;floorY:number;screenHeight:number};
 export function fromMediaPipe(world:Point[],image:Point[]):unknown;
 export function bestMatch(student:unknown,reference:Reference,time:number,mirror:boolean,playing:boolean):{score:number;joints:Record<string,number>;time:number}|null;
}
declare module '*web/dist/composite.js' {
 export function compositeOffset(fraction:number,vw:number,vh:number,w:number,h:number,frustum:number):{pixelX:number;worldX:number};
 export function suggestedAvatarPosition(calibration:{height:number;center:number}|null,side:string,vw:number,vh:number,mirrored:boolean):number;
}
declare module '*web/dist/hand-labels.js' {
 export function liveHandPositions(points:import('*web/dist/pose.js').Point[],vw:number,vh:number,w:number,h:number,mirror:boolean):Record<string,{x:number;y:number}|null>;
 export function placeHandLabels(elements:Record<string,HTMLElement>,positions:Record<string,{x:number;y:number}|null>,w:number,h:number):void;
}
declare module '*web/dist/voice.js' {
 export class VoiceCommands{enabled:boolean;constructor(options:{Recognition:unknown;onCommand:(command:'next'|'back'|'again'|'pause')=>void;onState:(state:string)=>void;onError:(message:string)=>void});start():void;stop():void;}
}
