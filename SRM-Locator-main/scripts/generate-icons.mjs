// Regenerates every raster icon from the brand logo: the Android launcher icons, the
// Capacitor asset sources, and the web notification icon. Run: node scripts/generate-icons.mjs
//
// The launcher icon is the LIGHT variant (navy mark on white), branding/locus-logo-on-light.svg.
// The in-app logo is separate and follows the theme (src/components/LocusMark.jsx).
// Rasterising uses the Chromium that Playwright already ships with; no new dependency.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOGO = readFileSync(join(root, '..', 'branding', 'locus-logo-on-light.svg'), 'utf8')
  .replace(/ width="\d+" height="\d+"/, ' width="100%" height="100%"')
const WHITE = '#FFFFFF'

// Adaptive-icon layers are 108 dp, shown through a 72 dp window (the launcher XML insets
// them 16.7 %), so a layer PNG is 72 dp across at its density. The mark fills it: its ring
// is ~65 dp wide, inside the 66 dp circle every launcher mask keeps. Legacy icons are 48 dp.
const DENSITIES = {
  ldpi: { layer: 54, legacy: 36 },
  mdpi: { layer: 72, legacy: 48 },
  hdpi: { layer: 108, legacy: 72 },
  xhdpi: { layer: 144, legacy: 96 },
  xxhdpi: { layer: 216, legacy: 144 },
  xxxhdpi: { layer: 288, legacy: 192 },
}

const browser = await chromium.launch()
const page = await browser.newPage()

// scale: how much of the square the mark fills; shape: 'square' | 'rounded' | 'circle';
// bg: null for a transparent PNG.
async function png({ size, scale = 1, bg = null, shape = 'square' }) {
  await page.setViewportSize({ width: size, height: size })
  const radius = shape === 'circle' ? '50%' : shape === 'rounded' ? '20%' : '0'
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;
      background:${bg ?? 'transparent'};border-radius:${radius}">
      <div style="width:${scale * 100}%;height:${scale * 100}%">${LOGO}</div></div></body></html>`)
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

const write = (rel, buf) => {
  const file = join(root, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, buf)
  console.log('wrote', rel)
}

const res = 'android/app/src/main/res'
for (const [d, { layer, legacy }] of Object.entries(DENSITIES)) {
  write(`${res}/mipmap-${d}/ic_launcher_foreground.png`, await png({ size: layer }))
  write(`${res}/mipmap-${d}/ic_launcher_background.png`, await png({ size: layer, bg: WHITE }))
  write(`${res}/mipmap-${d}/ic_launcher.png`, await png({ size: legacy, scale: 0.78, bg: WHITE, shape: 'rounded' }))
  write(`${res}/mipmap-${d}/ic_launcher_round.png`, await png({ size: legacy, scale: 0.8, bg: WHITE, shape: 'circle' }))
}

// Sources for @capacitor/assets (not a dependency; kept so the set stays complete).
write('assets/icon.png', await png({ size: 1024, scale: 0.72, bg: WHITE }))
write('assets/icon-foreground.png', await png({ size: 1024, scale: 0.7 }))
write('assets/icon-background.png', await png({ size: 1024, bg: WHITE }))

// The web Notification icon (App.jsx triggerSystemNotification).
write('public/locus-icon-192.png', await png({ size: 192, scale: 0.86, bg: WHITE, shape: 'rounded' }))

await browser.close()
