import type {Section} from '../lesson-schema/index';
export function phraseSections(duration:number,bpm:number,beats=8):Section[]{
 if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(bpm)||bpm<30||bpm>240||!Number.isInteger(beats)||beats<1)throw new Error('Choose a tempo from 30 to 240 BPM.');
 const width=60/bpm*beats,sections:Section[]=[];for(let start=0;start<duration-.05;start+=width){const end=duration-(start+width)<.05?duration:Math.min(duration,start+width);sections.push({id:crypto.randomUUID(),label:`Phrase ${sections.length+1}`,start,end});if(end===duration)break;}
 if(!sections.length)sections.push({id:crypto.randomUUID(),label:'Phrase 1',start:0,end:duration});return sections;
}
