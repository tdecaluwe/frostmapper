#include <cstdlib>
#include <vector>
#include <queue>
#include <fstream>
#include <iostream>
#include <cmath>
#include <limits>
#include <algorithm>
#include <numeric>
using namespace std;
struct Hit{int r,c;double weight;};
struct Move{int r,c;double length,ux,uy;vector<Hit> hits;};
struct Node{double f,cost;int i;bool operator<(const Node&b)const{return f>b.f;}};
// Offline candidate search: exposure + lambda * distance. Heading validity is
// cached lazily; every positive-length segment/cell intersection is checked.
// The geometric bound excludes nodes outside any length-eligible route but
// does not enforce total travelled length. The exporter filters that length.
int main(int argc,char**argv){
 if(argc<11){cerr<<"Usage: exposure H W sr sc tr tc cap lambda output bound [radius] [mask]\n";return 1;}
 auto readFile=[](const char*path,void*data,size_t bytes){ifstream file(path,ios::binary);if(!file.read((char*)data,bytes)){cerr<<"Cannot read "<<path<<"\n";exit(1);}};
 int H=atoi(argv[1]),W=atoi(argv[2]),sr=atoi(argv[3]),sc=atoi(argv[4]),tr=atoi(argv[5]),tc=atoi(argv[6]);double cap=atof(argv[7]),lambda=atof(argv[8]),bound=atof(argv[10]);string output=argv[9];int R=argc>11?atoi(argv[11]):4;
 if(H<=0||W<=0||lambda<=0||R<1||cap<0){cerr<<"Invalid search parameters\n";return 1;}
 vector<float>s(H*W),h(H*W);readFile("slope-float.bin",s.data(),s.size()*4);readFile("height.bin",h.data(),h.size()*4);
 vector<unsigned char>nearSteep(H*W);readFile("near-steep.bin",nearSteep.data(),nearSteep.size());
 vector<unsigned char>forbidden(H*W,0);if(argc>12)readFile(argv[12],forbidden.data(),forbidden.size());
 vector<double>spacing(H);readFile("spacing.bin",spacing.data(),H*8);double ms=*min_element(spacing.begin(),spacing.end());
 vector<Move>moves;
 for(int dr=-R;dr<=R;dr++)for(int dc=-R;dc<=R;dc++){
  if((!dr&&!dc)||gcd(abs(dr),abs(dc))!=1)continue;Move m{dr,dc,hypot(dr,dc)};m.ux=dc/m.length;m.uy=dr/m.length;
  for(int r=min(0,dr)-1;r<=max(0,dr)+1;r++)for(int c=min(0,dc)-1;c<=max(0,dc)+1;c++){
   double a=0,b=1;bool valid=true;
   for(int axis=0;axis<2;axis++){double v=axis?dc:dr,p=axis?c:r;
    if(!v){if(abs(p)>.5)valid=false;}else{double low=(p-.5)/v,high=(p+.5)/v;if(low>high)swap(low,high);a=max(a,low);b=min(b,high);}
   }
   if(valid&&b>=a-1e-10)m.hits.push_back({r,c,max(0.,b-a)});
  }
  moves.push_back(m);
 }
 int K=moves.size(),words=(K+63)/64;vector<unsigned long long>allowed((size_t)H*W*words,0);vector<unsigned char>computed(H*W,0);
 auto permits=[&](int i,int k){
  if(s[i]<=10)return true;
  if(!computed[i]){
   computed[i]=1;int r=i/W,c=i%W;double gx=h[r*W+min(W-1,c+1)]-h[r*W+max(0,c-1)],gy=h[min(H-1,r+1)*W+c]-h[max(0,r-1)*W+c];double norm=hypot(gx,gy),angle=30-s[i];
   if(angle>=0&&norm>0){double threshold=cos(angle*M_PI/180);
    for(int j=0;j<K;j++)if(abs(gx*moves[j].ux+gy*moves[j].uy)/norm>=threshold-1e-12)allowed[(size_t)i*words+j/64]|=1ULL<<(j%64);
   }
  }
  return ((allowed[(size_t)i*words+k/64]>>(k%64))&1ULL)!=0;
 };
 vector<double>cost(H*W,numeric_limits<double>::infinity()),distance(H*W,numeric_limits<double>::infinity());vector<short>prev(H*W,-1);
 int start=sr*W+sc,goal=tr*W+tc;priority_queue<Node>queue;
 auto heuristic=[&](int r,int c){return hypot(r-tr,c-tc)*ms*lambda;};
 cost[start]=distance[start]=0;queue.push({heuristic(sr,sc),0,start});long expanded=0;
 auto edge=[&](int r,int c,int k,double &length,double &exposure,double &maximum,double &deviation,bool stats=false){
  auto&m=moves[k];int rr=r+m.r,cc=c+m.c;if(rr<0||rr>=H||cc<0||cc>=W)return false;
  if((hypot(rr-sr,cc-sc)+hypot(rr-tr,cc-tc))*ms>bound)return false;
  double sum=0;maximum=0;deviation=0;exposure=0;
  for(auto&hit:m.hits){
   int y=r+hit.r,x=c+hit.c;if(y<0||y>=H||x<0||x>=W)return false;int i=y*W+x;
   if(forbidden[i]||!isfinite(s[i])||s[i]>cap)return false;
   if(stats&&hit.weight>1e-9)maximum=max(maximum,(double)s[i]);
   if(hit.weight>1e-9){if(!permits(i,k))return false;sum+=spacing[y]*hit.weight;if(s[i]>15)exposure+=spacing[y]*hit.weight;
    if(stats&&s[i]>10){double gx=h[y*W+min(W-1,x+1)]-h[y*W+max(0,x-1)],gy=h[min(H-1,y+1)*W+x]-h[max(0,y-1)*W+x];deviation=max(deviation,acos(min(1.,abs(gx*m.ux+gy*m.uy)/hypot(gx,gy)))*180/M_PI);}
   }
  }
  length=sum*m.length;exposure*=m.length;return true;
 };
 while(!queue.empty()){
  auto n=queue.top();queue.pop();if(n.cost>cost[n.i]+1e-8)continue;if(n.i==goal)break;
  int r=n.i/W,c=n.i%W;expanded++;
  for(int k=0;k<K;k++){
   if(!permits(n.i,k))continue;auto&m=moves[k];if(!nearSteep[n.i]&&(abs(m.r)>2||abs(m.c)>2))continue;int rr=r+m.r,cc=c+m.c;if(rr<0||rr>=H||cc<0||cc>=W)continue;
   double len,expo,maximum,deviation;if(!edge(r,c,k,len,expo,maximum,deviation))continue;
   int j=rr*W+cc;double nc=cost[n.i]+expo+lambda*len,nd=distance[n.i]+len;
   if(nc<cost[j]-1e-7||(abs(nc-cost[j])<1e-7&&nd<distance[j])){cost[j]=nc;distance[j]=nd;prev[j]=k;queue.push({nc+heuristic(rr,cc),nc,j});}
  }
 }
 if(!isfinite(cost[goal])){cout<<"{\"feasible\":false,\"expanded\":"<<expanded<<"}"<<endl;return 2;}
 vector<int>path;int i=goal;double steep=0,maximum=0,dev=0;
 while(i!=start){path.push_back(i);int k=prev[i];if(k<0)return 3;auto&m=moves[k];int p=i-m.r*W-m.c;double l,e,g,d;edge(p/W,p%W,k,l,e,g,d,true);steep+=e;maximum=max(maximum,g);dev=max(dev,d);i=p;}
 path.push_back(start);ofstream out(output,ios::binary);for(auto it=path.rbegin();it!=path.rend();it++){int r=*it/W,c=*it%W;out.write((char*)&r,4);out.write((char*)&c,4);}
 cout<<"{\"feasible\":true,\"distance_m\":"<<distance[goal]<<",\"distance_above_15_m\":"<<steep<<",\"maximum_slope_deg\":"<<maximum<<",\"maximum_fallline_deviation_deg\":"<<dev<<",\"cost\":"<<cost[goal]<<",\"expanded\":"<<expanded<<",\"directions\":"<<K<<"}"<<endl;
}
