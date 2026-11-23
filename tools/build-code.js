// Gera js/code-data.js a partir dos arquivos reais do firmware.
// Uso: node tools/build-code.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const data = {
  video: { file: 'video_original.ino', code: read('firmware/video_original/video_original.ino') },
  travessia: { file: 'travessia_inteligente.ino', code: read('firmware/travessia_inteligente/travessia_inteligente.ino') },
  diagram: { file: 'diagram.json', code: read('firmware/travessia_inteligente/diagram.json') },
  libraries: { file: 'libraries.txt', code: read('firmware/travessia_inteligente/libraries.txt') }
};
const out = '// Arquivo gerado por tools/build-code.js — não edite à mão.\nwindow.CODE = ' + JSON.stringify(data, null, 0) + ';\n';
fs.writeFileSync(path.join(root, 'js/code-data.js'), out);
console.log('js/code-data.js gerado (' + out.length + ' bytes)');
