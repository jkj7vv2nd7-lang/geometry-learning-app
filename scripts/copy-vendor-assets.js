'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

async function copyVendorAssets() {
  const katexSource = path.join(root, 'node_modules', 'katex');
  const threeSource = path.join(root, 'node_modules', 'three');
  const vendorRoot = path.join(root, 'frontend', 'vendor');
  const katexTarget = path.join(vendorRoot, 'katex');
  const fontsTarget = path.join(katexTarget, 'fonts');
  const threeModule = path.join(vendorRoot, 'three.module.min.js');

  await fs.rm(katexTarget, { recursive: true, force: true });
  await fs.mkdir(vendorRoot, { recursive: true });
  await fs.rm(path.join(vendorRoot, 'three.module.js'), { force: true });
  await fs.mkdir(fontsTarget, { recursive: true });
  await fs.copyFile(path.join(katexSource, 'dist', 'katex.min.css'), path.join(katexTarget, 'katex.min.css'));
  await fs.copyFile(path.join(katexSource, 'dist', 'katex.min.js'), path.join(katexTarget, 'katex.min.js'));
  await fs.copyFile(path.join(katexSource, 'LICENSE'), path.join(katexTarget, 'LICENSE'));
  const fontSource = path.join(katexSource, 'dist', 'fonts');
  for (const font of await fs.readdir(fontSource)) {
    if (font.endsWith('.woff2') || font.endsWith('.woff')) {
      await fs.copyFile(path.join(fontSource, font), path.join(fontsTarget, font));
    }
  }
  await fs.copyFile(
    path.join(threeSource, 'build', 'three.module.min.js'),
    threeModule
  );
  await fs.copyFile(path.join(threeSource, 'LICENSE'), path.join(vendorRoot, 'THREE-LICENSE'));
}

copyVendorAssets().catch((error) => {
  console.error('Failed to copy locally served vendor assets:', error);
  process.exitCode = 1;
});
