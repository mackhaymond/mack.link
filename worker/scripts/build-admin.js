#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ADMIN_DIR = join(__dirname, '../../admin');
const DIST_DIR = join(ADMIN_DIR, 'dist');
const OUTPUT_FILE = join(__dirname, '../src/admin-assets.js');

// Maximum file size for embedding (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

function getAllFiles(dir, baseDir = dir) {
  const files = [];

  function traverse(currentDir) {
    const items = readdirSync(currentDir);

    for (const item of items) {
      const itemPath = join(currentDir, item);
      const stat = statSync(itemPath);

      if (stat.isDirectory()) {
        traverse(itemPath);
      } else {
        const relativePath = relative(baseDir, itemPath).replace(/\\/g, '/');
        files.push({
          path: relativePath,
          fullPath: itemPath,
          size: stat.size
        });
      }
    }
  }

  traverse(dir);
  return files;
}

function encodeFile(filePath, maxSize) {
  const stats = statSync(filePath);

  if (stats.size > maxSize) {
    console.warn(`Skipping large file: ${filePath} (${Math.round(stats.size / 1024)}KB)`);
    return null;
  }

  const content = readFileSync(filePath);

  // Check if file is text-based
  const isText = isTextFile(filePath);

  if (isText) {
    // For text files, store as string with proper escaping
    return JSON.stringify(content.toString('utf8'));
  } else {
    // For binary files, store as base64
    return JSON.stringify(`data:${getMimeType(filePath)};base64,${content.toString('base64')}`);
  }
}

function isTextFile(filePath) {
  const textExtensions = ['.html', '.css', '.js', '.json', '.svg', '.txt', '.md', '.map'];
  const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
  return textExtensions.includes(ext);
}

function getMimeType(filePath) {
  const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function buildAdminAssets() {
console.log('Building admin assets from /admin/dist ...');

  // Check if dist directory exists
  try {
    statSync(DIST_DIR);
  } catch (error) {
console.error('Admin app not built yet. Run "npm -w admin run build" first.');
    process.exit(1);
  }

  // Get all files from dist directory
  // M11: source maps live on disk for debugging but never get embedded into
  // the Worker bundle (would inflate it by ~MBs and isn't served anywhere).
  const files = getAllFiles(DIST_DIR).filter((f) => !f.path.endsWith('.map'));

  console.log(`Found ${files.length} files to embed`);

  const assets = {};
  let totalSize = 0;
  let skippedFiles = 0;

  for (const file of files) {
    const encoded = encodeFile(file.fullPath, MAX_FILE_SIZE);

    if (encoded !== null) {
      assets[file.path] = encoded;
      totalSize += file.size;
      console.log(`✓ ${file.path} (${Math.round(file.size / 1024)}KB)`);
    } else {
      skippedFiles++;
    }
  }

  console.log(`\nTotal embedded size: ${Math.round(totalSize / 1024)}KB`);
  if (skippedFiles > 0) {
    console.log(`Skipped ${skippedFiles} large files`);
  }

  // Generate the admin-assets.js file
  const output = `// Auto-generated file - DO NOT EDIT
// Generated on: ${new Date().toISOString()}
// Total files: ${Object.keys(assets).length}
// Total size: ${Math.round(totalSize / 1024)}KB

export const adminAssets = ${JSON.stringify(assets, null, 2)};

// File manifest for debugging
export const manifest = {
  generatedAt: ${JSON.stringify(new Date().toISOString())},
  totalFiles: ${Object.keys(assets).length},
  totalSize: ${totalSize},
  files: ${JSON.stringify(files.map(f => ({ path: f.path, size: f.size })), null, 2)}
};
`;

  writeFileSync(OUTPUT_FILE, output, 'utf8');

  console.log(`\n✅ Admin assets generated: ${OUTPUT_FILE}`);
  console.log(`📦 Bundle size: ${Math.round(output.length / 1024)}KB`);

  // Warn about worker bundle limits
  if (output.length > 1024 * 1024) { // 1MB
    console.warn('⚠️  Warning: Bundle size is large and may exceed Cloudflare Workers limits');
    console.warn('   Consider optimizing your build or splitting assets');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    buildAdminAssets();
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
}

export { buildAdminAssets };
