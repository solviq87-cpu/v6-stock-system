'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_WATCH = 20;
const isWatchCode = code => typeof code === 'string' && /^(?:00|30|60|68|43|83|87|88|92)\d{4}$/.test(code);

function createFastStockWatch(file) {
  function read() {
    let descriptor;
    try {
      descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 8192 || (stat.mode & 0o077)) throw Error('invalid watch file');
      const { schemaVersion, items } = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
      if (schemaVersion !== 1 || !Array.isArray(items) || items.length > MAX_WATCH ||
          items.some(item => !isWatchCode(item?.code) || typeof item.name !== 'string' || item.name.length > 50) ||
          new Set(items.map(item => item.code)).size !== items.length) throw Error('invalid watch list');
      return items.map(({ code, name }) => ({ code, name }));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  function set(code, enabled, officialName) {
    if (!isWatchCode(code) || typeof enabled !== 'boolean') throw Error('invalid watch selection');
    const items = read();
    if (enabled === items.some(item => item.code === code)) return items;
    if (enabled && items.length >= MAX_WATCH) throw Error('watch capacity');
    const name = typeof officialName === 'string' ? officialName.trim().slice(0, 50) : '';
    const next = enabled ? [...items, { code, name }] : items.filter(item => item.code !== code);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + '.' + randomUUID() + '.tmp';
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, items: next }));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, file);
      const directory = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(directory); }
      finally { fs.closeSync(directory); }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.rmSync(temporary, { force: true });
    }
    return next;
  }

  return { read, set };
}

module.exports = { createFastStockWatch, isWatchCode, MAX_WATCH };
