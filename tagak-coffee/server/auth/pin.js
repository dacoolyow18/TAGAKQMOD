const crypto = require('node:crypto');

function pinDigest(pin) {
  const key = process.env.PIN_HMAC_KEY;
  if (!/^[0-9a-f]{64}$/i.test(key || '')) throw new Error('Configure a 32-byte hex PIN_HMAC_KEY');
  return crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(pin).digest('hex');
}

module.exports = { pinDigest };
