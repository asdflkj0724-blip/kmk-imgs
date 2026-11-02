const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeZip, crc32 } = require('../extension/src/zip.js');

test('CRC32 が正しい', () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('作った ZIP を標準のツールで開ける', () => {
  const jpegLike = new Uint8Array(5000).map((_, i) => (i * 7) % 256);
  const zip = makeZip([
    { name: 'taobao_7001_01.jpg', data: jpegLike },
    { name: '説明.txt', data: 'こんにちは' },
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
  const file = path.join(dir, 'out.zip');
  fs.writeFileSync(file, zip);

  let listing;
  try {
    execFileSync('which', ['unzip']);
    listing = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.match(listing, /No errors detected/);
  } catch (e) {
    if (e.code !== undefined && e.status === undefined) throw e;
    listing = execFileSync('python3', ['-I', '-m', 'zipfile', '-t', file], { encoding: 'utf8' });
    assert.match(listing, /Done testing/);
  }
  // 中身も取り出して一致するか確かめる（Python の zipfile で読む）
  const out = execFileSync(
    'python3',
    ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print("|".join(z.namelist()));print(z.read("説明.txt").decode());print(len(z.read("taobao_7001_01.jpg")))', file],
    { encoding: 'utf8' }
  );
  assert.equal(out.trim(), 'taobao_7001_01.jpg|説明.txt\nこんにちは\n5000');
  fs.rmSync(dir, { recursive: true, force: true });
});
