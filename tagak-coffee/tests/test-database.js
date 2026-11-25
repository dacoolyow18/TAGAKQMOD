const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');
const file = path.resolve(__dirname, '..', '.env');
const local = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
const value = process.env.TEST_DATABASE_URL || local.TEST_DATABASE_URL;
if (!value) throw new Error('Configure TEST_DATABASE_URL for the disposable local test database.');
const url = new URL(value);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/tagak_test' ||
    url.port !== '5433' || url.search) throw new Error('Expected the approved localhost:5433/tagak_test database.');
process.env.SUPER_ADMIN_PASSWORD ||= 'Super-pass-123';
process.env.PIN_HMAC_KEY ||= require('node:crypto').randomBytes(32).toString('hex');
module.exports = value;
