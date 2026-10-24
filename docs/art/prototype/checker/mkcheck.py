import os, re
HERE=os.path.dirname(os.path.abspath(__file__))
c=open(os.path.join(HERE,'..','land3d.html')).read()
CHECK=open(os.path.join(HERE,'check_block.js')).read()
def R(a,b):
    global c
    assert c.count(a)==1,a[:50];c=c.replace(a,b)
R("async function card(o){",CHECK+"async function card(o){")
R("  scene.traverse(m=>{if(m.geometry)m.geometry.dispose()});}","  if(window.CHECK){window.RESULTS.push(await runChecks(o,scene,cam,placed,spot,cv,skyline));cv.remove()}\n  scene.traverse(m=>{if(m.geometry)m.geometry.dispose()});}")
R('const q=new URLSearchParams(location.search);','window.CHECK=1;window.RESULTS=[];const q=new URLSearchParams(location.search);')
R('const lms=[L("employment","emp-"+nm,"active")];if(r()<0.7)lms.push(L("skills","sk-"+nm,r()<0.3?"pending":"active"));if(r()<0.5)lms.push(L("clearance","cl-"+nm,"active"));if(r()<0.6)lms.push(L("custom","cu-"+nm,"active"));',
 'const two=r()<0.35;const lms=[L("employment","emp-"+nm,two?"revoked":"active"),L("skills","sk-"+nm,r()<0.25?"pending":"active"),L("clearance","cl-"+nm,"active"),L("custom","cu-"+nm,"active")];if(two)lms.push(L("employment","emp2-"+nm,"active"));')
open(os.path.join(HERE,'..','check.html'),'w').write(c)
