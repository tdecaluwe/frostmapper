// Repair a conservative coarse proposal inside the requested native slope cap.
// Every replacement is a full-resolution search, never smoothing over a cliff.
#define FROST_LOCAL_LIBRARY
#include "kartverket-local.cpp"
int main(int argc,char**argv){
 try{
  if(argc!=9)throw runtime_error("root width height cap bound input output report");
  double cap=stod(argv[4]),bound=stod(argv[5]);LocalRefiner local(argv[1],stoi(argv[2]),stoi(argv[3]),cap,bound,argv[6],true);TerrainCost strict(local.raster,cap,1);int repaired=0;bool success=false;
  for(int iteration=0;iteration<150;iteration++){
   vector<double> distance(local.path.size(),0);vector<int> bad;
   for(size_t i=1;i<local.path.size();i++){
    auto a=local.path[i-1],b=local.path[i];distance[i]=distance[i-1]+hypot(b.first-a.first,b.second-a.second);
    auto segment=local.segments.find({b.first-a.first,b.second-a.second});Edge edge;
    if(segment==local.segments.end()||!strict.evaluate(a.first,a.second,segment->second,edge))bad.push_back(i);
   }
   if(bad.empty()){success=true;break;}
   int first=bad[0],last=first;
   for(int index:bad){if(distance[index]-distance[last]>80)break;last=index;}
   size_t begin=lower_bound(distance.begin(),distance.end(),max(0.,distance[first]-60))-distance.begin();
   size_t end=lower_bound(distance.begin(),distance.end(),min(distance.back(),distance[last]+60))-distance.begin();
   auto permitted=[&](Point p){size_t i=size_t(p.first)*local.raster.width+p.second;return local.raster.slopes[i]>0&&(local.raster.slopes[i]-1)*.01<=cap&&local.raster.headingSlopes[i]>0&&local.raster.headingSlopes[i]<=3001;};
   while(begin>0&&!permitted(local.path[begin]))begin--;
   while(end+1<local.path.size()&&!permitted(local.path[end]))end++;
   Trial chosen;double limit=distance[end]-distance[begin]+max(0.,bound-distance.back());
   for(int buffer:{50,150,400}){
    local.buffer=buffer;Trial trial=local.search(begin,end,0);
    if(trial.length<=limit+.001){chosen=trial;break;}
    if(isfinite(trial.cost))for(double pressure:{1.,4.,16.,64.}){trial=local.search(begin,end,pressure);if(trial.length<=limit+.001){chosen=trial;break;}}
    if(isfinite(chosen.cost))break;
   }
   if(!isfinite(chosen.cost)){cerr<<"Cannot repair interval "<<distance[begin]<<" to "<<distance[end]<<" native metres\n";break;}
   local.path.erase(local.path.begin()+begin,local.path.begin()+end+1);local.path.insert(local.path.begin()+begin,chosen.path.begin(),chosen.path.end());repaired++;
   cerr<<"Repaired "<<repaired<<" intervals\n";
  }
  ofstream report(argv[8]);report<<"{\"success\":"<<(success?"true":"false")<<",\"repaired_intervals\":"<<repaired<<"}\n";
  if(success){ofstream out(argv[7],ios::binary);for(auto[r,c]:local.path){out.write((char*)&r,4);out.write((char*)&c,4);}}
 }catch(const exception&e){cerr<<e.what()<<"\n";return 1;}
}
