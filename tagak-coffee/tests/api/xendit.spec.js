const { test, expect } = require('@playwright/test');
const { randomUUID, randomBytes } = require('node:crypto');
const { resetDatabase, startServer, withClient, insertAccount } = require('./helpers');

const signingSecret = randomBytes(32).toString('hex');
const originalFetch = global.fetch;
const keyNames = ['ALLOW_PAYMENT_SIMULATION', 'XENDIT_QR_ENABLED', 'XENDIT_SECRET_KEY', 'XENDIT_WEBHOOK_TOKEN'];
const originalEnv = Object.fromEntries(keyNames.map(name => [name, process.env[name]]));
let server, intentId, checkout, staffCookie, stockManagerCookie;
const body = { branchId: 'qr-test', customerName: 'Test', payment: 'qr',
  lines: [{ menuItemId: 'coffee-test', qty: 1 }] };

test.beforeAll(async ({ request }) => {
  const target = new URL(require('./helpers').TEST_DATABASE_URL);
  if (target.hostname !== 'localhost' || target.port !== '5433' || target.pathname !== '/tagak_test' || target.search) {
    throw new Error('Expected the approved disposable database');
  }
  await resetDatabase();
  await withClient(async c => {
    await c.query("INSERT INTO branches (id,code,name) VALUES ('qr-test','1987654','QR test')");
    await c.query("INSERT INTO supplies (id,name,unit,stock) VALUES ('qr-stock','Stock','pcs',100)");
    await c.query("INSERT INTO menu_items (id,name,category,price) VALUES ('coffee-test','Coffee','Pastries',100)");
    await c.query("INSERT INTO menu_item_recipes (menu_item_id,supply_id,qty) VALUES ('coffee-test','qr-stock',1)");
  });
  await insertAccount({ id:'qr-manager', name:'Manager', role:'Manager', pin:'5723', branchId:'qr-test' });
  await insertAccount({ id:'qr-cashier', name:'Cashier', role:'Cashier', pin:'1234', branchId:'qr-test' });
  Object.assign(process.env, {ALLOW_PAYMENT_SIMULATION:'true', XENDIT_QR_ENABLED:'true', XENDIT_SECRET_KEY:'xnd_development_fixture',
    XENDIT_WEBHOOK_TOKEN:signingSecret});
  global.fetch = async (url, options) => {
    if (url === 'https://api.xendit.co/v3/payment_requests/' + intentId + '/simulate') {
      expect(JSON.parse(options.body)).toEqual({amount:100});
      return Response.json({});
    }
    if (url !== 'https://api.xendit.co/v3/payment_requests') return originalFetch(url, options);
    const input = JSON.parse(options.body);
    expect(input).toMatchObject({channel_code:'QRPH', country:'PH', currency:'PHP', type:'PAY', request_amount:100});
    expect(options.headers['api-version']).toBe('2024-11-11');
    intentId = 'pr-' + randomUUID();
    return Response.json({...input, payment_request_id:intentId, business_id:'fixture-business',
      status:'REQUIRES_ACTION', actions:[{type:'PRESENT_TO_CUSTOMER', descriptor:'QR_STRING', value:'fixture-qr'}]});

  };
  server = await startServer();
  const login = await request.post(server.baseURL+'/api/auth/pin', { data:{email:'qr-cashier@tagak.test',pin:'1234'} });
  expect(login.ok()).toBeTruthy();
  staffCookie = login.headers()['set-cookie'].split(';')[0];
  const manager = await request.post(server.baseURL+'/api/auth/pin', { data:{email:'qr-manager@tagak.test',pin:'5723'} });
  expect(manager.status()).toBe(200);
  stockManagerCookie = manager.headers()['set-cookie'].split(';')[0];
});
test.afterAll(async () => {
  global.fetch = originalFetch;
  for (const name of keyNames) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
  await server?.close();
});
async function counts() {
  return withClient(async c=>(await c.query('SELECT (SELECT count(*)::int FROM orders) AS orders, (SELECT coalesce(sum(last_value),0)::int FROM ticket_counters) AS tickets')).rows[0]);
}
let checkoutToken;
async function initiate(request, pos=false) {
  checkoutToken=randomUUID();
  const res=await request.post(server.baseURL+(pos?'/api/orders':'/api/public/orders'), { data:body, headers:{'Idempotency-Key':checkoutToken,...(pos?{Cookie:staffCookie}:{})} });
  expect(res.status()).toBe(202);
  checkout=await res.json();
  expect(checkout.qrImage).toMatch(/^data:image\/png;base64,/);
}
function event(type='payment.capture', status='SUCCEEDED') {
  return {event:type, business_id:'fixture-business', created:new Date().toISOString(), data:{
    reference_id:checkout.checkoutId, payment_id:'py-'+randomUUID(), payment_request_id:intentId,
    channel_code:'QRPH', country:'PH', currency:'PHP', request_amount:100, status,
    captures:[{capture_timestamp:new Date().toISOString(),capture_amount:100}]}};
}
function deliver(request, value, mode='valid') {
  const headers={};
  if(mode!=='missing') headers['x-callback-token']=mode==='invalid'?'different':signingSecret;
  return request.post(server.baseURL+'/api/webhooks/xendit',{data:value,headers});
}
test('cash-only mode rejects outstanding sandbox captures', async ({request}) => {
  await initiate(request);
  const before = await counts();
  process.env.XENDIT_QR_ENABLED = 'false';
  try {
    expect((await deliver(request, event())).status()).toBe(404);
    expect(await counts()).toEqual(before);
  } finally {
    process.env.XENDIT_QR_ENABLED = 'true';
  }
});

for(const pos of [false,true]) {
  test((pos?'POS':'Customer')+' success releases exactly one paid order to preparation',async({request})=>{
    const before=await counts();
    await initiate(request,pos);
    const simulateUrl=server.baseURL+'/api/xendit/simulate/'+checkout.checkoutId;
    expect((await request.post(simulateUrl)).status()).toBe(404);
    expect((await request.post(simulateUrl,{headers:{'X-Checkout-Token':randomUUID()}})).status()).toBe(404);
    expect((await request.post(simulateUrl,{headers:{'X-Checkout-Token':checkoutToken},data:{amount:1}})).status()).toBe(202);
    expect(await counts()).toEqual(before);
    expect((await deliver(request,event())).status()).toBe(204);
    const result=await (await request.get(server.baseURL+'/api/xendit/status/'+checkout.checkoutId)).json();
    const order=await (await request.get(server.baseURL+'/api/public/orders/'+result.ticketNo)).json();
    expect(order).toMatchObject({status:'brewing',payment:'qr',total:100});
    expect(await counts()).toEqual({orders:before.orders+1,tickets:before.tickets+1});
    if (pos) {
      const stock = () => withClient(async c => (await c.query("SELECT stock::int FROM supplies WHERE id='qr-stock'")).rows[0].stock);
      expect(await stock()).toBe(100);
      const completed = await request.patch(server.baseURL + '/api/orders/' + result.ticketNo, {
        headers: { Cookie: stockManagerCookie }, data: { status:'completed' },
      });
      expect(completed.status()).toBe(200);
      expect(await stock()).toBe(99);
    }
  });
}
test('register QR uses the server total and requires a nickname', async ({request}) => {
  const url = server.baseURL + '/api/orders';
  const headers = { Cookie: staffCookie };
  for (const amountReceived of [0, 99.99, 101, '100']) {
    const res = await request.post(url, { headers, data: { ...body, amountReceived } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('must equal the order total');
  }
  const blank = await request.post(url, { headers, data: { ...body, customerName: ' ' } });
  expect((await blank.json()).error).toBe('Nickname is required before approving this order.');
  expect((await request.post(url, { headers, data: { ...body, amountReceived: 100 } })).status()).toBe(202);
});
test('a QR retry returns the same checkout and new attempts respect the daily budget', async ({request}) => {
  const url = server.baseURL + '/api/public/orders';
  const headers = { 'Idempotency-Key': randomUUID() };
  const first = await request.post(url, { headers, data:body });
  expect(first.status()).toBe(202);
  const previousLimit = process.env.XENDIT_DAILY_CHECKOUT_LIMIT;
  try {
    process.env.XENDIT_DAILY_CHECKOUT_LIMIT = '1';
    const retry = await request.post(url, { headers, data:body });
    expect(retry.status()).toBe(202);
    expect(await retry.json()).toEqual(await first.json());
    expect((await request.post(url, { headers, data:{...body, customerName:'Different'} })).status()).toBe(409);
    expect((await request.post(url, { headers:{'Idempotency-Key':randomUUID()}, data:body })).status()).toBe(429);
  } finally {
    if (previousLimit === undefined) delete process.env.XENDIT_DAILY_CHECKOUT_LIMIT;
    else process.env.XENDIT_DAILY_CHECKOUT_LIMIT = previousLimit;
  }
});
test('failed payment creates no order or ticket',async({request})=>{
  const before=await counts();await initiate(request);
  expect((await deliver(request,event('payment.failure','FAILED'))).status()).toBe(204);
  expect(await counts()).toEqual(before);
});
test('expired checkout creates no order or ticket',async({request})=>{
  const before=await counts();await initiate(request);
  const expired=event('payment_request.expiry','EXPIRED');
  expired.created=new Date(Date.now()-60000).toISOString();
  expect((await deliver(request,expired)).status()).toBe(204);
  expect((await deliver(request,event())).status()).toBe(204);
  const status=await (await request.get(server.baseURL+'/api/xendit/status/'+checkout.checkoutId)).json();
  expect(status).toEqual({ticketNo:null,expired:true,failed:false});
  expect(await counts()).toEqual(before);
});
test('concurrent duplicate and repeated success deliveries issue one ticket',async({request})=>{
  const before=await counts();await initiate(request);
  const paid=event();
  const results=await Promise.all([deliver(request,paid),deliver(request,paid),deliver(request,event())]);
  expect(results.map(r=>r.status())).toEqual([204,204,204]);
  expect(await counts()).toEqual({orders:before.orders+1,tickets:before.tickets+1});
});
test('missing or invalid token, wrong merchant and amount mismatch cannot release an order',async({request})=>{
  const before=await counts();await initiate(request);
  for(const mode of ['invalid','missing']) expect((await deliver(request,event(),mode)).status()).toBe(401);
  const live=event();live.business_id='other-business';
  expect((await deliver(request,live)).status()).toBe(400);
  const wrong=event();wrong.data.captures[0].capture_amount++;
  expect((await deliver(request,wrong)).status()).toBe(400);
  expect(await counts()).toEqual(before);
});

test('simulation fails closed when disabled or configured with a live key',async({request})=>{
  for(const [flag,key] of [['false','xnd_development_fixture'],['true','xnd_production_fixture']]){
    try {
      Object.assign(process.env,{ALLOW_PAYMENT_SIMULATION:flag,XENDIT_SECRET_KEY:key});
      const result=await request.get(server.baseURL+'/api/xendit/enabled');
      expect((await result.json()).simulation).toBe(false);
      expect((await request.post(server.baseURL+'/api/xendit/simulate/'+randomUUID(),{headers:{'X-Checkout-Token':randomUUID()}})).status()).toBe(404);
    }finally{Object.assign(process.env,{ALLOW_PAYMENT_SIMULATION:'true',XENDIT_SECRET_KEY:'xnd_development_fixture'});}
  }
});
