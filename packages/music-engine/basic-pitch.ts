/**
 * Profile-faithful Basic Pitch windowing and decoding for the pinned 0.4.0 ONNX
 * artifact. The constants below are verified against the local model/profile:
 * 22,050 Hz, hop 256, 43,844-sample windows, 30-frame overlap, 36,164-sample stride,
 * 3,840-sample leading pad, 172 output frames and MIDI 21..108.
 *
 * No model is loaded here; this module is deterministic and browser-independent so
 * decoder parity can be tested against saved Python activations.
 */
export type BasicPitchProfile = {
  version:'basic-pitch-0.4.0';
  decodingVersion:'basic-pitch-0.4.0/decoding-v1' | 'basic-pitch-0.4.0/piano-peaks-v1';
  sampleRate:22050;
  fftHop:256;
  windowSamples:43844;
  overlapFrames:30;
  strideSamples:36164;
  leadPadding:3840;
  framesPerWindow:172;
  frequencyBins:88;
  midiOffset:21;
  weightsSha256:string;
  thresholds:{
    onsetThreshold:number;
    frameThreshold:number;
    minimumNoteLengthMs:number;
    onsetProminence?:number;
    minimumAttackSpacingMs?:number;
  };
};
export type BasicPitchNote = {onset:number; duration:number; pitch:number; amplitude:number};
export type BasicPitchActivations = {
  note:Float32Array;
  onset:Float32Array;
  contourFrames:number;
  frames:number;
  frequencyBins:number;
};

export const BASIC_PITCH_PROFILE:BasicPitchProfile = Object.freeze({
  version:'basic-pitch-0.4.0',
  decodingVersion:'basic-pitch-0.4.0/decoding-v1',
  sampleRate:22050,
  fftHop:256,
  windowSamples:43844,
  overlapFrames:30,
  strideSamples:36164,
  leadPadding:3840,
  framesPerWindow:172,
  frequencyBins:88,
  midiOffset:21,
  weightsSha256:'2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec',
  thresholds:{onsetThreshold:.5,frameThreshold:.3,minimumNoteLengthMs:127.7},
});

export const BASIC_PITCH_MODEL_IDENTITY = Object.freeze({
  model:'basic-pitch',
  version:'0.4.0',
  engine:'onnx',
  weightsSha256:'2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec',
  inputName:'serving_default_input_2:0',
  noteOutput:'StatefulPartitionedCall:2',
  onsetOutput:'StatefulPartitionedCall:1',
  contourOutput:'StatefulPartitionedCall:0',
  modelUrl:'/models/basic-pitch-0.4.0.onnx',
  wasmPath:'/onnxruntime/',
});

export const PIANO_PEAKS_PROFILE:BasicPitchProfile = Object.freeze({
  ...BASIC_PITCH_PROFILE,
  decodingVersion:'basic-pitch-0.4.0/piano-peaks-v1',
  thresholds:{onsetThreshold:.6,frameThreshold:.3,minimumNoteLengthMs:80,onsetProminence:.2,minimumAttackSpacingMs:70},
});

const ANNOTATIONS_FPS = 86;
const MAX_FREQ_IDX = 87;
const ENERGY_TOLERANCE = 11;
const LEADING_FRAMES = 15;

export function monoFloat32(input:Float32Array|Float32Array[]):Float32Array {
  if (Array.isArray(input)) {
    if (!input.length) throw new Error('Audio has no channels.');
    const length=input[0].length;
    if (input.some(channel => channel.length !== length)) throw new Error('Audio channels have different lengths.');
    const mono=new Float32Array(length);
    for (let index=0; index<length; index+=1) {
      let sum=0;
      for (const channel of input) sum+=channel[index]??0;
      mono[index]=sum/input.length;
    }
    return mono;
  }
  return input;
}

/** Linear downmix/resample for testable PCM preparation; browser capture uses OfflineAudioContext. */
export function resampleLinear(input:Float32Array, fromRate:number, toRate:number):Float32Array {
  if (!Number.isFinite(fromRate)||fromRate<=0||!Number.isFinite(toRate)||toRate<=0) throw new Error('Invalid audio sample rate.');
  if (fromRate===toRate) return new Float32Array(input);
  const outputLength=Math.max(1,Math.round(input.length*toRate/fromRate));
  const output=new Float32Array(outputLength);
  const ratio=fromRate/toRate;
  for (let index=0; index<outputLength; index+=1) {
    const source=index*ratio;
    const left=Math.min(input.length-1,Math.floor(source));
    const right=Math.min(input.length-1,left+1);
    const fraction=source-left;
    output[index]=(input[left]??0)*(1-fraction)+(input[right]??0)*fraction;
  }
  return output;
}

export function windowAudio(pcm:Float32Array, profile:BasicPitchProfile=BASIC_PITCH_PROFILE):Float32Array[] {
  if (!(pcm instanceof Float32Array)||!pcm.length) throw new Error('Audio has no samples.');
  const padded=new Float32Array(pcm.length+profile.leadPadding);
  padded.set(pcm,profile.leadPadding);
  const windows:Float32Array[]=[];
  for (let offset=0; offset<padded.length; offset+=profile.strideSamples) {
    const window=new Float32Array(profile.windowSamples);
    window.set(padded.subarray(offset,Math.min(padded.length,offset+profile.windowSamples)));
    windows.push(window);
    if (windows.length>4096) throw new Error('Audio is too long for bounded windowing.');
  }
  return windows;
}

export function stitchActivations(
  output:{note:Float32Array;onset:Float32Array;contour:Float32Array}[],
  originalLength:number,
  profile:BasicPitchProfile=BASIC_PITCH_PROFILE,
):BasicPitchActivations {
  if (!output.length) throw new Error('The model returned no windows.');
  const framesPerWindow=profile.framesPerWindow;
  const combined=(name:'note'|'onset'|'contour'):{data:Float32Array;width:number}=>{
    const width=name==='contour'?264:profile.frequencyBins;
    const data=new Float32Array(output.length*framesPerWindow*width);
    output.forEach((window,index)=>{
      const values=window[name];
      if (!(values instanceof Float32Array)||values.length!==framesPerWindow*width) throw new Error(`Unexpected ${name} activation shape.`);
      data.set(values,index*framesPerWindow*width);
    });
    return {data,width};
  };
  const note=combined('note'),onset=combined('onset');
  const trim=(values:Float32Array,width:number):Float32Array=>{
    const start=LEADING_FRAMES*width;
    const end=values.length-(profile.overlapFrames-LEADING_FRAMES)*width;
    const sliced=values.subarray(start,Math.max(start,end));
    const originalFrames=Math.max(0,Math.floor(originalLength*(ANNOTATIONS_FPS/profile.sampleRate)));
    return new Float32Array(sliced.subarray(0,Math.min(sliced.length,originalFrames*width)));
  };
  const noteData=trim(note.data,note.width);
  const onsetData=trim(onset.data,onset.width);
  const frames=noteData.length/profile.frequencyBins;
  return {note:noteData,onset:onsetData,contourFrames:frames,frames,frequencyBins:profile.frequencyBins};
}

function localMaxima(values:Float32Array):number[] {
  const peaks:number[]=[];
  for (let index=1; index<values.length-1; index+=1) {
    if (values[index]>values[index-1]&&values[index]>=values[index+1]) peaks.push(index);
  }
  return peaks;
}

function prominence(values:Float32Array,peak:number,wlen:number):number {
  const half=Math.max(1,Math.floor(wlen/2));
  const left=Math.max(0,peak-half),right=Math.min(values.length-1,peak+half);
  const height=values[peak];
  let leftBase=height,index=peak-1;
  while (index>=left) { leftBase=Math.min(leftBase,values[index]); if (values[index]>height) break; index-=1; }
  let rightBase=height;index=peak+1;
  while (index<=right) { rightBase=Math.min(rightBase,values[index]); if (values[index]>height) break; index+=1; }
  return height-Math.max(leftBase,rightBase);
}

function selectPeaks(values:Float32Array,threshold:number,prominenceThreshold=0,distance=1,wlen=25):number[] {
  let peaks=localMaxima(values).filter(index=>values[index]>=threshold);
  if (prominenceThreshold>0) peaks=peaks.filter(index=>prominence(values,index,wlen)>=prominenceThreshold);
  if (distance>1) {
    const chosen:number[]=[];
    for (const peak of [...peaks].sort((left,right)=>values[right]-values[left]||left-right)) {
      if (chosen.every(other=>Math.abs(other-peak)>=distance)) chosen.push(peak);
    }
    chosen.sort((left,right)=>left-right);
    return chosen;
  }
  return peaks;
}

function inferredOnsets(onsets:Float32Array,frames:Float32Array,framesCount:number,bins:number):Float32Array {
  let maxOnset=0,maxDiff=0;
  for (const value of onsets) if (value>maxOnset) maxOnset=value;
  const diffs:Float32Array[]=[];
  for (let n=1; n<=2; n+=1) {
    const diff=new Float32Array(framesCount*bins);
    for (let frame=n; frame<framesCount; frame+=1) for (let bin=0; bin<bins; bin+=1) {
      diff[frame*bins+bin]=frames[frame*bins+bin]-frames[(frame-n)*bins+bin];
    }
    diffs.push(diff);
  }
  const minimum=new Float32Array(framesCount*bins);
  for (let index=0; index<minimum.length; index+=1) minimum[index]=Math.min(diffs[0][index],diffs[1][index]);
  for (let index=0; index<minimum.length; index+=1) {
    if (minimum[index]<0||index<2*bins) minimum[index]=0;
    if (minimum[index]>maxDiff) maxDiff=minimum[index];
  }
  if (maxDiff>0&&maxOnset>0) for (let index=0; index<minimum.length; index+=1) minimum[index]=maxOnset*minimum[index]/maxDiff;
  const result=new Float32Array(onsets.length);
  for (let index=0; index<onsets.length; index+=1) result[index]=Math.max(onsets[index],minimum[index]);
  return result;
}

function pianoPeakOnsets(onsets:Float32Array,framesCount:number,bins:number,profile:BasicPitchProfile):Float32Array {
  const output=new Float32Array(onsets.length);
  const spacing=Math.max(1,Math.round((profile.thresholds.minimumAttackSpacingMs??70)/1000*profile.sampleRate/profile.fftHop));
  for (let bin=0; bin<bins; bin+=1) {
    const column=new Float32Array(framesCount);
    for (let frame=0; frame<framesCount; frame+=1) column[frame]=onsets[frame*bins+bin];
    const peaks=selectPeaks(column,profile.thresholds.onsetThreshold,profile.thresholds.onsetProminence??0,spacing,25);
    for (const frame of peaks) output[frame*bins+bin]=onsets[frame*bins+bin];
  }
  return output;
}

function modelFramesToTime(frame:number):number {
  const original=frame*256/22050;
  const windowOffset=(256/22050)*(172-43844/256)+.0018;
  return original-windowOffset*Math.floor(frame/172);
}

export function decodeBasicPitch(activations:BasicPitchActivations,duration:number,profile:BasicPitchProfile=BASIC_PITCH_PROFILE):BasicPitchNote[] {
  if (!Number.isFinite(duration)||duration<=0) throw new Error('Invalid transcription duration.');
  const {frames,frequencyBins:bins}=activations;
  if (!Number.isInteger(frames)||frames<0||activations.note.length!==frames*bins||activations.onset.length!==frames*bins) throw new Error('Invalid activation dimensions.');
  let onsets=activations.onset;
  if (profile.decodingVersion==='basic-pitch-0.4.0/piano-peaks-v1') onsets=pianoPeakOnsets(onsets,frames,bins,profile);
  else onsets=inferredOnsets(onsets,activations.note,frames,bins);
  const peakOnsets=new Float32Array(onsets.length);
  if (profile.decodingVersion==='basic-pitch-0.4.0/piano-peaks-v1') {
    peakOnsets.set(onsets);
  } else {
    for (let bin=0; bin<bins; bin+=1) {
      const column=new Float32Array(frames);
      for (let frame=0; frame<frames; frame+=1) column[frame]=onsets[frame*bins+bin];
      for (const frame of selectPeaks(column,profile.thresholds.onsetThreshold,0,1,25)) peakOnsets[frame*bins+bin]=onsets[frame*bins+bin];
    }
  }
  const remaining=new Float32Array(activations.note);
  const starts:{frame:number;bin:number}[]=[];
  for (let frame=frames-1; frame>=0; frame-=1) for (let bin=bins-1; bin>=0; bin-=1) {
    if (peakOnsets[frame*bins+bin]>=profile.thresholds.onsetThreshold) starts.push({frame,bin});
  }
  const minimumFrames=Math.max(1,Math.round(profile.thresholds.minimumNoteLengthMs/1000*profile.sampleRate/profile.fftHop));
  const notes:BasicPitchNote[]=[];
  for (const start of starts) {
    if (start.frame>=frames-1) continue;
    let index=start.frame+1,dropped=0;
    while (index<frames-1&&dropped<ENERGY_TOLERANCE) {
      if (remaining[index*bins+start.bin]<profile.thresholds.frameThreshold) dropped+=1; else dropped=0;
      index+=1;
    }
    index-=dropped;
    if (index-start.frame<=minimumFrames) continue;
    for (let frame=start.frame; frame<index; frame+=1) {
      remaining[frame*bins+start.bin]=0;
      if (start.bin<MAX_FREQ_IDX) remaining[frame*bins+start.bin+1]=0;
      if (start.bin>0) remaining[frame*bins+start.bin-1]=0;
    }
    let amplitude=0;
    for (let frame=start.frame; frame<index; frame+=1) amplitude+=activations.note[frame*bins+start.bin];
    amplitude/=Math.max(1,index-start.frame);
    const onset=Math.max(0,modelFramesToTime(start.frame));
    const end=Math.max(onset,modelFramesToTime(index));
    if (onset>=duration||end<=onset) continue;
    notes.push({onset:Math.min(duration,onset),duration:Math.max(.001,Math.min(duration,end)-onset),
      pitch:start.bin+profile.midiOffset,amplitude});
    if (notes.length>=20000) break;
  }
  notes.sort((left,right)=>left.onset-right.onset||left.pitch-right.pitch);
  return notes;
}

/** Bounded memory guard shared by worker and upload paths. */
export const MAX_TRANSCRIPTION_SECONDS = 600;
export function validatePcmDuration(sampleCount:number,sampleRate:number):void {
  if (!Number.isFinite(sampleCount)||sampleCount<0||!Number.isFinite(sampleRate)||sampleRate<=0) throw new Error('Invalid PCM length.');
  if (sampleCount/sampleRate>MAX_TRANSCRIPTION_SECONDS) throw new Error('Recording exceeds the supported transcription length.');
}
