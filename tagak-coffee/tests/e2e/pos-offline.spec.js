const {test,expect}=require('@playwright/test');
const {resetDatabase,withClient,insertAccount}=require('../api/helpers');
const branch='brn-offline',device='49c26bcf-5bbf-4eb4-b14d-142775906762';
test.skip(({viewport})=>viewport.width<800,'Dedicated desktop register');
test.beforeAll(async()=>{
  await resetDatabase();
  await withClient(async c=>{
    await c.query("INSERT INTO branches(id,code,name) VALUES($1,'9902','Offline Branch')",[branch]);
    await c.query("INSERT INTO menu_items(id,name,category,price,branch_id) VALUES('roll','Roll','Pastries',20,$1)",[branch]);
  });
  await insertAccount({id:'offline-staff',name:'Offline Cashier',role:'Cashier',branchId:branch,pin:'4928'});
});
async function signIn(page, registerId=device){
  await page.goto('/unified-login/index.html');
  await page.addScriptTag({url:'/pos-app/js/offline-store.js'});
  await page.evaluate(id=>posStore.set('device',id),registerId);
  await page.fill('#pos-email','offline-staff@tagak.test');
  await page.fill('#pos-pin','4928');
  await page.click('#pos-form button[type="submit"]');
  await expect(page.locator('#offline-status')).toContainText(registerId===device?'Offline ready':'Register online');
}

test('unprepared register explains offline lock and retry prepares an open cart after enrollment',async({page,context})=>{
  await signIn(page,'c128e011-557a-4091-824c-b995376e8006');
  await page.click('.reg-tile[data-id="roll"]');
  await context.setOffline(true);
  await expect(page.locator('#offline-status')).toContainText('Ask your manager to set up this register');
  await page.evaluate(id=>posStore.set('device',id),device);
  await context.setOffline(false);
  await page.evaluate(()=>offlinePOS.check(true));
  await expect(page.locator('#offline-status')).toContainText('Offline ready');
  await expect(page.locator('#reg-cart-count')).toHaveText('1 item');
});

test('cache, cash, failed disk write, offline reopen, fulfillment and automatic replay',async({page,context})=>{
  test.setTimeout(90000);
  await signIn(page);
  await context.setOffline(true);
  await page.evaluate(()=>offlinePOS.check());
  await expect(page.locator('#offline-status')).toContainText('OFFLINE EMERGENCY MODE');
  for(const name of ['First','Second']){
    await page.click('.reg-tile[data-id="roll"]');
    await page.fill('#reg-customer-name',name);
    await page.click('#reg-pay');
    await expect(page.locator('.reg-tender-opt[data-method="qr"]')).toBeHidden();
    await page.fill('#reg-tender-received','50');
    if(name==='First'){
      await page.evaluate(()=>{
        const put=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(...args){
          if(this.name==='sales'){IDBObjectStore.prototype.put=put;throw new DOMException('Disk full','QuotaExceededError');}
          return put.apply(this,args);
        };
      });
      await page.click('#btn-tender-confirm');
      await expect(page.getByText('Disk full',{exact:true})).toBeVisible();
      await expect(page.locator('#tender-modal')).toHaveClass(/open/);
    }
    await page.click('#btn-tender-confirm');
    await expect(page.locator('#receipt-body')).toContainText('LOCAL-');
    await expect(page.locator('#receipt-body')).toContainText('30.00');
    await page.reload({waitUntil:'domcontentloaded'});
    await expect(page.locator('#offline-status')).toContainText('OFFLINE EMERGENCY MODE');
  }
  await expect(page.locator('#offline-count')).toContainText('2 pending');
  const reopened=await context.newPage();
  await page.close();
  await reopened.goto('/pos-app/index.html',{waitUntil:'domcontentloaded'});
  await expect(reopened.locator('#offline-count')).toContainText('2 pending');
  await reopened.locator('[data-view="orders"]').first().click();
  for(const action of ['brew','ready','complete']) await reopened.locator('.act-'+action).first().click();
  await context.setOffline(false);
  await expect(reopened.locator('#offline-count')).toContainText('0 pending',{timeout:40000});
  const rows=await withClient(async c=>(await c.query("SELECT status,tender::int,change_due::int FROM orders JOIN pos_cash_transactions USING(ticket_no) WHERE branch_id=$1 ORDER BY status",[branch])).rows);
  expect(rows).toEqual([{status:'completed',tender:50,change_due:30},{status:'queued',tender:50,change_due:30}]);
});

test('backend unavailable with internet up; expired sessions retain pending cash and block checkout',async({page})=>{
  await signIn(page);
  await page.route('**/api/pos/offline/ready',route=>route.fulfill({status:503,json:{posReady:0}}));
  await page.evaluate(()=>offlinePOS.check());
  expect(await page.evaluate(()=>navigator.onLine)).toBe(true);
  await expect(page.locator('#offline-status')).toContainText('OFFLINE EMERGENCY MODE');
  await page.click('.reg-tile[data-id="roll"]');
  await page.fill('#reg-customer-name','Pending');
  await page.click('#reg-pay');await page.click('#btn-tender-confirm');
  await expect(page.locator('#receipt-body')).toContainText('LOCAL-');
  await page.route('**/api/auth/me',route=>route.fulfill({status:401,json:{error:'Expired'}}));
  await page.unroute('**/api/pos/offline/ready');
  await page.evaluate(()=>{void offlinePOS.check();});
  await expect(page).toHaveURL(/unified-login/);
  await page.addScriptTag({url:'/pos-app/js/offline-store.js'});
  expect(await page.evaluate(async()=>[(await posStore.all()).filter(r=>!r.ticket).length,await posStore.get('shift')])).toEqual([1,null]);
});

test('lost acknowledgement after an online cash commit reconciles to the original ticket',async({page})=>{
  await signIn(page);
  await page.route('**/api/orders',async route=>{
    if(route.request().method()!=='POST') return route.continue();
    const committed=await route.fetch();
    expect(committed.status()).toBe(201);
    await route.abort('connectionreset');
  });
  await page.click('.reg-tile[data-id="roll"]');
  await page.fill('#reg-customer-name','Lost response');
  await page.click('#reg-pay');
  await page.click('#btn-tender-confirm');
  await expect(page.locator('#receipt-body')).toContainText('LOCAL-');
  await page.unroute('**/api/orders');
  await page.reload();
  await expect(page.locator('#offline-count')).toContainText('0 pending',{timeout:15000});
  const records=await withClient(async c=>(await c.query(
    "SELECT t.id,t.ticket_no FROM pos_cash_transactions t JOIN orders o USING(ticket_no) WHERE customer_name='Lost response'")).rows);
  expect(records).toHaveLength(1);
  await expect.poll(()=>page.evaluate(async()=> (await posStore.all())[0]?.ticket)).toBe(records[0].ticket_no);
});

test('reconnection replaces an offline shift permission and keeps the cashier signed in', async ({ page, context, request }) => {
  const login = await request.post('/api/auth/admin-login', { data: {
    email: process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test',
    password: process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123',
  } });
  const cookie = login.headers()['set-cookie'].split(';')[0];
  async function setOrders(enabled) {
    const response = await request.patch('/api/permissions', {
      headers: { Cookie: cookie }, data: { role: 'Cashier', key: 'view_orders', enabled },
    });
    expect(response.status()).toBe(204);
  }
  await signIn(page);
  await context.setOffline(true);
  await expect(page.locator('#offline-status')).toContainText('OFFLINE EMERGENCY MODE');
  await setOrders(false);
  await context.setOffline(false);
  await expect(page.locator('[data-view="orders"]')).toBeHidden();
  await expect(page.locator('#view-register')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await posStore.get('shift'))?.user.permissions.view_orders)).toBe(false);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#offline-status')).toContainText('OFFLINE EMERGENCY MODE');
  await expect(page.locator('[data-view="orders"]')).toBeHidden();
  await setOrders(true);
  await context.setOffline(false);
  await expect(page.locator('[data-view="orders"]')).toBeVisible();
});
