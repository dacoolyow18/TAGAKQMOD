const ADMIN_ROLES = ['Super Admin', 'Admin'];
const EMPLOYEE_ROLES = ['Manager', 'Barista', 'Cashier'];
const ALL_ROLES = [...ADMIN_ROLES, ...EMPLOYEE_ROLES];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPin(value) {
  return /^\d{4}$/.test(value);
}

module.exports = { ADMIN_ROLES, EMPLOYEE_ROLES, ALL_ROLES, text, isPin };
