import {useEffect,useRef} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createExplosionLayout} from './explosion-layout';
import {decodeModelResponse} from './model-download';
import {PointerTap} from './pointer-tap';
import {SYSTEMS,type Atlas,type SceneLabel,type SceneState} from './anatomy';
import {MAX_LAYERS,stripes} from './groups';
interface Props {atlas:Atlas;state:SceneState;onSelect:(id:string,additive:boolean)=>void;onBoxSelect:(ids:string[])=>void;onClear:()=>void;onLabel:(id:string)=>void;onPoint:(part:string,at:[number,number,number])=>void;onProgress:(n:number)=>void;onError:(s:string)=>void}
export default function AnatomyScene({atlas,state,onSelect,onBoxSelect,onClear,onLabel,onPoint,onProgress,onError}:Props){
 const host=useRef<HTMLDivElement>(null),latest=useRef(state),select=useRef(onSelect),boxSelect=useRef(onBoxSelect),clearSelect=useRef(onClear),labelClick=useRef(onLabel),addPoint=useRef(onPoint);
 latest.current=state;select.current=onSelect;boxSelect.current=onBoxSelect;clearSelect.current=onClear;labelClick.current=onLabel;addPoint.current=onPoint;
 useEffect(()=>{
  const el=host.current!;let disposed=false,frame=0,dirty=true,ready=false,lastView='',lastReset=-1,lastIsolate='',layoutKey='',amount=0,lastShot=0;
  let lastState:SceneState|null=null;
  const abort=new AbortController();
  let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch{onError('This browser could not start the 3D viewer. Please try a browser with WebGL enabled.');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<768?1.5:2));renderer.setClearColor('#f2f3f3');renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;el.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','Interactive human anatomy. Drag to orbit, pinch or scroll to zoom, and tap a structure to inspect it.');
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,.005,100),controls=new OrbitControls(camera,renderer.domElement);
  camera.position.set(1.4,1.05,3.6);controls.target.set(0,.85,0);controls.enableDamping=true;controls.dampingFactor=.085;controls.minDistance=.07;controls.maxDistance=40;controls.maxPolarAngle=Math.PI*.96;controls.addEventListener('change',()=>{dirty=true;});
  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose();
  scene.add(new T.HemisphereLight(0xffffff,0xa7acb2,1.05));
  const key=new T.DirectionalLight(0xfffaf4,2.3);key.position.set(-2,4,3);scene.add(key);
  const rim=new T.DirectionalLight(0xe9f0ff,1.8);rim.position.set(2,2,-3);scene.add(rim);
  const ground=new T.Mesh(new T.CircleGeometry(30,96),new T.MeshStandardMaterial({color:0xd5d9dc,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.019;scene.add(ground);
  const platform=new T.Mesh(new T.CylinderGeometry(.68,.7,.028,100),new T.MeshStandardMaterial({color:0xeeeeec,metalness:.12,roughness:.67}));platform.position.y=-.016;scene.add(platform);
  const ring=new T.Mesh(new T.RingGeometry(.63,.632,128),new T.MeshBasicMaterial({color:0x8c969f,transparent:true,opacity:.4,side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.001;scene.add(ring);
  const innerRing=new T.Mesh(new T.RingGeometry(.55,.551,128),new T.MeshBasicMaterial({color:0xa4aeb8,transparent:true,opacity:.16,side:T.DoubleSide}));innerRing.rotation.x=-Math.PI/2;innerRing.position.y=.001;scene.add(innerRing);
  const width=T.MathUtils.ceilPowerOfTwo(atlas.parts.length),data=new Float32Array(width*4),partTexture=new T.DataTexture(data,width,1,T.RGBAFormat,T.FloatType);partTexture.needsUpdate=true;
  const selectedData=new Uint8Array(width*4),selectionTexture=new T.DataTexture(selectedData,width,1);selectionTexture.needsUpdate=true;
  // Rows 0..MAX_LAYERS-1 hold layer colors; the last row holds layer count, band width and band phase per piece.
  const layerData=new Float32Array(width*(MAX_LAYERS+1)*4),layerTexture=new T.DataTexture(layerData,width,MAX_LAYERS+1,T.RGBAFormat,T.FloatType);layerTexture.needsUpdate=true;
  let lastLayers:SceneState['layers']|null=null;
  const materials:T.Material[]=[],geometries:T.BufferGeometry[]=[],pickers:(T.Mesh|undefined)[]=[],centers=atlas.parts.map(p=>new T.Vector3().fromArray(p.bounds[0]).add(new T.Vector3().fromArray(p.bounds[1])).multiplyScalar(.5));
  const offsets:T.Vector3[]=[],bounds=atlas.parts.map(p=>new T.Box3(new T.Vector3().fromArray(p.bounds[0]),new T.Vector3().fromArray(p.bounds[1])));
  const stripeDir=new T.Vector3(.42,.82,.38),spans=bounds.map(b=>b.getSize(new T.Vector3()).dot(stripeDir));
  let packingWidth=1,packingHeight=1;
  const markerPositions=new Float32Array(atlas.parts.length*3),markerGeometry=new T.BufferGeometry();markerGeometry.setAttribute('position',new T.BufferAttribute(markerPositions,3));
  const markerMaterial=new T.PointsMaterial({color:0x64748b,size:5,sizeAttenuation:false,transparent:true,opacity:.72,depthTest:false});
  markerMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;');};
  const markers=new T.Points(markerGeometry,markerMaterial);markers.frustumCulled=false;markers.renderOrder=10;markers.visible=false;scene.add(markers);
  const hover=document.createElement('div');hover.className='part-hover';hover.setAttribute('role','tooltip');hover.hidden=true;el.appendChild(hover);
  type Target={index:number;x:number;y:number;left:number;right:number;top:number;bottom:number};let targets:Target[]=[];
  const projected=new T.Vector3();
  const findTarget=(x:number,y:number,radius:number)=>{
   let best=-1,score=Infinity;
   for(const t of targets){const dx=Math.max(t.left-x,0,x-t.right),dy=Math.max(t.top-y,0,y-t.bottom),distance=Math.hypot(dx,dy);if(distance>radius)continue;const candidate=distance+Math.hypot(t.x-x,t.y-y)*.025;if(candidate<score){score=candidate;best=t.index;}}
   return best;
  };
  const materialFor=(system:string)=>{
   const m=new T.MeshStandardMaterial({color:SYSTEMS.find(s=>s.id===system)?.color??'#aebbb8',metalness:.08,roughness:.53,side:T.DoubleSide,transparent:system==='integumentary',opacity:system==='integumentary'?.1:1,depthWrite:system!=='integumentary'});
   m.onBeforeCompile=shader=>{
    shader.uniforms.partState={value:partTexture};shader.uniforms.selectionState={value:selectionTexture};shader.uniforms.layerState={value:layerTexture};shader.uniforms.stateWidth={value:width};
    shader.vertexShader=`attribute float partIndex; uniform sampler2D partState; uniform sampler2D selectionState; uniform float stateWidth; varying float partVisible; varying float partSelected; varying vec2 partLayer;\n`+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nvec2 stateUv = vec2((partIndex + 0.5) / stateWidth, 0.5); vec4 state = texture2D(partState, stateUv); transformed += state.xyz; partVisible = state.w; partSelected = texture2D(selectionState, stateUv).r; partLayer = vec2(stateUv.x, dot(position, vec3(${stripeDir.toArray().join(', ')})));`);
    shader.fragmentShader=`varying float partVisible; varying float partSelected; uniform sampler2D layerState; varying vec2 partLayer;\n`+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (partVisible < 0.5) discard;');
    // Model units are meters: diagonal bands fixed to the surface and centered on the piece, sized so each piece shows about two cycles of its colors (0.5 to 4.5 cm wide), blending softly into the next band.
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\nvec4 layerInfo = texture2D(layerState, vec2(partLayer.x, ${MAX_LAYERS+.5} / ${MAX_LAYERS+1}.0));\nif (layerInfo.x > 0.5) { float stripe = (partLayer.y - layerInfo.z) / layerInfo.y; float band = mod(floor(stripe), layerInfo.x), next = mod(band + 1.0, layerInfo.x); vec3 tag = mix(texture2D(layerState, vec2(partLayer.x, (band + 0.5) / ${MAX_LAYERS+1}.0)).rgb, texture2D(layerState, vec2(partLayer.x, (next + 0.5) / ${MAX_LAYERS+1}.0)).rgb, smoothstep(0.86, 1.0, fract(stripe))); diffuseColor.rgb = mix(diffuseColor.rgb, pow(tag, vec3(2.2)), 0.88); }\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.85, 0.78), partSelected * 0.75);`);
   };materials.push(m);return m;
  };
  const mats=new Map(SYSTEMS.map(s=>[s.id,materialFor(s.id)]));
  let loaded=0;
  const loadChunk=async(ci:number)=>{
   const chunk=atlas.chunks[ci],compressed=!!chunk.gzip&&typeof DecompressionStream!=='undefined';const response=await fetch(compressed?chunk.gzip!:chunk.url,{signal:abort.signal});const buffer=await decodeModelResponse(response,chunk.bytes,compressed);if(disposed)return;
   const groups=new Map<string,T.BufferGeometry[]>();
   atlas.parts.forEach((p,i)=>{
    if(p.chunk!==ci)return;
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(buffer,p.positions,p.vertexCount*3),3));
    // GPU normalized signed-short normals keep the complete atlas compact in memory.
    g.setAttribute('normal',new T.BufferAttribute(new Int16Array(buffer,p.normals,p.vertexCount*3),3,true));g.setIndex(new T.BufferAttribute(new Uint32Array(buffer,p.indices,p.indexCount),1));
    g.boundingBox=bounds[i].clone();g.computeBoundingSphere();const pick=new T.Mesh(g);pick.matrixAutoUpdate=false;pickers[i]=pick;geometries.push(g);
    g.setAttribute('partIndex',new T.BufferAttribute(new Float32Array(p.vertexCount).fill(i),1));
    const list=groups.get(p.system)??[];list.push(g);groups.set(p.system,list);
   });
   groups.forEach((gs,system)=>{const geometry=mergeGeometries(gs,false);if(!geometry)throw new Error('Could not assemble anatomy geometry.');geometries.push(geometry);const mesh=new T.Mesh(geometry,mats.get(system as never));mesh.frustumCulled=false;scene.add(mesh);});
   lastState=null;loaded++;onProgress(Math.round(loaded/atlas.chunks.length*100));dirty=true;
  };
  (async()=>{try{let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<atlas.chunks.length){const i=cursor++;await loadChunk(i);}}));if(!disposed){ready=true;dirty=true;}}catch(e){if(!disposed)onError(e instanceof Error?e.message:'Could not load the anatomy.');}})();
  const fit=(view:string,extent=0)=>{
   const aspect=camera.aspect,mobile=el.clientWidth<768,normalDistance=mobile?Math.max(4.5,1.8*el.clientHeight/Math.max(160,el.clientHeight-350)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))):4;
   const reservedHeight=mobile?350:270;const availableAspect=Math.max(.35,(el.clientWidth-(mobile?40:340))/Math.max(160,el.clientHeight-reservedHeight));const atlasDistance=Math.max(packingHeight,packingWidth/availableAspect)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))*(el.clientHeight/Math.max(160,el.clientHeight-reservedHeight))*1.08;
   const distance=T.MathUtils.lerp(normalDistance,Math.max(.2,atlasDistance),extent);if(extent>.8)view='front';
   const direction=view==='front'?new T.Vector3(0,.02,1):view==='back'?new T.Vector3(0,.02,-1):view==='side'?new T.Vector3(1,.02,0):new T.Vector3(.35,.06,1).normalize();
   controls.target.set(extent>.1&&el.clientWidth>767?-packingWidth*.12:0,extent>.1||mobile?.85:.68,0);camera.position.copy(controls.target).addScaledVector(direction,distance);controls.update();dirty=true;
  };
  const resize=()=>{layoutKey='';lastState=null;renderer.setPixelRatio(Math.min(devicePixelRatio,el.clientWidth<768||el.clientHeight<600?1.5:2));camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight);fit(latest.current.view,amount);};const observer=new ResizeObserver(resize);observer.observe(el);
  const raycaster=new T.Raycaster(),pointer=new T.Vector2(),tap=new PointerTap(),worldBox=new T.Box3(),hitPoint=new T.Vector3(),pickPoint=new T.Vector3();let pickHit=-1;
  const down=(e:PointerEvent)=>{hover.hidden=true;tap.down(e.pointerId,e.clientX,e.clientY,e.pointerType==='touch'?12:5);};
  const move=(e:PointerEvent)=>{tap.move(e.pointerId,e.clientX,e.clientY);if(e.buttons||amount<.5||e.pointerType==='touch'){hover.hidden=true;return;}const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,index=findTarget(x,y,12);hover.hidden=index<0;renderer.domElement.style.cursor=index<0?'grab':'pointer';if(index>=0){hover.textContent=atlas.parts[index].name;hover.style.left=`${Math.max(8,Math.min(x+14,el.clientWidth-260))}px`;hover.style.top=`${Math.max(8,Math.min(y+18,el.clientHeight-55))}px`;}};
  const cancel=(e:PointerEvent)=>tap.cancel(e.pointerId);
  const pickAt=(clientX:number,clientY:number,touch:boolean)=>{
   const rect=renderer.domElement.getBoundingClientRect();pointer.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
   let nearest=Infinity,found=-1;const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);
   pickers.forEach((mesh,i)=>{if(!mesh||data[i*4+3]<.5||(hasSolid&&atlas.parts[i].system==='integumentary'))return;worldBox.copy(bounds[i]).translate(mesh.position);if(!raycaster.ray.intersectBox(worldBox,hitPoint))return;const hits=raycaster.intersectObject(mesh,false);if(hits[0]&&hits[0].distance<nearest){nearest=hits[0].distance;found=i;pickPoint.copy(hits[0].point);}});
   pickHit=found;if(found<0&&amount>.45)found=findTarget(clientX-rect.left,clientY-rect.top,touch?24:16);return found;
  };
  const up=(e:PointerEvent)=>{
   const validTap=tap.up(e.pointerId,e.clientX,e.clientY);if(!validTap||!ready)return;const found=pickAt(e.clientX,e.clientY,e.pointerType==='touch');
   // Marker mode only accepts a real surface hit, stored relative to the piece's current explode offset.
   if(latest.current.placing){if(pickHit>=0){pickPoint.sub(pickers[pickHit]!.position);addPoint.current(atlas.parts[pickHit].id,[pickPoint.x,pickPoint.y,pickPoint.z]);}return;}
   if(found>=0){hover.hidden=true;select.current(atlas.parts[found].id,false);}
  };
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',cancel);
  // Shift gestures are claimed before OrbitControls, which would otherwise pan on Shift-drag.
  const marquee=document.createElement('div');marquee.className='scene-marquee';marquee.hidden=true;el.appendChild(marquee);
  let box:{id:number;x:number;y:number;left:number;top:number;right:number;bottom:number}|null=null;const shifted=new T.Vector3();
  const boxDown=(e:PointerEvent)=>{
   if(!e.shiftKey||e.button!==0||!ready||e.target!==renderer.domElement)return;e.stopPropagation();e.preventDefault();hover.hidden=true;
   const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;box={id:e.pointerId,x,y,left:x,top:y,right:x,bottom:y};try{el.setPointerCapture(e.pointerId);}catch{/* Capture is optional; listeners on the host still finish the box. */}
  };
  const boxMove=(e:PointerEvent)=>{
   if(!box||e.pointerId!==box.id)return;const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
   box.left=Math.min(box.x,x);box.right=Math.max(box.x,x);box.top=Math.min(box.y,y);box.bottom=Math.max(box.y,y);
   marquee.hidden=box.right-box.left<4&&box.bottom-box.top<4;Object.assign(marquee.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.right-box.left}px`,height:`${box.bottom-box.top}px`});
  };
  const boxUp=(e:PointerEvent)=>{
   if(!box||e.pointerId!==box.id)return;boxMove(e);const b=box;box=null;marquee.hidden=true;if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
   if(b.right-b.left<5&&b.bottom-b.top<5){const found=pickAt(e.clientX,e.clientY,e.pointerType==='touch');if(found>=0)select.current(atlas.parts[found].id,true);else clearSelect.current();return;}
   const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5),ids:string[]=[];
   atlas.parts.forEach((p,i)=>{if(data[i*4+3]<.5||(hasSolid&&p.system==='integumentary'))return;projected.copy(centers[i]).add(shifted.set(data[i*4],data[i*4+1],data[i*4+2])).project(camera);if(projected.z< -1||projected.z>1)return;const x=(projected.x+1)*el.clientWidth/2,y=(1-projected.y)*el.clientHeight/2;if(x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom)ids.push(p.id);});
   if(ids.length)boxSelect.current(ids);
  };
  const boxCancel=(e:PointerEvent)=>{if(box&&e.pointerId===box.id){box=null;marquee.hidden=true;}};
  const shiftKey=(e:KeyboardEvent)=>el.classList.toggle('box-select',e.shiftKey),shiftOff=()=>el.classList.remove('box-select');
  el.addEventListener('pointerdown',boxDown,{capture:true});el.addEventListener('pointermove',boxMove);el.addEventListener('pointerup',boxUp);el.addEventListener('pointercancel',boxCancel);
  window.addEventListener('keydown',shiftKey);window.addEventListener('keyup',shiftKey);window.addEventListener('blur',shiftOff);
  // Group labels sit in columns in the free margins beside the open panels, each joined to its structure by a leader line.
  const SVG='http://www.w3.org/2000/svg',lineLayer=document.createElementNS(SVG,'svg');lineLayer.classList.add('group-lines');el.appendChild(lineLayer);
  interface Tag {tag:HTMLButtonElement;swatch:HTMLSpanElement;name:HTMLSpanElement;line:SVGPolylineElement;dot:SVGCircleElement;width:number;height:number}
  const tags=new Map<string,Tag>(),partIndex=new Map(atlas.parts.map((p,i)=>[p.id,i])),anchor=new T.Vector3(),mean=new T.Vector3();let lastLabels:SceneState['labels']|null=null;
  const hideTag=(t:Tag)=>{t.tag.hidden=true;t.line.style.display='none';t.dot.style.display='none';};
  const syncLabels=(labels:SceneLabel[])=>{
   const ids=new Set(labels.map(l=>l.id));tags.forEach((t,id)=>{if(!ids.has(id)){t.tag.remove();t.line.remove();t.dot.remove();tags.delete(id);}});
   for(const l of labels){
    let t=tags.get(l.id);
    if(!t){const tag=document.createElement('button'),swatch=document.createElement('span'),name=document.createElement('span'),line=document.createElementNS(SVG,'polyline'),dot=document.createElementNS(SVG,'circle');tag.type='button';tag.className='group-tag';tag.hidden=true;swatch.className='group-tag-swatch';name.className='group-tag-name';tag.appendChild(swatch);tag.appendChild(name);tag.addEventListener('click',()=>labelClick.current(l.id));el.appendChild(tag);dot.setAttribute('r','3.5');lineLayer.appendChild(line);lineLayer.appendChild(dot);t={tag,swatch,name,line,dot,width:0,height:0};tags.set(l.id,t);}
    const color=l.colors[0]??'#263b48';t.name.textContent=l.name;t.width=0;t.swatch.style.background=stripes(l.colors);t.tag.setAttribute('aria-label',`Show ${l.name}`);t.line.setAttribute('stroke',color);t.dot.setAttribute('fill',color);
   }
  };
  const SIDE_UI=['.layers-panel','.search-panel','.detail-sheet','.view-controls'],EDGE_UI=['.identity','.top-actions','.bottom-dock'];
  const layoutLabels=(labels:SceneLabel[])=>{
   const w=el.clientWidth,h=el.clientHeight,hostBox=el.getBoundingClientRect();projected.copy(controls.target).project(camera);const middle=(projected.x+1)*w/2;
   const placed:{t:Tag;x:number;y:number;side:number;ty:number}[]=[];
   for(const l of labels){
    const t=tags.get(l.id);if(!t)continue;
    // A visible chosen anchor (piece or point) wins; otherwise pieces anchor the label, and a group without visible pieces anchors at its first visible point.
    const shown=(i:number|undefined):i is number=>i!==undefined&&!!pickers[i]&&data[i*4+3]>.5;
    const chosenPoint=l.anchor?.startsWith('point:')?l.points?.[Number(l.anchor.slice(6))]:undefined,pinned=chosenPoint&&shown(partIndex.get(chosenPoint.part))?chosenPoint:undefined,fixed=l.anchor&&!chosenPoint?partIndex.get(l.anchor):undefined;
    const indices=l.parts.map(id=>partIndex.get(id)).filter(shown),point=pinned??(indices.length?undefined:l.points?.find(p=>shown(partIndex.get(p.part))));if(!indices.length&&!point){hideTag(t);continue;}
    const at=(i:number)=>anchor.copy(centers[i]).add(shifted.set(data[i*4],data[i*4+1],data[i*4+2]));
    if(point){const i=partIndex.get(point.part)!;anchor.fromArray(point.at).add(shifted.set(data[i*4],data[i*4+1],data[i*4+2]));}
    else if(shown(fixed))at(fixed);
    else{mean.set(0,0,0);indices.forEach(i=>mean.add(at(i)));mean.divideScalar(indices.length);
     let best=indices[0],nearest=Infinity;indices.forEach(i=>{const d=at(i).distanceToSquared(mean);if(d<nearest){nearest=d;best=i;}});at(best);}
    anchor.project(camera);const x=(anchor.x+1)*w/2,y=(1-anchor.y)*h/2;
    if(anchor.z< -1||anchor.z>1||x<0||x>w||y<0||y>h){hideTag(t);continue;}
    t.tag.hidden=false;if(!t.width){t.tag.style.left='0px';t.width=t.tag.offsetWidth;t.height=t.tag.offsetHeight;}placed.push({t,x,y,side:x<middle?-1:1,ty:y});
   }
   if(!placed.length)return;
   // Tags sit just outside the body silhouette on the anchor's side: 80-160 px from the anchor, never closer than 44 px, and 16 px short of an open side panel.
   const rects=(list:string[])=>list.flatMap(s=>[...document.querySelectorAll<HTMLElement>(s)]).filter(n=>getComputedStyle(n).visibility!=='hidden').map(n=>n.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0).map(r=>({left:r.left-hostBox.left,right:r.right-hostBox.left,top:r.top-hostBox.top,bottom:r.bottom-hostBox.top}));
   const sideUi=rects(SIDE_UI),edgeUi=[...rects(EDGE_UI),...sideUi.filter(r=>r.right-r.left>w*.6)];let inL=16,inR=w-16;
   for(const r of sideUi)if(r.right-r.left<=w*.6){if((r.left+r.right)/2<w/2)inL=Math.max(inL,r.right+16);else inR=Math.min(inR,r.left-16);}
   const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5),body:{l:number;r:number;t:number;b:number}[]=[];
   atlas.parts.forEach((p,i)=>{if(!pickers[i]||data[i*4+3]<.5||(hasSolid&&p.system==='integumentary'))return;let l=Infinity,r=-Infinity,t=Infinity,b=-Infinity;for(let c=0;c<8;c++){projected.set(p.bounds[c&1?1:0][0]+data[i*4],p.bounds[c&2?1:0][1]+data[i*4+1],p.bounds[c&4?1:0][2]+data[i*4+2]).project(camera);if(projected.z>1)return;const x=(projected.x+1)*w/2,y=(1-projected.y)*h/2;l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);}body.push({l,r,t,b});});
   for(const s of [-1,1]){
    const group=placed.filter(p=>p.side===s).sort((a,b)=>a.y-b.y);if(!group.length)continue;
    const reach=160+Math.max(...group.map(p=>p.t.width)),a=s<0?Math.min(...group.map(p=>p.x))-reach:Math.min(...group.map(p=>p.x)),b=s<0?Math.max(...group.map(p=>p.x)):Math.max(...group.map(p=>p.x))+reach;
    let top=24,bottom=h-24;for(const r of edgeUi)if(r.right>a&&r.left<b){if((r.top+r.bottom)/2<h/2)top=Math.max(top,r.bottom+16);else bottom=Math.min(bottom,r.top-16);}
    // Tags may wrap, so each one is spaced by its measured height plus up to 6 px, tightened when the column is short.
    const heights=group.reduce((sum,p)=>sum+p.t.height,0),gap=group.length>1?T.MathUtils.clamp((bottom-top-heights)/(group.length-1),0,6):6;
    let prev=-Infinity,half=0;for(const p of group){const h2=p.t.height/2;p.ty=Math.max(p.y,top+h2,prev+half+gap+h2);prev=p.ty;half=h2;}const overflow=prev+half-bottom;if(overflow>0)group.forEach(p=>p.ty-=overflow);
    for(const p of group){
     const y0=Math.min(p.y,p.ty)-14,y1=Math.max(p.y,p.ty)+14;let edge=p.x;for(const r of body)if(r.b>y0&&r.t<y1)edge=s<0?Math.min(edge,r.l):Math.max(edge,r.r);
     const d=Math.max(44,Math.min(T.MathUtils.clamp(Math.abs(edge-p.x)+20,80,160),s<0?p.x-inL-p.t.width:inR-p.t.width-p.x)),end=p.x+s*d,elbow=end-s*18;
     p.t.line.style.display='';p.t.dot.style.display='';p.t.tag.classList.toggle('to-left',s<0);
     p.t.tag.style.left=`${end}px`;p.t.tag.style.top=`${p.ty}px`;p.t.line.setAttribute('points',`${p.x},${p.y} ${elbow},${p.ty} ${end},${p.ty}`);p.t.dot.setAttribute('cx',String(p.x));p.t.dot.setAttribute('cy',String(p.y));
    }
   }
  };
  // Group point markers: shared spheres (back-face hull as an outline in the 2nd color) kept about 4.5 px wide on screen, never at less than 7 mm.
  const PIN=.0035,pinGeometry=new T.SphereGeometry(PIN,16,12),pins=new T.Group(),pinMaterials=new Map<string,T.Material>();scene.add(pins);
  let pinList:{mesh:T.Mesh;index:number;at:T.Vector3}[]=[],lastPoints:SceneState['points']|null=null,lastPlacing=false;
  const pinMaterial=(hex:string,back:boolean)=>{const k=hex+back;let m=pinMaterials.get(k);if(!m){m=new T.MeshBasicMaterial({color:hex,side:back?T.BackSide:T.FrontSide});pinMaterials.set(k,m);}return m;};
  const syncPins=(points:NonNullable<SceneState['points']>)=>{
   pins.clear();pinList=[];
   for(const p of points){const index=partIndex.get(p.part);if(index===undefined)continue;const colors=p.colors?.length?p.colors:['#263b48'],mesh=new T.Mesh(pinGeometry,pinMaterial(colors[0],false)),hull=new T.Mesh(pinGeometry,pinMaterial(colors[1]??'#ffffff',true));hull.scale.setScalar(1.45);mesh.add(hull);pins.add(mesh);pinList.push({mesh,index,at:new T.Vector3().fromArray(p.at)});}
  };
  const placePins=()=>pinList.forEach(({mesh,index:i,at})=>{mesh.visible=!!pickers[i]&&data[i*4+3]>.5;mesh.position.copy(at).add(shifted.set(data[i*4],data[i*4+1],data[i*4+2]));});
  const scalePins=()=>{const k=2*Math.tan(T.MathUtils.degToRad(camera.fov/2))/Math.max(1,el.clientHeight)*2.25/PIN;pinList.forEach(({mesh})=>mesh.scale.setScalar(Math.max(1,camera.position.distanceTo(mesh.position)*k)));};
  // One still of the rendered view (2× pixel ratio, long side capped near 4096) plus leader lines and tags. The live buffer is always restored.
  const viewSize=new T.Vector2();
  const roundPath=(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number)=>{const radius=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+radius,y);ctx.arcTo(x+w,y,x+w,y+h,radius);ctx.arcTo(x+w,y+h,x,y+h,radius);ctx.arcTo(x,y+h,x,y,radius);ctx.arcTo(x,y,x+w,y,radius);ctx.closePath();};
  const exportImage=()=>{
   const glCanvas=renderer.domElement;if(!glCanvas?.width)return;
   renderer.getSize(viewSize);const ratio=renderer.getPixelRatio(),savedW=viewSize.x,savedH=viewSize.y,cssW=el.clientWidth,cssH=el.clientHeight;if(!cssW||!cssH)return;
   let exportRatio=ratio*2;const long=Math.max(cssW,cssH);if(long*exportRatio>4096)exportRatio=4096/long;
   try{
    renderer.setPixelRatio(exportRatio);renderer.setSize(cssW,cssH,false);scalePins();renderer.render(scene,camera);
    const out=document.createElement('canvas');out.width=glCanvas.width;out.height=glCanvas.height;const ctx=out.getContext('2d');if(!ctx||glCanvas.width<2)return;
    ctx.drawImage(glCanvas,0,0);const scale=glCanvas.width/cssW;ctx.setTransform(scale,0,0,scale,0,0);ctx.lineJoin='round';
    lineLayer.querySelectorAll('polyline').forEach(line=>{
     if(line.style.display==='none')return;const pts=line.getAttribute('points')?.trim().split(/\s+/)??[];if(pts.length<2)return;
     ctx.beginPath();pts.forEach((p,i)=>{const [x,y]=p.split(',').map(Number);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle=line.getAttribute('stroke')||'#263b48';ctx.lineWidth=1.5;ctx.stroke();
    });
    lineLayer.querySelectorAll('circle').forEach(dot=>{
     if(dot.style.display==='none')return;const cx=+(dot.getAttribute('cx')??NaN),cy=+(dot.getAttribute('cy')??NaN);if(!Number.isFinite(cx)||!Number.isFinite(cy))return;
     ctx.beginPath();ctx.arc(cx,cy,+(dot.getAttribute('r')??3.5),0,Math.PI*2);ctx.fillStyle=dot.getAttribute('fill')||'#263b48';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
    });
    const hostBox=el.getBoundingClientRect();
    tags.forEach(t=>{
     if(t.tag.hidden)return;const box=t.tag.getBoundingClientRect();if(box.width<1||box.height<1)return;
     const x=box.left-hostBox.left,y=box.top-hostBox.top,w=box.width,h=box.height,cs=getComputedStyle(t.tag);
     ctx.save();ctx.shadowColor='rgba(24,37,54,.07)';ctx.shadowBlur=8;ctx.shadowOffsetY=2;roundPath(ctx,x,y,w,h,8);
     const fill=cs.backgroundColor;ctx.fillStyle=!fill||fill==='rgba(0, 0, 0, 0)'?'rgba(255,255,255,.92)':fill;ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
     ctx.strokeStyle=cs.borderTopColor;ctx.lineWidth=parseFloat(cs.borderTopWidth)||1;ctx.stroke();
     const sw=t.swatch.getBoundingClientRect(),sx=sw.left-hostBox.left,sy=sw.top-hostBox.top,sww=sw.width,swh=sw.height,raw=t.swatch.style.background,hex=[...raw.matchAll(/#[0-9a-fA-F]{6}/g)].map(m=>m[0]);
     roundPath(ctx,sx,sy,sww,swh,3);ctx.clip();
     if(raw.includes('linear-gradient')&&hex.length>1){const g=ctx.createLinearGradient(sx,sy,sx+sww,sy+swh);hex.forEach((c,i)=>{const a=i/hex.length,b=(i+1)/hex.length;g.addColorStop(a,c);g.addColorStop(b,c);});ctx.fillStyle=g;}
     else ctx.fillStyle=hex[0]||getComputedStyle(t.swatch).backgroundColor;
     ctx.fillRect(sx,sy,sww,swh);ctx.restore();
     roundPath(ctx,sx,sy,sww,swh,3);ctx.strokeStyle='rgba(24,37,54,.13)';ctx.lineWidth=1;ctx.stroke();
     const name=t.name,node=name.firstChild,text=node?.nodeType===3?node.textContent:null;ctx.fillStyle=getComputedStyle(name).color;ctx.font=getComputedStyle(name).font;ctx.textBaseline='top';
     if(node&&text){const range=document.createRange();let run='',runLeft=0,runTop=0,open=false;const flush=()=>{if(open&&run)ctx.fillText(run,runLeft-hostBox.left,runTop-hostBox.top);run='';open=false;};
      for(let i=0;i<text.length;i++){range.setStart(node,i);range.setEnd(node,i+1);const r=range.getBoundingClientRect();if(r.width<.01&&r.height<.01){run+=text[i];continue;}if(!open||Math.abs(r.top-runTop)>1){flush();run=text[i];runLeft=r.left;runTop=r.top;open=true;}else run+=text[i];}flush();}
    });
    ctx.setTransform(1,0,0,1,0,0);
    out.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='human-atlas.png';document.body.appendChild(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(url);},1500);},'image/png');
   }finally{renderer.setPixelRatio(ratio);renderer.setSize(savedW,savedH,false);renderer.render(scene,camera);}
  };
  const clock=new T.Clock();let lastExtent=-1;
  const animate=()=>{
   if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05),s=latest.current;
   if(s.layers!==lastLayers){
    layerData.fill(0);atlas.parts.forEach((p,i)=>{const list=s.layers?.[p.id]?.slice(0,MAX_LAYERS);if(!list?.length)return;list.forEach((hex,k)=>{const n=parseInt(hex.slice(1),16);layerData.set([(n>>16&255)/255,(n>>8&255)/255,(n&255)/255],(k*width+i)*4);});layerData.set([list.length,T.MathUtils.clamp(spans[i]/(list.length*2),.005,.045),centers[i].dot(stripeDir)],(MAX_LAYERS*width+i)*4);});
    layerTexture.needsUpdate=true;lastLayers=s.layers;dirty=true;
   }
   if(s.labels!==lastLabels){syncLabels(s.labels??[]);lastLabels=s.labels;dirty=true;}
   if(s.points!==lastPoints){syncPins(s.points??[]);placePins();lastPoints=s.points;dirty=true;}
   if(!!s.placing!==lastPlacing){lastPlacing=!!s.placing;el.classList.toggle('placing',lastPlacing);}
   const changed=lastState?.visible!==s.visible||lastState?.selected!==s.selected||lastState?.isolate!==s.isolate;
   const moving=Math.abs(amount-s.explode)>.0001;
   if(moving){amount=T.MathUtils.damp(amount,s.explode,8,dt);dirty=true;}
   if(changed||moving||lastExtent<0){
    const visible=new Set(s.visible),selection=new Set(s.selected);
    const visibleParts=atlas.parts.filter(p=>s.isolate?selection.has(p.id):visible.has(p.system)||selection.has(p.id));
    const nextLayoutKey=visibleParts.map(p=>p.id).join(',')+':'+camera.aspect.toFixed(3);
    if(nextLayoutKey!==layoutKey){const layout=createExplosionLayout(visibleParts,camera.aspect);packingWidth=layout.width;packingHeight=layout.height;atlas.parts.forEach((p,i)=>{const cell=layout.cells.get(p.id);offsets[i]=cell?new T.Vector3(cell.x,cell.y+.85,0):centers[i].clone();});layoutKey=nextLayoutKey;if(amount>.05&&!s.isolate)fit(s.view,Math.max(0,(amount-.3)/.7));}

    atlas.parts.forEach((p,i)=>{
     const c=centers[i],destination=offsets[i];let dx=0,dy=0,dz=0;
     if(amount<=.45){const t=amount/.45;const group=SYSTEMS.findIndex(sys=>sys.id===p.system);const angle=group/SYSTEMS.length*Math.PI*2;dx=Math.sin(angle)*t*.48;dy=(c.y-.85)*t*.28;dz=Math.cos(angle)*t*.48;}
     else {const t=(amount-.45)/.55,group=SYSTEMS.findIndex(sys=>sys.id===p.system),angle=group/SYSTEMS.length*Math.PI*2;dx=T.MathUtils.lerp(Math.sin(angle)*.48,destination.x-c.x,t);dy=T.MathUtils.lerp((c.y-.85)*.28,destination.y-c.y,t);dz=T.MathUtils.lerp(Math.cos(angle)*.48,-c.z,t);}
     const selected=selection.has(p.id);data.set([dx,dy,dz,(s.isolate?selected:visible.has(p.system)||selected)?1:0],i*4);selectedData[i*4]=selected?255:0;
     markerPositions.set(data[i*4+3]>.5?[c.x+dx,c.y+dy,c.z+dz]:[10000,10000,10000],i*3);const mesh=pickers[i];if(mesh){mesh.position.set(dx,dy,dz);mesh.updateMatrix();mesh.updateMatrixWorld(true);}
    });placePins();partTexture.needsUpdate=true;selectionTexture.needsUpdate=true;markerGeometry.attributes.position.needsUpdate=true;lastState=s;lastExtent=amount;dirty=true;
   }
   if(s.view!==lastView||s.reset!==lastReset){fit(s.view,amount);lastView=s.view;lastReset=s.reset;}
   if(moving&&!s.isolate)fit(amount>.5?'front':s.view,Math.max(0,(amount-.3)/.7));
   const isolateKey=s.isolate?s.selected.join(',')+':'+s.reset+':'+s.inspectorOpen+':'+camera.aspect:'';
   if(isolateKey!==lastIsolate||(s.isolate&&moving)){
    if(s.isolate){const box=new T.Box3();atlas.parts.forEach((p,i)=>{if(s.selected.includes(p.id))box.union(bounds[i].clone().translate(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])));});
     if(!box.isEmpty()){const center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());const w=el.clientWidth,h=el.clientHeight,mobile=w<768,landscape=w>h&&h<=600;let left=20,right=w-20,top=mobile?175:110,bottom=h-170;if(s.inspectorOpen){if(landscape){right=w-335;top=100;bottom=h-125;}else if(mobile){const sheet=document.querySelector('.detail-sheet')?.getBoundingClientRect(),header=document.querySelector('.identity')?.getBoundingClientRect();top=(header?.bottom??94)+16;bottom=(sheet?.top??h*.58-139)-16;}else{right=w-370;left=w>1100?285:25;}}const availableWidth=Math.max(150,right-left),availableHeight=Math.max(40,bottom-top);camera.setViewOffset(w,h,w/2-(left+right)/2,h/2-(top+bottom)/2,w,h);const distance=Math.max(.07,Math.max(size.y*h/availableHeight,size.x*w/availableWidth/camera.aspect,size.z)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))*1.35);controls.maxDistance=Math.max(40,distance*2);controls.target.copy(center);camera.position.copy(center).add(new T.Vector3(.2,.1,1).normalize().multiplyScalar(distance));controls.update();dirty=true;}
    }else if(lastIsolate){camera.clearViewOffset();fit(s.view,amount);}
    lastIsolate=isolateKey;
   }
   controls.enableRotate=amount<.8;controls.mouseButtons.LEFT=amount<.8?T.MOUSE.ROTATE:T.MOUSE.PAN;controls.touches.ONE=amount<.8?T.TOUCH.ROTATE:T.TOUCH.PAN;ground.visible=platform.visible=ring.visible=innerRing.visible=amount<.5&&!s.isolate;markers.visible=amount>.75;controls.autoRotate=s.rotate&&!s.isolate&&amount<.4;controls.autoRotateSpeed=.65;controls.update();if(controls.autoRotate)dirty=true;
   if(dirty){scalePins();renderer.render(scene,camera);targets=[];if(amount>.45){const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);atlas.parts.forEach((p,i)=>{if(data[i*4+3]<.5||(hasSolid&&p.system==='integumentary'))return;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;for(let corner=0;corner<8;corner++){projected.set(p.bounds[(corner&1)?1:0][0]+data[i*4],p.bounds[(corner&2)?1:0][1]+data[i*4+1],p.bounds[(corner&4)?1:0][2]+data[i*4+2]).project(camera);const x=(projected.x+1)*el.clientWidth/2,y=(1-projected.y)*el.clientHeight/2;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}projected.copy(centers[i]).add(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])).project(camera);if(projected.z< -1||projected.z>1)return;targets.push({index:i,x:(projected.x+1)*el.clientWidth/2,y:(1-projected.y)*el.clientHeight/2,left,right,top,bottom});});}layoutLabels(s.labels??[]);dirty=false;}
   if(s.shot!==lastShot&&renderer.domElement.width){const n=s.shot;lastShot=n;if(n)exportImage();}
  };animate();
  const contextLost=(e:Event)=>{e.preventDefault();onError('The 3D session was paused by your device. Reload to continue.');};renderer.domElement.addEventListener('webglcontextlost',contextLost);
  return()=>{disposed=true;abort.abort();cancelAnimationFrame(frame);observer.disconnect();controls.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());scene.traverse(o=>{if(o instanceof T.Mesh&&!geometries.includes(o.geometry)){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});env.dispose();partTexture.dispose();selectionTexture.dispose();layerTexture.dispose();markerGeometry.dispose();markerMaterial.dispose();pinGeometry.dispose();pinMaterials.forEach(m=>m.dispose());el.classList.remove('placing');hover.remove();marquee.remove();lineLayer.remove();tags.forEach(t=>t.tag.remove());el.removeEventListener('pointerdown',boxDown,{capture:true});el.removeEventListener('pointermove',boxMove);el.removeEventListener('pointerup',boxUp);el.removeEventListener('pointercancel',boxCancel);window.removeEventListener('keydown',shiftKey);window.removeEventListener('keyup',shiftKey);window.removeEventListener('blur',shiftOff);shiftOff();renderer.dispose();renderer.domElement.remove();};
 },[atlas]);
 return <div className="scene" ref={host}/>;
}
