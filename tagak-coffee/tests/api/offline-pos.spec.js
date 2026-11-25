const { test,expect }=require('@playwright/test');
const { randomUUID }=require('node:crypto');
const { resetDatabase,insertAccount,withClient,startServer }=require('./helpers');
const branch='emergency-test',device=randomUUID();
let server,cookie,shift,otherCookie;
async function login(request,id,pin) {
  const res=await request.post(server.baseURL+'/api/auth/pin',{data:{email:id+'@tagak.test',pin}});
  expect(res.status()).toBe(200);
  return res.headers()['set-cookie'].split(';')[0];
}
test.beforeAll(async({request})=>{
  await resetDatabase();
  process.env.POS_OFFLINE_REGISTERS=branch+'/'+device;
  await withClient(async c=>{
    await c.query("INSERT INTO branches(id,name,code) VALUES($1,'Test','9901')",[branch]);
    await c.query("INSERT INTO menu_items(id,name,category,price,branch_id) VALUES('bread','Bread','Pastries',15.55,$1)",[branch]);
    await c.query("INSERT INTO supplies(id,name,unit,stock,branch_id) VALUES('flour','Flour','g',4,$1)",[branch]);
    await c.query("INSERT INTO menu_item_recipes(menu_item_id,supply_id,qty) VALUES('bread','flour',1)");
  });
  await insertAccount({id:'pos-alice',name:'Alice',role:'Cashier',branchId:branch,pin:'5432'});
  await insertAccount({id:'pos-bob',name:'Bob',role:'Cashier',branchId:branch,pin:'1234'});
  await insertAccount({id:'pos-mgr',name:'Manager',role:'Manager',branchId:branch,pin:'5731'});
  server=await startServer();
  cookie=await login(request,'pos-alice','5432');otherCookie=await login(request,'pos-bob','1234');
  const response=await request.post(server.baseURL+'/api/pos/offline/prepare',{headers:{Cookie:cookie},data:{device}});
  expect(response.status()).toBe(200);
  shift=(await response.json()).shift;
});
test.afterAll(async()=>{delete process.env.POS_OFFLINE_REGISTERS;await server?.close();});
const payload=()=>({id:randomUUID(),device,shiftId:shift.id,time:new Date().toISOString(),total:31.1,tender:5000,
  body:{branchId:branch,customerName:'Walk in',orderMode:'takeout',payment:'cash',lines:[{menuItemId:'bread',qty:2}]}});
const send=(request,data,session=cookie)=>request.post(server.baseURL+'/api/pos/offline/sync',{data,headers:{Cookie:session}});
test('ambiguous online acknowledgement and parallel offline retries produce one tender and ticket',async({request})=>{
  const data=payload();
  const online=await request.post(server.baseURL+'/api/orders',{data:{posCash:data},headers:{Cookie:cookie}});
  expect(online.status()).toBe(201);
  const results=await Promise.all([send(request,data),send(request,data)]);
  for(const r of results) expect((await r.json()).order.ticketNo).toBe((await online.json()).order.ticketNo);
  expect((await send(request,{...data,tender:6000})).status()).toBe(409);
  expect((await send(request,data,otherCookie)).status()).toBe(403);
  expect((await send(request,{...payload(),tender:1})).status()).toBe(409);
  expect((await send(request,{...payload(),time:'2000-01-01'})).status()).toBe(409);
  const row=await withClient(async c=>(await c.query('SELECT tender,change_due FROM pos_cash_transactions WHERE id=$1',[data.id])).rows);
  expect(row).toEqual([{tender:'50.00',change_due:'18.90'}]);
});
test('historical price and recipe survive changes, repeated events move stock once and shortages remain auditable',async({request})=>{
  await withClient(async c=>{
    await c.query("UPDATE menu_items SET price=99 WHERE id='bread'");
    await c.query("UPDATE menu_item_recipes SET qty=3 WHERE menu_item_id='bread'");
  });
  for(let i=0;i<3;i++){
    const sale=payload(), res=await send(request,sale);
    expect(res.status()).toBe(200);
    const {order}=await res.json();
    expect(order.total).toBe(31.1);
    for(const status of ['brewing','ready','completed']){
      const event={id:randomUUID(),saleId:sale.id,shiftId:shift.id,device,status,time:new Date().toISOString()};
      for(const replay of await Promise.all([send(request,event),send(request,event)])) expect(replay.status()).toBe(200);
      if(status==='completed') expect((await send(request,{...event,id:randomUUID(),status:'brewing'})).status()).toBe(409);
    }
  }
  const result=await withClient(async c=>(await c.query("SELECT stock::int,(SELECT count(*)::int FROM pos_inventory_discrepancies) AS discrepancies FROM supplies WHERE id='flour'")).rows[0]);
  expect(result).toEqual({stock:0,discrepancies:1});
  const mgr=await login(request,'pos-mgr','5731');
  const headers={Cookie:mgr}, root=server.baseURL+'/api/pos/offline';
  const [item]=await (await request.get(root+'/discrepancies',{headers})).json();
  const reconcile=()=>request.post(root+'/reconcile',{headers,data:{ticketNo:item.ticket_no}});
  expect((await (await reconcile()).json()).resolved).toBe(false);
  await withClient(c=>c.query("UPDATE supplies SET stock=3 WHERE id='flour'"));
  expect((await (await reconcile()).json()).resolved).toBe(true);
  expect((await (await reconcile()).json()).resolved).toBe(false);
  const recovered=payload();
  const recovery=await request.post(root+'/recover',{headers,data:recovered});
  expect(recovery.status()).toBe(200);
  expect(await withClient(async c=>(await c.query('SELECT manager_id FROM pos_recovery_audit WHERE operation_id=$1',[recovered.id])).rows[0].manager_id)).toBe('pos-mgr');
});
