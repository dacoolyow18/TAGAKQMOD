

function mapBranch(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    location: row.location,
    managerId: row.manager_id,
    createdAt: row.created_at,
  };
}

function formatAccountName(row) {
  const first = (row.first_name || '').trim();
  const middle = (row.middle_name || '').trim();
  const initialRaw = (row.middle_initial || '').trim().replace(/\.+$/, '');
  const initial = initialRaw ? `${initialRaw}.` : '';
  const last = (row.last_name || '').trim();
  const built = [first, middle || initial, last].filter(Boolean).join(' ');
  return built || row.name || '';
}

function mapAccount(row) {
  return {
    id: row.id,
    name: formatAccountName(row),
    firstName: row.first_name || '',
    middleName: row.middle_name || '',
    middleInitial: row.middle_initial || '',
    lastName: row.last_name || '',
    role: row.role,
    email: row.email || '',
    phone: row.phone || '',
    birthdate: row.birthdate || '',
    branchId: row.branch_id,
    active: row.active,
    locked: Boolean(row.locked),
    createdAt: row.created_at,
  };
}

module.exports = { mapBranch, mapAccount };
