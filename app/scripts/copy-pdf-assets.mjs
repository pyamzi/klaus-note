import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('static/pdfjs', { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(`node_modules/pdfjs-dist/${name}`, `static/pdfjs/${name}`, { recursive: true });
}
