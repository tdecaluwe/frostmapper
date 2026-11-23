// Whole-route descent in a sparse, moving corridor. The input route supplies
// the initial upper bound only: no intermediate vertices are pinned.
#define FROST_ROUTING_LIBRARY
#include "kartverket-search.cpp"
#include <array>
#include <chrono>
#include <map>
using Point=pair<int,int>;
struct Range {int first,last,stride,offset;};
class CorridorGraph {
 const Raster& raster;
 vector<vector<pair<int,int>>> fine,coarse;
 public:
 vector<vector<Range>> rows;
 vector<Point> points;
 CorridorGraph(const Raster& r,const vector<Point>& path,int radius,int fineRadius):raster(r),fine(r.height),coarse(r.height),rows(r.height){
  auto stamp=[&](Point p,int rad,bool dense){
   for(int y=max(0,p.first-rad);y<=min(r.height-1,p.first+rad);y++){
    if(!dense&&y%4)continue;
    int dx=int(sqrt(double(rad)*rad-double(y-p.first)*(y-p.first)));
    int a=max(0,p.second-dx),b=min(r.width-1,p.second+dx);
    (dense?fine:coarse)[y].push_back({a,b});
   }
  };
  // Sampling plus padding encloses the complete polyline corridor. Every
  // original vertex is dense, so its valid edges remain available verbatim.
  double since=1e9;for(size_t i=0;i<path.size();i++){
   since+=i?hypot(path[i].first-path[i-1].first,path[i].second-path[i-1].second):0;
   stamp(path[i],fineRadius,true);
   if(since>=32||i+1==path.size()){stamp(path[i],radius+32,false);since=0;}
  }
  auto merge=[](vector<pair<int,int>>& ranges){sort(ranges.begin(),ranges.end());size_t n=0;for(auto q:ranges){if(n&&q.first<=ranges[n-1].second+1)ranges[n-1].second=max(q.second,ranges[n-1].second);else ranges[n++]=q;}ranges.resize(n);};
  for(int y=0;y<r.height;y++){
   auto& fs=fine[y];auto& cs=coarse[y];merge(fs);merge(cs);
   for(auto [a,b]:fs)rows[y].push_back({a,b,1,0});
   for(auto [a,b]:cs){int next=a;for(auto [fa,fb]:fs){if(fb<next)continue;if(fa>b)break;addCoarse(y,next,min(b,fa-1));next=max(next,fb+1);}addCoarse(y,next,b);}
   sort(rows[y].begin(),rows[y].end(),[](auto a,auto b){return a.first<b.first;});
   for(auto& segment:rows[y]){segment.offset=points.size();for(int x=segment.first;x<=segment.last;x+=segment.stride)points.push_back({y,x});}
   vector<pair<int,int>>().swap(fs);vector<pair<int,int>>().swap(cs);
  }
 }
 void addCoarse(int y,int a,int b){if(a>b)return;a=(a+3)/4*4;b=b/4*4;if(a<=b)rows[y].push_back({a,b,4,0});}
 int index(int y,int x)const {
  if(y<0||y>=raster.height||x<0||x>=raster.width)return -1;
  const auto& list=rows[y];auto it=upper_bound(list.begin(),list.end(),x,[](int x,const Range& r){return x<r.first;});
  if(it==list.begin())return -1;--it;
  if(x>it->last||(x-it->first)%it->stride)return -1;
  return it->offset+(x-it->first)/it->stride;
 }
};
int main(int argc,char**argv){try{
 if(argc!=10)throw runtime_error("root width height cap input output radius fineRadius report");
 auto began=chrono::steady_clock::now();Raster raster(argv[1],stoi(argv[2]),stoi(argv[3]));double cap=stod(argv[4]);vector<Point> path;ifstream input(argv[5],ios::binary);int r,c;while(input.read((char*)&r,4)&&input.read((char*)&c,4))path.push_back({r,c});if(path.size()<2)throw runtime_error("Empty route");
 int radius=stoi(argv[7]),fineRadius=stoi(argv[8]);if(radius<fineRadius||fineRadius<1)throw runtime_error("Invalid corridor widths");
 TerrainCost terrain(raster,cap,1);vector<Move> moves;map<Point,int> edges;
 for(int mesh:{1,2,4})for(auto move:makeMoves(mesh,3)){move.row*=mesh;move.col*=mesh;if(edges.count({move.row,move.col}))continue;edges[{move.row,move.col}]=moves.size();moves.push_back(move);}
 auto score=[&](const vector<Point>& line){Edge total;for(size_t i=1;i<line.size();i++){auto it=edges.find({line[i].first-line[i-1].first,line[i].second-line[i-1].second});Edge edge;if(it==edges.end()||!terrain.evaluate(line[i-1].first,line[i-1].second,moves[it->second],edge))throw runtime_error("Invalid input edge");total.cost+=edge.cost;total.length+=edge.length;}return total;};
 Edge before=score(path);double tolerance=max(.25,before.cost*.0002),cutoff=before.cost-tolerance;
 CorridorGraph graph(raster,path,radius,fineRadius);int start=graph.index(path.front().first,path.front().second),goal=graph.index(path.back().first,path.back().second);if(start<0||goal<0)throw runtime_error("Endpoint absent");
 vector<double> cost(graph.points.size(),INFINITY);vector<int> parent(cost.size(),-1);priority_queue<Node> queue;
 auto heuristic=[&](int i){auto p=graph.points[i];return hypot(p.first-path.back().first,p.second-path.back().second);};
 cost[start]=0;queue.push({heuristic(start),0,start});long expanded=0;bool improved=false;
 while(!queue.empty()){
  Node n=queue.top();queue.pop();if(n.cost!=cost[n.index])continue;if(n.estimate>=cutoff)break;if(n.index==goal){improved=true;break;}
  expanded++;auto [row,col]=graph.points[n.index];
  for(auto& move:moves){int j=graph.index(row+move.row,col+move.col);if(j<0)continue;Edge edge;if(!terrain.evaluate(row,col,move,edge))continue;double nc=n.cost+edge.cost;
   if(nc+1e-8>=cost[j]||nc+heuristic(j)>=cutoff)continue;cost[j]=nc;parent[j]=n.index;queue.push({nc+heuristic(j),nc,j});
  }
 }
 if(improved){vector<Point> result;for(int i=goal;i>=0;i=parent[i]){result.push_back(graph.points[i]);if(i==start)break;}reverse(result.begin(),result.end());path=move(result);}
 Edge after=score(path);ofstream output(argv[6],ios::binary);for(auto [y,x]:path){output.write((char*)&y,4);output.write((char*)&x,4);}
 double elapsed=chrono::duration<double>(chrono::steady_clock::now()-began).count();ofstream report(argv[9]);report.precision(12);
 report<<"{\"improved\":"<<(improved?"true":"false")<<",\"cost_before_m\":"<<before.cost<<",\"cost_after_m\":"<<after.cost<<",\"distance_m\":"<<after.length<<",\"tolerance_m\":"<<tolerance<<",\"coarse_radius_m\":"<<radius<<",\"fine_radius_m\":"<<fineRadius<<",\"graph_nodes\":"<<graph.points.size()<<",\"expanded\":"<<expanded<<",\"seconds\":"<<elapsed<<",\"distance_constrained\":false,\"pinned_intermediate_points\":0}\n";
}catch(const exception& e){cerr<<e.what()<<"\n";return 1;}}
