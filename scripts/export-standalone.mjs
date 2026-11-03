import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const root = resolve('dist');
const readAsset = async (url) => {
  const path = resolve(root, url.replace(/^\//, ''));
  if (!path.startsWith(root + sep)) throw new Error(`Asset is outside dist: ${url}`);
  return readFile(path);
};
const dataURI = async (url) => {
  const type = url.endsWith('.woff2') ? 'font/woff2' : url.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
  return `data:${type};base64,${(await readAsset(url)).toString('base64')}`;
};
let html = await readFile(resolve(root, 'index.html'), 'utf8');
for (const match of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)]) {
  const href = match[0].match(/href="([^"]+)"/)?.[1];
  if (!href) throw new Error('Stylesheet URL missing');
  let css = (await readAsset(href)).toString();
  for (const asset of [...new Set([...css.matchAll(/url\((?:"|')?([^\s)"']+)(?:"|')?\)/g)].map(result => result[1]))]) {
    if (asset.startsWith('data:') || asset.startsWith('#')) continue;
    if (!asset.startsWith('/assets/')) throw new Error(`Unexpected CSS resource: ${asset}`);
    css = css.replaceAll(asset, await dataURI(asset));
  }
  html = html.replace(match[0], () => `<style>${css.replaceAll('</style', '<\\/style')}</style>`);
}
for (const match of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
  const js = (await readAsset(match[1])).toString();
  html = html.replace(match[0], () => `<script type="module">${js.replaceAll('</script', '<\\/script')}</script>`);
}
html = html.replace(/<link\b[^>]*rel="icon"[^>]*>/g, `<link rel="icon" href="${await dataURI('/favicon.svg')}" />`);
if (/\b(?:src|href)="\/assets\//.test(html)) throw new Error('An external build asset remains');
const filename = resolve(root, 'rosen-academy.html');
await writeFile(filename, html);
console.log(`Standalone simulator: ${filename} (${Buffer.byteLength(html).toLocaleString()} bytes)`);
