import type {LessonManifest} from '../../../packages/lesson-schema/index';
export async function loadDemo(signal?:AbortSignal):Promise<LessonManifest|null>{
  const response=await fetch('/api/demo',{signal});
  if(response.status===404)return null;
  if(!response.ok)throw new Error('Your lesson could not be loaded. Try again.');
  const value=await response.json() as LessonManifest;
  if(value.schema_version!==1)throw new Error('This lesson format is not supported.');
  return value;
}
export const assetUrl=(key:string)=>`/api/demo/assets/${encodeURIComponent(key.split('/').pop()!)}`;
