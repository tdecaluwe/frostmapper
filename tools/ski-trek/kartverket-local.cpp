#define FROST_ROUTING_LIBRARY
#include "kartverket-search.cpp"
#include <map>
using Point=pair<int,int>;
struct Trial{vector<Point> path;double cost=INFINITY,length=INFINITY,score=INFINITY;};
class LocalRefiner {
 public:
 Raster raster;double cap,bound;int mesh=4,window=1000,stride=500,buffer=300,margin=400;double absoluteTolerance=2;vector<Move> moves;map<Point,Move> segments;
 public:
 vector<Point> path;int tested=0,changes=0,unresolved=0,passes=0;double worstGap=0;
 LocalRefiner(string root,int w,int h,double cap_,double bound_,string input,bool micro=false):raster(root,w,h),cap(cap_),bound(bound_),moves(makeMoves(micro?1:4,3)) {
  if(micro){mesh=1;window=100;stride=50;buffer=25;margin=0;absoluteTolerance=.25;}
  ifstream f(input,ios::binary);int r,c;while(f.read((char*)&r,4)&&f.read((char*)&c,4))path.push_back({r,c});
  for(int mesh:{1,2,4})for(auto m:makeMoves(mesh,3))segments[{m.row*mesh,m.col*mesh}]=m;
 }
 Edge edge(Point a,Point b,const TerrainCost& terrain){Edge e;auto it=segments.find({b.first-a.first,b.second-a.second});if(it==segments.end()||!terrain.evaluate(a.first,a.second,it->second,e))throw runtime_error("Invalid path edge");return e;}
 Trial search(size_t begin,size_t end,double pressure) {
  int top=raster.height,left=raster.width,bottom=0,right=0;
  for(size_t i=begin;i<=end;i++){top=min(top,path[i].first);bottom=max(bottom,path[i].first);left=min(left,path[i].second);right=max(right,path[i].second);}
  top=max(0,(top-buffer)/mesh)*mesh;left=max(0,(left-buffer)/mesh)*mesh;bottom=min(raster.height-1,bottom+buffer);right=min(raster.width-1,right+buffer);
  int rows=(bottom-top)/mesh+1,cols=(right-left)/mesh+1;
  Point a=path[begin],b=path[end];int start=(a.first-top)/mesh*cols+(a.second-left)/mesh,goal=(b.first-top)/mesh*cols+(b.second-left)/mesh;
  TerrainCost terrain(raster,cap,1,pressure);vector<double> cost(rows*cols,INFINITY);vector<float> length(cost.size(),INFINITY);vector<uint8_t> parent(cost.size(),255);priority_queue<Node> queue;
  auto heuristic=[&](int r,int c){return hypot(top+r*mesh-b.first,left+c*mesh-b.second)*(1+pressure);};
  cost[start]=length[start]=0;queue.push({heuristic(start/cols,start%cols),0,start});
  while(!queue.empty()){
   auto n=queue.top();queue.pop();if(n.cost!=cost[n.index])continue;if(n.index==goal)break;
   int r=n.index/cols,c=n.index%cols;
   for(int k=0;k<(int)moves.size();k++){
    auto&m=moves[k];int rr=r+m.row,cc=c+m.col;if(rr<0||cc<0||rr>=rows||cc>=cols)continue;
    Edge e;if(!terrain.evaluate(top+r*mesh,left+c*mesh,m,e))continue;int j=rr*cols+cc;double nc=n.cost+e.cost;
    if(nc+1e-8<cost[j]){cost[j]=nc;length[j]=length[n.index]+e.length;parent[j]=k;queue.push({nc+heuristic(rr,cc),nc,j});}
   }
  }
  Trial t;if(!isfinite(cost[goal]))return t;t.score=cost[goal];int i=goal;
  while(true){t.path.push_back({top+i/cols*mesh,left+i%cols*mesh});if(i==start)break;int k=parent[i];if(k==255)throw runtime_error("Broken local path");i-=moves[k].row*cols+moves[k].col;}
  reverse(t.path.begin(),t.path.end());t.cost=0;t.length=0;TerrainCost raw(raster,cap,1);
  for(size_t i=1;i<t.path.size();i++){auto e=edge(t.path[i-1],t.path[i],raw);t.cost+=e.cost;t.length+=e.length;}return t;
 }
 Trial constrainedSearch(size_t begin,size_t end,double maxLength,double upperCost) {
  int top=raster.height,left=raster.width,bottom=0,right=0;
  for(size_t i=begin;i<=end;i++){top=min(top,path[i].first);bottom=max(bottom,path[i].first);left=min(left,path[i].second);right=max(right,path[i].second);}
  top=max(0,(top-buffer)/mesh)*mesh;left=max(0,(left-buffer)/mesh)*mesh;bottom=min(raster.height-1,bottom+buffer);right=min(raster.width-1,right+buffer);
  int rows=(bottom-top)/mesh+1,cols=(right-left)/mesh+1;Point a=path[begin],b=path[end];
  int start=(a.first-top)/mesh*cols+(a.second-left)/mesh,goal=(b.first-top)/mesh*cols+(b.second-left)/mesh;
  struct Label{int node,parent,move;double cost,length;bool active;};
  vector<Label> labels;vector<vector<int>> fronts(rows*cols);priority_queue<Node> queue;
  auto distance=[&](int n){return hypot(top+n/cols*mesh-b.first,left+n%cols*mesh-b.second);};
  labels.push_back({start,-1,-1,0,0,true});fronts[start].push_back(0);queue.push({distance(start),0,0});TerrainCost terrain(raster,cap,1);
  while(!queue.empty()){
   auto item=queue.top();queue.pop();if(!labels[item.index].active)continue;if(item.estimate>=upperCost)break;Label current=labels[item.index];
   if(current.node==goal){Trial t;t.cost=t.score=current.cost;t.length=current.length;int i=item.index;while(i>=0){auto l=labels[i];t.path.push_back({top+l.node/cols*mesh,left+l.node%cols*mesh});i=l.parent;}reverse(t.path.begin(),t.path.end());return t;}
   int r=current.node/cols,c=current.node%cols;
   for(int k=0;k<(int)moves.size();k++){
    auto&m=moves[k];int rr=r+m.row,cc=c+m.col;if(rr<0||cc<0||rr>=rows||cc>=cols)continue;int node=rr*cols+cc;Edge edge;
    if(!terrain.evaluate(top+r*mesh,left+c*mesh,m,edge))continue;double cost=current.cost+edge.cost,length=current.length+edge.length,remaining=distance(node);
    if(length+remaining>maxLength+.0001||cost+remaining>=upperCost)continue;
    bool dominated=false;for(int id:fronts[node]){auto&l=labels[id];if(l.active&&l.cost<=cost+1e-8&&l.length<=length+1e-8){dominated=true;break;}}
    if(dominated)continue;
    for(int id:fronts[node]){auto&l=labels[id];if(l.active&&cost<=l.cost+1e-8&&length<=l.length+1e-8)l.active=false;}
    auto&front=fronts[node];front.erase(remove_if(front.begin(),front.end(),[&](int id){return !labels[id].active;}),front.end());
    int id=labels.size();labels.push_back({node,item.index,k,cost,length,true});front.push_back(id);queue.push({cost+remaining,cost,id});
    if(labels.size()>5000000)throw runtime_error("Local Pareto frontier exceeded memory bound");
   }
  }
  return Trial{};
 }
 void refine(){
  TerrainCost terrain(raster,cap,1);
  for(passes=1;passes<=32;passes++){
   int improved=0;unresolved=0;worstGap=0;
   vector<double> distance(path.size(),0),cost(path.size(),0);
   auto measure=[&](){distance.assign(path.size(),0);cost.assign(path.size(),0);for(size_t i=1;i<path.size();i++){auto e=edge(path[i-1],path[i],terrain);distance[i]=distance[i-1]+e.length;cost[i]=cost[i-1]+e.cost;}};
   measure();double next=margin;
   while(next+window<distance.back()-margin){
    size_t begin=lower_bound(distance.begin(),distance.end(),next)-distance.begin(),end=lower_bound(distance.begin(),distance.end(),next+window)-distance.begin();
    while(begin<end&&begin>0&&(path[begin].first%4||path[begin].second%4))begin++;
    while(end>begin&&(path[end].first%4||path[end].second%4))end--;
    next+=stride;if(begin>=end)continue;tested++;
    double oldCost=cost[end]-cost[begin],oldLength=distance[end]-distance[begin],limit=oldLength+max(0.,bound-distance.back()),tol=max(absoluteTolerance,oldCost*.005);
    Trial t=search(begin,end,0);double lower=t.cost;Trial best;
    if(t.length<=limit+.001)best=t;
    if(t.cost<oldCost-tol&&t.length>limit+.001){
     double lo=0,hi=1;
     for(int k=0;k<7;k++){
      Trial q=search(begin,end,hi);lower=max(lower,q.score-hi*limit);
      if(q.length<=limit+.001){if(q.cost<best.cost)best=q;break;}lo=hi;hi*=4;
     }
     for(int k=0;k<10&&lower<oldCost-tol;k++){
      double mid=(lo+hi)/2;Trial q=search(begin,end,mid);lower=max(lower,q.score-mid*limit);
      if(q.length<=limit+.001){hi=mid;if(q.cost<best.cost)best=q;}else lo=mid;
      if(best.cost<oldCost-tol)break;
     }
    }
    if(best.cost>=oldCost-tol&&lower<oldCost-tol){
     Trial exact=constrainedSearch(begin,end,limit,oldCost-tol);
     if(exact.cost<oldCost-tol)best=exact;else lower=oldCost-tol;
    }
    if(best.cost<oldCost-tol){
     path.erase(path.begin()+begin,path.begin()+end+1);path.insert(path.begin()+begin,best.path.begin(),best.path.end());changes++;improved++;measure();
    }else if(lower<oldCost-tol){unresolved++;worstGap=max(worstGap,oldCost-lower);}
   }
   if(!improved)break;
  }
 }
};
#ifndef FROST_LOCAL_LIBRARY
int main(int argc,char**argv){
 try{
  if(argc!=9&&argc!=10)throw runtime_error("root width height cap bound input output report");
  LocalRefiner refiner(argv[1],stoi(argv[2]),stoi(argv[3]),stod(argv[4]),stod(argv[5]),argv[6],argc==10&&string(argv[9])=="micro");refiner.refine();ofstream out(argv[7],ios::binary);for(auto[r,c]:refiner.path){out.write((char*)&r,4);out.write((char*)&c,4);}
  ofstream report(argv[8]);report<<"{\"passes\":"<<refiner.passes<<",\"tested_windows\":"<<refiner.tested<<",\"improvements\":"<<refiner.changes<<",\"unresolved_windows\":"<<refiner.unresolved<<",\"maximum_unresolved_gain_bound_m\":"<<refiner.worstGap<<",\"window_length_m\":"<<refiner.window<<",\"window_stride_m\":"<<refiner.stride<<",\"buffer_m\":"<<refiner.buffer<<",\"mesh_m\":"<<refiner.mesh<<",\"relative_tolerance\":0.005,\"absolute_tolerance_m\":"<<refiner.absoluteTolerance<<",\"converged\":"<<(refiner.passes<=32?"true":"false")<<"}\n";
 }catch(const exception&e){cerr<<e.what()<<"\n";return 1;}
}

#endif
