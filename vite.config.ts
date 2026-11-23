import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Vercel serves the app at the root. GitHub Pages serves it at /nesmo/, so
// the Pages workflow builds with BASE_PATH=/nesmo/.
const base = process.env.BASE_PATH || '/';

function walk(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name), root) : [relative(root, join(dir, d.name)).split('\\').join('/')],
  );
}

/**
 * After the build, write the list of output files and a content hash into
 * dist/sw.js so the service worker can download the whole app on install.
 * NesMo 1 under legacy/ is left out; it's cached as it gets visited.
 */
function precacheManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'nesmo-precache',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) return;
      const sw = readFileSync(swPath, 'utf8');
      if (!sw.includes('__PRECACHE__')) return;
      const files = walk(outDir)
        .filter((f) => f !== 'sw.js' && !f.startsWith('legacy/') && !f.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const list = ['./', ...files];
      writeFileSync(
        swPath,
        sw.replace("'__VERSION__'", JSON.stringify(version)).replace('[/* __PRECACHE__ */]', JSON.stringify(list)),
      );
    },
  };
}

export default defineConfig({
  base,
  plugins: [precacheManifest()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
  server: {
    host: true,
  },
});
