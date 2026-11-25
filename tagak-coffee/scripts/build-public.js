const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
// Remove only generated public assets from previous builds.
const assets = ['customer-app', 'pos-app', 'admin-app', 'unified-login', 'form-validation.js', 'menu-initials.js', 'auth.js', 'order-sync.js', 'qr-checkout.js', 'qr-checkout.css'];
fs.mkdirSync(output, { recursive: true });
if (fs.realpathSync(output) !== path.join(fs.realpathSync(root), 'public')) {
  throw new Error('public must be a directory inside the project');
}
const generatedNames = new Set([...assets, 'vendor']);
for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
  if (!generatedNames.has(entry.name) || entry.isSymbolicLink()) {
    throw new Error('Unexpected entry in public/. Review before building: ' + entry.name);
  }
}
for (const asset of assets) {
  fs.rmSync(path.join(output, asset), { recursive: true, force: true });
  fs.cpSync(path.join(root, asset), path.join(output, asset), {
    recursive: true,
    filter: source => {
      if (source === path.join(root, 'admin-app', 'index.html')) return false;
      if (path.basename(source).startsWith('.') || fs.lstatSync(source).isSymbolicLink()) return false;
      return fs.statSync(source).isDirectory() || /\.(html|css|js|png|jpe?g|webp|svg|ico|woff2?)$/i.test(source);
    },
  });
}

// Hosting serves these pages directly. Pin uploads and image redirects to the
// configured Storage origin in addition to the shared edge policy.
const storageOrigin = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : '';
for (const app of ['customer-app', 'pos-app', 'unified-login']) {
  const page = path.join(output, app, 'index.html');
  const origin = app === 'unified-login' ? '' : storageOrigin;
  const policy = `connect-src 'self' ${origin}; img-src 'self' data: blob: ${origin}`;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('<head>', '<head>\n  ' + meta));
}

const vendor = path.join(output, 'vendor');
fs.rmSync(vendor, { recursive: true, force: true });
fs.mkdirSync(vendor, { recursive: true });
for (const asset of [
  'chart.js/dist/chart.umd.min.js',
  'cropperjs/dist/cropper.min.css',
  'cropperjs/dist/cropper.min.js',
]) {
  fs.copyFileSync(path.join(root, 'node_modules', asset), path.join(vendor, path.basename(asset)));
}
execFileSync(process.execPath, [
  require.resolve('tailwindcss/lib/cli.js'), '--config', 'scripts/tailwind.config.js',
  '--input', '-', '--output', path.join(vendor, 'tailwind.css'), '--minify',
], { cwd: root, input: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' });

// Include only local dependencies of the built POS entry page.
const entry = '/pos-app/index.html';
const html = fs.readFileSync(path.join(output, entry), 'utf8');
const paths = new Set([entry]);
for (const [,src] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = new URL(src, 'https://build.local' + entry);
  if (url.origin === 'https://build.local' && /\.(css|js|png|ico)$/.test(url.pathname) &&
      fs.existsSync(path.join(output,url.pathname))) paths.add(url.pathname);
}
const worker = path.join(output,'pos-app','sw.js');
const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(worker));
const shellIntegrity = Object.fromEntries([...paths].map(item=>{
  const content=fs.readFileSync(path.join(output,item));
  digest.update(item).update(content);
  return [item,'sha256-'+require('node:crypto').createHash('sha256').update(content).digest('base64')];
}));
fs.writeFileSync(worker,fs.readFileSync(worker,'utf8').replace('__POS_RELEASE__',digest.digest('hex')).replace('__POS_ASSETS__',JSON.stringify(shellIntegrity)));
