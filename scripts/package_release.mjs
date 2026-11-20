/**
 * Builds dist/cdn-analyzer-pro/ and dist/cdn-analyzer-pro-v<version>.zip.
 * Pure Node (no PowerShell / zip CLI) so it runs on Windows, macOS and Linux.
 * Zip entries always use forward slashes, as the Chrome Web Store requires.
 *
 *   node scripts/package_release.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(repoDir, 'extension');
const distDir = path.resolve(repoDir, 'dist');
const packageDir = path.resolve(distDir, 'cdn-analyzer-pro');

const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const zipFile = path.resolve(distDir, `cdn-analyzer-pro-v${manifest.version}.zip`);

const RUNTIME_FILES = [
    'manifest.json',
    'background.js',
    'popup.html',
    'popup.js',
    'styles.css',
    'icons/icon-16.png',
    'icons/icon-32.png',
    'icons/icon-48.png',
    'icons/icon-128.png',
    'icons/icon-v7.png',
    'modules/cdp.js',
    'modules/cdn.js',
    'modules/providers.js',
    'modules/metrics.js',
    'modules/resources.js',
    'modules/scoring.js',
    'modules/security.js'
];

function fail(msg) {
    console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('==================================================================');
console.log(`CDN ANALYZER PRO — RELEASE PACKAGING v${manifest.version}`);
console.log('==================================================================');

// ── Manifest checks ──────────────────────────────────────────────────────────
if (manifest.manifest_version !== 3) fail(`Expected Manifest V3, found ${manifest.manifest_version}`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail(`Invalid version string ${manifest.version}`);
if ((manifest.description || '').length > 132) fail('Manifest description exceeds 132 characters (Chrome Web Store limit)');
console.log(`  ✓ Manifest V3, ${manifest.name} v${manifest.version}`);
console.log(`  ✓ Permissions: ${manifest.permissions.join(', ')}`);
console.log(`  ✓ Host permissions: ${manifest.host_permissions.join(', ')}`);

// ── Copy runtime files ───────────────────────────────────────────────────────
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });
for (const rel of RUNTIME_FILES) {
    const src = path.join(rootDir, rel);
    if (!fs.existsSync(src)) fail(`Missing runtime file: ${rel}`);
    const dest = path.join(packageDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}
console.log(`  ✓ Copied ${RUNTIME_FILES.length} runtime files`);

// ── Reference checks: every file referenced by the manifest/HTML/imports exists ──
const referenced = new Set([
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action.default_icon || {})
]);
const html = fs.readFileSync(path.join(packageDir, 'popup.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!/^https?:/.test(m[1])) referenced.add(m[1]);
}
for (const rel of RUNTIME_FILES.filter(f => f.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(packageDir, rel), 'utf8');
    for (const m of code.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) {
        referenced.add(path.posix.join(path.posix.dirname(rel), m[1]));
    }
    if (/\son[a-z]+\s*=\s*["']/i.test(code) && rel === 'popup.js') {
        fail('popup.js generates inline event handler attributes, which the MV3 CSP blocks');
    }
}
for (const ref of referenced) {
    if (!fs.existsSync(path.join(packageDir, ref))) fail(`Referenced file missing from package: ${ref}`);
}
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail('popup.html contains an inline <script>, blocked by MV3 CSP');
console.log(`  ✓ ${referenced.size} referenced files present; no inline scripts`);

// ── Forbidden content audit ──────────────────────────────────────────────────
const forbidden = [/\.git/, /node_modules/, /(^|\/)tests?\//, /(^|\/)docs\//, /\.env/, /\.agents/, /\.DS_Store/];
function listFiles(dir, base = '') {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
        else out.push(rel);
    }
    return out;
}
const files = listFiles(packageDir).sort();
for (const f of files) {
    if (forbidden.some(p => p.test(f))) fail(`Forbidden file in package: ${f}`);
}
console.log('  ✓ No tests, git metadata, credentials or tooling in package');

// ── Zip (deflate, forward-slash paths) ───────────────────────────────────────
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}

const localParts = [];
const centralParts = [];
let offset = 0;
const { time, date } = dosDateTime(new Date());
for (const rel of files) {
    const data = fs.readFileSync(path.join(packageDir, rel));
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 30);
    central.writeUInt32LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + body.length;
}
const centralBuf = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
fs.writeFileSync(zipFile, Buffer.concat([...localParts, centralBuf, end]));

console.log(`  ✓ ${path.relative(repoDir, zipFile)} (${(fs.statSync(zipFile).size / 1024).toFixed(1)} KB, ${files.length} files)`);
console.log('==================================================================');
console.log('RELEASE PACKAGE READY');
console.log('==================================================================');
