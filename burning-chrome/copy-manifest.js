import fs from 'fs';
import path from 'path';

// Copy manifest
fs.copyFileSync('manifest.json', 'dist/manifest.json');

// Copy icons
const iconsSrc = path.join('icons');
const iconsDest = path.join('dist', 'icons');
if (!fs.existsSync(iconsDest)) {
  fs.mkdirSync(iconsDest, { recursive: true });
}
for (const file of fs.readdirSync(iconsSrc)) {
  if (file.endsWith('.png') || file.endsWith('.ico') || file.endsWith('.svg')) {
    fs.copyFileSync(path.join(iconsSrc, file), path.join(iconsDest, file));
  }
}

// Copy HTML files
const htmlFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));
for (const file of htmlFiles) {
  fs.copyFileSync(file, path.join('dist', file));
}