#!/usr/bin/env node
'use strict';

// WorkBuddy publishes a single HTML document. Preserve its source bytes and add
// only a removable, nonvisual release block so publication can be verified.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const MAX_BYTES = 2 * 1024 * 1024;
const SCOPE = 'static-frontend-only';
const BEGIN = '\n<!-- v6-static-release:begin -->\n';
const END = '\n<!-- v6-static-release:end -->';
const NAMES = ['v6-repository-sha', 'v6-static-content-sha256', 'v6-release-id', 'v6-target-scope'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const releaseIdFor = (sha, contentHash) => `${sha}-${contentHash.slice(0, 12)}`;

function attributes(tag) {
  const values = {};
  const re = /([^\s=<>/'"]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(tag))) {
    const key = match[1].toLowerCase();
    if (Object.hasOwn(values, key)) throw new Error('Duplicate HTML attribute');
    values[key] = match[2] ?? match[3] ?? match[4];
  }
  return values;
}

function validateHtml(input, { checkCredentials = true } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Static HTML size is invalid');
  let html;
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Static HTML must be UTF-8'); }
  if (Buffer.byteLength(html) !== bytes.length || html.includes('\0')) throw new Error('Static HTML encoding is invalid');
  if (!/^\s*<!doctype html\s*>/i.test(html) || !/<html\b/i.test(html) || !/<head\b[^>]*>/i.test(html) ||
      !/<title\b[^>]*>[^<\S]*[^<]+<\/title\s*>/i.test(html) || !/<\/head\s*>/i.test(html) ||
      !/<body\b/i.test(html) || !/<\/body\s*>/i.test(html) || !/<\/html\s*>\s*$/i.test(html)) {
    throw new Error('A complete standalone HTML document with a title is required');
  }
  // Deployed code must obtain access from the current URL, never from Git.
  if (checkCredentials && (/\b(?:SHARE|SHARE_CODE|SHARECODE)\s*=\s*(['"])[^'"]+\1/i.test(html) ||
      /\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*(['"])[^'"]+\1/i.test(html) ||
      /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,})/.test(html) ||
      /https?:\/\/[^\s/'"<>]+:[^\s/@'"<>]+@/i.test(html))) throw new Error('Static HTML contains a possible embedded credential');
  if (checkCredentials && /(?:api\.openai\.com|OPENAI_API_KEY)/i.test(html)) throw new Error('OpenAI runtime API access is forbidden in static HTML');
  // Ignore inline script/style text when looking for markup dependencies.
  const markup = html.replace(/<!--[^]*?-->/g, '').replace(/(<(?:script|style)\b[^>]*>)[^]*?<\/(?:script|style)\s*>/gi, '$1');
  for (const tag of markup.match(/<(?:script|link|img|source|video|audio|iframe|object|embed|input)\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    for (const key of ['src', 'srcset', 'poster', 'data']) {
      if (attrs[key] && !/^data:/i.test(attrs[key])) throw new Error('Static HTML depends on an external asset');
    }
    if (/^<link\b/i.test(tag) && attrs.href && !/^data:/i.test(attrs.href)) throw new Error('Static HTML depends on an external stylesheet or linked asset');
  }
  const css = [...html.matchAll(/<style\b[^>]*>([^]*?)<\/style\s*>/gi)].map(m => m[1]).join('\n') +
    [...markup.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(m => m[1] ?? m[2]).join('\n');
  for (const match of css.matchAll(/(?:@import\s+(?:url\()?\s*|url\(\s*)(['"]?)([^'"\s)]+)\1/gi)) {
    if (!/^(?:data:|#)/i.test(match[2])) throw new Error('Static HTML depends on an external CSS asset');
  }
  return html;
}

function metadataBlock(sha, contentHash) {
  const values = [sha, contentHash, releaseIdFor(sha, contentHash), SCOPE];
  return BEGIN + NAMES.map((name, index) => `<meta name="${name}" content="${values[index]}">`).join('\n') + END;
}

function parseStaticRelease(input) {
  // Readback must identify pre-migration documents too. Return hashes only;
  // the build path separately rejects credentials before producing HTML.
  const html = validateHtml(input, { checkCredentials: false });
  const artifactHash = hash(Buffer.from(html));
  const metas = (html.match(/<meta\b[^>]*>/gi) || []).map(attributes).filter(a => /^v6-(?:source|repository-sha|static-content-sha256|release-id|target-scope)/i.test(a.name || ''));
  const hasBoundary = html.includes('v6-static-release:');
  if (!metas.length && !hasBoundary) return { sha: undefined, contentHash: undefined, artifactHash, releaseId: undefined };
  if (metas.length !== NAMES.length || metas.some((m, i) => m.name !== NAMES[i])) throw new Error('Static release metadata is invalid or duplicated');
  const [sha, contentHash, releaseId, scope] = metas.map(m => m.content);
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^[a-f0-9]{64}$/.test(contentHash || '') ||
      releaseId !== releaseIdFor(sha, contentHash) || scope !== SCOPE) throw new Error('Static release identity is invalid');
  const block = metadataBlock(sha, contentHash);
  const head = /<head\b[^>]*>/i.exec(html);
  const offset = head.index + head[0].length;
  if (html.slice(offset, offset + block.length) !== block || html.indexOf(BEGIN, offset + block.length) !== -1 ||
      html.indexOf(END, offset + block.length) !== -1) throw new Error('Static release block is malformed');
  const canonical = html.slice(0, offset) + html.slice(offset + block.length);
  if (hash(Buffer.from(canonical)) !== contentHash) throw new Error('Static release content hash does not match');
  return { sha, contentHash, artifactHash, releaseId, scope };
}

function buildWorkBuddyStatic({ sourceFile, sha, outputFile } = {}) {
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('A full lowercase Git commit SHA is required');
  if (typeof sourceFile !== 'string' || !sourceFile) throw new Error('A source file is required');
  const sourcePath = fs.realpathSync(sourceFile);
  if (fs.statSync(sourcePath).size > MAX_BYTES) throw new Error('Static HTML size is invalid');
  if (outputFile) {
    const outputPath = path.resolve(outputFile);
    const sourceStat = fs.statSync(sourcePath);
    const outputStat = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
    if (outputPath === sourcePath || (outputStat && outputStat.dev === sourceStat.dev && outputStat.ino === sourceStat.ino)) throw new Error('Output must not overwrite the canonical source');
  }
  const source = fs.readFileSync(sourcePath);
  const canonical = validateHtml(source);
  const prior = parseStaticRelease(canonical);
  if (prior.sha) throw new Error('Canonical source must not contain release metadata');
  const contentHash = hash(source);
  const html = canonical.replace(/<head\b[^>]*>/i, opening => opening + metadataBlock(sha, contentHash));
  const release = parseStaticRelease(html);
  if (outputFile) fs.writeFileSync(outputFile, html, { encoding: 'utf8', mode: 0o600 });
  return { html, ...release };
}

if (require.main === module) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      const name = { '--source': 'sourceFile', '--sha': 'sha', '--output': 'outputFile' }[args[i]];
      if (!name || !args[i + 1] || Object.hasOwn(options, name)) throw new Error('Use --source FILE --sha SHA --output FILE');
      options[name] = args[i + 1];
    }
    if (!options.outputFile) throw new Error('An output file is required');
    const { html, ...release } = buildWorkBuddyStatic(options);
    process.stdout.write(JSON.stringify(release) + '\n');
  } catch (error) {
    // Avoid printing source bytes, paths or values from rejected input.
    process.stderr.write(`Static build failed: ${error.code ? 'file operation failed' : error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildWorkBuddyStatic, parseStaticRelease, MAX_BYTES, SCOPE };
