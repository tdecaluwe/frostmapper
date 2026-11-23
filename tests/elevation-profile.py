from pathlib import Path
import importlib.util
import numpy as np
p=Path(__file__).resolve().parents[1]/'tools/ski-trek/elevation-profile.py';spec=importlib.util.spec_from_file_location('profile',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
x=np.arange(0,1001,dtype=float)
monotonic=m.ElevationProfile(x,1000+x*.1);assert abs(monotonic.ascent-100)<1e-8 and monotonic.descent==0
noise=m.ElevationProfile(x,1000+np.sin(x*1.3)*.8);assert noise.ascent<2 and noise.descent<2
coarse=m.ElevationProfile(x[::10],1000+x[::10]*.1);assert np.max(np.abs(coarse.elevation-monotonic.elevation))<1e-8
h=np.interp(x,[0,250,500,750,1000],[1000,1100,1050,1150,1000]);rolling=m.ElevationProfile(x,h)
assert 185<rolling.ascent<201 and abs(rolling.ascent-rolling.descent)<1e-8
net=m.ElevationProfile(x,1000+10*np.sin(x/100)+x*.02);assert abs(net.ascent-net.descent-(net.elevation[-1]-net.elevation[0]))<1e-8
print('Distance resampling, monotonic gain, noise suppression, real hills and endpoint balance passed')
