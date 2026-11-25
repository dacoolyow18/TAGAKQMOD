/**
 * Customer catalog loaded from the public API. Nothing here is seeded with
 * drinks, prices, add-ons, temperatures, branches, or images.
 */

let MENU = [];
let ADD_ONS = [];
const CATEGORIES = ['Drinks', 'Pastries'];

const CATALOG = {
  settings: { vatRate: 0, largeUpcharge: 0, estimatedMinutes: 0 },
  branches: [],
  carousel: [],
};

function mapMenuItem(item) {
  return {
    id: item.id,
    name: item.name,
    price: Number(item.price),
    category: item.category,
    img: item.imagePath || '',
    desc: item.description || '',
    hasTemperature: Boolean(item.hasTemperature),
    soldOut: Boolean(item.soldOut),
  };
}

function mapAddOn(addOn) {
  return {
    id: addOn.id,
    name: addOn.name,
    price: Number(addOn.price),
    appliesTo: addOn.appliesTo,
  };
}

async function fetchJson(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${path} could not be loaded (${res.status})`);
  return res.json();
}

async function loadCatalog(branchId = null) {
  MENU = [];
  ADD_ONS = [];
  CATALOG.carousel = [];
  const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  const results = await Promise.allSettled([
    fetchJson(`/api/public/menu${q}`),
    fetchJson(`/api/public/add-ons${q}`),
    fetchJson(`/api/public/settings${q}`),
    fetchJson('/api/public/branches'),
    fetchJson(`/api/public/carousel${q}`),
  ]);
  const [menuRes, addOnsRes, settingsRes, branchesRes, carouselRes] = results;

  if (menuRes.status === 'fulfilled') MENU = menuRes.value.map(mapMenuItem);
  if (addOnsRes.status === 'fulfilled') ADD_ONS = addOnsRes.value.map(mapAddOn);
  if (settingsRes.status === 'fulfilled') {
    const settings = settingsRes.value;
    CATALOG.settings = {
      vatRate: Number(settings.vatRate) || 0,
      largeUpcharge: Number(settings.largeUpcharge) || 0,
      estimatedMinutes: Number(settings.estimatedMinutes) || 0,
      storeOpen: settings.storeOpen !== false,
    };
  }
  if (branchesRes.status === 'fulfilled') CATALOG.branches = branchesRes.value;
  if (carouselRes.status === 'fulfilled') CATALOG.carousel = carouselRes.value;

  const failed = results.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;

  return {
    menu: MENU,
    addOns: ADD_ONS,
    settings: CATALOG.settings,
    branches: CATALOG.branches,
    carousel: CATALOG.carousel,
  };
}

function addOnsFor(category) {
  return ADD_ONS.filter(addOn => addOn.appliesTo === (category === 'Drinks' ? 'drink' : 'pastry'));
}

function formatMoney(n) {
  return '\u20B1' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
