export type FeedbackSample={score:number|null;cue:string;coverage:number};
/** Excludes unclear samples and summarizes an attempt, rather than its final frame. */
export class AttemptFeedback {
 private total=0;private valid=0;private seen=0;private cues=new Map<string,number>();
 sample(value:FeedbackSample){this.seen++;if(value.score===null||!Number.isFinite(value.score)||value.coverage<.75)return;this.total+=value.score;this.valid++;if(value.cue)this.cues.set(value.cue,(this.cues.get(value.cue)??0)+1);}
 reset(){this.total=0;this.valid=0;this.seen=0;this.cues.clear();}
 result(){const coverage=this.seen?this.valid/this.seen:0;return {score:this.valid>=3&&coverage>=.6?Math.round(this.total/this.valid):null,coverage,cue:[...this.cues].sort((a,b)=>b[1]-a[1])[0]?.[0]??''};}
}
