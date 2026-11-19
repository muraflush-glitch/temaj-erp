// Ndërton provën që punon brenda shfletuesit: dist/index.html + app.js + skedarët e databazës (të koduar si tekst).
import { build } from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

const migDir = join(root, 'apps/api/migrations');
const migrations = readdirSync(migDir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort().map((name) => ({ name, sql: readFileSync(join(migDir, name), 'utf8') }));
writeFileSync(join(here, 'src/migrations.gen.ts'), `// I gjeneruar nga build.mjs — mos e ndryshoni me dorë.\nexport const MIGRATIONS: { name: string; sql: string }[] = ${JSON.stringify(migrations)};\n`);

const shim = (f) => join(here, 'shims', f);
await build({
  entryPoints: [join(here, 'src/main.tsx')], outfile: join(out, 'app.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  jsx: 'automatic', legalComments: 'none', logLevel: 'warning',
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, jsx: 'react-jsx' } },
  alias: { '@nestjs/common': shim('nest-common.ts'), '@nestjs/core': shim('nest-core.ts'), pg: shim('pg.ts'), crypto: shim('crypto.ts'), util: shim('util.ts'),
    'next/link': shim('next-link.tsx'), 'next/navigation': shim('next-navigation.ts'), '@': join(root, 'apps/web') },
  inject: [shim('globals.ts')],
  // Degët vetëm-për-Node të PGlite nuk ekzekutohen kurrë në shfletues.
  plugins: [{ name: 'vetem-node', setup(b) {
    b.onResolve({ filter: /^(node:.*|fs|path|url|module|ws|stream|zlib|os|child_process|worker_threads)$/ }, (a) => ({ path: a.path, namespace: 'bosh' }));
    b.onLoad({ filter: /.*/, namespace: 'bosh' }, () => ({ contents: 'export default {};', loader: 'js' }));
  } }],
  define: { 'process.env': 'globalThis.__temajEnv', 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'text' },
});

const require = createRequire(import.meta.url);
const pgDist = dirname(require.resolve('@electric-sql/pglite'));
const b64 = (f) => readFileSync(join(pgDist, f)).toString('base64');
writeFileSync(join(out, 'pg-wasm.js'), `globalThis.__PGW="${b64('pglite.wasm')}";`);
writeFileSync(join(out, 'pg-data.js'), `globalThis.__PGD="${b64('pglite.data')}";`);
writeFileSync(join(out, 'pg-ext.js'), `globalThis.__PGX=${JSON.stringify({ initdb: b64('initdb.wasm'), citext: b64('citext.tar.gz'), btree_gist: b64('btree_gist.tar.gz') })};`);

const css = readFileSync(join(root, 'apps/web/app/globals.css'), 'utf8');
writeFileSync(join(out, 'index.html'), `<!DOCTYPE html>
<html lang="sq">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Temaj ERP — provë</title>
<style>
${css}
.prove-bar { background: #fff4e5; border-bottom: 1px solid #e8c9a0; color: #5a3b12; padding: 8px 20px; display: flex; gap: 8px 14px; align-items: center; flex-wrap: wrap; font-size: 14px; }
.prove-bar .grow { flex: 1; }
.prove-bar button { background: #fff; color: #5a3b12; border: 1px solid #c79a5c; padding: 6px 12px; font-size: 14px; }
.prove-bar button.on { background: #5a3b12; color: #fff; border-color: #5a3b12; }
.prove-hint { max-width: 380px; margin: 16px auto 0; padding: 0 16px; font-size: 14px; color: var(--quiet); }
#boot { max-width: 520px; margin: 80px auto; padding: 0 20px; text-align: center; }
#boot h1 { font-size: 24px; } #boot p { color: var(--quiet); }
#boot code { display: block; margin-top: 10px; color: var(--bad); word-break: break-word; }
</style>
</head>
<body>
<div id="boot"><h1>Temaj ERP</h1><p id="boot-status">Po ngarkohet sistemi… (10–30 sekonda herën e parë)</p></div>
<div id="root"></div>
<script src="pg-ext.js"></script>
<script src="pg-wasm.js"></script>
<script src="pg-data.js"></script>
<script type="module" src="app.js"></script>
</body>
</html>
`);
for (const f of readdirSync(out)) console.log(f, (readFileSync(join(out, f)).length / 1048576).toFixed(2), 'MiB');
