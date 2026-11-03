import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { calculateSourceHash, exportStreamlit, listSourceFiles } from '../scripts/export-streamlit.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'rosen-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'src/main.tsx': 'export const app = "synthetic simulator";\n',
    'src/lib/model.ts': 'export const slope = 12;\n',
    'public/favicon.svg': '<svg/>\n',
    'index.html': '<div id="root"></div>\n',
    'package.json': '{"name":"release-fixture"}\n',
    'package-lock.json': '{"lockfileVersion":3}\n',
    'tsconfig.json': '{}\n',
    'vite.config.ts': 'export default {};\n',
    'scripts/export-standalone.mjs': '// Standalone exporter fixture\n',
    'scripts/export-streamlit.mjs': '// Streamlit exporter fixture\n',
    'dist/rosen-academy.html': '<!doctype html><html><body>Calibration: µg/L → ppm</body></html>\n',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return { root, files };
}

test('source hash follows the documented path/NUL/file-hash/LF contract', async (t) => {
  const { root, files } = await fixture(t);
  const expectedPaths = Object.keys(files).filter((path) => !path.startsWith('dist/')).sort();
  assert.deepEqual(await listSourceFiles(root), expectedPaths);
  const records = expectedPaths.map((path) => `${path}\0${sha256(Buffer.from(files[path]))}\n`).join('');
  assert.equal(await calculateSourceHash(root), sha256(Buffer.from(records)));
  assert.equal(await calculateSourceHash(root), await calculateSourceHash(root));
});

test('source edits and new nested source files invalidate the source hash', async (t) => {
  const { root } = await fixture(t);
  const before = await calculateSourceHash(root);
  await writeFile(join(root, 'src/lib/model.ts'), 'export const slope = 13;\n');
  const afterEdit = await calculateSourceHash(root);
  assert.notEqual(afterEdit, before);
  await mkdir(join(root, 'src/components'), { recursive: true });
  await writeFile(join(root, 'src/components/Chart.tsx'), 'export const chart = true;\n');
  assert.notEqual(await calculateSourceHash(root), afterEdit);
});

test('generated assets and unrelated documentation do not affect the source hash', async (t) => {
  const { root } = await fixture(t);
  const before = await calculateSourceHash(root);
  await mkdir(join(root, 'streamlit_assets'), { recursive: true });
  await mkdir(join(root, 'node_modules/cache'), { recursive: true });
  await writeFile(join(root, 'streamlit_assets/index.html'), 'old release');
  await writeFile(join(root, 'node_modules/cache/cache.txt'), 'cached package');
  await writeFile(join(root, 'README.md'), 'Deployment instructions');
  await writeFile(join(root, 'dist/rosen-academy.html'), 'new build bytes');
  assert.equal(await calculateSourceHash(root), before);
});

test('release copies exact bytes and records verifiable deterministic metadata', async (t) => {
  const { root } = await fixture(t);
  const manifest = await exportStreamlit(root);
  const input = await readFile(join(root, 'dist/rosen-academy.html'));
  const output = await readFile(join(root, 'streamlit_assets/index.html'));
  const manifestBytes = await readFile(join(root, 'streamlit_assets/manifest.json'));
  assert.deepEqual(output, input);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceHash, await calculateSourceHash(root));
  assert.equal(manifest.artifactHash, sha256(output));
  assert.equal(manifest.artifact, 'index.html');
  assert.equal(manifest.sizeBytes, input.length);
  assert.deepEqual(JSON.parse(manifestBytes), manifest);
  await exportStreamlit(root);
  assert.deepEqual(await readFile(join(root, 'streamlit_assets/manifest.json')), manifestBytes);
});

test('missing or empty standalone builds fail with an actionable command', async (t) => {
  const { root } = await fixture(t);
  await rm(join(root, 'dist/rosen-academy.html'));
  await assert.rejects(exportStreamlit(root), /Standalone build is missing.*npm run build:streamlit/);
  await writeFile(join(root, 'dist/rosen-academy.html'), '');
  await assert.rejects(exportStreamlit(root), /Standalone build is empty.*npm run build:streamlit/);
});

test('a missing required source file fails instead of declaring a valid release', async (t) => {
  const { root } = await fixture(t);
  const original = await calculateSourceHash(root);
  await rm(join(root, 'src/lib/model.ts'));
  const afterSourceRemoval = await calculateSourceHash(root);
  assert.notEqual(afterSourceRemoval, original);
  await rm(join(root, 'package-lock.json'));
  await assert.rejects(exportStreamlit(root), /ENOENT/);
});
