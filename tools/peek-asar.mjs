// 从 Folia 的 app.asar 里抽单个文件（只读，不落地整棵树）。
//   node tools/peek-asar.mjs <asar内路径> [关键字]
import { openSync, readSync, closeSync, readFileSync, statSync } from 'node:fs';

const ASAR = process.env.FOLIA_ASAR || 'C:/Other/Folia/resources/app.asar';
const want = process.argv[2];
const needle = process.argv[3];

const fd = openSync(ASAR, 'r');
const head = Buffer.alloc(16);
readSync(fd, head, 0, 16, 0);
const jsonLen = head.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonLen);
readSync(fd, jsonBuf, 0, jsonLen, 16);
const base = 16 + jsonLen;
const tree = JSON.parse(jsonBuf.toString('utf8'));

function find(node, prefix) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (entry.files) {
      const hit = find(entry, p);
      if (hit) return hit;
    } else if (p === want || p.endsWith('/' + want)) {
      return entry;
    }
  }
  return null;
}

const entry = find(tree, '');
closeSync(fd);
if (!entry) {
  console.log('NOT FOUND:', want);
  process.exit(1);
}
const buf = Buffer.alloc(entry.size);
const fd2 = openSync(ASAR, 'r');
readSync(fd2, buf, 0, entry.size, base + Number(entry.offset));
closeSync(fd2);
const text = buf.toString('utf8');
console.log('size:', entry.size);

if (!needle) {
  console.log(text.slice(0, 2000));
  process.exit(0);
}
const re = new RegExp(needle, 'g');
let m;
let n = 0;
while ((m = re.exec(text)) !== null && n < 12) {
  const s = Math.max(0, m.index - 400);
  console.log('--- @' + m.index + ' ---');
  console.log(text.slice(s, m.index + 400));
  n += 1;
}
if (n === 0) console.log('no match for', needle);
