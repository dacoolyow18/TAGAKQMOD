const media = require('../media');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { localImage } = require('../images');
const { pool, query } = require('../../db/pool');
const { requireSession } = require('../middleware/requireSession');
const { resolveSessionBranch, resolvePublicBranchId, safeBranchDir, publicOwned } = require('../branchScope');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const CAROUSEL_DIR = path.join(UPLOAD_ROOT, 'carousel');
const MAX_IMAGES = 5;
const uploadHandler = localImage(CAROUSEL_DIR);

function removeFile(relPath) {
  if (!relPath) return;
  fs.rmSync(path.join(CAROUSEL_DIR, relPath), { force: true });
}

function mapCarousel(row) {
  return {
    id: row.id,
    position: row.position,
    publicUrl: row.public_url,
    branchId: row.branch_id || null,
  };
}


function carouselRoutes() {
  const router = express.Router();

  router.get('/carousel', requireSession({ allPermissions: ['view_tools', 'edit_tools'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    try {
      const { rows } = await query(
        'SELECT * FROM carousel_images WHERE branch_id IS NOT DISTINCT FROM $1 ORDER BY position',
        [scope.branchId],
      );
      res.json(rows.map(mapCarousel));
    } catch (err) {
      next(err);
    }
  });

  router.post('/uploads/carousel', requireSession({ allPermissions: ['view_tools', 'edit_tools'] }), media.upload('carousel'), uploadHandler, async (req, res, next) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an image to upload' });
    const scope = resolveSessionBranch(req);
    if (scope.error) {
      removeFile(req.file.filename);
      return res.status(scope.status).json({ error: scope.error });
    }
    let storedRelPath = req.file.filename;
    try {
      const branchId = scope.branchId;
      const { rows: taken } = await query(
        'SELECT position FROM carousel_images WHERE branch_id IS NOT DISTINCT FROM $1',
        [branchId],
      );
      if (taken.length >= MAX_IMAGES) {
        removeFile(storedRelPath);
        return res.status(409).json({ error: `You can show up to ${MAX_IMAGES} carousel images` });
      }
      const used = new Set(taken.map(r => r.position));
      let position = 1;
      while (used.has(position)) position += 1;

      let publicUrl = `/uploads/carousel/${req.file.filename}`;
      if (branchId) {
        const subDir = safeBranchDir(branchId);
        const branchDir = path.join(CAROUSEL_DIR, subDir);
        fs.mkdirSync(branchDir, { recursive: true });
        fs.renameSync(path.join(CAROUSEL_DIR, req.file.filename), path.join(branchDir, req.file.filename));
        storedRelPath = `${subDir}/${req.file.filename}`;
        publicUrl = `/uploads/carousel/${subDir}/${req.file.filename}`;
      }

      const { rows } = await query(
        `INSERT INTO carousel_images (position, file_path, public_url, branch_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        [position, storedRelPath, publicUrl, branchId],
      );
      res.status(201).json(mapCarousel(rows[0]));
    } catch (err) {
      removeFile(storedRelPath);
      next(err);
    }
  });

  router.put('/carousel/:id/position', requireSession({ allPermissions: ['view_tools', 'edit_tools'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const position = req.body?.position;
    if (!Number.isInteger(position) || position < 1 || position > MAX_IMAGES) {
      return res.status(400).json({ error: `Position must be between 1 and ${MAX_IMAGES}` });
    }
    try {
      const { rows: targetRows } = await query(
        'SELECT * FROM carousel_images WHERE id = $1 AND ($2::text IS NULL OR branch_id = $2)',
        [req.params.id, scope.branchId],
      );
      if (!targetRows[0]) return res.status(404).json({ error: 'Carousel image not found' });

      const targetBranchId = targetRows[0].branch_id || null;
      const { rows: clash } = await query(
        'SELECT id FROM carousel_images WHERE position = $1 AND id <> $2 AND branch_id IS NOT DISTINCT FROM $3',
        [position, req.params.id, targetBranchId],
      );
      if (clash.length) return res.status(409).json({ error: 'That position is already used' });
      const { rows } = await query(
        'UPDATE carousel_images SET position = $2 WHERE id = $1 RETURNING *',
        [req.params.id, position],
      );
      if (!rows[0]) return res.status(404).json({ error: 'Carousel image not found' });
      res.json(mapCarousel(rows[0]));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/carousel/:id', requireSession({ allPermissions: ['view_tools', 'edit_tools'] }), async (req, res, next) => {
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const { rows } = await client.query(
        'DELETE FROM carousel_images WHERE id = $1 AND ($2::text IS NULL OR branch_id = $2) RETURNING file_path',
        [req.params.id, scope.branchId],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Carousel image not found' });
      }
      if (media.hosted()) {
        const { error } = await media.bucket().remove(['carousel/' + rows[0].file_path]);
        if (error) throw new Error('Carousel file removal failed');
        await client.query('DELETE FROM media_uploads WHERE object_path=$1', ['carousel/' + rows[0].file_path]);
      } else removeFile(rows[0].file_path);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      if (client) await client.query('ROLLBACK');
      next(err);
    } finally { client?.release(); }
  });

  return router;
}

function publicCarouselRoutes() {
  const router = express.Router();
  router.get('/', async (req, res, next) => {
    try {
      const branchId = await resolvePublicBranchId(req);
      const { rows } = await query(
        `SELECT * FROM carousel_images WHERE ${publicOwned('$1')} ORDER BY position`,
        [branchId],
      );
      res.json(rows.map(mapCarousel));
    } catch (err) {
      next(err);
    }
  });
  return router;
}

module.exports = { carouselRoutes, publicCarouselRoutes, UPLOAD_ROOT };
