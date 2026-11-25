const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { pool, query } = require('../db/pool');
const { resolveSessionBranch, safeBranchDir } = require('./branchScope');

const { extensions, maxBytes, encodeImage } = require('./images');
let storage;
function client() {
  if (!storage) {
    const { SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_STORAGE_BUCKET } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPABASE_STORAGE_BUCKET) throw new Error('Demo image storage is not configured');
    storage = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    }).storage;
  }
  return storage;
}

function bucket() { return client().from(process.env.SUPABASE_STORAGE_BUCKET); }

async function stagingBucket() {
  const name = process.env.SUPABASE_STORAGE_STAGING_BUCKET;
  if (!name || name === process.env.SUPABASE_STORAGE_BUCKET) throw new Error('Configure a separate staging bucket');
  const { data, error } = await client().getBucket(name);
  if (error || !data || data.public !== false || !(data.file_size_limit > 0 && data.file_size_limit <= maxBytes)
      || !data.allowed_mime_types?.length || !data.allowed_mime_types.every(mime => extensions.has(mime))) {
    throw new Error('Configure private staging with image types and a 5 MB limit');
  }
  return client().from(name);
}

// Staged files use flat UUID names so removal also covers abandoned uploads
// whose database records disappeared when an account or branch was deleted.
async function expireStagedFiles(staging) {
  const { data, error } = await staging.list('', { limit: 32, sortBy: { column: 'created_at', order: 'asc' } });
  if (error) throw new Error('Staging cleanup failed');
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const stale = data.filter(file => Date.parse(file.created_at) < cutoff).map(file => file.name);
  if (stale.length && (await staging.remove(stale)).error) throw new Error('Staging cleanup failed');
}

// Object storage is opt-in. Without a bucket the app writes to server/uploads,
// which is the default for local development and single-host deployments.
function hosted() { return Boolean(process.env.SUPABASE_STORAGE_BUCKET); }

function upload(kind) {
  return async (req, res, next) => {
    if (!hosted()) {
      if (req.body?.stage === 'sign') return res.json({ multipart: true });
      return next();
    }
    const scope = resolveSessionBranch(req);
    if (scope.error) return res.status(scope.status).json({ error: scope.error });
    const { branchId } = scope;
    const { stage, id, mimeType, size } = req.body || {};
    let db;
    try {
      if (stage === 'sign') {
        if (!extensions.has(mimeType) || !Number.isInteger(size) || size <= 0 || size > maxBytes) {
          return res.status(400).json({ error: 'Choose a JPG, PNG or WebP image up to 5 MB.' });
        }
        const uploadId = randomUUID();
        const objectPath = [kind, safeBranchDir(branchId), uploadId + '.' + extensions.get(mimeType)].filter(Boolean).join('/');
        const staging = await stagingBucket();
        await expireStagedFiles(staging);
        const { data, error } = await staging.createSignedUploadUrl(uploadId);
        if (error) throw new Error('Could not authorize image upload');
        await query('INSERT INTO media_uploads(id,kind,object_path,account_id,branch_id,mime_type) VALUES($1,$2,$3,$4,$5,$6)',
          [uploadId,kind,objectPath,req.account.id,branchId,mimeType]);
        return res.json({ id: uploadId, signedUrl: data.signedUrl });
      }
      if (stage !== 'finish' || !/^[0-9a-f-]{36}$/i.test(id || '')) return res.status(400).json({error:'Start a signed upload first'});
      db = await pool.connect();
      await db.query('BEGIN');
      const {rows:[entry]} = await db.query(
        'SELECT * FROM media_uploads WHERE id=$1 AND account_id=$2 AND branch_id IS NOT DISTINCT FROM $3 AND kind=$4 FOR UPDATE',
        [id,req.account.id,branchId,kind]);
      if (!entry) { await db.query('ROLLBACK'); return res.sendStatus(404); }
      if (entry.result) { await db.query('COMMIT'); return res.json(entry.result); }
      const staging = await stagingBucket();
      const {data: info, error} = await staging.info(id);
      const mime = info?.metadata?.mimetype ?? info?.contentType;
      const bytes = Number(info?.metadata?.size ?? info?.size);
      if (error || mime !== entry.mime_type || !Number.isFinite(bytes) || bytes <= 0 || bytes > maxBytes) {
        await db.query('ROLLBACK'); return res.status(400).json({error:'Uploaded image could not be verified'});
      }
      const { data: file, error: downloadError } = await staging.download(id);
      if (downloadError || !file) throw new Error('Staged image could not be read');
      let imageBytes;
      try {
        imageBytes = await encodeImage(Buffer.from(await file.arrayBuffer()), entry.mime_type);
      } catch (error) {
        await db.query('ROLLBACK');
        await staging.remove([id]);
        return res.status(415).json({ error: 'Invalid image content' });
      }
      const publicUrl = '/uploads/' + entry.object_path;
      const result = { branchId, publicUrl };
      if (kind === 'carousel') {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['carousel:'+(branchId || '')]);
        const {rows:[slot]} = await db.query(
          'SELECT p FROM generate_series(1,5) p WHERE NOT EXISTS (SELECT 1 FROM carousel_images WHERE position=p AND branch_id IS NOT DISTINCT FROM $1) ORDER BY p LIMIT 1',[branchId]);
        if (!slot) {
          await db.query('ROLLBACK');
          await staging.remove([id]);
          return res.status(409).json({error:'You can show up to 5 carousel images'});
        }
        const {rows:[image]} = await db.query(
          'INSERT INTO carousel_images(position,file_path,public_url,branch_id) VALUES ($1,$2,$3,$4) RETURNING id,position',
          [slot.p,entry.object_path.slice(kind.length+1),publicUrl,branchId]);
        Object.assign(result,image);
      }
      const published = await bucket().upload(entry.object_path, imageBytes, { contentType: entry.mime_type, upsert: true });
      if (published.error) throw new Error('Image publication failed');
      await db.query('UPDATE media_uploads SET result=$2 WHERE id=$1',[id,result]);
      await db.query('COMMIT');
      await staging.remove([id]).catch(() => {}); // Sweep retries when storage is unavailable.
      res.status(201).json(result);
    } catch (err) {
      if (db) await db.query('ROLLBACK');
      next(new Error('Demo image storage operation failed'));
    } finally { db?.release(); }
  };
}

function serve(req, res, next) {
  if (!hosted()) return next();
  if (!/^\/(menu|carousel)\/(?:[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(req.path)) return res.sendStatus(404);
  res.redirect(302, bucket().getPublicUrl(req.path.slice(1)).data.publicUrl);
}
module.exports = { hosted, bucket, upload, serve };
