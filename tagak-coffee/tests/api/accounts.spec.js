const { test, expect } = require('@playwright/test');
const { resetDatabase, insertAccount, startServer } = require('./helpers');

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@tagak.test';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super-pass-123';

let server;
let superCookie;
let managerCookie;
let adminCookie;

async function cookieFrom(res) {
  const header = res.headers()['set-cookie'] || '';
  return `tagak_session=${header.match(/tagak_session=([^;]+)/)[1]}`;
}

test.beforeAll(async ({ request }) => {
  await resetDatabase();
  await insertAccount({ id: 'emp-mgr', name: 'Juan Dela Cruz', role: 'Manager', pin: '5678' });
  await insertAccount({ id: 'adm-test', name: 'Ana Admin', role: 'Admin', email: 'admin.test@tagak.test', password: 'admin-pass-123' });
  server = await startServer();
  superCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/admin-login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  }));
  adminCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/admin-login`, {
    data: { email: 'admin.test@tagak.test', password: 'admin-pass-123' },
  }));
  managerCookie = await cookieFrom(await request.post(`${server.baseURL}/api/auth/pin`, {
    data: { email: 'emp-mgr@tagak.test', pin: '5678' },
  }));
});

test.afterAll(async () => {
  await server?.close();
});

function call(request, method, path, cookie, data) {
  return request.fetch(`${server.baseURL}${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
    data,
  });
}

let uniq = 0;
function uniqueCode() {
  uniq += 1;
  return String(3000000 + uniq);
}

async function makeBranch(request, name = 'Test Branch') {
  const res = await call(request, 'POST', '/api/branches', superCookie, {
    code: uniqueCode(), name, location: 'Davao City',
  });
  return res.json();
}

async function makeEmployee(request, branchId, overrides = {}) {
  const n = ++uniq;
  const res = await call(request, 'POST', '/api/accounts', superCookie, {
    firstName: 'Maria',
    middleName: 'Clara',
    lastName: 'Santos',
    role: 'Cashier',
    email: `employee${n}@tagak.test`,
    phone: '0988' + String(n).padStart(7, '0'),
    birthdate: '1998-05-14',
    pin: String(1000 + n).padStart(4, '0'),
    branchId,
    ...overrides,
  });
  return res.json();
}

test('branches require a session', async ({ request }) => {
  const res = await call(request, 'GET', '/api/branches', null);
  expect(res.status()).toBe(401);
});

test('branch entry and assignment validate codes and employee names', async ({ request }) => {
  const branch = await makeBranch(request);
  for (const code of ['12A', ' 123', '12-3', '12345678']) {
    for (const method of ['POST', 'PUT']) {
      const path = '/api/branches' + (method === 'PUT' ? '/' + branch.id : '');
      expect((await call(request, method, path, superCookie, { name: 'Demo', code })).status()).toBe(400);
    }
    expect((await request.get(server.baseURL + '/api/public/branches', { params: { code } })).status()).toBe(400);
    expect((await makeEmployee(request, branch.id, { branchCode: code })).error).toContain('numbers only');
  }
  for (const field of ['firstName', 'middleName', 'lastName']) {
    for (const value of ['A2', 'Sam!']) {
      expect((await makeEmployee(request, branch.id, { [field]: value })).error).toBe('Only letters are allowed in name fields.');
    }
  }
  const admin = await call(request, 'POST', '/api/accounts', superCookie, {
    firstName: 'Ana1', lastName: 'Reyes', role: 'Admin', email: 'ana.admin@tagak.test',
    phone: '09181114444', birthdate: '1990-01-01', password: 'admin-pass-123',
  });
  expect(admin.status()).toBe(400);
  expect((await admin.json()).error).toBe('Only letters are allowed in name fields.');
  expect((await makeEmployee(request, branch.id, { branchCode: branch.code, middleName: '' })).id).toBeTruthy();
});

test('a Super Admin creates a branch, and a duplicate code is rejected with 409', async ({ request }) => {
  const code = uniqueCode();
  const created = await call(request, 'POST', '/api/branches', superCookie, {
    code, name: 'Tagak Main', location: '123 A. Pichon St, Davao City',
  });
  expect(created.status()).toBe(201);
  const body = await created.json();
  expect(body).toMatchObject({ code, name: 'Tagak Main' });
  expect(body.id).toBeTruthy();

  const dup = await call(request, 'POST', '/api/branches', superCookie, { code, name: 'Other', location: 'X' });
  expect(dup.status()).toBe(409);
});

test('branches with employees are grouped, and only employees of that branch are nested', async ({ request }) => {
  const first = await makeBranch(request, 'First');
  const second = await makeBranch(request, 'Second');
  await makeEmployee(request, first.id, { firstName: 'Maria', middleName: 'Clara', lastName: 'Santos' });

  const res = await call(request, 'GET', '/api/branches?include=employees', superCookie);
  expect(res.status()).toBe(200);
  const branches = await res.json();
  expect(branches.find(b => b.id === first.id).employees.map(e => e.name)).toEqual(['Maria Clara Santos']);
  expect(branches.find(b => b.id === second.id).employees).toEqual([]);
});

test('a Manager cannot create accounts (403)', async ({ request }) => {
  const branch = await makeBranch(request);
  const res = await call(request, 'POST', '/api/accounts', managerCookie, {
    firstName: 'Sneaky',
    middleName: 'Middle',
    lastName: 'Cashier',
    role: 'Cashier',
    email: 'sneaky@tagak.test',
    phone: '09171234567',
    birthdate: '1999-01-01',
    pin: '2222',
    branchId: branch.id,
  });
  expect(res.status()).toBe(403);
});

test('an employee needs a 4-digit PIN and a branch; a duplicate PIN returns 409', async ({ request }) => {
  const branch = await makeBranch(request);

  const noPin = await call(request, 'POST', '/api/accounts', superCookie, {
    firstName: 'No',
    middleName: 'M',
    lastName: 'Pin',
    role: 'Barista',
    email: 'nopin@tagak.test',
    phone: '09171234567',
    birthdate: '1999-01-01',
    pin: '',
    branchId: branch.id,
  });
  expect(noPin.status()).toBe(400);

  const taken = await makeEmployee(request, branch.id, { pin: '7777' });
  expect(taken.id).toBeTruthy();
  expect(taken).not.toHaveProperty('pin');
  expect(taken).not.toHaveProperty('pin_digest');
  const dup = await call(request, 'POST', '/api/accounts', superCookie, {
    firstName: 'Clash',
    middleName: 'M',
    lastName: 'User',
    role: 'Barista',
    email: 'clash@tagak.test',
    phone: '09171234567',
    birthdate: '1999-01-01',
    pin: '7777',
    branchId: branch.id,
  });
  expect(dup.status()).toBe(409);
});

test('an admin account cannot be given a PIN or a branch', async ({ request }) => {
  const branch = await makeBranch(request);
  const res = await call(request, 'POST', '/api/accounts', superCookie, {
    firstName: 'Ops',
    middleInitial: 'A',
    lastName: 'Admin',
    role: 'Admin',
    email: 'ops@tagak.test',
    phone: '09171234567',
    birthdate: '1990-06-15',
    password: 'ops-pass-123',
    pin: '3333',
    branchId: branch.id,
  });
  expect(res.status()).toBe(400);
});

test('employees and admins require firstName, lastName, email, phone, and birthdate while middleName/middleInitial are optional', async ({ request }) => {
  const branch = await makeBranch(request);

  // Employee missing required fields is rejected (400)
  const baseEmp = {
    firstName: 'Carlo',
    middleName: 'Diaz',
    lastName: 'Mendoza',
    role: 'Barista',
    email: 'carlo@tagak.test',
    phone: '09181112222',
    birthdate: '1997-04-20',
    pin: '6161',
    branchId: branch.id,
  };
  for (const field of ['firstName', 'lastName', 'email', 'phone', 'birthdate']) {
    const bad = await call(request, 'POST', '/api/accounts', superCookie, { ...baseEmp, [field]: '' });
    expect(bad.status()).toBe(400);
  }

  const createdEmp = await call(request, 'POST', '/api/accounts', superCookie, baseEmp);
  expect(createdEmp.status()).toBe(201);
  const empBody = await createdEmp.json();
  expect(empBody).toMatchObject({
    name: 'Carlo Diaz Mendoza',
    firstName: 'Carlo',
    middleName: 'Diaz',
    middleInitial: '',
    lastName: 'Mendoza',
    email: 'carlo@tagak.test',
    phone: '09181112222',
    birthdate: '1997-04-20',
  });

  // Employee without middleName/middleInitial succeeds
  const empNoMiddle = await call(request, 'POST', '/api/accounts', superCookie, {
    ...baseEmp,
    middleName: '',
    email: 'carlo.nomiddle@tagak.test',
    phone: '09181112223',
    pin: '6262',
  });
  expect(empNoMiddle.status()).toBe(201);
  const empNoMiddleBody = await empNoMiddle.json();
  expect(empNoMiddleBody).toMatchObject({
    name: 'Carlo Mendoza',
    firstName: 'Carlo',
    middleName: '',
    middleInitial: '',
    lastName: 'Mendoza',
  });

  // Admin & Super Admin missing required fields is rejected (400), while middleInitial is optional
  for (const role of ['Admin', 'Super Admin']) {
    const baseAdmin = {
      firstName: 'Elena',
      middleInitial: 'R',
      lastName: 'Velasco',
      role,
      email: `${role.toLowerCase().replace(/\s+/g, '')}@tagak.test`,
      phone: role === 'Admin' ? '09179998888' : '09179998889',
      birthdate: '1988-11-05',
      password: 'Admin-pass-123',
    };
    for (const field of ['firstName', 'lastName', 'email', 'phone', 'birthdate']) {
      const bad = await call(request, 'POST', '/api/accounts', superCookie, { ...baseAdmin, [field]: '' });
      expect(bad.status()).toBe(400);
    }
    const createdAdmin = await call(request, 'POST', '/api/accounts', superCookie, baseAdmin);
    expect(createdAdmin.status()).toBe(201);
    const adminBody = await createdAdmin.json();
    expect(adminBody).toMatchObject({
      name: 'Elena R. Velasco',
      firstName: 'Elena',
      middleName: '',
      middleInitial: 'R',
      lastName: 'Velasco',
      role,
      phone: baseAdmin.phone,
      birthdate: '1988-11-05',
    });

    const createdAdminNoMiddle = await call(request, 'POST', '/api/accounts', superCookie, {
      ...baseAdmin,
      phone: role === 'Admin' ? '09179998890' : '09179998891',
      middleInitial: '',
      email: `${role.toLowerCase().replace(/\s+/g, '')}.nomiddle@tagak.test`,
    });
    expect(createdAdminNoMiddle.status()).toBe(201);
    const adminNoMiddleBody = await createdAdminNoMiddle.json();
    expect(adminNoMiddleBody).toMatchObject({
      name: 'Elena Velasco',
      firstName: 'Elena',
      middleName: '',
      middleInitial: '',
      lastName: 'Velasco',
      role,
    });
  }
});

test('an account can be updated and deleted', async ({ request }) => {
  const branch = await makeBranch(request);
  const created = await makeEmployee(request, branch.id, {
    firstName: 'Ana', middleName: 'Lopez', lastName: 'Reyes', role: 'Barista', pin: '9135',
  });

  const updated = await call(request, 'PUT', `/api/accounts/${created.id}`, superCookie, {
    firstName: 'Ana',
    middleName: 'Lopez',
    lastName: 'Ramos',
    role: 'Barista',
    email: created.email,
    phone: created.phone,
    birthdate: created.birthdate,
    branchId: branch.id,
  });
  expect(updated.status()).toBe(200);
  expect((await updated.json()).name).toBe('Ana Lopez Ramos');
  const login = await request.post(server.baseURL + '/api/auth/pin', { data: { email: created.email, pin: '9135' } });
  expect(login.status()).toBe(200);
  const oldSession = await cookieFrom(login);
  const replacement = await call(request, 'PUT', '/api/accounts/' + created.id, superCookie, { ...created, pin: '9136' });
  expect(replacement.status()).toBe(200);
  expect((await call(request, 'GET', '/api/auth/me', oldSession)).status()).toBe(401);

  const removed = await call(request, 'DELETE', `/api/accounts/${created.id}`, superCookie);
  expect(removed.status()).toBe(200);
});

test('deactivating an account is saved and reflected in the list', async ({ request }) => {
  const branch = await makeBranch(request);
  const created = await makeEmployee(request, branch.id, {
    firstName: 'Toggle', middleName: 'M', lastName: 'Me',
  });

  const off = await call(request, 'PUT', `/api/accounts/${created.id}`, superCookie, {
    firstName: created.firstName,
    middleName: created.middleName,
    lastName: created.lastName,
    role: 'Cashier',
    email: created.email,
    phone: created.phone,
    birthdate: created.birthdate,
    branchId: branch.id,
    active: false,
  });
  expect((await off.json()).active).toBe(false);

  const list = await (await call(request, 'GET', '/api/accounts', superCookie)).json();
  expect(list.find(a => a.id === created.id).active).toBe(false);
});

test('a branch with employees cannot be deleted (409), and an empty one can', async ({ request }) => {
  const busy = await makeBranch(request, 'Busy');
  await makeEmployee(request, busy.id);
  const blocked = await call(request, 'DELETE', `/api/branches/${busy.id}`, superCookie);
  expect(blocked.status()).toBe(409);

  const empty = await makeBranch(request, 'Empty');
  const removed = await call(request, 'DELETE', `/api/branches/${empty.id}`, superCookie);
  expect(removed.status()).toBe(200);
});

test('permissions can be read by a signed-in user and changed only with manage_roles', async ({ request }) => {
  const read = await call(request, 'GET', '/api/permissions', superCookie);
  expect(read.status()).toBe(200);
  const matrix = await read.json();
  expect(Object.keys(matrix).sort()).toEqual(['Admin', 'Barista', 'Cashier', 'Manager', 'Super Admin']);

  const denied = await call(request, 'PUT', '/api/permissions', managerCookie, { ...matrix });
  expect(denied.status()).toBe(403);

  const updated = { ...matrix, Cashier: { ...matrix.Cashier, view_analytics: true } };
  const ok = await call(request, 'PUT', '/api/permissions', superCookie, updated);
  expect(ok.status()).toBe(200);
  const after = await (await call(request, 'GET', '/api/permissions', superCookie)).json();
  expect(after.Cashier.view_analytics).toBe(true);
});

test('admin can toggle employee status and edit employee permissions, but not Admin or Super Admin ones', async ({ request }) => {
  const branch = await makeBranch(request, 'Admin Scope');
  const emp = await makeEmployee(request, branch.id, { role: 'Manager' });
  const toggled = await call(request, 'PUT', `/api/accounts/${emp.id}`, adminCookie, {
    firstName: emp.firstName, middleName: emp.middleName, lastName: emp.lastName, role: 'Manager',
    email: emp.email, phone: emp.phone, birthdate: emp.birthdate, branchId: branch.id, active: false,
  });
  expect(toggled.status()).toBe(200);
  expect((await toggled.json()).active).toBe(false);

  const matrix = await (await call(request, 'GET', '/api/permissions', adminCookie)).json();
  const employeeEdit = { ...matrix, Barista: { ...matrix.Barista, view_analytics: true } };
  expect((await call(request, 'PUT', '/api/permissions', adminCookie, employeeEdit)).status()).toBe(200);

  const adminEdit = { ...matrix, Admin: { ...matrix.Admin, view_analytics: false } };
  expect((await call(request, 'PUT', '/api/permissions', adminCookie, adminEdit)).status()).toBe(403);

  const superEdit = { ...matrix, 'Super Admin': { ...matrix['Super Admin'], view_analytics: false } };
  expect((await call(request, 'PUT', '/api/permissions', adminCookie, superEdit)).status()).toBe(400);
  expect((await call(request, 'PUT', '/api/permissions', superCookie, superEdit)).status()).toBe(400);
});

test('phone numbers must be digits only and PINs must be exactly four digits', async ({ request }) => {
  const branch = await makeBranch(request);
  const base = { firstName: 'Mika', lastName: 'Reyes', role: 'Barista', email: 'mika.digits@tagak.test', phone: '09181113333', birthdate: '1998-01-02', pin: '4444', branchId: branch.id };
  for (const phone of ['0917123456', '091712345678', '08171234567', ' 09171234567', '09171234567\n', '0917-123-4567', '+639171234567', '0917 123 4567', '09171234abc']) {
    const res = await call(request, 'POST', '/api/accounts', superCookie, { ...base, phone });
    expect(res.status()).toBe(400);
  }
  for (const pin of ['123', 'abcd', '12345']) {
    const res = await call(request, 'POST', '/api/accounts', superCookie, { ...base, email: `mika.${pin}@tagak.test`, pin });
    expect(res.status()).toBe(400);
  }
});

test('phone ownership is global across roles and branches, including edits', async ({ request }) => {
  const first = await makeBranch(request);
  const second = await makeBranch(request);
  const employee = await makeEmployee(request, first.id);
  const other = await makeEmployee(request, second.id, { role: 'Manager' });
  const conflict = 'This phone number is already registered to another account.';
  const admin = { firstName: 'Test', lastName: 'Admin', role: 'Admin', email: 'unique@tagak.test',
    phone: employee.phone, birthdate: '1990-01-01', password: 'Strong-123' };
  const create = await call(request, 'POST', '/api/accounts', superCookie, admin);
  expect(create.status()).toBe(409);
  expect((await create.json()).error).toBe(conflict);
  expect((await makeEmployee(request, second.id, { phone: employee.phone })).error).toBe(conflict);
  const update = body => call(request, 'PUT', '/api/accounts/' + other.id, superCookie, body);
  expect((await update({ ...other, phone: employee.phone })).status()).toBe(409);
  expect((await update(other)).status()).toBe(200);

  admin.phone = '09812345123';
  const created = await call(request, 'POST', '/api/accounts', superCookie, admin);
  expect(created.status()).toBe(201);
  const path = '/api/accounts/' + (await created.json()).id;
  for (const [password, missing] of [['Aa1!', '8 characters'], ['lower123!', 'uppercase'], ['UPPER123!', 'lowercase'],
    ['Upperlower!', 'number'], ['Upper123 ', 'special character']]) {
    expect((await call(request, 'POST', '/api/accounts', superCookie, { ...admin, password })).status()).toBe(400);
    const edit = await call(request, 'PUT', path, superCookie, { ...admin, password });
    expect(edit.status()).toBe(400);
    expect((await edit.json()).error).toContain(missing);
  }
  expect((await call(request, 'PUT', path, superCookie, { ...admin, password: '' })).status()).toBe(200);
  expect((await call(request, 'POST', '/api/auth/admin-login', null, { email: admin.email, password: admin.password })).status()).toBe(200);
});
