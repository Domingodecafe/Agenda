/* Uma transação IndexedDB engloba leitura, validação e gravação. */
(() => {
  'use strict';
  const env=globalThis.AnaEnvironment;
  if(!env?.isAllowed())return;
  const key='ana-dev-assistant-v1';
  function open() {
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(env.database,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(env.store);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
  }
  async function read() {
    const db=await open();
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction(env.store,'readonly');const req=tx.objectStore(env.store).get(key);
      let value;req.onsuccess=()=>{value=req.result;};tx.oncomplete=()=>resolve(value||AnaPolicy.empty());tx.onabort=()=>reject(tx.error);
    });}finally{db.close();}
  }
  async function dispatch(cmd,now=Date.now()) {
    const db=await open();
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction(env.store,'readwrite');const store=tx.objectStore(env.store),req=store.get(key);
      let answer,failure;
      req.onsuccess=()=>{
        try{answer=AnaPolicy.execute(req.result||AnaPolicy.empty(),cmd,now);store.put(answer.state,key);}
        catch(error){failure=error;tx.abort();}
      };
      tx.oncomplete=()=>resolve(answer);tx.onabort=()=>reject(failure||tx.error||new Error('Gravação local interrompida.'));
    });}finally{db.close();}
  }
  globalThis.AnaLocalStore={read,dispatch};
})();
