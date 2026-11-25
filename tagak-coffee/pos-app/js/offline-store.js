/* Store a sale, its cash tender and its ordered outbox in the same record. */
const posStore = (() => {
  let connection;
  function open() {
    if (!connection) connection = new Promise((resolve,reject) => {
      const request = indexedDB.open('tagak-pos-emergency',1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('state');
        request.result.createObjectStore('sales',{keyPath:'id'});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error=>{connection=null;throw error;});
    return connection;
  }
  async function access(stores,mode,work) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(stores,mode,mode==='readwrite'?{durability:'strict'}:undefined);
      let result, failure;
      const done=value=>{result=value;};
      const fail=message=>{failure=new Error(message);tx.abort();};
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(failure || tx.error || new Error('Local write interrupted'));
      work(tx,done,fail);
    });
  }
  const get = key=>access('state','readonly',(tx,done)=>{
    const req=tx.objectStore('state').get(key);
    req.onsuccess=()=>done(req.result);
  });
  const set=(key,value)=>access('state','readwrite',tx=>tx.objectStore('state').put(value,key));
  const lock=logout=>access('state','readwrite',tx=>{
    const store=tx.objectStore('state');
    store.put(null,'shift');
    if(logout) store.put(true,'logout');
  });
  const device=()=>access('state','readwrite',(tx,done)=>{
    const store=tx.objectStore('state'),req=store.get('device');
    req.onsuccess=()=>{const id=req.result || crypto.randomUUID();store.put(id,'device');done(id);};
  });
  const all=()=>access('sales','readonly',(tx,done)=>{
    const req=tx.objectStore('sales').getAll();req.onsuccess=()=>done(req.result);
  });
  function change(id, fn, identity) {
    return access(['sales','state'],'readwrite',(tx,done,fail)=>{
      const state=tx.objectStore('state'),sales=tx.objectStore('sales');
      const session=state.get('shift');
      session.onsuccess=()=>{
        if(identity && (!session.result || session.result.user.id!==identity.user.id ||
          session.result.shift.id!==identity.shift.id || Date.now()+identity.offset>=Date.parse(identity.shift.expires_at))) return fail('Register locked or shift expired');
        if(identity){
          const now=Date.now();
          const saved=session.result;
          if(now+1000<(saved.lastWrite || saved.localStart)) return fail('Register clock changed. Reconnect before taking cash.');
          state.put({...saved,lastWrite:now},'shift');
        }
        const req=sales.get(id);
        req.onsuccess=()=>{
          try {
            const record=fn(req.result);
            if(record) sales.put(record);
            done(record);
          } catch(error){fail(error.message);}
        };
      };
    });
  }
  return {get,set,lock,all,change,device};
})();
