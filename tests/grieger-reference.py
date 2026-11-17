"""Independent 60-digit reference for selected Grieger contour points.
Uses the original Frostmapper/PROJ trigonometric equations, not dual arithmetic.
Requires mpmath; run from repository root with an atlas JSON argument.
"""
import json,sys,math
import mpmath as mp
mp.mp.dps=60
R=mp.mpf(6378137); K=mp.mpf('1.8540746773013719'); W=2*mp.pi*R
coefficients=list(map(mp.mpf,['-8.58691003636495e-7','2.02692115653689e-7','3.12960480765314e-5','5.30394739921063e-5','-0.0012804644680613','-0.00575574836830288','0.0914203033408211']))
def elliptic(phi):
    y=2*(phi*2/mp.pi)**2-1; d1=d2=mp.mpf(0)
    for c in coefficients: d1,d2=2*y*d1-d2+c,d1
    return phi*(y*d1-d2+mp.mpf('2.19174570831038')/2)
def project(u,v):
    lon=(u-mp.mpf('.5'))*2*mp.pi;lat=2*mp.atan(mp.exp((v-mp.mpf('.5'))*2*mp.pi))-mp.pi/2
    sp,cp,cl,sl=mp.sin(lat),mp.cos(lat),mp.cos(lon),mp.sin(lon);a=mp.sqrt(mp.mpf('.5'))
    rl=mp.atan2(cp*sl,-a*cp*cl+a*sp)+mp.pi/4;rp=mp.asin(-a*sp-a*cp*cl)
    s,c,p=mp.sin(rl),mp.cos(rl),mp.cos(rp)
    aa=mp.acos(p*(s+c)*a);bb=mp.acos(p*(s-c)*a)
    m=mp.asin(mp.sqrt(1+min(0,mp.cos(aa+bb))));n=mp.asin(mp.sqrt(1-max(0,mp.cos(aa-bb))))
    if s<0:m=-m
    if c>0:n=-n
    x,y=elliptic(m),elliptic(n)
    if rp<0:x=2*K-x
    return -R*(x-2*K),-R*y  # wrapping changes neither local derivative

def field(u,v):
    dx=[mp.diff(lambda t:project(t,v)[k],u)/W for k in [0,1]]
    dy=[mp.diff(lambda t:project(u,t)[k],v)/W for k in [0,1]]
    return -mp.log(abs(dx[0]*dy[1]-dx[1]*dy[0]),2)/2

def bezier(c,t):
    u=1-t
    return [u**3*c[k]+3*u*u*t*c[k+2]+3*u*t*t*c[k+4]+t**3*c[k+6] for k in [0,1]]
data=json.load(open(sys.argv[1]));samples=[]
for step in [-80,-60,-40,-20,0,8]:
    for path in [p for p in data['paths'] if p['step']==round(step*data['steps']/4)]:
        for c in path['curves'][::max(1,len(path['curves'])//2)][:2]:
            for t in [.125,.625]:samples.append((path['step'],bezier(c,t)))
errors=[];worst=None
for step,(u,v) in samples:
    value=field(mp.mpf(u),mp.mpf(v));error=float(abs(value-mp.mpf(step)/data['steps'])*data['steps']);errors.append(error)
    if worst is None or error>worst['errorSteps']:worst={'step':step,'point':[u,v],'errorSteps':error}
result={'precisionDigits':mp.mp.dps,'samples':len(errors),'maxErrorSteps':max(errors),'overHalfStep':sum(e>.5 for e in errors),'worst':worst}
print(json.dumps(result,indent=2))
if result['overHalfStep']:sys.exit(1)
