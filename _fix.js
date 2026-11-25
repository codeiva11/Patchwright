const fs = require('fs');
const p = 'driver_patches/autoInstallPatch.ts';
let lines = fs.readFileSync(p, 'utf8').split('\n');
const idx = lines.findIndex(l => l.includes('amd64.deb'));
console.log('found at', idx);
const tail = lines[idx].slice(-8);
console.log('tail:', JSON.stringify(tail));
if (tail.endsWith('`,')) {
  lines.splice(idx, 2);
  fs.writeFileSync(p, lines.join('\n'));
  console.log('removed dangling + duplicate opener');
}
