const { expect } = require('@playwright/test');

/**
 * Adds a menu item in the POS Menu & Recipes view the way a Manager does:
 * details first (saved as a draft), then one supply in the recipe, then publish.
 * `supplyIndex` picks a supply from the "Add Ingredient" dropdown (0 is the placeholder).
 */
async function publishNewItem(page, { name, price, category = 'Drinks', hasTemperature = false, supplyIndex = 1 }) {
  await page.click('#btn-add-menu-item');
  await page.fill('#mr-name', name);
  if (category !== 'Drinks') await page.selectOption('#mr-category', category);
  await page.fill('#mr-price', String(price));
  if (hasTemperature) await page.check('#mr-temp');
  await page.click('#btn-save-details');
  await expect(page.locator('#recipe-list')).toContainText(name);

  await page.selectOption('#recipe-add-supply', { index: supplyIndex });
  await page.click('#btn-add-ingredient');
  await page.click('#btn-recipe-save');
  await expect(page.locator('#toast-container')).toContainText('Recipe saved successfully!');

  await page.check('#mr-published');
  await page.click('#btn-save-details');
  await expect(page.locator('#toast-container')).toContainText('Item details saved successfully!');
}

module.exports = { publishNewItem };
