export type Section = { id: string; label: string; start: number; end: number };
export type SectionSet = { id: string; revision: number; duration: number; sections: Section[] };
export type Asset = { key: string; mime: string; bytes: number; sha256: string };
export type LessonManifest = {
  schema_version: 1; lesson_id: string; revision_id: string; title: string;
  duration: number; source_start: number; standing_time: number;
  engine: 'sam-3d-body' | 'mediapipe' | 'synthetic'; engine_version: string;
  units: 'metres'; landmark_axes: 'x-right/y-down/z-forward';
  root_motion: 'estimated-camera-relative' | 'hip-relative' | 'in-place';
  confidence: 'unmeasured' | 'measured'; animation: Asset; landmarks: Asset;
  source_video: Asset | null; thumbnail: Asset | null; section_set: SectionSet; warnings: string[];
};

export function validateSections(sections: Section[], duration: number): Section[] {
  if (!Number.isFinite(duration) || duration <= 0 || !sections.length) throw new Error('A lesson needs at least one section.');
  let end = 0;
  const ids = new Set<string>();
  for (const s of sections) {
    if (!s.id || ids.has(s.id) || !s.label.trim() || s.label.length > 80 || !Number.isFinite(s.start) || !Number.isFinite(s.end) || Math.abs(s.start-end)>1e-6 || s.end-s.start<.05-1e-9) throw new Error('Sections must cover the lesson without gaps or overlaps.');
    ids.add(s.id); end=s.end;
  }
  if (Math.abs(end-duration)>1e-6) throw new Error('The final section must end with the lesson.');
  return sections.map(s=>({...s}));
}

export function splitSection(sections: Section[], duration: number, time: number, id: string): Section[] {
  const draft=validateSections(sections,duration);
  const index=draft.findIndex(s=>time-s.start>=.05 && s.end-time>=.05);
  if (index<0) throw new Error('Move away from the section edge to split.');
  const current=draft[index];
  draft.splice(index,1,{...current,end:time},{id,label:`${current.label.slice(0,70)} · part 2`,start:time,end:current.end});
  return validateSections(draft,duration);
}

export function mergeNext(sections: Section[], duration: number, index: number): Section[] {
  const draft=validateSections(sections,duration);
  if(index<0 || index>=draft.length-1) throw new Error('Select a section with a following section.');
  draft.splice(index,2,{...draft[index],end:draft[index+1].end});
  return validateSections(draft,duration);
}
