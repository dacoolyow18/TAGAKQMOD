const media = require('../media');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { localImage } = require('../images');
const { randomUUID } = require('crypto');
const { pool, query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { text } = require('../validate');
const { sendDbError } = require('../errors');
const { resolveSessionBranch, resolvePublicBranchId, safeBranchDir, sessionOwned, publicOwned, ownedBy } = require('../branchScope');

const CATEGORIES = ['Drinks', 'Pastries'];
const MENU_IMAGE_DIR = path.join(__dirname, '..', 'uploads', 'menu');
const menuImageUpload = localImage(MENU_IMAGE_DIR);

function mapMenuItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    description: row.description,
    hasTemperature: row.has_temperature,
    imagePath: row.image_path,
    soldOut: row.sold_out,
    active: row.active,
    archived: row.is_archived === true,
    archivedAt: row.archived_at || null,
    branchId: row.branch_id || null,
  };
}

const ARCHIVED_ERROR = 'This item is archived. Restore it before editing.';

/** Returns 'missing', 'archived', or 'ok' for a menu item id within branch scope. */
async function menuItemState(db, id, branchId = null) {
  const { rows } = await db.query(
    `SELECT is_archived FROM menu_items WHERE id = $1 AND ${sessionOwned('$2')}`,
    [id, branchId],
  );
  if (!rows[0]) return 'missing';
  return rows[0].is_archived ? 'archived' : 'ok';
}

const SAFE_IMAGE_PATH = /^\/(uploads\/menu\/([a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_-]+\.(png|jpg|webp)|customer-app\/img\/[a-zA-Z0-9_.-]+\.(png|jpg|webp|svg))$/;

function menuInput(body) {
  const name = text(body.name);
  const category = text(body.category);
  const price = body.price;
  const imagePath = text(body.imagePath);
  if (!name) return { error: 'Please enter an item name' };
  if (!CATEGORIES.includes(category)) return { error: 'Category must be Drinks or Pastries' };
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return { error: 'Price must be zero or more' };
  if (imagePath && !SAFE_IMAGE_PATH.test(imagePath)) return { error: 'Image path must be a local menu upload' };
  return {
    value: {
      name,
      category,
      price,
      description: text(body.description),
      hasTemperature: category === 'Drinks' && body.hasTemperature === true,
      imagePath,
      soldOut: body.soldOut === true,
      active: body.active !== false,
    },
  };
}

async function hasRecipe(menuItemId) {
  const { rows } = await query('SELECT 1 FROM menu_item_recipes WHERE menu_item_id = $1 LIMIT 1', [menuItemId]);
  return rows.length > 0;
}

function recipeInput(body) {
  if (!Array.isArray(body)) return { error: 'Send the recipe as a list' };
  if (body.length === 0) return { error: 'Add at least one supply to the recipe' };
  for (const line of body) {
    if (!line || typeof line.supplyId !== 'string' || typeof line.qty !== 'number' || !(line.qty > 0)) {
      return { error: 'Each recipe line needs a supply and a quantity above zero' };
    }
    if (line.largeQty != null && (typeof line.largeQty !== 'number' || !(line.largeQty > 0))) {
      return { error: 'A Large quantity must be above zero, or left blank to keep the regular quantity' };
    }
  }
  return { value: body.map(line => ({ supplyId: line.supplyId, qty: line.qty, largeQty: line.largeQty ?? null })) };
}

function menuItemRoutes() {
  const router = express.Router();

  router.post('/image', requireSession({ allPermissions: ['view_menu', 'edit_menu'] }), media.upload('menu'), menuImageUpload, (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) {
      fs.rmSync(path.join(MENU_IMAGE_DIR, req.file.filename), { force: true });
      return res.status(scope.status).json({ error: scope.error });
    }
    if (scope.branchId) {
      const subDir = safeBranchDir(scope.branchId);
      const branchDir = path.join(MENU_IMAGE_DIR, subDir);
      fs.mkdirSync(branchDir, { recursive: true });
      fs.renameSync(path.join(MENU_IMAGE_DIR, req.file.filename), path.join(branchDir, req.file.filename));
      return res.status(201).json({
        publicUrl: `/uploads/menu/${subDir}/${req.file.filename}`,
        branchId: scope.branchId,
      });
    }
    res.status(201).json({ publicUrl: `/uploads/menu/${req.file.filename}`, branchId: null });
  });

  // Archived items are left out unless the caller asks for them (?includeArchived=true),
  // which the POS does so reports can still name and cost drinks sold before archiving.
  router.get('/', requireSession({ permission: ['view_menu', 'access_terminal'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const includeArchived = req.account.permissions.view_menu && req.query.includeArchived === 'true';
      const { rows } = await query(
        `SELECT * FROM menu_items
          WHERE ${sessionOwned('$1')}
            ${includeArchived ? '' : 'AND NOT is_archived'}
            ${req.account.permissions.view_menu ? '' : 'AND active'}
          ORDER BY category, name`,
        [scope.branchId],
      );
      res.json(rows.map(mapMenuItem));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireSession({ allPermissions: ['view_menu', 'edit_menu'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const input = menuInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });
    if (req.body.active === true) {
      return res.status(400).json({ error: 'Add at least one supply before publishing. New items are saved as drafts.' });
    }
    try {
      const v = input.value;
      const { rows } = await query(
        `INSERT INTO menu_items (id, name, category, price, description, has_temperature, image_path, sold_out, active, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9) RETURNING *`,
        [randomUUID(), v.name, v.category, v.price, v.description, v.hasTemperature, v.imagePath, v.soldOut, scope.branchId],
      );
      res.status(201).json(mapMenuItem(rows[0]));
    } catch (err) {
      sendDbError(res, err, next);
    }
  });

  router.put('/:id', requireSession({ allPermissions: ['view_menu', 'edit_menu'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const input = menuInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });
    try {
      const v = input.value;
      const state = await menuItemState({ query }, req.params.id, scope.branchId);
      if (state === 'missing') return res.status(404).json({ error: 'Menu item not found' });
      if (state === 'archived') return res.status(409).json({ error: ARCHIVED_ERROR });
      if (v.active && !(await hasRecipe(req.params.id))) {
        return res.status(400).json({ error: 'Add at least one supply before publishing this item' });
      }
      const { rows } = await query(
        `UPDATE menu_items
            SET name = $2, category = $3, price = $4, description = $5, has_temperature = $6,
                image_path = $7, sold_out = $8, active = $9,
                branch_id = COALESCE(branch_id, $10)
          WHERE id = $1 AND NOT is_archived
            AND ${sessionOwned('$10')}
          RETURNING *`,
        [req.params.id, v.name, v.category, v.price, v.description, v.hasTemperature, v.imagePath, v.soldOut, v.active, scope.branchId],
      );
      if (!rows[0]) return res.status(409).json({ error: ARCHIVED_ERROR });
      res.json(mapMenuItem(rows[0]));
    } catch (err) {
      sendDbError(res, err, next);
    }
  });

  // Soft delete: the row, its recipe, and every order that references it stay in
  // the database for history and reporting. The item just leaves the menu.
  router.delete('/:id', requireSession({ allPermissions: ['view_menu', 'edit_menu'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const { rows } = await query(
        `UPDATE menu_items
            SET is_archived = true, archived_at = COALESCE(archived_at, now()), active = false,
                branch_id = COALESCE(branch_id, $2)
          WHERE id = $1 AND ${sessionOwned('$2')}
          RETURNING *`,
        [req.params.id, scope.branchId],
      );
      if (!rows[0]) return res.status(404).json({ error: 'Menu item not found' });
      res.json({ ok: true, archived: true, item: mapMenuItem(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

  // Bring an archived item back as an unpublished draft so it is reviewed before going live.
  router.post('/:id/restore', requireSession({ allPermissions: ['view_menu', 'edit_menu'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const { rows } = await query(
        `UPDATE menu_items
            SET is_archived = false, archived_at = NULL, active = false,
                branch_id = COALESCE(branch_id, $2)
          WHERE id = $1 AND ${sessionOwned('$2')}
          RETURNING *`,
        [req.params.id, scope.branchId],
      );
      if (!rows[0]) return res.status(404).json({ error: 'Menu item not found' });
      res.json(mapMenuItem(rows[0]));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/recipe', requireSession({ permission: 'view_menu' }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const { rows: itemCheck } = await query(
        `SELECT 1 FROM menu_items WHERE id = $1 AND ${sessionOwned('$2')}`,
        [req.params.id, scope.branchId],
      );
      if (!itemCheck[0]) return res.status(404).json({ error: 'Menu item not found' });
      const { rows } = await query(
        'SELECT supply_id, qty::float8 AS qty, large_qty::float8 AS large_qty FROM menu_item_recipes WHERE menu_item_id = $1 ORDER BY supply_id',
        [req.params.id],
      );
      res.json(rows.map(row => ({ supplyId: row.supply_id, qty: row.qty, largeQty: row.large_qty })));
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id/recipe', requireSession({ allPermissions: ['view_menu', 'edit_menu'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const input = recipeInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await menuItemState(client, req.params.id, scope.branchId);
      if (state !== 'ok') {
        await client.query('ROLLBACK');
        return state === 'missing'
          ? res.status(404).json({ error: 'Menu item not found' })
          : res.status(409).json({ error: ARCHIVED_ERROR });
      }
      if (scope.branchId) {
        const supplyIds = input.value.map(l => l.supplyId);
        const { rows: foreignSupplies } = await client.query(
          `SELECT id FROM supplies WHERE id = ANY($1) AND NOT ${ownedBy('$2')}`,
          [supplyIds, scope.branchId],
        );
        if (foreignSupplies.length > 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'One or more supplies do not belong to your branch' });
        }
      }
      await client.query('DELETE FROM menu_item_recipes WHERE menu_item_id = $1', [req.params.id]);
      for (const line of input.value) {
        await client.query(
          'INSERT INTO menu_item_recipes (menu_item_id, supply_id, qty, large_qty) VALUES ($1, $2, $3, $4)',
          [req.params.id, line.supplyId, line.qty, line.largeQty],
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      sendDbError(res, err, next);
    } finally {
      client.release();
    }
  });

  return router;
}

function publicMenuRoutes() {
  const router = express.Router();
  router.get('/', async (req, res, next) => {
    try {
      const branchId = await resolvePublicBranchId(req);
      const { rows } = await query(
        `SELECT * FROM menu_items
          WHERE active AND NOT is_archived
            AND ${publicOwned('$1')}
          ORDER BY category, name`,
        [branchId],
      );
      res.json(rows.map(mapMenuItem));
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = { menuItemRoutes, publicMenuRoutes };
