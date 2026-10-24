/** Prefix a root-absolute public path with Vite's base, without a double slash. */
export function withBase(path:string){const base=((import.meta as {env?:{BASE_URL?:string}}).env?.BASE_URL)||'/';if(!path||/^[a-z][a-z0-9+.-]*:/i.test(path))return path;const root=base.endsWith('/')?base:`${base}/`;if(path===root||path.startsWith(root))return path;return `${root}${path.replace(/^\/+/,'')}`;}
