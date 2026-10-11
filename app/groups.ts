/** User-defined groups of source meshes with stacked annotation colors, stored in this browser. */
/** A marker on the surface of `part`, in the part's assembled (un-exploded) model coordinates. */
export interface GroupPoint {part:string;at:[number,number,number]}
export interface Group {id:string;name:string;parts:string[];colors:string[];children?:string[];points?:GroupPoint[];hidden?:boolean;tagHidden?:boolean;/** Where the label line attaches: one of `parts`, or `point:<index>` into `points`. */anchor?:string}
const isPoint=(p:unknown):p is GroupPoint=>{const q=p as GroupPoint;return !!q&&typeof q.part==='string'&&!!q.part&&Array.isArray(q.at)&&q.at.length===3&&q.at.every(n=>typeof n==='number'&&Number.isFinite(n));};
/** The shader draws at most this many colors on one piece (as alternating bands); extra layers are not drawn. */
export const MAX_LAYERS=4;
const KEY='human-atlas.groups';
export const isHex=(value:string)=>/^#[0-9a-f]{6}$/i.test(value);
export const newGroupId=()=>`group-${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
const ids=(list:unknown[])=>list.filter((x):x is string=>typeof x==='string'&&!!x);
/** Keeps the persisted fields of a stored group and drops entries of the wrong type; null when the group lacks its required shape. */
function normalizeGroup(raw:unknown):Group|null{
 const c=raw as Group;if(!c||typeof c!=='object'||typeof c.id!=='string'||typeof c.name!=='string'||!Array.isArray(c.parts)||!Array.isArray(c.colors))return null;
 const g:Group={id:c.id,name:c.name,parts:ids(c.parts),colors:c.colors.filter(x=>typeof x==='string'&&isHex(x)).map(x=>x.toLowerCase()),children:Array.isArray(c.children)?ids(c.children):[],points:(Array.isArray(c.points)?c.points as unknown[]:[]).filter(isPoint).map(p=>({part:p.part,at:[p.at[0],p.at[1],p.at[2]] as GroupPoint['at']})),hidden:typeof c.hidden==='boolean'?c.hidden:undefined,tagHidden:typeof c.tagHidden==='boolean'?c.tagHidden:undefined};
 return {...g,anchor:typeof c.anchor==='string'&&anchorOk(g,c.anchor)?c.anchor:undefined};
}
/** Whether `anchor` names one of the group's own pieces or an existing point. */
export const anchorOk=(g:Pick<Group,'parts'|'points'>,anchor:string)=>/^point:\d+$/.test(anchor)?Number(anchor.slice(6))<(g.points?.length??0):g.parts.includes(anchor);
export function loadGroups():Group[]{
 try{const raw:unknown=JSON.parse(localStorage.getItem(KEY)??localStorage.getItem('human-atlas.combines')??'[]');if(!Array.isArray(raw))return[];
  return raw.map(normalizeGroup).filter((c):c is Group=>!!c);
 }catch{return[];}
}
export const exportGroups=(groups:Group[])=>JSON.stringify({version:1,groups:groups.map(normalizeGroup)},null,1);
/** Strict counterpart of loadGroups for a downloaded file: the whole file is rejected (an error message is returned) if normalizing would drop or change anything. Unknown part ids are kept. */
export function importGroups(text:string):Group[]|string{
 if(text.length>2_000_000)return 'File is too large (over 2 MB).';
 let root:{version?:unknown;groups?:unknown};try{root=JSON.parse(text);}catch{return 'Not a valid JSON file.';}
 if(!root||typeof root!=='object'||Array.isArray(root)||root.version!==1||!Array.isArray(root.groups))return 'Not a Human Atlas groups file (version 1).';
 if(root.groups.length>200)return 'Too many groups (200 at most).';
 const out:Group[]=[];
 for(const [i,raw] of (root.groups as unknown[]).entries()){
  const g=normalizeGroup(raw),r=raw as Record<string,unknown>,len=(k:string)=>Array.isArray(r[k])?(r[k] as unknown[]).length:-1;
  if(!g||!g.id||!g.name.trim()||g.parts.length!==len('parts')||g.colors.length!==len('colors')||!g.colors.length||g.colors.length>MAX_LAYERS||(r.children!==undefined&&g.children!.length!==len('children'))||(r.points!==undefined&&g.points!.length!==len('points'))||(r.hidden!==undefined&&typeof r.hidden!=='boolean')||(r.tagHidden!==undefined&&typeof r.tagHidden!=='boolean')||(r.anchor!==undefined&&g.anchor!==r.anchor))return `Group ${i+1} is incomplete or has invalid fields.`;
  out.push({...g,name:g.name.trim()});
 }
 if(new Set(out.map(g=>g.id)).size!==out.length)return 'The file has duplicate group ids.';
 for(const g of out)for(const child of g.children??[]){if(!out.some(x=>x.id===child))return `“${g.name}” includes a group that is not in the file.`;if(includes(out,child,g.id))return `“${g.name}” includes itself through its groups.`;}
 return out;
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
