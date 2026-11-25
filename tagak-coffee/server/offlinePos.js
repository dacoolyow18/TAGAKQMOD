const { createHash } = require('node:crypto');
const { ownedBy } = require('./branchScope');
const { loadSettings, quoteOrder, insertQuotedOrder, recipeQuantities, moveStock, mapOrder, round2 } = require('./orders');
const { notifyOrder } = require('./orderEvents');

function reject(status, message) {
  throw Object.assign(new Error(message), { status });
}

function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) reject(400, 'Invalid transaction identifier');
  return value;
}

function fingerprint(value) {
  const json = JSON.stringify(value, (_, obj) => obj && typeof obj === 'object' && !Array.isArray(obj)
    ? Object.fromEntries(Object.keys(obj).sort().map(key => [key,obj[key]])) : obj);
  return createHash('sha256').update(json).digest('hex');
}

async function prepare(client, account, device) {
  uuid(device);
  const branch = account.branchId;
  if (!branch || !(process.env.POS_OFFLINE_REGISTERS || '').split(',').map(v => v.trim()).includes(branch + '/' + device)) return { enabled: false };
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const scoped = async (sql) => (await client.query(sql, [branch])).rows;
  const items = await scoped('SELECT id,name,price,category,has_temperature,description,image_path,active,sold_out,is_archived FROM menu_items WHERE '+ownedBy('$1')+' ORDER BY id');
  const addOns = await scoped('SELECT id,name,price,applies_to,active FROM add_ons WHERE '+ownedBy('$1')+' ORDER BY id');
  const recipes = await scoped('SELECT r.menu_item_id,r.supply_id,r.qty::float8,r.large_qty::float8 FROM menu_item_recipes r JOIN menu_items m ON m.id=r.menu_item_id WHERE '+ownedBy('$1','m.branch_id')+' ORDER BY 1,2');
  const extras = await scoped('SELECT r.add_on_id,r.supply_id,r.qty::float8 FROM add_on_supplies r JOIN add_ons a ON a.id=r.add_on_id WHERE '+ownedBy('$1','a.branch_id')+' ORDER BY 1,2');
  const settings = await loadSettings(client, branch);
  const catalog = { version: 1, items, addOns, settings, recipes, extras };
  const { rows: [snapshot] } = await client.query(
    'INSERT INTO pos_catalog_snapshots(branch_id,fingerprint,catalog) VALUES ($1,$2,$3) ON CONFLICT(branch_id,fingerprint) DO UPDATE SET fingerprint=excluded.fingerprint RETURNING id',
    [branch, fingerprint(catalog), catalog]);
  const { rows: [role] } = await client.query('SELECT permissions FROM role_permissions WHERE role=$1',[account.role]);
  const canFulfill=!!(role.permissions.view_orders && (role.permissions.manage_orders || role.permissions.fulfill_own_offline_orders));
  const {rows:[current]}=await client.query(
    'SELECT id,issued_at,expires_at,can_fulfill FROM pos_offline_shifts WHERE employee_id=$1 AND device_id=$2 AND snapshot_id=$3 AND expires_at=$4 AND can_fulfill=$5 ORDER BY issued_at DESC LIMIT 1',
    [account.id,device,snapshot.id,account.expiresAt,canFulfill]);
  const shift=current || (await client.query(
    'INSERT INTO pos_offline_shifts(employee_id,device_id,snapshot_id,expires_at,can_fulfill) VALUES ($1,$2,$3,$4,$5) RETURNING id,issued_at,expires_at,can_fulfill',
    [account.id,device,snapshot.id,account.expiresAt,canFulfill])).rows[0];
  const { rows: [location] } = await client.query('SELECT id,code,name FROM branches WHERE id=$1',[branch]);
  return { enabled:true, serverTime:new Date().toISOString(), shift, device, branch:location, items:items.filter(item=>item.active && !item.is_archived), addOns:addOns.filter(item=>item.active), settings };
}

async function getShift(client, account, body, managerRecovery=false) {
  const { rows: [shift] } = await client.query(
    'SELECT s.*,c.catalog,c.branch_id FROM pos_offline_shifts s JOIN pos_catalog_snapshots c ON c.id=s.snapshot_id WHERE s.id=$1',
    [uuid(body.shiftId)]);
  if (!shift || shift.branch_id !== account.branchId || shift.device_id !== body.device ||
      (!managerRecovery && shift.employee_id !== account.id)) reject(403,'Sign in with the original employee and branch');
  return shift;
}

function occurred(value, shift) {
  const time = new Date(value);
  if (!Number.isFinite(+time) || +time < +shift.issued_at || +time > Math.min(+shift.expires_at,Date.now()+30000)) reject(409,'Transaction time outside the prepared shift');
  return time;
}

async function sale(client, account, payload, online, managerRecovery=false) {
  const { id, body, total, tender } = payload;
  uuid(id);
  const shift = await getShift(client, account, payload, managerRecovery);
  if (body?.branchId !== shift.branch_id || body.payment !== 'cash') reject(400,'Only branch walk-in cash sales are accepted');
  const digest = fingerprint(payload);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);
  const { rows: [existing] } = await client.query(
    'SELECT t.fingerprint,t.shift_id,o.* FROM pos_cash_transactions t JOIN orders o USING(ticket_no) WHERE t.id=$1',[id]);
  if (existing) {
    if (existing.shift_id !== shift.id || existing.fingerprint !== digest) reject(409,'Sale ID already used with different details');
    return { id, order:mapOrder(existing) };
  }
  const time = occurred(payload.time, shift);
  const options = { body, actorId: shift.employee_id };
  const quote = await quoteOrder(client, options, shift.catalog);
  if (quote.total !== total || !Number.isSafeInteger(tender) || tender < Math.round(total*100) || tender > 999999999999) reject(409,'Cash or historical price mismatch');
  if (online) {
    const live = await quoteOrder(client, options);
    if (fingerprint(live) !== fingerprint(quote)) reject(409,'Menu changed. Refresh the register before accepting cash');
  }
  const order = await insertQuotedOrder(client,quote,time,shift.employee_id);
  await client.query('INSERT INTO pos_cash_transactions(id,shift_id,ticket_no,fingerprint,tender,change_due,emergency) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id,shift.id,order.ticketNo,digest,tender/100,round2(tender/100-total),!online]);
  return { id,order };
}

async function postUsage(client,ticket,branch,usage) {
  const ids=Object.keys(usage).sort();
  const {rows}=await client.query('SELECT id,stock FROM supplies WHERE id=ANY($1::text[]) AND '+ownedBy('$2')+' ORDER BY id FOR UPDATE',[ids,branch]);
  if (rows.length!==ids.length || rows.some(row=>Number(row.stock)<usage[row.id])) {
    await client.query('INSERT INTO pos_inventory_discrepancies(ticket_no,usage) VALUES($1,$2) ON CONFLICT(ticket_no) DO NOTHING',[ticket,usage]);
    return null;
  }
  await moveStock(client,usage,-1);
  return usage;
}

async function importedUsage(client,ticket,branch,items) {
  const {rows:[snapshot]}=await client.query('SELECT c.catalog FROM pos_cash_transactions t JOIN pos_offline_shifts s ON t.shift_id=s.id JOIN pos_catalog_snapshots c ON c.id=s.snapshot_id WHERE ticket_no=$1',[ticket]);
  if (!snapshot) return undefined;
  const usage=recipeQuantities(items,snapshot.catalog.recipes,snapshot.catalog.extras);
  return await postUsage(client,ticket,branch,usage) || {};
}

async function advance(client,account,payload,managerRecovery=false) {
  const shift=await getShift(client,account,payload,managerRecovery);
  const {rows:[role]}=await client.query('SELECT permissions FROM role_permissions WHERE role=$1',[account.role]);
  if (!role.permissions.view_orders || !shift.can_fulfill || !(role.permissions.manage_orders || role.permissions.fulfill_own_offline_orders)) reject(403,'Fulfillment permission required');
  const {rows:[order]}=await client.query('SELECT o.*,t.emergency FROM pos_cash_transactions t JOIN orders o USING(ticket_no) WHERE t.id=$1 AND t.shift_id=$2 FOR UPDATE OF o',[uuid(payload.saleId),shift.id]);
  if (!order || (!order.emergency && !role.permissions.manage_orders)) reject(403,'Order outside authorized emergency sales');
  const time=occurred(payload.time,shift);
  const {rows:[event]}=await client.query('SELECT * FROM pos_offline_events WHERE id=$1',[uuid(payload.id)]);
  if (event) {
    if(event.sale_id!==payload.saleId || event.status!==payload.status || +event.occurred_at!==+time) reject(409,'Event ID conflict');
  } else {
    const {rows:[previous]}=await client.query('SELECT max(occurred_at) AS time FROM pos_offline_events WHERE sale_id=$1',[payload.saleId]);
    if(previous.time && +time<+previous.time) reject(409,'Fulfillment events are out of sequence');
    const next={queued:'brewing',brewing:'ready',ready:'completed'};
    if(next[order.status]!==payload.status || +time<+order.time_in) reject(409,'Order status changed; review the current ticket');
    const usage=payload.status==='completed' ? await importedUsage(client,order.ticket_no,shift.branch_id,order.items) : {};
    await require('./orders').recordStateTransition(client,{ticketNo:order.ticket_no,branchId:shift.branch_id,fromState:order.status,toState:payload.status,actorId:shift.employee_id});
    await client.query("UPDATE orders SET status=$2,time_out=$3,supply_usage=$4, brewing_at=CASE WHEN $2='brewing' THEN $5 ELSE brewing_at END, ready_at=CASE WHEN $2='ready' THEN $5 ELSE ready_at END WHERE ticket_no=$1",[order.ticket_no,payload.status,payload.status==='completed'?time:null,usage,time]);
    await client.query('INSERT INTO pos_offline_events(id,sale_id,status,occurred_at) VALUES($1,$2,$3,$4)',[payload.id,payload.saleId,payload.status,time]);
    await notifyOrder(client,order.ticket_no,shift.branch_id);
  }
  return { id:payload.id,ticketNo:order.ticket_no };
}

module.exports={prepare,sale,advance,importedUsage,postUsage};
