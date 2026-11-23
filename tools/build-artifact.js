// Gera uma cópia de index.html sem <!doctype>/<html>/<head>/<body> para publicar como Artifact.
// Uso: node tools/build-artifact.js <pasta-de-saída>
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2];
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
// <title> precisa ficar no começo do arquivo
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('ok', html.slice(0, 80).replace(/\n/g, ' '));
