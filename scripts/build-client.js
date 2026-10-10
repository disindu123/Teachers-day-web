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
// Resolve every frontend import at build time, including dashboard-only modules.
await build({
  entryPoints: [
    'public/js/home.js',
    'public/js/gallery.js',
    'public/js/contact.js',
    'public/js/login.js',
    'public/js/admin.js',
  ],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  outdir: 'frontend-check',
  write: false,
  logLevel: 'warning',
});
console.log('Frontend imports verified.');
