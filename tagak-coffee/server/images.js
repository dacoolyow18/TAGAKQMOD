const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const sharp = require('sharp');

const extensions = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const maxBytes = 5 * 1024 * 1024;

function invalidImage() {
  return Object.assign(new Error('Choose a valid JPG, PNG or WebP image up to 5 MB.'), { status: 415 });
}

async function encodeImage(input, mimeType) {
  if (!extensions.has(mimeType) || !input.length || input.length > maxBytes) throw invalidImage();
  // Exclude vector and document inputs before asking a decoder to parse the file.
  const matches = {
    'image/png': input.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    'image/jpeg': input.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
    'image/webp': input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP',
  };
  if (!matches[mimeType]) throw invalidImage();
  try {
    const pipeline = sharp(input, { limitInputPixels: 20_000_000, failOn: 'warning' });
    const { format } = await pipeline.metadata();
    if ('image/' + format !== mimeType) throw invalidImage();
    const result = await pipeline.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .toFormat(format).toBuffer();
    if (result.length > maxBytes) throw invalidImage();
    return result;
  } catch {
    throw invalidImage();
  }
}

const parse = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fields: 2, fieldSize: 1024, parts: 4, fileSize: maxBytes },
}).single('file');

function localImage(directory) {
  return (req, res, next) => parse(req, res, async err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Invalid upload or image exceeds 5 MB.' });
    if (!req.file) return res.status(400).json({ error: 'Choose an image to upload' });
    try {
      const result = await encodeImage(req.file.buffer, req.file.mimetype);
      const filename = randomUUID() + '.' + extensions.get(req.file.mimetype);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, filename), result, { flag: 'wx' });
      req.file.filename = filename;
      next();
    } catch (error) {
      if (error.status === 415) return res.status(415).json({ error: error.message });
      next(error);
    }
  });
}

module.exports = { extensions, maxBytes, encodeImage, localImage };
