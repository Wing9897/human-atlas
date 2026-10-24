import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import {VitePWA} from 'vite-plugin-pwa';
const path=(relative:string)=>fileURLToPath(new URL(relative,import.meta.url));
export default defineConfig({
 base:'/human-atlas/',
 root:path('./web'),
 publicDir:path('./public'),
 plugins:[
  react(),
  VitePWA({
   registerType:'autoUpdate',
   scope:'/human-atlas/',
   manifest:{
    name:'Human Atlas',
    short_name:'Atlas',
    description:'An interactive atlas of the human body.',
    display:'standalone',
    id:'/human-atlas/',
    start_url:'/human-atlas/',
    scope:'/human-atlas/',
    background_color:'#f3f4f4',
    theme_color:'#f3f4f4',
    icons:[
     {src:'/human-atlas/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
     {src:'/human-atlas/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
     {src:'/human-atlas/icon-512-maskable.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
    ],
   },
   includeManifestIcons:false,
   workbox:{
    globPatterns:['**/*.{js,css,html,svg,png,ico,webmanifest}'],
    globIgnores:['**/models/**'],
    navigateFallback:'/human-atlas/index.html',
    navigateFallbackDenylist:[/\/models\//],
    // Glob entries are dist-relative. Prefix them so precache fetches stay inside the GitHub Pages base.
    modifyURLPrefix:{'':'/human-atlas/'},
    runtimeCaching:[{
     urlPattern:/\/models\/.+/i,
     handler:'CacheFirst',
     options:{
      cacheName:'anatomy-models',
      expiration:{maxEntries:64,maxAgeSeconds:60*60*24*365},
      cacheableResponse:{statuses:[0,200]},
     },
    }],
   },
   devOptions:{enabled:false},
   integration:{closeBundleOrder:'pre'},
  }),
  // Dev joins every root-absolute URL with `base`. %BASE_URL% is already absolute, so favicon and manifest links would be prefixed twice.
  // Workbox adds additionalManifestEntries after modifyURLPrefix, so those precache URLs still need the Pages base.
  {name:'dedupe-base-url',enforce:'post',transformIndexHtml(html){return html.replaceAll('/human-atlas/human-atlas/','/human-atlas/');},closeBundle:{sequential:true,order:'post',handler(){const swPath=path('./dist/sw.js');const sw=readFileSync(swPath,'utf8').replace(/\{url:"(?!\/human-atlas\/|https?:)([^"]+)"/g,(_,url:string)=>`{url:"/human-atlas/${url.replace(/^\/+/,'')}"`);writeFileSync(swPath,sw);}}},
 ],
 resolve:{alias:{'@':path('./')}},
 css:{postcss:{plugins:[tailwindcss()]}},
 server:{watch:{usePolling:true}},
 build:{outDir:path('./dist'),emptyOutDir:true},
});
