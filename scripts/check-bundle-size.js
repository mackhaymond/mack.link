#!/usr/bin/env node
/**
 * M12: Fail CI if any embedded admin asset chunk exceeds the size budget.
 *
 * Runs after `npm run build`. Reads the manifest from
 * worker/src/admin-assets.js, then enforces:
 *   - any single chunk <= 600 KB
 *   - total embedded size <= 1.5 MB
 * Either limit can be overridden via env vars MAX_CHUNK_KB / MAX_TOTAL_KB.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '..', 'worker', 'src', 'admin-assets.js');
const MAX_CHUNK_KB = Number(process.env.MAX_CHUNK_KB || 600);
const MAX_TOTAL_KB = Number(process.env.MAX_TOTAL_KB || 1500);

const src = readFileSync(MANIFEST_PATH, 'utf8');
const match = src.match(/files:\s*(\[[\s\S]*?\])\n};\s*$/);
if (!match) {
	console.error('Could not parse manifest from', MANIFEST_PATH);
	process.exit(1);
}
const files = JSON.parse(match[1]);
let totalBytes = 0;
let bigOnes = [];
for (const f of files) {
	totalBytes += f.size;
	const kb = f.size / 1024;
	if (kb > MAX_CHUNK_KB) bigOnes.push({ ...f, kb: Math.round(kb) });
}
const totalKb = Math.round(totalBytes / 1024);

let failed = false;
if (bigOnes.length > 0) {
	failed = true;
	console.error(`\u274c Chunks exceeding ${MAX_CHUNK_KB} KB:`);
	for (const f of bigOnes) console.error(`   - ${f.path}  ${f.kb} KB`);
}
if (totalKb > MAX_TOTAL_KB) {
	failed = true;
	console.error(`\u274c Total embedded size ${totalKb} KB exceeds ${MAX_TOTAL_KB} KB budget`);
}

if (failed) {
	console.error('\nRaise the budget intentionally via MAX_CHUNK_KB / MAX_TOTAL_KB if expected.');
	process.exit(1);
}
console.log(`\u2705 Bundle size OK: ${files.length} chunks, ${totalKb} KB total, max chunk ${Math.round(Math.max(...files.map((f) => f.size)) / 1024)} KB`);
