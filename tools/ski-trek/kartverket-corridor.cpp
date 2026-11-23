// Ordered geographic regions extend the graph with one state per passed gate.
#define FROST_ROUTING_LIBRARY
#include "kartverket-search.cpp"
#include <map>
#include <sstream>
struct Gate {double row,col,radius;int maxRowAfter;int minColAfter=0;};
int main(int argc,char**argv){
 try{
  if(argc!=15)throw runtime_error("root W H sr sc tr tc cap bound pressure gates output report");
  string root=argv[1];int W=stoi(argv[2]),H=stoi(argv[3]),sr=stoi(argv[4]),sc=stoi(argv[5]),tr=stoi(argv[6]),tc=stoi(argv[7]);double cap=stod(argv[8]),bound=stod(argv[9]),pressure=stod(argv[10]);
  int mesh=string(argv[14])=="m2"?2:4;
  vector<Gate> gates;ifstream input(argv[11]);Gate gate;string line;while(getline(input,line)){istringstream stream(line);if(!(stream>>gate.row>>gate.col>>gate.radius>>gate.maxRowAfter))continue;if(!(stream>>gate.minColAfter))gate.minColAfter=0;gates.push_back(gate);}
  if(gates.empty()||gates.size()>4)throw runtime_error("Expected 1 to 4 corridor gates");
  Raster raster(root,W,H);TerrainCost terrain(raster,cap,1,pressure);auto moves=makeMoves(mesh,3),unit=makeMoves(1,2);EndpointPatch startPatch(sr,sc,250,raster,terrain,unit),goalPatch(tr,tc,250,raster,terrain,unit);
  int rows=(H-1)/mesh+1,cols=(W-1)/mesh+1,N=rows*cols,stages=gates.size()+1;
  vector<float> cost(size_t(N)*stages,INFINITY);vector<uint8_t> parent(cost.size(),255);priority_queue<Node> queue;
  vector<double> tail(gates.size());for(int k=int(gates.size())-1;k>=0;k--){if(k==int(gates.size())-1)tail[k]=max(0.,hypot(gates[k].row-tr,gates[k].col-tc)-gates[k].radius);else tail[k]=tail[k+1]+max(0.,hypot(gates[k].row-gates[k+1].row,gates[k].col-gates[k+1].col)-gates[k].radius-gates[k+1].radius);}
  auto h=[&](int phase,int r,int c){return phase==(int)gates.size()?hypot(r*mesh-tr,c*mesh-tc):max(0.,hypot(r*mesh-gates[phase].row,c*mesh-gates[phase].col)-gates[phase].radius)+tail[phase];};
  auto permitted=[&](int phase,int r,int c){for(int k=0;k<phase;k++)if(r*mesh>gates[k].maxRowAfter||c*mesh<gates[k].minColAfter)return false;return true;};
  for(int r=max(0,(sr-250)/mesh);r<rows&&r*mesh<=sr+250;r++)for(int c=max(0,(sc-250)/mesh);c<cols&&c*mesh<=sc+250;c++){int j=startPatch.index(r*mesh,c*mesh);if(j<0||!isfinite(startPatch.cost[j]))continue;int i=r*cols+c;cost[i]=startPatch.cost[j];parent[i]=254;queue.push({cost[i]+h(0,r,c)*(1+pressure),cost[i],i});}
  int goal=-1;double best=INFINITY;long expanded=0;vector<long> phaseExpanded(stages,0);vector<double> nearestGate(gates.size(),INFINITY);
  while(!queue.empty()){
   auto n=queue.top();queue.pop();if(n.cost!=cost[n.index])continue;if(n.estimate>=best)break;int phase=n.index/N,p=n.index%N,r=p/cols,c=p%cols;expanded++;phaseExpanded[phase]++;if(phase<(int)gates.size())nearestGate[phase]=min(nearestGate[phase],hypot(r*mesh-gates[phase].row,c*mesh-gates[phase].col));
   if(phase<(int)gates.size()&&hypot(r*mesh-gates[phase].row,c*mesh-gates[phase].col)<=gates[phase].radius&&permitted(phase+1,r,c)){
    int j=n.index+N;if(n.cost<cost[j]){cost[j]=n.cost;parent[j]=253;queue.push({n.cost+h(phase+1,r,c)*(1+pressure),n.cost,j});}
   }
   if(phase==(int)gates.size()){int gi=goalPatch.index(r*mesh,c*mesh);if(gi>=0&&isfinite(goalPatch.cost[gi])&&n.cost+goalPatch.cost[gi]<best){best=n.cost+goalPatch.cost[gi];goal=n.index;}}
   for(int k=0;k<(int)moves.size();k++){
    auto&m=moves[k];int rr=r+m.row,cc=c+m.col;if(rr<0||cc<0||rr>=rows||cc>=cols||!permitted(phase,rr,cc))continue;
    double remaining=h(phase,rr,cc);if(hypot(rr*mesh-sr,cc*mesh-sc)+remaining>bound)continue;
    Edge e;if(!terrain.evaluate(r*mesh,c*mesh,m,e))continue;int j=phase*N+rr*cols+cc;float nc=n.cost+e.cost;
    if(nc<cost[j]-.0001){cost[j]=nc;parent[j]=k;queue.push({nc+remaining*(1+pressure),nc,j});}
   }
  }
  if(goal<0){cout<<"{\"feasible\":false,\"expanded\":"<<expanded<<",\"phase_expanded\":[";for(int k=0;k<stages;k++){if(k)cout<<",";cout<<phaseExpanded[k];}cout<<"],\"nearest_gate_m\":[";for(size_t k=0;k<gates.size();k++){if(k)cout<<",";cout<<(isfinite(nearestGate[k])?nearestGate[k]:-1);}cout<<"]}\n";return 2;}
  vector<pair<int,int>> coarse,hits;int i=goal;
  while(true){int p=i%N,r=p/cols*mesh,c=p%cols*mesh,k=parent[i];if(k==253){hits.push_back({r,c});i-=N;continue;}coarse.push_back({r,c});if(k==254)break;if(k==255)throw runtime_error("Broken corridor path");i-=moves[k].row*cols+moves[k].col;}
  reverse(coarse.begin(),coarse.end());reverse(hits.begin(),hits.end());auto path=startPatch.towardAnchor(coarse[0].first,coarse[0].second);reverse(path.begin(),path.end());path.insert(path.end(),coarse.begin()+1,coarse.end());auto last=goalPatch.towardAnchor(path.back().first,path.back().second);path.insert(path.end(),last.begin()+1,last.end());
  map<pair<int,int>,Move> segments;for(int scale:{1,mesh})for(auto m:makeMoves(scale,3))segments[{m.row*scale,m.col*scale}]=m;
  double distance=0,score=0,maximum=0;for(size_t j=1;j<path.size();j++){auto a=path[j-1],b=path[j];auto it=segments.find({b.first-a.first,b.second-a.second});Edge e;if(it==segments.end()||!terrain.evaluate(a.first,a.second,it->second,e))throw runtime_error("Invalid corridor edge");distance+=e.length;score+=e.cost;maximum=max(maximum,e.maximum);}
  ofstream output(argv[12],ios::binary);for(auto[r,c]:path){output.write((char*)&r,4);output.write((char*)&c,4);}
  ofstream report(argv[13]);report<<"{\"gate_indices\":[";size_t cursor=0;for(size_t k=0;k<hits.size();k++){while(cursor<path.size()&&path[cursor]!=hits[k])cursor++;if(cursor==path.size())throw runtime_error("Missing corridor hit");if(k)report<<",";report<<cursor;}report<<"]}\n";
  cout<<"{\"feasible\":true,\"within_distance_limit\":"<<(distance<=bound+.01?"true":"false")<<",\"distance_m\":"<<distance<<",\"weighted_cost_m\":"<<(score-pressure*distance)<<",\"max_slope_deg\":"<<maximum<<",\"expanded\":"<<expanded<<"}\n";
 }catch(const exception&e){cerr<<e.what()<<"\n";return 1;}
}
