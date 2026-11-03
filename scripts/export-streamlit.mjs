import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_DIRECTORIES = ['src', 'public'];
const SOURCE_FILES = [
  'index.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'scripts/export-standalone.mjs',
  'scripts/export-streamlit.mjs',
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Collect the complete reproducible source list, using POSIX relative paths. */
export async function listSourceFiles(repoRoot) {
  const root = resolve(repoRoot);
  const paths = [...SOURCE_FILES];
  async function visit(relativeDirectory) {
    for (const entry of await readdir(resolve(root, relativeDirectory), { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(relativePath);
      else if (entry.isFile()) paths.push(relativePath);
      else throw new Error(`Unsupported source entry: ${relativePath}. Release inputs must be regular files.`);
    }
  }
  for (const directory of SOURCE_DIRECTORIES) await visit(directory);
  return paths.sort();
}

/**
 * Cross-language source-hash contract (all hashes lowercase hexadecimal):
 * 1. Sort POSIX relative input paths lexicographically.
 * 2. For each file, append UTF-8(path + NUL + SHA256(file bytes) + LF).
 * 3. SHA256 the resulting concatenation.
 * No modification times or generated timestamps participate in this hash.
 */
async function hashFiles(repoRoot, paths) {
  const records = await Promise.all(paths.map(async (path) => `${path}\0${sha256(await readFile(resolve(repoRoot, path)))}\n`));
  return sha256(Buffer.from(records.join(''), 'utf8'));
}

export async function calculateSourceHash(repoRoot) {
  return hashFiles(repoRoot, await listSourceFiles(repoRoot));
}

/** Package an already-built standalone app for a Python-only Streamlit host. */
export async function exportStreamlit(repoRoot) {
  const root = resolve(repoRoot);
  let html;
  try {
    html = await readFile(resolve(root, 'dist/rosen-academy.html'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Standalone build is missing. Run npm run build:streamlit to build and package the simulator.');
    }
    throw error;
  }
  if (!html.length) throw new Error('Standalone build is empty. Run npm run build:streamlit to rebuild the simulator.');
  const sourceFiles = await listSourceFiles(root);
  const manifest = {
    schemaVersion: 1,
    sourceHash: await hashFiles(root, sourceFiles),
    sourceFiles,
    artifactHash: sha256(html),
    artifact: 'index.html',
    sizeBytes: html.length,
  };
  const output = resolve(root, 'streamlit_assets');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'index.html'), html);
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const root = resolve(process.argv[2] ?? '.');
    const manifest = await exportStreamlit(root);
    console.log(`Streamlit release: ${resolve(root, 'streamlit_assets/index.html')} (${manifest.sizeBytes.toLocaleString()} bytes)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
