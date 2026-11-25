// The browser uses the same validation, cent rounding and price rules as the API.
const TagakQuote = (() => {
const {nicknameError} = typeof module === 'undefined' ? TagakFields : require('../form-validation');
const text = value => typeof value === 'string' ? value.trim() : '';
const PAYMENTS = ['cash', 'qr'];
const ORDER_MODES = ['dine-in', 'takeout'];
const TEMPERATURES = ['hot', 'iced'];
const MAX_LINES = 100;
const MAX_QTY = 99;
const MAX_INSTRUCTIONS = 200;
const MAX_NICKNAME = 30;

/** Collapse whitespace and strip control characters from a customer nickname. */
function cleanNickname(value) {
  return text(value).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
}

/** Normalize dine-in / takeout service mode, defaulting omitted values to dine-in. */
function normalizeOrderMode(value) {
  if (value === undefined || value === null || value === '') return 'dine-in';
  const raw = text(value).toLowerCase();
  if (raw === 'take-out') return 'takeout';
  return raw;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function orderError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function validateLineShape(line, index) {
  if (!line || typeof line !== 'object') throw orderError(`Line ${index + 1} is not valid`);
  if (typeof line.menuItemId !== 'string' || !line.menuItemId) {
    throw orderError(`Line ${index + 1} needs a menu item`);
  }
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QTY) {
    throw orderError(`Line ${index + 1} needs a quantity between 1 and ${MAX_QTY}`);
  }
  if (line.addOnIds !== undefined && (!Array.isArray(line.addOnIds) || line.addOnIds.some(id => typeof id !== 'string'))) {
    throw orderError(`Line ${index + 1} has an invalid add-on list`);
  }
  if (line.temperature !== undefined && line.temperature !== null && !TEMPERATURES.includes(line.temperature)) {
    throw orderError(`Line ${index + 1} has an invalid temperature`);
  }
  if (line.size !== undefined && line.size !== null && (typeof line.size !== 'string' || line.size.length > 20)) {
    throw orderError(`Line ${index + 1} has an invalid size`);
  }
  const instructions = text(line.instructions);
  if (instructions.length > MAX_INSTRUCTIONS) {
    throw orderError(`Instructions must be ${MAX_INSTRUCTIONS} characters or fewer`);
  }
}

function validate({body,requireNickname=false}) {
  const branchId = text(body?.branchId);
  if (!branchId) throw orderError('Choose a branch');
  const customerName = cleanNickname(body?.customerName);
  if (requireNickname && !customerName) throw orderError('Enter a nickname for your order');
  if (!customerName) throw orderError(nicknameError);
  if (customerName.length > MAX_NICKNAME) {
    throw orderError(`Nickname must be ${MAX_NICKNAME} characters or fewer`);
  }
  const orderMode = normalizeOrderMode(body?.orderMode);
  if (!ORDER_MODES.includes(orderMode)) {
    throw orderError('Order mode must be dine-in or takeout');
  }
  const payment = text(body?.payment);
  if (!PAYMENTS.includes(payment)) throw orderError('Payment must be cash or qr');

  const lines = body?.lines;
  if (!Array.isArray(lines) || lines.length === 0) throw orderError('Add at least one item');
  if (lines.length > MAX_LINES) throw orderError(`An order can have at most ${MAX_LINES} lines`);
  lines.forEach(validateLineShape);

  return {branchId,customerName,orderMode,payment,lines};
}

function calculate({body,isPublic=false},validated,catalog) {
  const {branchId,customerName,orderMode,payment,lines}=validated;
  const items = new Map(catalog.items.map(row => [row.id, row]));
  const addOns = new Map(catalog.addOns.map(row => [row.id, row]));
  const { vatRate, largeUpcharge } = catalog.settings;
  let subtotal = 0;
  const storedLines = lines.map(line => {
    const item = items.get(line.menuItemId);
    if (!item || item.is_archived) throw orderError('One of the items is no longer on the menu');
    if (!item.active) throw orderError(`${item.name} is not available`);
    if (item.sold_out) throw orderError(`${item.name} is sold out`);

    let temperature = null;
    if (item.has_temperature) {
      if (!TEMPERATURES.includes(line.temperature)) {
        throw orderError(`Choose Hot or Iced for ${item.name}`);
      }
      temperature = line.temperature;
    } else if (line.temperature) {
      throw orderError(`${item.name} does not have a Hot / Iced choice`);
    }

    const size = line.size || null;
    const sizeUpcharge = item.category === 'Drinks' && size === 'Large' ? largeUpcharge : 0;

    const chosenAddOns = [];
    for (const id of [...new Set(line.addOnIds || [])]) {
      const addOn = addOns.get(id);
      if (!addOn) throw orderError('One of the add-ons is no longer available');
      if (!addOn.active) throw orderError(`${addOn.name} is not available`);
      const expectedScope = item.category === 'Drinks' ? 'drink' : 'pastry';
      if (addOn.applies_to !== expectedScope) {
        throw orderError(`${addOn.name} does not go with ${item.name}`);
      }
      chosenAddOns.push({ id: addOn.id, name: addOn.name, price: Number(addOn.price) });
    }

    const unitPrice = round2(Number(item.price) + sizeUpcharge);
    const addOnPrice = round2(chosenAddOns.reduce((sum, addOn) => sum + addOn.price, 0));
    subtotal = round2(subtotal + (unitPrice + addOnPrice) * line.qty);

    return {
      menuItemId: item.id,
      name: item.name,
      temperature,
      size,
      addOnIds: chosenAddOns.map(addOn => addOn.id),
      addOns: chosenAddOns,
      qty: line.qty,
      unitPrice,
      addOnPrice,
      instructions: text(line.instructions),
    };
  });

  const discount = !isPublic && body.pwdDiscount === true ? round2(subtotal * 0.2) : 0;
  const vat = round2((subtotal - discount) * vatRate);
  const total = round2(subtotal - discount + vat);
  if (payment === 'qr' && body.amountReceived !== undefined && body.amountReceived !== total) {
    throw orderError('QR Ph amount received must equal the order total.');
  }
  return { branchId, customerName, orderMode, payment, storedLines, subtotal, vat, total };
}

return { validate,calculate,round2,orderError,ORDER_MODES,MAX_NICKNAME };
})();
if(typeof module!=='undefined') module.exports=TagakQuote;
