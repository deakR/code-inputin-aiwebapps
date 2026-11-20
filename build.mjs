import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIcons } from './tools/make-icons.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const store = process.argv.includes('--store');
const maps = process.argv.includes('--maps');

const outArg = process.argv.find((arg) => arg.startsWith('--outdir='));
const dist = path.resolve(root, outArg ? outArg.slice('--outdir='.length) : 'dist');

// esbuild overwrites the files it writes but never deletes the ones it doesn't,
// and chunk hashes change on every edit: start from an empty directory so a build
// can't leave yesterday's chunks (or source maps) behind.
await rm(dist, { recursive: true, force: true });

const abs = (relative) => path.join(root, relative);

/** Files copied verbatim next to the bundles. */
const staticFiles = [
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
];

/**
 * `src/sites/hosts.json` is the single source of truth for host patterns. The
 * content-script and web-accessible-resource matches are injected into the
 * manifest here, so adding a site cannot leave one of the two lists behind.
 */
async function writeManifest() {
  const manifest = JSON.parse(await readFile(abs('src/manifest.json'), 'utf8'));
  const hosts = JSON.parse(await readFile(abs('src/sites/hosts.json'), 'utf8'));
  const siteMatches = Object.values(hosts.sites ?? {}).flat();
  const devMatches = hosts.dev ?? [];
  const matches = [...new Set(store ? siteMatches : [...siteMatches, ...devMatches])];

  for (const script of manifest.content_scripts ?? []) script.matches = matches;
  for (const resource of manifest.web_accessible_resources ?? []) resource.matches = matches;

  await writeFile(path.join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyStatic() {
  await mkdir(dist, { recursive: true });
  await writeManifest();
  for (const [from, to] of staticFiles) {
    const destination = path.join(dist, to);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(abs(from), destination);
  }
  await generateIcons(path.join(dist, 'icons'));
}

const common = {
  bundle: true,
  platform: 'browser',
  target: ['chrome114', 'edge114', 'firefox128'],
  outdir: dist,
  // Source maps are a development luxury: `npm run dev`, or --maps for an
  // unpacked build. Published packages skip them (~3 MB of .map files).
  sourcemap: watch || maps ? 'linked' : false,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'warning',
  // The panel keeps its stylesheet in a .css file, imports it as a string and
  // attaches it to the shadow root.
  loader: { '.css': 'text' },
  plugins: [
    {
      name: 'copy-static',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length > 0) return;
          await copyStatic();
        });
      },
    },
  ],
};

/**
 * Three bundles:
 *  - content.js  : tiny, runs on every Gemini page load
 *  - popup/popup : the toolbar popup
 *  - composer.js : CodeMirror core, imported only when the panel opens; every
 *                  language sits behind a dynamic import and lands in a
 *                  `composer/*` chunk, so an open editor only fetches the one
 *                  language that is selected
 */
const bundles = [
  {
    ...common,
    format: 'iife',
    entryPoints: [
      { in: abs('src/content/index.ts'), out: 'content' },
      { in: abs('src/popup/popup.ts'), out: 'popup/popup' },
    ],
  },
  {
    ...common,
    format: 'esm',
    splitting: true,
    chunkNames: 'composer/[name]-[hash]',
    entryPoints: [{ in: abs('src/composer/index.ts'), out: 'composer' }],
  },
];

if (watch) {
  const contexts = await Promise.all(bundles.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('[build] watching for changes...');
} else {
  let files = 0;
  for (const options of bundles) {
    const result = await esbuild.build({ ...options, metafile: true });
    files += Object.keys(result.metafile.outputs).length;
  }
  await copyStatic();
  const flavor = store ? 'store' : 'dev';
  console.log(
    `[build] ${path.relative(root, dist) || dist} ready — ${flavor} build, ${files} generated files + static assets`,
  );
}
