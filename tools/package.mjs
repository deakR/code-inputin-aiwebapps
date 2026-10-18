/**
 * Builds the two zips the stores want:
 *
 *   node tools/package.mjs
 *
 *   release/gemini-code-input-<version>.zip         upload to Edge Add-ons / AMO
 *   release/gemini-code-input-<version>-source.zip  what AMO asks for when the
 *                                                   submitted code is bundled
 *
 * `build/` is the store flavour of the extension (no source maps, no fixture
 * hosts) and both zips keep `manifest.json` at their root.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIcon } from './make-icons.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildDir = path.join(root, 'build');
const sourceDir = path.join(root, 'build-source');
const releaseDir = path.join(root, 'release');

const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
const base = `${manifest.name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')}-${manifest.version}`;

/** Repo files that go into the source zip reviewers get. */
const SOURCE_FILES = [
  '.gitignore',
  'LICENSE',
  'README.md',
  'build.mjs',
  'package-lock.json',
  'package.json',
  'playwright.config.mjs',
  'tsconfig.json',
];
const SOURCE_DIRS = ['docs', 'fixtures', 'src', 'tests', 'tools'];

const BUILD_NOTES = `# Building this extension

The submitted package was produced from these sources with Node.js 20+:

    npm ci
    node build.mjs --store --outdir=build
    node tools/package.mjs     # optional: rebuilds both zips in release/

\`build.mjs\` is the whole build. esbuild bundles \`src/\` (entry points at the
bottom of the file) into \`build/content.js\`, \`build/popup/*\` and
\`build/composer.js\` plus one \`build/composer/*\` chunk per language; it copies
\`src/manifest.json\` and the popup's HTML/CSS next to them and draws the icons
with \`tools/make-icons.mjs\`. \`--store\` only strips the localhost match patterns
that the test fixtures use.

The extension talks to no server of its own: the only traffic it causes is the
\`import()\` of the bundled editor from its own package. Everything else on the
page is Gemini's.

## About that one linter warning

\`npx web-ext lint --source-dir build\` reports 0 errors, 0 notices and one
warning, \`UNSAFE_VAR_ASSIGNMENT\`, pointing at the extension's single dynamic
\`import()\`. Its argument is \`browser.runtime.getURL('composer.js')\` — a file
inside the package, never a remote URL — and the rule simply flags any non-literal
argument. It is what makes the editor (and each language) load on demand instead
of on every page view, so it is deliberate. No code is fetched from anywhere but
this package, and there is no \`eval\` or \`Function\` anywhere in the sources.
`;

function zip(fromDir, toFile) {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${path.join(fromDir, '*')}' -DestinationPath '${toFile}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync('zip', ['-q', '-r', toFile, '.'], { cwd: fromDir, stdio: 'inherit' });
  }
}

await rm(buildDir, { recursive: true, force: true });
await rm(sourceDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

// 1. The extension itself.
execFileSync(process.execPath, [path.join(root, 'build.mjs'), '--store', `--outdir=${buildDir}`], {
  cwd: root,
  stdio: 'inherit',
});
zip(buildDir, path.join(releaseDir, `${base}.zip`));

// The stores ask for a listing logo separately from the extension's own icons.
await writeFile(path.join(releaseDir, `${base}-store-icon-300.png`), renderIcon(300));

// 2. The sources, for the reviewer.
await mkdir(sourceDir, { recursive: true });
for (const file of SOURCE_FILES) {
  await cp(path.join(root, file), path.join(sourceDir, file));
}
for (const dir of SOURCE_DIRS) {
  await cp(path.join(root, dir), path.join(sourceDir, dir), { recursive: true });
}
await writeFile(path.join(sourceDir, 'BUILD.md'), BUILD_NOTES);
zip(sourceDir, path.join(releaseDir, `${base}-source.zip`));
await rm(sourceDir, { recursive: true, force: true });

const made = (await readdir(releaseDir)).filter((name) => name.startsWith(base));
console.log(`[package] ${made.join('\n[package] ')}`);
