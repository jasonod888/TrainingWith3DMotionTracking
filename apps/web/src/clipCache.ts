// Store the exact prepared bytes, since re-encoding may produce different checksums.
type Entry={file:File;expires:number};
async function cache<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>,name='clips'):Promise<T>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('form-prepared-clips',2);request.onupgradeneeded=()=>{for(const name of ['clips','posters'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction(name,mode);const request=run(tx.objectStore(name));tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Could not save the prepared clip on this device.'));});}finally{db.close();}
}
export const saveClip=(id:string,file:File)=>cache('readwrite',store=>store.put({file,expires:Date.now()+7*86400000},id));
export const removeClip=(id:string)=>cache('readwrite',store=>store.delete(id));
export const savePoster=(id:string,image:string)=>cache('readwrite',store=>store.put({image,expires:Date.now()+7*86400000},id),'posters');
export async function loadPoster(id:string):Promise<string|undefined>{
 const entry=await cache<{image:string;expires:number}|undefined>('readonly',store=>store.get(id),'posters');
 return entry&&entry.expires>Date.now()?entry.image:undefined;
}
export const clearClips=()=>Promise.all(['clips','posters'].map(name=>cache('readwrite',store=>store.clear(),name)));
export const pruneClips=()=>Promise.all(['clips','posters'].map(name=>cache('readwrite',store=>{
 const request=store.openCursor();
 request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(cursor.value.expires<=Date.now())cursor.delete();cursor.continue();};
 return request;
},name)));
export async function loadClip(id:string):Promise<File|undefined>{
 const entry=await cache<Entry|undefined>('readonly',store=>store.get(id));
 if(entry&&entry.expires>Date.now())return entry.file;
 if(entry)await removeClip(id);
}
