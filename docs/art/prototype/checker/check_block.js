
// ---- the checker: measures each card instead of eyeballing it ----
const CW=248,CH=272;const PAL=[[255,0,0],[0,255,0],[0,0,255],[255,255,0],[255,0,255],[0,255,255],[255,128,0],[128,0,255],[255,255,255]];
function idRender(scene,cam,colorOf,onlyTargets){const saved=[],sky=[];
  scene.traverse(m=>{if(m.isPoints||(m.isMesh&&m.geometry.type==="SphereGeometry"&&m.geometry.parameters.radius>2000)){sky.push([m,m.visible]);return}
    if(m.isMesh){saved.push([m,m.material,m.visible,m.onBeforeRender]);const c=colorOf(m);m.onBeforeRender=()=>{};
      if(c===null){m.material=new THREE.MeshBasicMaterial({color:0x000000});if(onlyTargets)m.visible=false}
      else{m.material=new THREE.MeshBasicMaterial({color:new THREE.Color(c[0]/255,c[1]/255,c[2]/255)});m.visible=true}}});
  for(const [m] of sky)m.visible=false;
  const lights=[];scene.traverse(m=>{if(m.isLight)lights.push(m)});
  const fog=scene.fog;scene.fog=null;const tm=renderer.toneMapping;renderer.toneMapping=THREE.NoToneMapping;
  const rt=new THREE.WebGLRenderTarget(CW,CH);renderer.setRenderTarget(rt);renderer.setClearColor(0x000000,1);renderer.clear();renderer.render(scene,cam);
  const px=new Uint8Array(CW*CH*4);renderer.readRenderTargetPixels(rt,0,0,CW,CH,px);renderer.setRenderTarget(null);rt.dispose();renderer.toneMapping=tm;scene.fog=fog;
  for(const [m,mat,v,obr] of saved){m.material=mat;m.visible=v;m.onBeforeRender=obr}for(const [m,v] of sky)m.visible=v;
  const counts=new Array(PAL.length).fill(0);
  for(let i=0;i<CW*CH;i++){const r=px[i*4],g=px[i*4+1],b=px[i*4+2];if(r+g+b<40)continue;let best=-1,bd=1e9;PAL.forEach((c,k)=>{const d=Math.abs(c[0]-r)+Math.abs(c[1]-g)+Math.abs(c[2]-b);if(d<bd){bd=d;best=k}});if(bd<70)counts[best]++}
  return counts}
function ownerIndex(m,targets){let o=m;while(o){const k=targets.indexOf(o);if(k>=0)return k;o=o.parent}return -1}
async function runChecks(o,scene,cam,placed,spot,cv,skyline){
  const items=placed.filter(p=>p.obj),targets=items.map(p=>p.obj),water=scene.children.find(c=>c.isWater);
  const all=idRender(scene,cam,m=>{if(m===water)return PAL[8];const k=ownerIndex(m,targets);return k>=0?PAL[k]:null},false);
  const res={name:o.name,flags:[],items:[],entry:o.G.entry,head:o.G.head};
  items.forEach((p,k)=>{const alone=idRender(scene,cam,m=>ownerIndex(m,targets)===k?PAL[k]:null,true)[k],seen=all[k];
    const label=p.kind+(p.lm&&p.lm.status!=="active"?"("+p.lm.status+")":"");
    const v=new THREE.Vector3();new THREE.Box3().setFromObject(p.obj).getCenter(v);v.project(cam);const inFrame=Math.abs(v.x)<0.93&&Math.abs(v.y)<0.93;
    const frac=alone?seen/alone:0;res.items.push([label,alone,+frac.toFixed(2),inFrame]);
    if(p.lm&&p.lm.status==="revoked")return;
    if(!inFrame||alone===0)res.flags.push(label+" off card");else if(frac<0.5)res.flags.push(label+" "+Math.round((1-frac)*100)+"% hidden");else if(alone<14)res.flags.push(label+" tiny")});
  const wf=all[8]/(CW*CH);res.water=+wf.toFixed(3);if(wf<0.03)res.flags.push("little water "+(wf*100).toFixed(1)+"%");
  res.constellation=spot?+(spot.w/140).toFixed(2):0;if(!spot)res.flags.push("no room for constellation");else if(spot.w<140*0.6)res.flags.push("constellation squeezed");
  res.skyTop=Math.min(...skyline.slice(20,380));
  const small=document.createElement("canvas");small.width=400;small.height=600;const sg=small.getContext("2d");sg.drawImage(cv,0,0,400,600);sg.font="600 15px Helvetica";let y=505;
  if(res.flags.length){sg.fillStyle="rgba(180,30,30,.93)";sg.fillRect(0,488,400,112);sg.fillStyle="#fff";for(const f of res.flags.slice(0,5)){sg.fillText(f,14,y+8);y+=20}}
  else{sg.fillStyle="rgba(17,59,49,.93)";sg.fillRect(0,488,400,112);sg.fillStyle="#18dccb";sg.fillText("all checks pass",14,y+8)}
  res.thumb=small.toDataURL("image/jpeg",0.82);return res}
