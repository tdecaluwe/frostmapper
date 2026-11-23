// Offline A* on an explicit mesh, integrating each edge over native 1 m cells.
// No coarse averages are used for slope, heading validity or the travel cost.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>
#include <numeric>
#include <queue>
#include <stdexcept>
#include <string>
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <vector>
using namespace std;
struct Raster {
 int width,height;const uint16_t* slopes;const uint16_t* headingSlopes;const int16_t* aspects;
 void* map(const string& file,size_t bytes) {
  int fd=open(file.c_str(),O_RDONLY);struct stat st{};
  if(fd<0||fstat(fd,&st)||size_t(st.st_size)!=bytes)throw runtime_error("Bad raster "+file);
  void* p=mmap(nullptr,bytes,PROT_READ,MAP_SHARED,fd,0);close(fd);
  if(p==MAP_FAILED)throw runtime_error("Cannot mmap "+file);return p;
 }
 Raster(string root,int w,int h):width(w),height(h) {
  slopes=(const uint16_t*)map(root+"/slope.u16",size_t(w)*h*2);
  headingSlopes=(const uint16_t*)map(root+"/heading-slope.u16",size_t(w)*h*2);
  aspects=(const int16_t*)map(root+"/aspect.i16",size_t(w)*h*2);
 }
};
struct Hit{int row,col;float fraction;};
struct Move{int row,col;double length,ux,uy;vector<Hit> hits;};
struct Edge {double length=0,cost=0,exposure=0,maximum=0;};
class TerrainCost {
 const Raster& raster;double cap,weight;vector<double> slopeCost,threshold,cosAspect,sinAspect;
 public:
 TerrainCost(const Raster& r,double c,double w,double pressure=0):raster(r),cap(c),weight(w),slopeCost(9002),threshold(9002),cosAspect(36001),sinAspect(36001) {
  for(int i=1;i<9002;i++) {double slope=(i-1)*.01; double grade=tan(slope*M_PI/180);slopeCost[i]=1+pressure+weight*(10*grade+pow(6.,5*grade-1)-1./6);threshold[i]=cos(max(0.,90-3*slope-.02)*M_PI/180);}
  for(int i=0;i<=36000;i++){cosAspect[i]=cos((i-18000)*.01*M_PI/180);sinAspect[i]=sin((i-18000)*.01*M_PI/180);}
 }
 bool evaluate(int row,int col,const Move& move,Edge& edge) const {
  for(const auto& hit:move.hits){
   int y=row+hit.row,x=col+hit.col;if(x<0||x>=raster.width||y<0||y>=raster.height)return false;
   size_t i=size_t(y)*raster.width+x;int code=raster.slopes[i];
   if(!code||code>9001||(code-1)*.01>cap)return false;
   if(hit.fraction<=1e-9)continue;
   int heading=raster.headingSlopes[i];if(!heading||heading>3001)return false;
   if(heading>1001){
    int a=raster.aspects[i]+18000;
    if(a<0||a>36000||abs(cosAspect[a]*move.ux+sinAspect[a]*move.uy)<threshold[heading])return false;
   }
   double length=hit.fraction*move.length;
   edge.length+=length;edge.cost+=length*slopeCost[code];
   if(code>1501)edge.exposure+=length;
   edge.maximum=max(edge.maximum,(code-1)*.01);
  }
  return true;
 }
};
vector<Move> makeMoves(int mesh,int radius) {
 vector<Move> moves;
 for(int dr=-radius;dr<=radius;dr++)for(int dc=-radius;dc<=radius;dc++){
  if((!dr&&!dc)||gcd(abs(dr),abs(dc))!=1)continue;
  int rr=dr*mesh,cc=dc*mesh;double len=hypot(rr,cc);Move m{dr,dc,len,cc/len,rr/len,{}};
  for(int r=min(0,rr)-1;r<=max(0,rr)+1;r++)for(int c=min(0,cc)-1;c<=max(0,cc)+1;c++){
   double a=0,b=1;bool valid=true;
   for(int axis=0;axis<2;axis++){double v=axis?cc:rr,p=axis?c:r;
    if(!v){if(abs(p)>.5)valid=false;}else{double low=(p-.5)/v,high=(p+.5)/v;if(low>high)swap(low,high);a=max(a,low);b=min(b,high);}
   }
   if(valid&&b>=a-1e-10)m.hits.push_back({r,c,float(max(0.,b-a))});
  }
  moves.push_back(move(m));
 }
 return moves;
}
struct Node{double estimate,cost;int index;bool operator<(const Node& b)const{return estimate>b.estimate;}};
// Refine the two hut neighborhoods at 1 m. This avoids a coarse mesh trapping
// the start behind a small rock band, without allocating a whole-region 1 m graph.
struct EndpointPatch {
 int row,col,top,left,size;vector<double> cost;vector<float> length;vector<uint8_t> parent;
 const vector<Move>& moves;
 EndpointPatch(int r,int c,int radius,const Raster& raster,const TerrainCost& terrain,const vector<Move>& unitMoves):row(r),col(c),top(r-radius),left(c-radius),size(radius*2+1),cost(size*size,INFINITY),length(size*size,INFINITY),parent(size*size,255),moves(unitMoves) {
  int start=radius*size+radius;cost[start]=length[start]=0;priority_queue<Node> queue;queue.push({0,0,start});
  while(!queue.empty()){
   Node n=queue.top();queue.pop();if(n.cost!=cost[n.index])continue;
   int y=n.index/size,x=n.index%size;
   for(int k=0;k<(int)moves.size();k++){
    auto& m=moves[k];int yy=y+m.row,xx=x+m.col;
    if(yy<0||xx<0||yy>=size||xx>=size)continue;
    Edge edge;if(!terrain.evaluate(top+y,left+x,m,edge))continue;
    int j=yy*size+xx;double nc=n.cost+edge.cost;
    if(nc+1e-8<cost[j]){cost[j]=nc;length[j]=length[n.index]+edge.length;parent[j]=k;queue.push({nc,nc,j});}
   }
  }
 }
 int index(int r,int c)const {r-=top;c-=left;return r<0||c<0||r>=size||c>=size?-1:r*size+c;}
 vector<pair<int,int>> towardAnchor(int r,int c)const {
  vector<pair<int,int>> path;int i=index(r,c);if(i<0||!isfinite(cost[i]))throw runtime_error("Invalid endpoint connector");
  while(true){path.push_back({top+i/size,left+i%size});int k=parent[i];if(k==255)break;i-=moves[k].row*size+moves[k].col;}
  return path;
 }
};
#ifndef FROST_ROUTING_LIBRARY
int main(int argc,char**argv){
 if(argc<15){cerr<<"root width height startRow startCol goalRow goalCol cap penaltyMultiplier maxDistance mesh radius mask output\n";return 1;}
 try{
  string root=argv[1],output=argv[14];int W=stoi(argv[2]),H=stoi(argv[3]),sr=stoi(argv[4]),sc=stoi(argv[5]),tr=stoi(argv[6]),tc=stoi(argv[7]);
  double cap=stod(argv[8]),weight=stod(argv[9]),bound=stod(argv[10]);int mesh=stoi(argv[11]),radius=stoi(argv[12]);
  if(mesh<1||radius<1||weight<=0||cap<0||cap>=90||bound<=0)throw runtime_error("Invalid parameters");
  double pressure=argc>15?stod(argv[15]):0;
  Raster raster(root,W,H);TerrainCost terrain(raster,cap,weight,pressure);auto moves=makeMoves(mesh,radius),unitMoves=makeMoves(1,2);
  int patchRadius=mesh==1?0:250;
  EndpointPatch startPatch(sr,sc,patchRadius,raster,terrain,unitMoves),goalPatch(tr,tc,patchRadius,raster,terrain,unitMoves);
  if(moves.size()>254)throw runtime_error("Too many directions");
  int rows=(H-1)/mesh+1,cols=(W-1)/mesh+1;
  if(min({sr,sc,tr,tc})<0||sr>=H||tr>=H||sc>=W||tc>=W)throw runtime_error("Endpoint outside raster");
  vector<unsigned char> forbidden;
  if(string(argv[13])!="-"){forbidden.resize(size_t(rows)*cols);ifstream f(argv[13],ios::binary);if(!f.read((char*)forbidden.data(),forbidden.size()))throw runtime_error("Cannot read mesh mask");}
  vector<double> cost(size_t(rows)*cols,INFINITY);vector<float> length(cost.size(),INFINITY);vector<uint8_t> parent(cost.size(),255);
  auto heuristic=[&](int r,int c){return hypot(r*mesh-tr,c*mesh-tc);};
  priority_queue<Node> queue;long expanded=0;int closest=-1,goal=-1;double closestDistance=INFINITY,best=INFINITY;
  for(int r=max(0,(sr-patchRadius)/mesh);r<rows&&r*mesh<=sr+patchRadius;r++)for(int c=max(0,(sc-patchRadius)/mesh);c<cols&&c*mesh<=sc+patchRadius;c++){
   int j=startPatch.index(r*mesh,c*mesh),i=r*cols+c;
   if(j<0||!isfinite(startPatch.cost[j]))continue;
   if(!forbidden.empty()&&forbidden[i])continue;
   cost[i]=startPatch.cost[j];length[i]=startPatch.length[j];parent[i]=254;queue.push({cost[i]+(1+pressure)*heuristic(r,c),cost[i],i});
  }
  while(!queue.empty()){
   Node n=queue.top();queue.pop();if(n.cost!=cost[n.index])continue;if(n.estimate>=best)break;
   int r=n.index/cols,c=n.index%cols;expanded++;
   if(heuristic(r,c)<closestDistance){closestDistance=heuristic(r,c);closest=n.index;}
   int gi=goalPatch.index(r*mesh,c*mesh);
   if(gi>=0&&isfinite(goalPatch.cost[gi])&&n.cost+goalPatch.cost[gi]<best){best=n.cost+goalPatch.cost[gi];goal=n.index;}
   for(int k=0;k<(int)moves.size();k++){
    const auto& m=moves[k];int rr=r+m.row,cc=c+m.col;
    if(rr<0||rr>=rows||cc<0||cc>=cols||hypot(rr*mesh-sr,cc*mesh-sc)+heuristic(rr,cc)>bound)continue;
    int j=rr*cols+cc;if(!forbidden.empty()&&forbidden[j])continue;
    Edge e;if(!terrain.evaluate(r*mesh,c*mesh,m,e))continue;
    double nd=length[n.index]+e.length;
    double nc=n.cost+e.cost;
    if(nc+1e-8<cost[j]){cost[j]=nc;length[j]=nd;parent[j]=k;queue.push({nc+(1+pressure)*heuristic(rr,cc),nc,j});}
   }
  }
  if(goal<0){cout<<"{\"feasible\":false,\"expanded\":"<<expanded<<",\"closest_distance_m\":"<<(isfinite(closestDistance)?closestDistance:-1)<<",\"closest_row\":"<<(closest<0?-1:closest/cols*mesh)<<",\"closest_col\":"<<(closest<0?-1:closest%cols*mesh)<<"}\n";return 2;}
  vector<pair<int,int>> coarse;int i=goal;
  while(true){coarse.push_back({i/cols*mesh,i%cols*mesh});int k=parent[i];if(k==254)break;if(k==255)throw runtime_error("Broken path");i-=moves[k].row*cols+moves[k].col;}
  reverse(coarse.begin(),coarse.end());auto path=startPatch.towardAnchor(coarse[0].first,coarse[0].second);reverse(path.begin(),path.end());path.insert(path.end(),coarse.begin()+1,coarse.end());
  auto tail=goalPatch.towardAnchor(path.back().first,path.back().second);path.insert(path.end(),tail.begin()+1,tail.end());
  double distance=0,exposure=0,maximum=0,actualCost=0;
  for(size_t i=1;i<path.size();i++){
   int dr=path[i].first-path[i-1].first,dc=path[i].second-path[i-1].second;const Move* move=nullptr;
   for(const auto& m:moves)if(dr==m.row*mesh&&dc==m.col*mesh){move=&m;break;}
   if(!move)for(const auto& m:unitMoves)if(dr==m.row&&dc==m.col){move=&m;break;}
   Edge e;if(!move||!terrain.evaluate(path[i-1].first,path[i-1].second,*move,e))throw runtime_error("Invalid reconstructed edge");
   distance+=e.length;actualCost+=e.cost;exposure+=e.exposure;maximum=max(maximum,e.maximum);
  }
  
  ofstream out(output,ios::binary);for(auto [r,c]:path){out.write((char*)&r,4);out.write((char*)&c,4);}
  cout<<"{\"feasible\":true,\"distance_m\":"<<distance<<",\"within_distance_limit\":"<<(distance<=bound+.01?"true":"false")<<",\"distance_pressure\":"<<pressure<<",\"weighted_cost_m\":"<<(actualCost-pressure*distance)<<",\"distance_above_15_m\":"<<exposure<<",\"max_slope_deg\":"<<maximum<<",\"expanded\":"<<expanded<<",\"mesh_m\":"<<mesh<<",\"endpoint_refinement_m\":"<<patchRadius<<"}\n";
 }catch(const exception&e){cerr<<e.what()<<"\n";return 1;}
}

#endif
