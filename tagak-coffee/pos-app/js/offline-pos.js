const offlinePOS = (() => {
  const api='/api/pos/offline';
  let onlineBooted=false, enrollmentKnown=false;
  let shift, device, offline=false, working=false, checking=false, lastMessage='', confirmed=0;
  let local=[], identity, checkedAt=0, preparationDone;
  const prepared=new Promise(resolve=>{preparationDone=resolve;});
  const channel=typeof BroadcastChannel==='function' ? new BroadcastChannel('tagak-pos-lock') : null;
  if(channel) channel.onmessage=()=>location.reload();
  const pending=r=>!r.rejected && (!r.ticket || r.ack<r.events.length);
  function shiftProblem() {
    if (!shift) return 'Offline cash is unavailable. Ask your manager to set up this register while online, then select Check connection and retry.';
    const expiry = Date.parse(shift.shift?.expires_at);
    if (![expiry,shift.localStart,shift.offset].every(Number.isFinite))
      return 'Offline preparation is incomplete. Reconnect and select Check connection and retry.';
    if (Date.now() < shift.localStart - 1000)
      return 'Register clock changed. Correct the clock, reconnect and retry synchronization.';
    if (Date.now() + shift.offset >= expiry)
      return 'Your offline shift has ended. Reconnect and sign in again before taking cash.';
    return '';
  }
  function valid() { return !shiftProblem(); }
  async function request(path,body) {
    const res=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
      signal:AbortSignal.timeout(6000),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    if(!res.ok) {
      const error=await res.json().catch(()=>({}));
      throw Object.assign(new Error(error.error || 'Service returned '+res.status),{status:res.status});
    }
    return res.json();
  }
  async function reachable() {
    try{return (await request(api+'/ready')).posReady===1;}catch{return false;}
  }
  async function restore() {
    if(await reachable()) return null;
    shift=await posStore.get('shift');
    if(!valid() || !shift.user?.permissions?.access_terminal || !navigator.serviceWorker?.controller || await posStore.get('logout')) return null;
    device=shift.device;
    enrollmentKnown=true;
    offline=true;
    return shift.user;
  }
  async function confirmLogout() {
    const count=(await posStore.all().catch(()=>[])).filter(r=>r.employee===identity?.id && pending(r)).length;
    return !count || window.confirm(count+' cash transaction(s) still need synchronization. Lock the register and keep them on this device?');
  }
  async function lock(logout=false) {
    await posStore.lock(logout);
    shift=null;
    if (logout) channel?.postMessage('locked');
  }
  async function finishLogout() {
    if(!await posStore.get('logout').catch(()=>false)) return;
    await request('/api/auth/logout',{});
    await posStore.set('logout',false);
  }
  function useCatalog() {
    POS_MENU=shift.items.map(i=>({id:i.id,name:i.name,price:Number(i.price),category:i.category,
      active:i.active,archived:i.is_archived,soldOut:i.sold_out,description:i.description,hasTemperature:i.has_temperature}));
    ADD_ONS=shift.addOns.map(a=>mapAddOnForPos({...a,price:Number(a.price),appliesTo:a.applies_to}));
    Object.assign(POS_SETTINGS,shift.settings);
    POS_BRANCHES=[shift.branch];
    applyPosSettings();
    renderBranchOptions();
    renderRegisterGrid();
    renderRegisterCart();
  }
  function localOrder(r) {
    const lastEvent = r.events.at(-1);
    return {...r.receipt,id:r.ticket || r.receipt.ticketNo,ticketNo:r.ticket || r.receipt.ticketNo,
      localId:r.id,status:lastEvent?.status || 'queued',timeOut:lastEvent?.status === 'completed' ? lastEvent.time : null};
  }
  function merge(orders) {
    const mine=local.filter(r=>!r.rejected && (pending(r) || offline));
    const board=orders.filter(o=>!mine.some(r=>r.ticket===o.id || r.receipt.ticketNo===o.id)).map(order=>{
      const own=local.find(r=>r.ticket===order.id && r.origin==='emergency' && r.expiresAt && Date.parse(r.expiresAt)>Date.now());
      return own && !['completed','cancelled'].includes(order.status) ? {...order,localId:own.id} : order;
    });
    return [...mine.map(localOrder),...board];
  }
  async function refresh() {
    local=(await posStore.all()).filter(r=>r.employee===identity?.id && r.payload.body.branchId===identity?.branchId);
    POS.orders=canViewModule('orders') ? merge(offline ? [] : POS.orders.filter(o=>!o.id.startsWith('LOCAL-'))) : [];
    renderOrders();
    const status=document.querySelector('#offline-connection');
    const shiftInfo=document.querySelector('#offline-shift');
    shiftInfo.textContent = shift ? shift.branch.name+' ? '+identity.name+' ? Shift ends '+new Date(shift.shift.expires_at).toLocaleString()+' ? Menu saved '+new Date(shift.localStart).toLocaleString() : '';
    const problem = shiftProblem();
    status.textContent = offline ? 'OFFLINE EMERGENCY MODE' : valid() ? 'Offline ready ? Register online' : 'Register online';
    status.className = 'badge '+(offline && problem ? 'badge-void' : offline ? 'badge-brewing' : 'badge-ready');
    document.querySelector('#offline-instruction').textContent = [problem || (offline ? 'Take cash only.' : 'This register can take cash if the connection drops.'), lastMessage].filter(Boolean).join(' ');
    window.updateQmodsimRbdLiveBadge?.(offline, local.filter(pending).length);
    document.querySelector('#offline-count').textContent = local.filter(pending).length+' pending';
    document.querySelector('#offline-progress').textContent = working ? 'Sending receipts?' : local.length ? confirmed+' sent this session' : 'No receipts saved on this register for your account at this branch.';
    const detail=document.querySelector('#offline-history');
    detail.replaceChildren();
    for(const r of (canViewModule('orders') ? [...local] : []).reverse().sort((a,b)=>Number(pending(b))-Number(pending(a)))) {
      const line=document.createElement('li');
      line.textContent=[r.receipt.ticketNo,r.ticket,r.receipt.customerName,formatMoney(r.receipt.total),
        r.rejected?'Declined':r.error || (pending(r)?'Pending':'Synchronized')].filter(Boolean).join(' · ');
      if(!r.rejected) {
        const receipt=document.createElement('button');
        receipt.type='button';receipt.className='btn btn-secondary';receipt.textContent='View receipt';
        receipt.onclick=()=>{POS_REGISTER.lastOrder=localOrder(r);showReceipt(POS_REGISTER.lastOrder);};
        line.append(' ',receipt);
      }
      detail.append(line);
    }
  }
  async function prepare(user) {
    if(!user.permissions?.access_terminal){shift=null;await posStore.set('shift',null);return;}
    try{device=await posStore.device();}
    catch(error){
      if((await request(api+'/availability')).configured) throw error;
      enrollmentKnown=true;
      return;
    }
    document.querySelector('#offline-device').textContent='Register enrollment: '+user.branchId+'/'+device;
    const savedShift=await posStore.get('shift');
    if(savedShift && savedShift.user.id!==user.id) await lock();
    else if(savedShift && savedShift.user.branchId===user.branchId) {
      shift={...savedShift,user};
      await posStore.set('shift',shift);
    }
    const data=await request(api+'/prepare',{device});
    if(!data.enabled) {
      enrollmentKnown=true;
      await posStore.set('shift',null);shift=null;return;
    }
    enrollmentKnown=!!shift;
    if(!('serviceWorker' in navigator)) throw Error('Service worker unavailable');
    await navigator.serviceWorker.register('/pos-app/sw.js');
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('POS shell installation timed out')),15000))]);
    if(!navigator.serviceWorker.controller) await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Reopen the POS to finish preparation')),5000);
      navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
    });
    const localStart=Date.now();
    const saved={...data,user,localStart,offset:Date.parse(data.serverTime)-localStart};
    await posStore.set('shift',saved);
    shift=saved;
    enrollmentKnown=true;
    document.querySelector('#offline-shift').textContent='Catalog prepared '+new Date(data.shift.issued_at).toLocaleString()+' · Shift ends '+new Date(data.shift.expires_at).toLocaleTimeString();
    const durable=await navigator.storage?.persist?.().catch(()=>false);
    if(!durable) lastMessage='Browser storage is best effort. Enable persistent storage on this register.';
  }
  function setOffline(value) {
    offline=value;
    document.body.classList.toggle('pos-emergency',value);
    applyModuleAccess();
    if (value) document.querySelector('#offline-review').replaceChildren();
    if(value) {
      if(POS_REGISTER.payment==='qr' && POS_REGISTER.submitting){
        lastMessage='QR confirmation pending. Verify the original payment online before accepting another tender.';
      } else {
        POS_REGISTER.payment='cash';updateTenderChangeDisplay();
      }
      document.querySelector('.reg-tender-opt[data-method="qr"]').disabled=true;
      if(valid()) useCatalog();
      if(!['orders','register','offline'].includes(POS.currentView)) switchView('register');
    }
    syncPosOrders();
  }
  async function start(user) {
    identity=user;
    onlineBooted=!offline;
    const manager=document.querySelector('#offline-manager');
    manager.hidden=!(user.role==='Manager' && user.permissions?.view_orders && user.permissions?.manage_orders);
    manager.onclick=()=>review().catch(error=>showToast(error.message,'error'));
    document.querySelector('#offline-retry').onclick=()=>check(true);
    try {
      applyModuleAccess();
      if(!offline) await prepare(user);
      else setOffline(true);
      await refresh();
      if(!offline) await sync();
    } catch(error){
      lastMessage=error.message;
      document.querySelector('#offline-connection').textContent='Register setup needs attention';
      document.querySelector('#offline-instruction').textContent=lastMessage;
      if(error.status===401){await lock();TAGAK_AUTH.redirectToLogin();}
    }
    preparationDone();
    for(const event of ['online','offline','focus']) window.addEventListener(event,()=>check());
    setInterval(()=>check(),30000);
  }
  async function check(manual=false) {
    if(checking || !identity) return;
    checking=true;
    try {
      let up=await reachable();
      if(!up && !offline) up=await reachable();
      if(!up){setOffline(true);await refresh();return;}
      const me=await request('/api/auth/me').catch(async error => {
        if (error.status === 403) { await lock(); TAGAK_AUTH.redirectToLogin(); }
        throw error;
      });
      if(me.id!==identity.id || me.branchId!==identity.branchId || me.role!==identity.role){await lock();location.reload();return;}
      const previous=identity.permissions;
      const changed=JSON.stringify(previous)!==JSON.stringify(me.permissions);
      identity=me; POS.user=me;
      if(changed) {
        applyModuleAccess();
        if(shift) {
          shift=me.permissions.access_terminal ? {...shift,user:me} : null;
          await posStore.set('shift',shift);
        }
        document.querySelector('#offline-manager').hidden=!(me.role==='Manager' && me.permissions.view_orders && me.permissions.manage_orders);
        if (!offline) await refreshPermissionViews(previous);
      }
      if(offline || manual || changed || !checkedAt || Date.now()-checkedAt>300000) {
        if(offline) {
          setOffline(false);
          if (changed && onlineBooted) await refreshPermissionViews(previous);
          lastMessage='';
          if(!onlineBooted){await enterApp();onlineBooted=true;}
          else if(me.permissions.access_terminal && !POS_REGISTER.lines.length){
            await Promise.all([loadMenuItems(),loadAddOns(),loadPosSettings()]);
            applyPosSettings();renderRegisterGrid();renderRegisterCart();
          }
          enableQrCheckout();
        }
        if(changed || !POS_REGISTER.lines.length || !valid()) await prepare(me);
        checkedAt=Date.now();
      }
      await sync(manual || changed);
      await refresh();
    } catch(error){
      lastMessage=error.message;
      if(error.status===401){await lock();TAGAK_AUTH.redirectToLogin();}
    } finally{checking=false;}
  }
  async function send(r,online=false,manager=false) {
    const importPath=api+(manager?'/recover':'/sync');
    if(!r.ticket) {
      const ack=online ? await request('/api/orders',{posCash:r.payload}) : await request(importPath,r.payload);
      if(ack.id!==r.id || !ack.order?.ticketNo) throw Error('Missing server acknowledgement');
      const {trackingToken,...order}=ack.order;
      r=await posStore.change(r.id,current=>({...current,ticket:order.ticketNo,review:false,error:'',serverOrder:order}));
      if(trackingToken) r.serverOrder={...order,trackingToken};
    }
    for(let i=r.ack;i<r.events.length;i++) {
      const event=r.events[i],ack=await request(importPath,event);
      if(ack.id!==event.id || ack.ticketNo!==r.ticket) throw Error('Missing fulfillment acknowledgement');
      await posStore.change(r.id,current=>({...current,ack:Math.max(current.ack,i+1),error:''}));
    }
    return r;
  }
  async function review() {
    if (identity.role !== 'Manager' || !permitted('access_terminal') || !permitted('manage_orders') || !permitted('view_orders')) throw Error('Recovery permission required');
    if(offline) throw Error('Reconnect to review branch records');
    const panel=document.querySelector('#offline-review');
    panel.replaceChildren();
    function action(label,work) {
      const button=document.createElement('button');
      button.type='button';button.className='btn btn-secondary';button.textContent=label;
      button.onclick=async()=>{
        button.disabled=true;
        try {await work();await refresh();await review();}
        catch(error){showToast(error.message,'error');button.disabled=false;}
      };
      panel.append(button);
    }
    for(const row of await posStore.all()){
      if(pending(row) && row.payload.body.branchId===identity.branchId)
        action('Recover '+row.receipt.ticketNo+' · '+formatMoney(row.receipt.total),()=>send(row,false,true));
    }
    for(const row of await request(api+'/discrepancies')){
      action('Apply missing stock usage · '+row.ticket_no,async()=>{
        const result=await request(api+'/reconcile',{ticketNo:row.ticket_no});
        if(!result.resolved) throw Error('Check available inventory before retrying');
      });
    }
    if(!panel.children.length) panel.textContent='No branch records need recovery.';
  }
  async function sync(manual=false) {
    if(working || offline || !identity || !permitted('access_terminal')) return;
    working=true;
    try {
      await refresh();
      const run=async()=>{
        const rows=await posStore.all();
        for(const r of rows.filter(r=>r.employee===identity.id && r.payload.body.branchId===identity.branchId && pending(r))) {
          if(!manual && (r.review || (r.nextAttempt || 0)>Date.now())) continue;
          try {await send(r,r.origin==='online');confirmed++;}
          catch(error){
            await posStore.change(r.id,current=>{
              const attempts=(current.attempts || 0)+1;
              const delay=Math.min(300000,3000*2**Math.min(attempts,7));
              return {...current,attempts,nextAttempt:Date.now()+delay*(0.8+Math.random()*0.4),
                error:error.message,review:[400,403,409].includes(error.status)};
            });
            if(error.status===401){await lock();TAGAK_AUTH.redirectToLogin();break;}
            if(!error.status || error.status>=500) break;
          }
        }
      };
      if(navigator.locks) await navigator.locks.request('tagak-pos-outbox',{ifAvailable:true},lock=>lock && run());
      else await run();
    } finally {working=false;await refresh();}
  }
  async function checkout(body,receipt,tender) {
    if (!permitted('access_terminal')) throw Error('Terminal permission required');
    const problem = shiftProblem();
    if(problem) throw Error(problem);
    if(offline && !shift.items.length) throw Error('Cached menu unavailable');
    const quote=TagakQuote.calculate({body},TagakQuote.validate({body}),shift);
    if(quote.total!==receipt.total || quote.vat!==receipt.vat || quote.subtotal!==receipt.subtotal)
      throw Error('Catalog changed. Reopen the register before taking cash.');
    receipt.items=quote.storedLines;
    const id=crypto.randomUUID();
    const payload={id,device,shiftId:shift.shift.id,time:new Date(Date.now()+shift.offset).toISOString(),
      body,total:receipt.total,tender};
    if(new TextEncoder().encode(JSON.stringify({posCash:payload})).length>100*1024) throw Error('Order exceeds the maximum checkout size');
    receipt={...receipt,ticketNo:'LOCAL-'+id,timeIn:payload.time,status:'queued',payment:'cash',
      customerName:body.customerName,orderMode:body.orderMode,branchId:body.branchId,cashReceived:tender/100,changeDue:(tender-Math.round(receipt.total*100))/100};
    const record={id,expiresAt:shift.shift.expires_at,employee:identity.id,payload,receipt,events:[],ack:0,origin:offline?'emergency':'online'};
    await posStore.change(id,()=>record,shift);
    if(!offline) {
      let posted;
      try{posted=await send(record,true);}
      catch(error){
        if([400,401,403,409].includes(error.status)){
          await posStore.change(id,r=>({...r,rejected:true,error:error.message}));
          if(error.status===401){await lock();TAGAK_AUTH.redirectToLogin();}
          else if(error.status===403) void check();
          throw error;
        }
        // The original request may have committed. Keep its UUID and receipt.
        await posStore.change(id,current=>({...current,origin:'interrupted'})).catch(()=>{});
        lastMessage='Confirmation pending. Keep this receipt; do not ring the sale again.';
        void check();
      }
      if(posted) receipt=posted.serverOrder;
    }
    return receipt;
  }
  async function advance(id,status) {
    const r=local.find(r=>r.ticket===id || r.receipt.ticketNo===id);
    if(!permitted('view_orders') || !(permitted('manage_orders') || permitted('fulfill_own_offline_orders')) || !r || !valid() || !shift.shift.can_fulfill || r.employee!==identity.id || Date.now()+shift.offset>=Date.parse(r.expiresAt))
      throw Error('A valid original shift and fulfillment permission are required');
    await posStore.change(r.id,current=>{
      const prev=current.events.at(-1)?.status || 'queued';
      if(({queued:'brewing',brewing:'ready',ready:'completed'})[prev]!==status) throw Error('Order status changed');
      current.events.push({id:crypto.randomUUID(),saleId:r.id,shiftId:r.payload.shiftId,device,status,time:new Date(Date.now()+shift.offset).toISOString()});
      return current;
    },shift);
    await refresh();
    if(!offline) await sync();
    return localOrder(local.find(row=>row.id===r.id));
  }
  return {prepared,confirmLogout,restore,start,lock,finishLogout,checkout,advance,refresh,merge,check,
    get enrollmentKnown(){return enrollmentKnown;},get offline(){return offline;},get enrolled(){return !!shift;}, get ready(){return valid();}};
})();
