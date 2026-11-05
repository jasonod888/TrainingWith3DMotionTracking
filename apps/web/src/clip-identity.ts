export type ClipIdentity={subject?:string|null;instrument?:string|null;preparationVersion?:string|null};
export function matchesClipIdentity(meta:ClipIdentity|undefined,job:{subject?:string;instrument?:string|null;preparation?:Record<string,unknown>}):boolean{
 if(job.instrument)return Boolean(meta&&meta.subject===job.subject&&meta.instrument===job.instrument&&
   meta.preparationVersion&&meta.preparationVersion===job.preparation?.preparation_version);
 // Old movement cache entries predate subject metadata; job id and part hashes still bind them.
 return !meta||((meta.subject==null||meta.subject===(job.subject??'movement_other'))&&!meta.instrument&&!meta.preparationVersion);
}
