/**
 * Release Packaging Script for CDN Analyzer Pro
 * Validates runtime dependencies, builds a clean unpacked extension directory,
 * creates a distributable ZIP package, and validates package completeness.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const packageDir = path.resolve(distDir, 'cdn-analyzer-pro');
const zipFile = path.resolve(distDir, 'cdn-analyzer-pro-v2.0.0.zip');

const RUNTIME_FILES = [
    'manifest.json',
    'background.js',
    'popup.html',
    'popup.js',
    'styles.css',
    'README.md',
    'icons/icon-v7.png',
    'modules/cdp.js',
    'modules/cdn.js',
    'modules/metrics.js',
    'modules/report.js',
    'modules/resources.js',
    'modules/scoring.js',
    'modules/security.js'
];

console.log('==================================================================');
console.log('CDN ANALYZER PRO — RELEASE PACKAGING & VALIDATION');
console.log('==================================================================');

// 1. Clean and prepare output directories
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(packageDir, { recursive: true });

// 2. Copy verified runtime files
console.log('\n>>> Copying runtime files into package directory:');
for (const relPath of RUNTIME_FILES) {
    const src = path.resolve(rootDir, relPath);
    const dest = path.resolve(packageDir, relPath);

    if (!fs.existsSync(src)) {
        throw new Error(`Critical runtime file missing: ${relPath}`);
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`  ✓ ${relPath}`);
}

// 3. Verify manifest.json integrity inside package
console.log('\n>>> Validating manifest.json inside release package:');
const manifestContent = JSON.parse(fs.readFileSync(path.resolve(packageDir, 'manifest.json'), 'utf8'));

if (manifestContent.manifest_version !== 3) {
    throw new Error(`Expected Manifest V3, found: ${manifestContent.manifest_version}`);
}
console.log(`  ✓ Manifest Version: ${manifestContent.manifest_version}`);
console.log(`  ✓ Extension Name: ${manifestContent.name} (v${manifestContent.version})`);
console.log(`  ✓ Service Worker: ${manifestContent.background.service_worker} (type: ${manifestContent.background.type})`);
console.log(`  ✓ Declared Permissions: ${manifestContent.permissions.join(', ')}`);
console.log(`  ✓ Host Permissions: ${manifestContent.host_permissions.join(', ')}`);

// Verify all declared icon files exist
for (const [size, iconPath] of Object.entries(manifestContent.icons || {})) {
    if (!fs.existsSync(path.resolve(packageDir, iconPath))) {
        throw new Error(`Declared icon ${size} missing in package: ${iconPath}`);
    }
}
console.log('  ✓ All declared icons verified.');

// 4. Create ZIP archive
console.log('\n>>> Generating release ZIP archive:');
try {
    const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${packageDir}\\*' -DestinationPath '${zipFile}' -Force"`;
    execSync(psCmd, { stdio: 'inherit' });
    const stat = fs.statSync(zipFile);
    console.log(`  ✓ Release ZIP created: ${zipFile} (${(stat.size / 1024).toFixed(1)} KB)`);
} catch (err) {
    console.warn('  ! PowerShell Compress-Archive encountered an issue, fallback directory is intact:', err.message);
}

// 5. Audit release directory against forbidden files
console.log('\n>>> Auditing package directory for forbidden files:');
const forbiddenPatterns = [
    /\.git/,
    /node_modules/,
    /tests/,
    /docs/,
    /\.env/,
    /\.codex/,
    /\.agents/,
    /content\.js/
];

function checkDir(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const rel = path.relative(packageDir, fullPath).replace(/\\/g, '/');

        for (const pattern of forbiddenPatterns) {
            if (pattern.test(rel)) {
                throw new Error(`Forbidden file detected in release package: ${rel}`);
            }
        }

        if (entry.isDirectory()) {
            checkDir(fullPath);
        }
    }
}

checkDir(packageDir);
console.log('  ✓ No test files, credentials, git metadata, or deprecated scripts in package.');

console.log('\n==================================================================');
console.log('RELEASE PACKAGE VALIDATION SUCCEEDED!');
console.log(`Unpacked Directory: ${packageDir}`);
if (fs.existsSync(zipFile)) {
    console.log(`ZIP Archive:        ${zipFile}`);
}
console.log('==================================================================');
