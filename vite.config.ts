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
   manifest:{
    name:'Human Atlas',
    short_name:'Atlas',
    description:'An interactive atlas of the human body.',
    display:'standalone',
    start_url:'/human-atlas/',
    scope:'/human-atlas/',
    background_color:'#f3f4f4',
    theme_color:'#f3f4f4',
    icons:[
     {src:'icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
     {src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
     {src:'icon-512-maskable.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
    ],
   },
   includeAssets:['favicon.svg','apple-touch-icon.png','icon-192.png','icon-512.png','icon-512-maskable.png'],
   workbox:{
    globPatterns:['**/*.{js,css,html,svg,png,ico,webmanifest}'],
    globIgnores:['**/models/**'],
    navigateFallbackDenylist:[/\/models\//],
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
  }),
  // Dev joins every root-absolute URL with `base`. %BASE_URL% is already absolute, so favicon and manifest links would be prefixed twice.
  {name:'dedupe-base-url',enforce:'post',transformIndexHtml(html){return html.replaceAll('/human-atlas/human-atlas/','/human-atlas/');}},
 ],
 resolve:{alias:{'@':path('./')}},
 css:{postcss:{plugins:[tailwindcss()]}},
 server:{watch:{usePolling:true}},
 build:{outDir:path('./dist'),emptyOutDir:true},
});
