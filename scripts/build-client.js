import { build } from 'esbuild';
await build({
  entryPoints: ['client/firebase.js'],
  outfile: 'public/js/firebase.bundle.js',
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'linked',
});
console.log('Firebase browser bundle built.');
