const { duplicatePhoneError } = require('../form-validation');

const CONSTRAINT_MESSAGES = {
  accounts_phone_key: duplicatePhoneError,
  accounts_pin_key: 'This PIN is already assigned to another employee',
  accounts_email_key: 'This email is already in use',
  branches_code_key: 'This branch code is already in use',
};

function sendDbError(res, err, next) {
  if (err.code === '23505') {
    return res.status(409).json({ error: CONSTRAINT_MESSAGES[err.constraint] || 'Already exists' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }
  return next(err);
}

module.exports = { sendDbError };
