import { build } from 'esbuild'

await build({
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
})
