import { fileURLToPath } from 'url'
import sharp from 'sharp'

const src = fileURLToPath(new URL('../public/brand/nuri-seckin-mark.jpg', import.meta.url))

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
let minX = info.width
let minY = info.height
let maxX = 0
let maxY = 0
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
}

const pad = 8
const left = Math.max(0, minX - pad)
const top = Math.max(0, minY - pad)
const width = Math.min(info.width - left, maxX - minX + 1 + pad * 2)
const height = Math.min(info.height - top, maxY - minY + 1 + pad * 2)

const cropped = await sharp(src).extract({ left, top, width, height }).png().toBuffer()

const size = 1024
const maxLogo = Math.round(size * 0.84)
const fitted = await sharp(cropped)
  .resize({ width: maxLogo, height: maxLogo, fit: 'inside', kernel: 'lanczos3' })
  .png()
  .toBuffer()
const fittedMeta = await sharp(fitted).metadata()
const lx = Math.round((size - fittedMeta.width) / 2)
const ly = Math.round((size - fittedMeta.height) / 2)

const circleSvg = Buffer.from(
  `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#ffffff"/></svg>`
)

await sharp({
  create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    { input: circleSvg, top: 0, left: 0 },
    { input: fitted, top: ly, left: lx },
  ])
  .png()
  .toFile('public/brand/nuri-seckin-logo.png')

console.log(await sharp('public/brand/nuri-seckin-logo.png').metadata())
