const express = require('express');
const { query, withTransaction } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { prepare, sale, advance, postUsage } = require('../offlinePos');

const router = express.Router();
router.get('/ready', async (req,res) => {
  try {
    await query({text:'SELECT 1',query_timeout:3000});
    res.json({posReady:1});
  } catch { res.status(503).json({posReady:0}); }
});

function transaction(fn) {
  return async (req,res,next) => {
    try { res.json(await withTransaction(client=>fn(client,req.account,req.body || {}))); }
    catch (error) {
      if ([400,403,409].includes(error.status)) return res.status(error.status).json({error:error.message});
      next(error);
    }
  };
}
const staff=requireSession({roles:['Manager','Barista','Cashier'],permission:'access_terminal'});
router.get('/availability',staff,(req,res)=>{
  const prefix=req.account.branchId+'/';
  res.json({configured:(process.env.POS_OFFLINE_REGISTERS || '').split(',').some(pair=>pair.trim().startsWith(prefix))});
});
router.post('/prepare',staff,transaction((client,account,body)=>prepare(client,account,body.device)));
router.post('/sync',staff,transaction((client,account,body)=>body.saleId ? advance(client,account,body) : sale(client,account,body,false)));

const manager=requireSession({roles:['Manager'],allPermissions:['access_terminal','view_orders','manage_orders']});
router.post('/recover',manager,transaction(async(client,account,body)=>{
  const ack=body.saleId ? await advance(client,account,body,true) : await sale(client,account,body,false,true);
  await client.query('INSERT INTO pos_recovery_audit(operation_id,sale_id,manager_id) VALUES($1,$2,$3) ON CONFLICT(operation_id) DO NOTHING',
    [body.id,body.saleId || body.id,account.id]);
  return ack;
}));
router.get('/discrepancies',manager,async(req,res,next)=>{
  try {
    const {rows}=await query('SELECT d.ticket_no,d.usage FROM pos_inventory_discrepancies d JOIN orders o USING(ticket_no) WHERE o.branch_id=$1 AND d.resolved_at IS NULL AND o.status=$2',[req.account.branchId,'completed']);
    res.json(rows);
  } catch(error) {next(error);}
});
router.post('/reconcile',manager,transaction(async(client,account,body)=>{
  const {rows:[item]}=await client.query('SELECT d.usage FROM orders o JOIN pos_inventory_discrepancies d USING(ticket_no) WHERE o.ticket_no=$1 AND o.branch_id=$2 AND o.status=$3 AND d.resolved_at IS NULL FOR UPDATE OF o,d',[body.ticketNo,account.branchId,'completed']);
  if (!item) return {resolved:false};
  if (!await postUsage(client,body.ticketNo,account.branchId,item.usage)) return {resolved:false};
  await client.query('UPDATE orders SET supply_usage=$2 WHERE ticket_no=$1',[body.ticketNo,item.usage]);
  await client.query('UPDATE pos_inventory_discrepancies SET resolved_at=now(),resolved_by=$2 WHERE ticket_no=$1',[body.ticketNo,account.id]);
  return {resolved:true};
}));
module.exports=router;
