const PERMISSION_DEFS = [
  { key: 'view_orders',            label: 'View Orders',              module: 'Orders' },
  { key: 'manage_orders',          label: 'Manage Orders (Status)',   module: 'Orders' },
  { key: 'void_orders',            label: 'Void Orders',              module: 'Orders' },
  { key: 'view_analytics',         label: 'View Analytics',           module: 'Analytics' },
  { key: 'export_reports',         label: 'Export / Download Reports',module: 'Analytics' },
  { key: 'view_menu',              label: 'View Menu & Recipes',      module: 'Menu & Recipes' },
  { key: 'edit_menu',              label: 'Edit Menu & Recipes',      module: 'Menu & Recipes' },
  { key: 'view_supplies',          label: 'View Supplies',            module: 'Supplies' },
  { key: 'edit_supplies',          label: 'Edit Supplies',            module: 'Supplies' },
  { key: 'view_tools',             label: 'View Storefront Tools',    module: 'Tools' },
  { key: 'edit_tools',             label: 'Edit Storefront Tools',    module: 'Tools' },
  { key: 'access_cash_drawer',     label: 'Access Cash Drawer',       module: 'Cash Drawer' },
  { key: 'view_addons',            label: 'View Add-ons',              module: 'Add-ons' },
  { key: 'edit_addons',            label: 'Manage Add-ons',            module: 'Add-ons' },
  { key: 'access_terminal',        label: 'Access POS Terminal',      module: 'POS Access' },
  { key: 'manage_users',           label: 'Manage User Accounts',     module: 'Admin' },
  { key: 'manage_roles',           label: 'Manage Roles & Permissions',module: 'Admin' },
];

if (typeof module !== 'undefined') module.exports = { PERMISSION_DEFS };
