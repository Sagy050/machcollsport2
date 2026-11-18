(function(){
/* House points arrive from site.js through window.sdPoints([...]) so the runners speed up for the leading house.
   site.js also calls window.sdResult(colour) when a new result lands (fireworks) and window.sdIntro() on the landing page (camera fly-in). */
var H=[{p:0},{p:0},{p:0},{p:0}];window.sdPoints=function(a){for(var i=0;i<4;i++)H[i].p=+a[i]||0};
/* 3D: realistic stadium scene */
var cv=document.getElementById("stage");
if(!window.THREE){return}
var PI=Math.PI,r;try{r=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true})}catch(e){return}
r.setPixelRatio(Math.min(devicePixelRatio,1.5));r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;
var sc=new THREE.Scene(),cam=new THREE.PerspectiveCamera(45,1,.1,700);
sc.fog=new THREE.Fog(0xdcc3a6,90,300);
sc.add(new THREE.HemisphereLight(0xcfe0ff,0x6a7a50,.8));
var dl=new THREE.DirectionalLight(0xffe0b0,1.05);dl.position.set(-60,45,25);dl.castShadow=true;dl.shadow.mapSize.set(2048,2048);
var sh=dl.shadow.camera;sh.left=-62;sh.right=62;sh.top=62;sh.bottom=-62;sh.near=1;sh.far=220;sh.updateProjectionMatrix();dl.shadow.bias=-.0004;sc.add(dl);
function noise(base,vr,n,rep){var c=document.createElement("canvas");c.width=c.height=256;var x=c.getContext("2d");x.fillStyle=base;x.fillRect(0,0,256,256);
  for(var i=0;i<n;i++){var v=(Math.random()-.5)*vr;x.fillStyle=v>0?"rgba(255,255,255,"+v/255+")":"rgba(0,0,0,"+-v/255+")";x.fillRect(Math.random()*256,Math.random()*256,2,2)}
  var t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rep,rep);return t}
function mat(c,ro,map){return new THREE.MeshStandardMaterial({color:c,roughness:ro||.8,map:map||null,side:THREE.DoubleSide})}
var W=new THREE.Group();sc.add(W);
function ms(m,x,y,z,cast){m.position.set(x,y,z);m.receiveShadow=true;m.castShadow=!!cast;W.add(m);return m}
function bx(w,h,d,c,x,y,z,map){return ms(new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(c,.85,map)),x,y,z,true)}
/* sky dome, hills, clouds */
var sun=new THREE.Vector3(-60,45,25).normalize();
sc.add(new THREE.Mesh(new THREE.SphereGeometry(500,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:{uSun:{value:sun}},
  vertexShader:"varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
  fragmentShader:"varying vec3 vP;uniform vec3 uSun;void main(){float h=clamp(vP.y,0.,1.);vec3 col=mix(vec3(.95,.76,.58),vec3(.5,.68,.92),smoothstep(0.,.22,h));col=mix(col,vec3(.12,.3,.62),smoothstep(.2,.85,h));float s=max(dot(vP,uSun),0.);col+=vec3(1.,.82,.55)*(pow(s,500.)*2.5+pow(s,10.)*.3);gl_FragColor=vec4(col,1.);}"})));
function ridge(z,col,h,seed){var g=new THREE.PlaneGeometry(420,h,120,1),p=g.attributes.position;
  for(var i=0;i<p.count;i++)if(p.getY(i)>0){var x=p.getX(i);p.setY(i,h/2+(Math.sin(x*.05+seed)+Math.sin(x*.02+seed*2)*1.7+Math.sin(x*.12+seed)*.35)*h*.16)}
  var m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:col,fog:false}));m.position.set(0,h/2-2,z);sc.add(m)}
ridge(-200,0xb7a8a6,46,1);ridge(-160,0x8f90a3,38,4);ridge(-125,0x66728c,28,9);
function glow(rad,a){var c=document.createElement("canvas");c.width=c.height=128;var x=c.getContext("2d"),g=x.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,"rgba(255,255,255,"+a+")");g.addColorStop(1,"rgba(255,255,255,0)");x.fillStyle=g;x.fillRect(0,0,128,128);return new THREE.CanvasTexture(c)}
var cloudT=(function(){var c=document.createElement("canvas");c.width=256;c.height=128;var x=c.getContext("2d");for(var i=0;i<10;i++){var cx=40+Math.random()*176,cy=50+Math.random()*30,rr=24+Math.random()*26,g=x.createRadialGradient(cx,cy,0,cx,cy,rr);g.addColorStop(0,"rgba(255,255,255,.55)");g.addColorStop(1,"rgba(255,255,255,0)");x.fillStyle=g;x.fillRect(0,0,256,128)}return new THREE.CanvasTexture(c)})();
var clouds=[];for(var i=0;i<14;i++){var cs=new THREE.Sprite(new THREE.SpriteMaterial({map:cloudT,transparent:true,opacity:.85,depthWrite:false,fog:false}));cs.position.set(Math.random()*500-250,75+Math.random()*40,-Math.random()*260-40);cs.scale.set(90+Math.random()*80,36+Math.random()*20,1);sc.add(cs);clouds.push(cs)}
var gd=new THREE.Mesh(new THREE.CircleGeometry(260,64),mat(0xffffff,1,noise("#436f3c",70,9000,90)));gd.rotation.x=-PI/2;gd.position.y=-.05;gd.receiveShadow=true;sc.add(gd);
/* trees */
var NT=70,tr=new THREE.InstancedMesh(new THREE.CylinderGeometry(.3,.4,3,6),mat(0x5a4130),NT),cr=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),mat(0xffffff,.9),NT),dm=new THREE.Object3D();
for(var i=0;i<NT;i++){var an=Math.random()*2*PI,rd=95+Math.random()*60,s=2.5+Math.random()*2;dm.position.set(Math.cos(an)*rd,1.5,Math.sin(an)*rd);dm.scale.set(1,1,1);dm.updateMatrix();tr.setMatrixAt(i,dm.matrix);
  dm.position.y=3+s*.8;dm.scale.set(s,s*1.1,s);dm.updateMatrix();cr.setMatrixAt(i,dm.matrix);cr.setColorAt(i,new THREE.Color().setHSL(.25+Math.random()*.06,.45,.22+Math.random()*.1))}
sc.add(tr,cr);
/* track */
var S=30,R=13,LW=.9,NL=6,tk=noise("#b9483a",70,7000,5);
function arc(a,b,cx,st,col,y,map){ms(new THREE.Mesh(new THREE.RingGeometry(a,b,48,1,st,PI),mat(col,.9,map)),cx,y,0).rotation.x=-PI/2}
function str(a,b,col,y,map){[1,-1].forEach(function(sg){ms(new THREE.Mesh(new THREE.PlaneGeometry(S,b-a),mat(col,.9,map)),0,y,sg*(a+b)/2).rotation.x=-PI/2})}
for(var i=0;i<NL;i++){var a=R-LW/2+i*LW,b=a+LW,col=i%2?0xe8d6d0:0xffffff;arc(a,b,S/2,-PI/2,col,.02,tk);arc(a,b,-S/2,PI/2,col,.02,tk);str(a,b,col,.02,tk)}
for(var i=0;i<=NL;i++){var q=R-LW/2+i*LW;arc(q-.03,q+.03,S/2,-PI/2,0xffffff,.035);arc(q-.03,q+.03,-S/2,PI/2,0xffffff,.035);str(q-.03,q+.03,0xffffff,.035)}
ms(new THREE.Mesh(new THREE.PlaneGeometry(.35,NL*LW),mat(0xffffff)),8,.04,R+NL*LW/2-LW/2).rotation.x=-PI/2;
var ir=R-LW/2-.02,gt=noise("#2f7d3a",60,7000,8);
[S/2,-S/2].forEach(function(x){ms(new THREE.Mesh(new THREE.CircleGeometry(ir,48),mat(0xffffff,1,gt)),x,.01,0).rotation.x=-PI/2});
ms(new THREE.Mesh(new THREE.PlaneGeometry(S,ir*2),mat(0xffffff,1,gt)),0,.01,0).rotation.x=-PI/2;
/* pitch */
var cp=document.createElement("canvas");cp.width=1024;cp.height=560;var c=cp.getContext("2d");
for(var i=0;i<12;i++){c.fillStyle=i%2?"#2e8a3e":"#3a9a4c";c.fillRect(i*1024/12,0,1024/12+1,560)}
for(var i=0;i<9000;i++){c.fillStyle=Math.random()>.5?"rgba(255,255,255,.07)":"rgba(0,0,0,.08)";c.fillRect(Math.random()*1024,Math.random()*560,2,3)}
c.strokeStyle="rgba(255,255,255,.92)";c.lineWidth=5;c.strokeRect(20,20,984,520);c.beginPath();c.moveTo(512,20);c.lineTo(512,540);c.stroke();c.beginPath();c.arc(512,280,70,0,2*PI);c.stroke();
c.strokeRect(20,150,150,260);c.strokeRect(854,150,150,260);c.strokeRect(20,215,55,130);c.strokeRect(949,215,55,130);
ms(new THREE.Mesh(new THREE.PlaneGeometry(40,22),new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(cp),roughness:.95})),0,.04,0).rotation.x=-PI/2;
[-20,20].forEach(function(x){bx(.1,1.6,.1,0xffffff,x,.8,-1.6);bx(.1,1.6,.1,0xffffff,x,.8,1.6);bx(.1,.1,3.3,0xffffff,x,1.6,0)});
/* main grandstand */
var sk=document.createElement("canvas");sk.width=sk.height=32;var sx=sk.getContext("2d");sx.fillStyle="#fff";sx.fillRect(0,0,32,32);sx.strokeStyle="rgba(0,0,0,.45)";sx.lineWidth=2;sx.strokeRect(1,1,30,30);sx.fillStyle="rgba(0,0,0,.18)";sx.fillRect(3,3,26,9);
function seat(w){var t=new THREE.CanvasTexture(sk);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(w/.8,2);return t}
var blk=[[9,0x1f6a50],[11,0x2d5fd0],[16,0xd0404a],[11,0x2d5fd0],[9,0x1f6a50]];
for(var k=0;k<7;k++){var x0=-28;blk.forEach(function(b){bx(b[0]-.1,(k+1)*1.1,1.9,b[1],x0+b[0]/2,(k+1)*.55,-(20.5+k*2+1),seat(b[0]));x0+=b[0]});bx(56,.06,.06,0xffffff,0,(k+1)*1.1+.45,-(20.5+k*2)-.05)}
bx(60,11,1,0xb8bcc4,0,5.5,-36.5,noise("#b8bcc4",50,2500,6));
var roof=bx(62,.5,19,0x1b3f9a,0,12.6,-29.5);roof.rotation.x=-.1;bx(62,1.6,.2,0x1b3f9a,0,11.9,-19.9);bx(60,.35,.35,0x3a4560,0,12,-26);bx(60,.35,.35,0x3a4560,0,12.2,-32);
[-27,-13.5,0,13.5,27].forEach(function(x){bx(.4,12.3,.4,0xf4f4f4,x,6.1,-20.3)});
for(var k=0;k<4;k++){bx(50,(k+1)*.9,1.7,0xe8ecf2,0,(k+1)*.45,21+k*1.8+.9,seat(50));bx(50,.05,.05,0xffffff,0,(k+1)*.9+.4,21+k*1.8+.05)}
/* crowd: detailed seated and cheering people */
var seats=[];
for(var k=0;k<7;k++)for(var rw=0;rw<2;rw++)for(var xx=-27.6;xx<27.7;xx+=.72)if(Math.random()>.18)seats.push([xx,(k+1)*1.1,-(20.5+k*2)-.5-rw*.9,0]);
for(var k=0;k<4;k++)for(var xx=-24.6;xx<24.7;xx+=.72)if(Math.random()>.5)seats.push([xx,(k+1)*.9,21+k*1.8+.9,PI]);
var NC=seats.length,pal=[0xffffff,0x1f4fd0,0x009543,0xffc233,0xff4d4d,0x3b82ff,0x2ec46a,0x222222,0xff7a1a,0x7a8696,0x8a2b3a,0x2b3a4a];
var skins=[0x8a5a3c,0x6b4430,0xa06a46,0x4a2f20,0x7a4e34,0x5b3a28],kits=[0x2ec46a,0x3b82ff,0xff4d4d,0xffc233],hairC=[0x15100e,0x2a1c14,0x0d0d0d,0x3a2a1c];
function inst(g,m,n){var im=new THREE.InstancedMesh(g,m,n);im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);W.add(im);return im}
var tg=new THREE.LatheGeometry([new THREE.Vector2(.12,0),new THREE.Vector2(.16,.2),new THREE.Vector2(.18,.38),new THREE.Vector2(.15,.5),new THREE.Vector2(.06,.56)],10);tg.scale(1,1,.62);
var hg=new THREE.SphereGeometry(.1,10,8);hg.scale(1,1.15,1.05);
var hrg=new THREE.SphereGeometry(.108,10,6,0,2*PI,0,PI*.55);hrg.scale(1,1.15,1.05);
var ag=new THREE.LatheGeometry([new THREE.Vector2(.034,0),new THREE.Vector2(.045,-.08),new THREE.Vector2(.036,-.22),new THREE.Vector2(.028,-.4)],8);
var hat=[],hp=[];for(var i=0;i<NC;i++){if(Math.random()<.32)hat.push(i);if(Math.random()<.12)hp.push(i)}
var cT=inst(tg,mat(0xffffff,.85),NC),cH=inst(hg,mat(0xffffff,.55),NC),cR=inst(hrg,mat(0xffffff,.9),NC),cA=inst(ag,mat(0xffffff,.55),NC),cB=inst(ag,mat(0xffffff,.55),NC),
  hT=inst(new THREE.CylinderGeometry(.09,.125,.09,10),mat(0xffffff,.9),hat.length),hB=inst(new THREE.CylinderGeometry(.19,.19,.012,12),mat(0xffffff,.9),hat.length),
  hpM=inst(new THREE.BoxGeometry(.05,.1,.012),new THREE.MeshBasicMaterial({color:0xcfe6ff}),hp.length),ph=[],bb=[],sx=[],sy=[],af=[],up=[],aa=[];
var hatC=[0x1f4fd0,0xffffff,0xf2d03b,0x2d5fd0];
for(var i=0;i<NC;i++){var sk=new THREE.Color(skins[Math.random()*6|0]);cT.setColorAt(i,new THREE.Color(pal[Math.random()*pal.length|0]));cH.setColorAt(i,sk);cA.setColorAt(i,sk);cB.setColorAt(i,sk);cR.setColorAt(i,new THREE.Color(hairC[Math.random()*4|0]));
  ph.push(Math.random()*6.3);bb.push(0);sx.push(.88+Math.random()*.26);sy.push(.92+Math.random()*.18);af.push(Math.random()<.28);up.push(0);aa.push(.12)}
for(var j=0;j<hat.length;j++){var hc=new THREE.Color(hatC[Math.random()*4|0]);hT.setColorAt(j,hc);hB.setColorAt(j,hc)}
var d2=new THREE.Object3D();
function crowd(T){for(var i=0;i<NC;i++){var s=seats[i],p=ph[i],u=Math.sin(s[0]*.21+s[2]*.04-T*2.3)>.62||Math.sin(T*.6+p*3)>.93,b=u?Math.abs(Math.sin(T*6+p))*.1:Math.sin(T*1.5+p)*.015,y=s[1]+.05+b,a=u?PI*.8+Math.sin(T*9+p)*.3:.12+Math.sin(T+p)*.05,w=sx[i],h=sy[i];bb[i]=b;up[i]=u;aa[i]=a;
    d2.scale.set(w,h,w);d2.rotation.set(0,s[3],0);d2.position.set(s[0],y,s[2]);d2.updateMatrix();cT.setMatrixAt(i,d2.matrix);
    d2.position.y=y+.66*h;d2.updateMatrix();cH.setMatrixAt(i,d2.matrix);
    if(af[i])d2.scale.set(1.45,1.35,1.45);d2.position.y=y+.675*h;d2.updateMatrix();cR.setMatrixAt(i,d2.matrix);
    d2.scale.set(1,h,1);d2.rotation.set(0,0,a);d2.position.set(s[0]+.2*w,y+.46*h,s[2]);d2.updateMatrix();cA.setMatrixAt(i,d2.matrix);
    d2.rotation.set(0,0,-a);d2.position.x=s[0]-.2*w;d2.updateMatrix();cB.setMatrixAt(i,d2.matrix)}
  d2.scale.set(1,1,1);d2.rotation.set(0,0,0);
  for(var j=0;j<hat.length;j++){var i2=hat[j],s2=seats[i2];d2.position.set(s2[0],s2[1]+.05+bb[i2]+.77*sy[i2],s2[2]);d2.updateMatrix();hT.setMatrixAt(j,d2.matrix);d2.position.y-=.05;d2.updateMatrix();hB.setMatrixAt(j,d2.matrix)}
  for(var j=0;j<hp.length;j++){var i3=hp[j],s3=seats[i3];if(up[i3])d2.position.set(s3[0]+.2+.42*Math.sin(aa[i3]),s3[1]+.05+bb[i3]+.46-.42*Math.cos(aa[i3]),s3[2]+.04);else d2.position.set(0,-50,0);d2.updateMatrix();hpM.setMatrixAt(j,d2.matrix)}
  [cT,cH,cR,cA,cB,hT,hB,hpM].forEach(function(m){m.instanceMatrix.needsUpdate=true})}
/* floodlights */
var gls=[],gl=glow(1,.9);
[[-38,-26],[38,-26],[-38,28],[38,28]].forEach(function(p){ms(new THREE.Mesh(new THREE.CylinderGeometry(.35,.5,24,8),mat(0x9fb0c9)),p[0],12,p[1],true);
  var h=ms(new THREE.Mesh(new THREE.BoxGeometry(4,2.6,.6),new THREE.MeshBasicMaterial({color:0xfff6d0})),p[0],24.6,p[1]);h.lookAt(0,10,0);
  var g=new THREE.Sprite(new THREE.SpriteMaterial({map:gl,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,fog:false}));g.position.set(p[0],24.6,p[1]);g.scale.set(16,16,1);W.add(g);gls.push(g)});
[[0,2,0xffc233],[-1.6,1.4,0xc0c8d8],[1.6,1,0xcd7f32]].forEach(function(p){bx(1.4,p[1],1.4,p[2],p[0],p[1]/2+.05,0)});
/* athletes */
function numTex(n,kit){var c=document.createElement("canvas");c.width=c.height=64;var x=c.getContext("2d");x.fillStyle="#"+("000000"+kit.toString(16)).slice(-6);x.fillRect(0,0,64,64);x.fillStyle="#fff";x.font="900 44px 'Big Shoulders Display',sans-serif";x.textAlign="center";x.textBaseline="middle";x.fillText(n,32,36);return new THREE.CanvasTexture(c)}
function lp2(p){return new THREE.LatheGeometry(p.map(function(q){return new THREE.Vector2(q[0],q[1])}),12)}
var gTh=lp2([[.05,0],[.075,-.04],[.088,-.15],[.08,-.3],[.062,-.43],[.056,-.46]]),gSh=lp2([[.054,0],[.06,-.05],[.066,-.14],[.052,-.3],[.04,-.43],[.037,-.46]]),
  gUp=lp2([[.034,0],[.046,-.08],[.042,-.18],[.034,-.3]]),gFo=lp2([[.034,0],[.038,-.05],[.03,-.2],[.025,-.27]]);
function limb(g1,g2,l1,l2,m,hand,kr){var a=new THREE.Group();a.add(new THREE.Mesh(g1,m));var k=new THREE.Group();k.position.y=-l1;a.add(k);
  k.add(new THREE.Mesh(new THREE.SphereGeometry(kr,10,8),m));k.add(new THREE.Mesh(g2,m));
  if(hand){var h=new THREE.Mesh(new THREE.SphereGeometry(.036,8,6),m);h.scale.set(.8,1.4,1);h.position.y=-l2-.02;k.add(h)}a.k=k;return a}
var an=0,lathe=new THREE.LatheGeometry([new THREE.Vector2(.12,0),new THREE.Vector2(.16,.2),new THREE.Vector2(.18,.38),new THREE.Vector2(.15,.5),new THREE.Vector2(.06,.56)],12);
var faceT=(function(){var c=document.createElement("canvas");c.width=128;c.height=112;var x=c.getContext("2d");x.fillStyle="#fff";[40,88].forEach(function(px){x.beginPath();x.ellipse(px,52,11,7,0,0,2*Math.PI);x.fill()});
  x.fillStyle="#2a1810";[40,88].forEach(function(px){x.beginPath();x.arc(px,52,5.5,0,2*Math.PI);x.fill()});x.fillRect(24,32,32,5);x.fillRect(72,32,32,5);x.fillStyle="rgba(70,25,25,.8)";x.fillRect(48,88,32,5);return new THREE.CanvasTexture(c)})();
var faceM=new THREE.MeshStandardMaterial({map:faceT,transparent:true,roughness:.8,depthWrite:false});
function skinM(c){var m=mat(c,.5);m.emissive=new THREE.Color(c).multiplyScalar(.1);return m}
function ath(kit,skin,hs){var g=new THREE.Group(),hip=new THREE.Group(),ms2=skinM(skin),mk=mat(kit,.7),md=mat(0x14224a,.7),mw=mat(0xf4f4f4,.7),mh=mat(hairC[Math.random()*4|0],.9);hip.position.y=.95;g.add(hip);
  var t=new THREE.Mesh(lathe,mk);t.scale.z=.62;hip.add(t);
  var nb=new THREE.Mesh(new THREE.PlaneGeometry(.2,.22),new THREE.MeshStandardMaterial({map:numTex(++an+10,kit),roughness:.8}));nb.position.set(0,.3,-.108);nb.rotation.y=PI;hip.add(nb);
  [-.19,.19].forEach(function(x){var s=new THREE.Mesh(new THREE.SphereGeometry(.065,10,8),ms2);s.position.set(x,.52,0);hip.add(s)});
  var sh=new THREE.Mesh(new THREE.CylinderGeometry(.16,.15,.22,12),md);sh.scale.z=.68;sh.position.y=-.04;hip.add(sh);
  var nk=new THREE.Mesh(new THREE.CylinderGeometry(.045,.052,.12,8),ms2);nk.position.y=.6;hip.add(nk);
  var hd=new THREE.Mesh(new THREE.SphereGeometry(.1,14,12),ms2);hd.scale.set(1,1.18,1.06);hd.position.y=.75;hip.add(hd);
  var fc=new THREE.Mesh(new THREE.PlaneGeometry(.15,.131),faceM);fc.position.set(0,.75,.1085);hip.add(fc);
  var ns=new THREE.Mesh(new THREE.SphereGeometry(.02,6,6),ms2);ns.position.set(0,.735,.108);hip.add(ns);
  [-.099,.099].forEach(function(x){var e=new THREE.Mesh(new THREE.SphereGeometry(.02,6,6),ms2);e.scale.set(.5,1,.8);e.position.set(x,.75,0);hip.add(e)});
  if(hs==1){var af=new THREE.Mesh(new THREE.SphereGeometry(.14,12,10),mh);af.position.set(0,.8,-.01);hip.add(af)}
  else{var cap=new THREE.Mesh(new THREE.SphereGeometry(.106,12,8,0,2*PI,0,PI*.58),mh);cap.scale.set(1,1.18,1.06);cap.position.y=.76;hip.add(cap);
    if(hs==2){var pn=new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),mh);pn.position.set(0,.73,-.13);hip.add(pn)}
    else{var hb=new THREE.Mesh(new THREE.TorusGeometry(.106,.012,6,18),mk);hb.rotation.x=PI/2;hb.position.y=.8;hip.add(hb)}}
  var A={g:g,hip:hip};
  A.aL=limb(gUp,gFo,.3,.27,ms2,1,.036);A.aL.position.set(-.21,.53,0);A.aR=limb(gUp,gFo,.3,.27,ms2,1,.036);A.aR.position.set(.21,.53,0);hip.add(A.aL,A.aR);
  A.lL=limb(gTh,gSh,.46,.46,ms2,0,.056);A.lL.position.set(-.09,.95,0);A.lR=limb(gTh,gSh,.46,.46,ms2,0,.056);A.lR.position.set(.09,.95,0);g.add(A.lL,A.lR);
  [A.lL,A.lR].forEach(function(l){var sl=new THREE.Mesh(new THREE.CylinderGeometry(.09,.083,.24,10),md);sl.position.y=-.12;l.add(sl);
    var so=new THREE.Mesh(new THREE.CylinderGeometry(.045,.04,.14,8),mw);so.position.y=-.38;l.k.add(so);
    var f=new THREE.Mesh(new THREE.BoxGeometry(.1,.055,.25),mat(kit,.6));f.position.set(0,-.49,.05);l.k.add(f);
    var sl2=new THREE.Mesh(new THREE.BoxGeometry(.1,.02,.26),mw);sl2.position.set(0,-.52,.05);l.k.add(sl2)});
  g.traverse(function(m){if(m.isMesh){var ty=m.geometry.type;m.castShadow=(ty=="CylinderGeometry"||ty=="LatheGeometry")}});g.scale.setScalar(.85);W.add(g);return A}
function put(A,x,y,z,ry){A.g.position.set(x,y,z);A.g.rotation.y=ry;A.hip.position.y=.95;A.hip.rotation.set(0,0,0);[A.aL,A.aR,A.lL,A.lR].forEach(function(l){l.rotation.set(0,0,0);l.k.rotation.set(0,0,0)})}
function run(A,ph,lean){var s=Math.sin(ph),c=Math.cos(ph);A.hip.rotation.x=lean;A.hip.rotation.y=s*.16;A.hip.position.y=.95+Math.abs(c)*.035;
  A.lL.rotation.x=s*1.0;A.lR.rotation.x=-s*1.0;A.lL.k.rotation.x=.25+Math.max(0,-c)*1.45;A.lR.k.rotation.x=.25+Math.max(0,c)*1.45;
  A.aL.rotation.x=-s*1.0;A.aR.rotation.x=s*1.0;A.aL.rotation.z=.1;A.aR.rotation.z=-.1;A.aL.k.rotation.x=-(1.2+.25*c);A.aR.k.rotation.x=-(1.2-.25*c)}
function lp(rr,s){var L=2*S+2*PI*rr;s=((s%L)+L)%L;
  if(s<S)return[-S/2+s,rr];if(s<S+PI*rr){var f=(s-S)/rr;return[S/2+rr*Math.sin(f),rr*Math.cos(f)]}
  if(s<2*S+PI*rr)return[S/2-(s-S-PI*rr),-rr];var f2=(s-2*S-PI*rr)/rr;return[-S/2-rr*Math.sin(f2),-rr*Math.cos(f2)]}
var runners=[];for(var i=0;i<14;i++){var A=ath(kits[i%4],skins[(i*5)%6],i%3);A.h=i%4;A.rr=R+(i%NL)*LW;A.s=Math.random()*200;A.v=(i%3)*.35;runners.push(A)}
var lj=ath(0xff4d4d,skins[1]),jv=ath(0x3b82ff,skins[2]);
bx(3,.1,2,0xe6c98a,-10.5,.07,8);
var jav=ms(new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,2.4,6),mat(0xf2f2f2)),0,2,0,true);
function field(T){var c=T%3.8,x,u,q;
  if(c<1.7){put(lj,-21+c/1.7*8,0,8,PI/2);run(lj,c*12,.2)}
  else if(c<2.4){u=(c-1.7)/.7;q=Math.sin(u*PI);put(lj,-13+u*2.6,q*1.1,8,PI/2);lj.hip.rotation.x=.2-u*.4;lj.lL.rotation.x=lj.lR.rotation.x=-1.2*q;lj.lL.k.rotation.x=lj.lR.k.rotation.x=.6*q;lj.aL.rotation.x=lj.aR.rotation.x=-2.6*q}
  else{var d=c<3.1?1:0;put(lj,-10.4,-.05,8,PI/2);lj.hip.rotation.x=.5*d;lj.lL.rotation.x=lj.lR.rotation.x=-.6*d;lj.lL.k.rotation.x=lj.lR.k.rotation.x=.9*d;lj.aL.rotation.x=lj.aR.rotation.x=-1.2*d}
  c=T%4.2;
  if(c<1.8){x=21-c/1.8*5;put(jv,x,0,-7,-PI/2);run(jv,c*12,.2);jv.aR.rotation.x=1.6;jv.aR.k.rotation.x=-.8;jav.position.set(x,1.5,-6.7);jav.rotation.z=PI/2}
  else{var tt=Math.min(1,(c-1.8)/.3);put(jv,16,0,-7,-PI/2);jv.hip.rotation.x=.3;jv.lL.rotation.x=-.5;jv.lR.rotation.x=.5;jv.aR.rotation.x=1.6-4.2*tt;jv.aL.rotation.x=-.8;
    if(c<2.1){jav.position.set(16,1.5,-6.7);jav.rotation.z=PI/2}
    else{u=Math.min(1,(c-2.1)/1.3);var vy=-1.5+3.5*(1-2*u);jav.position.set(16-u*14,1.5*(1-u)+3.5*u*(1-u),-6.7);jav.rotation.z=PI/2-Math.atan2(vy,14)}}}
/* extra detail */
function tex(w,h,fn){var c=document.createElement("canvas");c.width=w;c.height=h;fn(c.getContext("2d"),w,h);var t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t}
var adT=tex(1024,64,function(x,w,h){x.fillStyle="#0b1d44";x.fillRect(0,0,w,h);x.font="900 30px 'Big Shoulders Display',sans-serif";x.textBaseline="middle";
  var tx=["INTER-HOUSE SPORTS DAY 2026","RAVENS","HAWKS","EAGLES","FALCONS"],cl=["#ffffff","#eab308","#2563eb","#ef4444","#16a34a"],ps=[10,470,600,725,860];for(var i=0;i<5;i++){x.fillStyle=cl[i];x.fillText(tx[i],ps[i],34)}});
adT.repeat.set(4,1);
[[-19.4,0],[19.6,PI]].forEach(function(b){ms(new THREE.Mesh(new THREE.PlaneGeometry(56,.9),new THREE.MeshBasicMaterial({map:adT,side:THREE.DoubleSide})),0,.55,b[0]).rotation.y=b[1]});
var ckT=tex(256,32,function(x,w,h){for(var i=0;i<32;i++)for(var j=0;j<4;j++){x.fillStyle=(i+j)%2?"#111":"#fff";x.fillRect(i*8,j*8,8,8)}});
bx(.25,3.6,.25,0xdddddd,8,1.8,11.9);bx(.25,3.6,.25,0xdddddd,8,1.8,18.7);bx(.3,.3,7.1,0xdddddd,8,3.6,15.3);
ms(new THREE.Mesh(new THREE.PlaneGeometry(6.6,.8),new THREE.MeshBasicMaterial({map:ckT,side:THREE.DoubleSide})),8,3.1,15.3).rotation.y=PI/2;
arc(R-LW/2-.14,R-LW/2-.02,S/2,-PI/2,0xffffff,.05);arc(R-LW/2-.14,R-LW/2-.02,-S/2,PI/2,0xffffff,.05);str(R-LW/2-.14,R-LW/2-.02,0xffffff,.05);
for(var k=0;k<7;k++)[-19,-8,8,19].forEach(function(xe){bx(.7,(k+1)*1.1-.02,1.95,0x4a505c,xe,(k+1)*.55,-(20.5+k*2+1))});
var flagT=tex(120,80,function(x,w,h){x.fillStyle="#00209f";x.fillRect(0,0,w,24);x.fillStyle="#fff";x.fillRect(0,24,w,32);x.fillStyle="#009543";x.fillRect(0,56,w,24);x.fillStyle="#000";x.beginPath();x.moveTo(60,28);x.lineTo(50,52);x.lineTo(70,52);x.fill()});
var flags=[];[-27,-13.5,0,13.5,27].forEach(function(x){bx(.12,7,.12,0xdddddd,x,16,-27);var g=new THREE.PlaneGeometry(3,2,12,6);g.translate(1.5,0,0);g.userData.b=g.attributes.position.array.slice();
  ms(new THREE.Mesh(g,new THREE.MeshBasicMaterial({map:flagT,side:THREE.DoubleSide})),x,18.5,-27);flags.push(g)});
var bn=[],hn=["RAVENS","HAWKS","EAGLES","FALCONS"],hc=["#eab308","#2563eb","#ef4444","#16a34a"];
[-21,-7,7,21].forEach(function(x,i){var t=tex(256,96,function(c,w,h){c.fillStyle=hc[i];c.fillRect(0,0,w,h);c.fillStyle=i===0||i===3?"#0f172a":"#fff";c.font="900 54px 'Big Shoulders Display',sans-serif";c.textAlign="center";c.textBaseline="middle";c.fillText(hn[i],128,52)});
  bn.push(ms(new THREE.Mesh(new THREE.PlaneGeometry(6,2.2),new THREE.MeshBasicMaterial({map:t})),x,9.2,-19.85))});
[[0,10.9,0],[10,-10.9,PI],[-24,0,-PI/2],[24,0,PI/2]].forEach(function(p,i){var o=ath(0xff7a1a,skins[i]);put(o,p[0],0,p[1],p[2]);o.aR.rotation.x=-1.9;o.aR.k.rotation.x=-1.1});
var sg=new THREE.Sprite(new THREE.SpriteMaterial({map:glow(1,1),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,fog:false}));sg.position.copy(sun).multiplyScalar(430);sg.scale.set(130,130,1);sc.add(sg);
/* post-processing: bloom, colour grade, vignette, grain */
var comp=null,grade=null;
if(THREE.EffectComposer&&THREE.RenderPass&&THREE.UnrealBloomPass&&THREE.ShaderPass&&THREE.CopyShader){try{
  var rt=new THREE.WebGLMultisampleRenderTarget(512,512,{type:THREE.HalfFloatType,format:THREE.RGBAFormat});
  comp=new THREE.EffectComposer(r,rt);comp.addPass(new THREE.RenderPass(sc,cam));comp.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(512,512),.5,.55,1.0));
  grade=new THREE.ShaderPass({uniforms:{tDiffuse:{value:null},uT:{value:0}},vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader:"uniform sampler2D tDiffuse;uniform float uT;varying vec2 vUv;float hs(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+uT)*43758.5453);}void main(){vec2 d=vUv-.5;vec3 col=vec3(texture2D(tDiffuse,vUv+d*.0018).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-d*.0018).b);float l=dot(col,vec3(.299,.587,.114));col=mix(vec3(l),col,1.1);col=(col-.5)*1.05+.5;float v=smoothstep(.9,.3,length(d*vec2(1.,.9)));col*=mix(.7,1.,v);col+=(hs(vUv*900.)-.5)*.03;gl_FragColor=vec4(col,1.);}"});
  comp.addPass(grade)}catch(e){comp=null}}
/* fireworks, trophy */
var FN=700,fg=new THREE.BufferGeometry(),fp=new Float32Array(FN*3),fc=new Float32Array(FN*3),fv=new Float32Array(FN*3),fl=new Float32Array(FN),fb=new Float32Array(FN*3),fi=0;
for(var i=0;i<FN;i++)fp[i*3+1]=-100;
fg.setAttribute("position",new THREE.BufferAttribute(fp,3));fg.setAttribute("color",new THREE.BufferAttribute(fc,3));
sc.add(new THREE.Points(fg,new THREE.PointsMaterial({size:.6,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false})));
function burst(x,y,z,col,n,sp){var c=new THREE.Color(col);for(var k=0;k<n;k++){var i=fi++%FN,a=Math.random()*2*PI,b=Math.acos(2*Math.random()-1),v=sp*(.5+Math.random()*.6);fp[i*3]=x;fp[i*3+1]=y;fp[i*3+2]=z;fv[i*3]=Math.sin(b)*Math.cos(a)*v;fv[i*3+1]=Math.cos(b)*v;fv[i*3+2]=Math.sin(b)*Math.sin(a)*v;fl[i]=1.4+Math.random()*.6;fb[i*3]=c.r;fb[i*3+1]=c.g;fb[i*3+2]=c.b}}
function sparks(dt){for(var i=0;i<FN;i++){if(fl[i]>0){fl[i]-=dt;fv[i*3+1]-=7*dt;fp[i*3]+=fv[i*3]*dt;fp[i*3+1]+=fv[i*3+1]*dt;fp[i*3+2]+=fv[i*3+2]*dt;var f=Math.max(0,fl[i])*1.6;fc[i*3]=fb[i*3]*f;fc[i*3+1]=fb[i*3+1]*f;fc[i*3+2]=fb[i*3+2]*f;if(fl[i]<=0)fp[i*3+1]=-100}}fg.attributes.position.needsUpdate=true;fg.attributes.color.needsUpdate=true}
window.sdResult=function(col){for(var k=0;k<3;k++)setTimeout(function(){burst((Math.random()-.5)*26,12+Math.random()*10,(Math.random()-.5)*12,col,90,9)},k*350);burst(0,3.2,0,col,60,6)};
var trophy=new THREE.Group(),gm=new THREE.MeshStandardMaterial({color:0xffc94d,metalness:.85,roughness:.25,side:THREE.DoubleSide});
trophy.add(new THREE.Mesh(new THREE.LatheGeometry([[0,0],[.35,0],[.35,.1],[.12,.22],[.1,.7],[.2,.78],[.6,1.5],[.55,1.55],[.48,1.0],[0,1.0]].map(function(p){return new THREE.Vector2(p[0],p[1])}),24),gm));
trophy.position.set(0,2.3,0);trophy.scale.setScalar(1.1);W.add(trophy);
/* camera path: landing view orbits slowly, home view follows the scroll */
var VW={land:[["top"],[[10,24,50,-14,2,-6]]],home:[["hometop","live","events","athletes","points","about","signin"],[[0,9,34,-10,2,-4],[14,2.6,19,-4,1.4,14],[-14,2.6,-9.5,4,1.4,-15],[0,4,12,-6,1.6,0],[-6,5,10,6,1.5,0],[0,5,-3,-10,7,-30],[0,38,58,0,0,0]]]};
var cur=VW.land[1][0].slice(),tgt=cur.slice();window.sdIntro=function(){cur[0]=70;cur[1]=65;cur[2]=120;cur[3]=0;cur[4]=0;cur[5]=0};window.sdIntro();
function aim(){var v=document.body.className=="home"?VW.home:VW.land,ids=v[0],wp=v[1];
  if(wp.length<2){for(var k=0;k<6;k++)tgt[k]=wp[0][k];return}
  var y=scrollY+innerHeight*.5,cc=ids.map(function(i){var e=document.getElementById(i),b=e.getBoundingClientRect();return b.top+scrollY+b.height/2});
  var i=0;while(i<cc.length-2&&y>cc[i+1])i++;var t=Math.min(1,Math.max(0,(y-cc[i])/(cc[i+1]-cc[i])));t=t*t*(3-2*t);
  for(var k=0;k<6;k++)tgt[k]=wp[i][k]+(wp[i+1][k]-wp[i][k])*t}
var wide=true,mx=0,my=0;
function size(){var w=cv.clientWidth,h=cv.clientHeight;r.setSize(w,h,false);if(comp)comp.setSize(w,h);cam.aspect=w/h;wide=w>860;cam.updateProjectionMatrix()}
size();addEventListener("resize",size);
if(comp){try{var g2=r.getContext();for(var z=0;z<20&&g2.getError();z++);comp.render();if(g2.getError())comp=null}catch(e){comp=null}}
addEventListener("pointermove",function(e){mx=e.clientX/innerWidth-.5;my=e.clientY/innerHeight-.5;var d=document.documentElement.style;d.setProperty("--px",mx.toFixed(3));d.setProperty("--py",my.toFixed(3))});
var still=matchMedia("(prefers-reduced-motion:reduce)").matches,clock=new THREE.Clock(),T=0;
var fr=0,ft=0,low=false;
function degrade(){low=true;comp=null;r.setPixelRatio(1);r.setSize(cv.clientWidth,cv.clientHeight,false);dl.castShadow=false;r.shadowMap.enabled=false;sc.traverse(function(o){if(o.material){var m=o.material;(Array.isArray(m)?m:[m]).forEach(function(x){x.needsUpdate=true})}})}
(function loop(){
  requestAnimationFrame(loop);
  try{
  var raw=clock.getDelta(),dt=Math.min(raw,.05);if(!still)T+=dt;
  var mxp=Math.max(20,Math.max.apply(null,H.map(function(h){return h.p})));
  runners.forEach(function(A){if(!still)A.s+=dt*(4.6+H[A.h].p/mxp*3+A.v);var q=lp(A.rr,A.s),q2=lp(A.rr,A.s+.3),ph2=A.s*1.9;
    put(A,q[0],Math.abs(Math.sin(ph2))*.05,q[1],Math.atan2(q2[0]-q[0],q2[1]-q[1]));run(A,ph2,.22)});
  field(T);
  crowd(T);sparks(dt);trophy.rotation.y=T*.9;trophy.position.y=2.3+Math.sin(T*1.5)*.08;
  gls.forEach(function(g,i){var k=16+Math.sin(T*2+i*1.7)*1.6;g.scale.set(k,k,1)});bn.forEach(function(b,i){b.rotation.z=Math.sin(T*1.4+i)*.04});
  flags.forEach(function(g,fi){var p=g.attributes.position.array,b=g.userData.b;for(var i=0;i<p.length;i+=3)p[i+2]=Math.sin(b[i]*2.2-T*5+fi)*.28*b[i]/3;g.attributes.position.needsUpdate=true});
  clouds.forEach(function(c){c.position.x+=dt*1.5;if(c.position.x>260)c.position.x=-260});
  aim();var sw=document.body.className=="home"?0:Math.sin(T*.15)*6;for(var k=0;k<6;k++)cur[k]+=(still?tgt[k]-cur[k]:(tgt[k]-cur[k])*.06);
  var lx=wide?cur[3]:0,ly=wide?cur[4]:cur[4]+2,lz=cur[5],q=wide?1:1.5;
  cam.position.set(lx+(cur[0]-lx)*q+mx*2+sw+Math.sin(T*1.3)*.05,ly+(cur[1]-ly)*q-my*1.5+Math.sin(T*1.9)*.04,lz+(cur[2]-lz)*q);
  cam.lookAt(lx,ly,lz);
  if(!low&&++fr>20&&fr<=140){ft+=raw;if(fr==140&&ft/120>.05)degrade()}
  }catch(e){if(!window.__e3){window.__e3=1;console.error(e)}}
  try{if(comp){grade.uniforms.uT.value=T;comp.render()}else r.render(sc,cam)}catch(e){comp=null}
})();
})();
