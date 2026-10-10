// Deterministic raster export of the checked-in vector; no generated artwork.
// NODE_PATH=../browser-tests/node_modules node scripts/render-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const sizes = [152, 167, 180, 192, 512];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    const svg = fs.readFileSync(path.join(root, 'icons/home-icon.svg'), 'utf8');
    for (const size of sizes) {
      const result = await page.evaluate(async ({ svg, size }) => {
        const image = new Image();
        image.src = 'data:image/svg+xml;base64,' + btoa(svg);
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, size, size);
        const rgba = ctx.getImageData(0, 0, size, size).data;
        let symbolRadius = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          if (rgba[i + 3] !== 255 || rgba[i] < 247 || rgba[i + 1] < 147 || rgba[i + 2] < 26) throw new Error('Unexpected transparent/dark pixel');
          if (rgba[i] !== 247 || rgba[i + 1] !== 147 || rgba[i + 2] !== 26) {
            const pixel = i / 4;
            symbolRadius = Math.max(symbolRadius, Math.hypot(pixel % size + 0.5 - size / 2, Math.floor(pixel / size) + 0.5 - size / 2));
          }
        }
        if (symbolRadius > size * 0.4) throw new Error('Symbol exceeds maskable circular safe zone');
        return { png: canvas.toDataURL('image/png').split(',')[1], symbolRadius };
      }, { svg, size });
      const name = size <= 180 ? `apple-touch-icon-${size}.png` : `home-icon-${size}.png`;
      fs.writeFileSync(path.join(root, 'icons', name), Buffer.from(result.png, 'base64'));
      console.log(`PASS ${name}: opaque orange corners, no black pixels, symbol radius ${result.symbolRadius.toFixed(2)} < safe radius ${size * 0.4}`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
