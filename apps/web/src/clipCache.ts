// Store the exact prepared bytes, since re-encoding may produce different checksums.
type Entry={file:File;expires:number};
async function cache<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('form-prepared-clips',1);request.onupgradeneeded=()=>request.result.createObjectStore('clips');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 try{return await new Promise<T>((resolve,reject)=>{const tx=db.transaction('clips',mode);const request=run(tx.objectStore('clips'));tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(tx.error??new Error('Could not save the prepared clip on this device.'));});}finally{db.close();}
}
export const saveClip=(id:string,file:File)=>cache('readwrite',store=>store.put({file,expires:Date.now()+7*86400000},id));
export const removeClip=(id:string)=>cache('readwrite',store=>store.delete(id));
export const clearClips=()=>cache('readwrite',store=>store.clear());
export const pruneClips=()=>cache('readwrite',store=>{
 const request=store.openCursor();
 request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(cursor.value.expires<=Date.now())cursor.delete();cursor.continue();};
 return request;
});
export async function loadClip(id:string):Promise<File|undefined>{
 const entry=await cache<Entry|undefined>('readonly',store=>store.get(id));
 if(entry&&entry.expires>Date.now())return entry.file;
 if(entry)await removeClip(id);
}
