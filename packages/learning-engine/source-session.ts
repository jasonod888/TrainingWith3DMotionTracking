/** Owns only resources explicitly started for the current camera/test source. */
export class SourceSession {
 generation=0;
 private releases=new Set<()=>void>();
 retain(release:()=>void,generation:number){
  if(generation!==this.generation){release();return false;}
  this.releases.add(release);return true;
 }
 stop(){
  this.generation++;
  const pending=[...this.releases];this.releases.clear();
  for(const release of pending){try{release();}catch{/* Continue releasing the other source resources. */}}
 }
}
