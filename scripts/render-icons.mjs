// Erzeugt die App-Icons (PNG) aus assets/icon.svg mit dem installierten Microsoft Edge (headless).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EDGE = process.env.EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8')
// Maskierbare Icons brauchen das Zeichen in der mittleren Schutzzone (80 %).
const maskable = svg.replace('<g id="mark">', '<g id="mark" transform="translate(256 256) scale(0.72) translate(-256 -256)">')
const dir = mkdtempSync(path.join(tmpdir(), 'icons-'))
const targets = [
  ['public/icon-512.png', 512, svg],
  ['public/icon-192.png', 192, svg],
  ['public/apple-touch-icon.png', 180, svg],
  ['public/icon-maskable-512.png', 512, maskable],
]
for (const [file, size, src] of targets) {
  const html = path.join(dir, `${size}.html`)
  writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:#0a0b0f}svg{display:block;width:${size}px;height:${size}px}</style>${src}`)
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${size},${size}`, `--screenshot=${path.resolve(file)}`, pathToFileURL(html).href], { stdio: 'ignore' })
  console.log(file)
}
