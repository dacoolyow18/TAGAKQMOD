/**
 * Price in effect at a point in time: the latest log at or before `at`.
 * Falls back to the earliest log when `at` precedes every log.
 * `priceLogs` must be sorted ascending by effectiveAt.
 */
function priceAt(priceLogs, at) {
  if (!priceLogs.length) return null;
  const t = new Date(at).getTime();
  let price = priceLogs[0].price;
  for (const log of priceLogs) {
    if (new Date(log.effectiveAt).getTime() <= t) price = log.price;
    else break;
  }
  return price;
}

module.exports = { priceAt };
