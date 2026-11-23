"""Distance-based terrain profile and noise-resistant elevation accumulation."""
import math
import numpy as np

class ElevationProfile:
 sample_spacing_m=5
 smoothing_sigma_m=10
 reversal_hysteresis_m=3
 def __init__(self,distance,elevation):
  distance=np.asarray(distance,dtype=float);elevation=np.asarray(elevation,dtype=float)
  if len(distance)<2 or len(distance)!=len(elevation) or not np.isfinite(distance).all() or not np.isfinite(elevation).all():raise ValueError('Invalid elevation profile')
  keep=np.r_[True,np.diff(distance)>1e-8];distance=distance[keep];elevation=elevation[keep]
  if len(distance)<2 or np.any(np.diff(distance)<=0):raise ValueError('Profile chainage must increase')
  self.distance=np.r_[np.arange(distance[0],distance[-1],self.sample_spacing_m),distance[-1]]
  raw=np.interp(self.distance,distance,elevation);sigma=self.smoothing_sigma_m/self.sample_spacing_m;radius=math.ceil(3*sigma);x=np.arange(-radius,radius+1);kernel=np.exp(-.5*(x/sigma)**2);kernel/=kernel.sum()
  smooth=np.convolve(np.pad(raw,(radius,radius),mode='edge'),kernel,mode='valid');smooth[0]=raw[0];smooth[-1]=raw[-1];self.elevation=smooth
  turns=[float(smooth[0])];direction=0;extreme=turns[0];threshold=self.reversal_hysteresis_m
  for value in smooth[1:]:
   if direction==0:
    if value-turns[-1]>=threshold:direction=1;extreme=value
    elif turns[-1]-value>=threshold:direction=-1;extreme=value
   elif direction==1:
    if value>=extreme:extreme=value
    elif extreme-value>=threshold:turns.append(float(extreme));direction=-1;extreme=value
   else:
    if value<=extreme:extreme=value
    elif value-extreme>=threshold:turns.append(float(extreme));direction=1;extreme=value
  turns.append(float(smooth[-1]));delta=np.diff(turns);self.ascent=float(delta.clip(0).sum());self.descent=float(-delta.clip(max=0).sum())
 def json(self):
  distance=np.round(self.distance,2);keep=np.r_[np.diff(distance)>0,True]
  return dict(distance_m=distance[keep].tolist(),elevation_m=np.round(self.elevation[keep],2).tolist(),method=dict(sample_spacing_m=self.sample_spacing_m,gaussian_sigma_m=self.smoothing_sigma_m,reversal_hysteresis_m=self.reversal_hysteresis_m),ascent_m=self.ascent,descent_m=self.descent)
