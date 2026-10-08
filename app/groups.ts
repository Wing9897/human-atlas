/** User-defined groups of source meshes with stacked annotation colors, stored in this browser. */
export interface Group {id:string;name:string;parts:string[];colors:string[];children?:string[];hidden?:boolean;tagHidden?:boolean}
/** The shader draws at most this many colors on one piece (as alternating bands); extra layers are not drawn. */
export const MAX_LAYERS=4;
const KEY='human-atlas.groups';
export const isHex=(value:string)=>/^#[0-9a-f]{6}$/i.test(value);
export const newGroupId=()=>`group-${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
export function loadGroups():Group[]{
 try{const raw:unknown=JSON.parse(localStorage.getItem(KEY)??localStorage.getItem('human-atlas.combines')??'[]');if(!Array.isArray(raw))return[];
  return raw.filter((c):c is Group=>!!c&&typeof c.id==='string'&&typeof c.name==='string'&&Array.isArray(c.parts)&&Array.isArray(c.colors)).map(c=>({...c,parts:c.parts.filter(p=>typeof p==='string'),colors:c.colors.filter(x=>typeof x==='string'&&isHex(x)).map(x=>x.toLowerCase()),children:Array.isArray(c.children)?c.children.filter(x=>typeof x==='string'):[],tagHidden:typeof c.tagHidden==='boolean'?c.tagHidden:undefined}));
 }catch{return[];}
}
export function saveGroups(groups:Group[]){try{localStorage.setItem(KEY,JSON.stringify(groups));}catch{/* Storage can be full or disabled; groups then last for this session. */}}
/** Own pieces plus every piece of included groups, ignoring cycles. */
export function resolveParts(groups:Group[],id:string,seen=new Set<string>()):string[]{
 const c=groups.find(x=>x.id===id);if(!c||seen.has(id))return[];seen.add(id);
 const out=new Set(c.parts);for(const child of c.children??[])for(const p of resolveParts(groups,child,seen))out.add(p);
 return [...out];
}
/** Whether `target` is `root` or is reachable through included groups of `root`. */
export function includes(groups:Group[],root:string,target:string,seen=new Set<string>()):boolean{
 if(root===target)return true;if(seen.has(root))return false;seen.add(root);
 return (groups.find(x=>x.id===root)?.children??[]).some(child=>includes(groups,child,target,seen));
}
/** Color layers per part id without repeats. The most specific group (fewest resolved pieces, ties by list order) comes first, so its colors lead the bands. */
export function colorLayers(groups:Group[]){
 const layers:Record<string,string[]>={};
 const visible=groups.filter(c=>!c.hidden).map(c=>({c,parts:resolveParts(groups,c.id)})).sort((a,b)=>a.parts.length-b.parts.length);
 for(const {c,parts} of visible)for(const id of parts){const list=layers[id]??=[];for(const color of c.colors)if(!list.includes(color))list.push(color);}
 return layers;
}
/** CSS diagonal segments matching the wide bands on the model. */
export function stripes(colors:string[]){
 if(!colors.length)return 'transparent';if(colors.length===1)return colors[0];
 return `linear-gradient(135deg,${colors.map((c,i)=>`${c} ${i*100/colors.length}% ${(i+1)*100/colors.length}%`).join(',')})`;
}
