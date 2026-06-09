import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '..', 'public');
const source = Buffer.from(`
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" rx="220" fill="#F6EFE8"/>
  <rect x="116" y="116" width="792" height="792" rx="180" fill="#6F2F1D"/>
  <circle cx="512" cy="360" r="132" fill="#F6EFE8"/>
  <rect x="308" y="534" width="408" height="70" rx="35" fill="#F6EFE8"/>
  <rect x="308" y="648" width="272" height="70" rx="35" fill="#F6EFE8"/>
  <rect x="620" y="648" width="96" height="70" rx="35" fill="#D89A64"/>
</svg>
`);

await mkdir(publicDir, { recursive: true });

await Promise.all([
  sharp(source).resize(192, 192).png().toFile(resolve(publicDir, 'icon-192.png')),
  sharp(source).resize(512, 512).png().toFile(resolve(publicDir, 'icon-512.png')),
  sharp(source).resize(512, 512).png().toFile(resolve(publicDir, 'icon-512-maskable.png')),
  sharp(source).resize(180, 180).png().toFile(resolve(publicDir, 'apple-touch-icon.png')),
  sharp(source).resize(32, 32).png().toFile(resolve(publicDir, 'favicon-32.png'))
]);

