import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icons/icon.svg', 'utf8');
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const sizes = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['apple-touch-icon.png', 180, true], ['icon-maskable-512.png', 512, 'mask']];
for (const [name, size, mode] of sizes) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const inner = mode === 'mask' ? `<div style="width:${size}px;height:${size}px;background:#b8452a;display:grid;place-items:center"><div style="width:${size * 0.7}px;height:${size * 0.7}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>`
    : `<div style="width:${size}px;height:${size}px;${mode ? 'background:#b8452a;' : ''}">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>`;
  await p.setContent(`<body style="margin:0;background:transparent">${inner}</body>`);
  await p.screenshot({ path: `public/icons/${name}`, omitBackground: !mode });
  await p.close();
}
await b.close();
