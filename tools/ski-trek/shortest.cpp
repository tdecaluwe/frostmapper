#include <vector>
#include <queue>
#include <fstream>
#include <iostream>
#include <cmath>
#include <limits>
using namespace std;
struct Node{double f,d;int i;bool operator<(const Node& b)const{return f>b.f;}};
int main(int argc,char**argv){
 int H=atoi(argv[1]),W=atoi(argv[2]),sr=atoi(argv[3]),sc=atoi(argv[4]),tr=atoi(argv[5]),tc=atoi(argv[6]),limit=atoi(argv[7]);
 vector<unsigned short>s(H*W);ifstream("slope.bin",ios::binary).read((char*)s.data(),s.size()*2);
 vector<double> spacing(H);ifstream("spacing.bin",ios::binary).read((char*)spacing.data(),H*8);
 double maxDistance=argc>9?atof(argv[9]):1e100;
 double ms=spacing[0];for(auto a:spacing)ms=min(ms,a);
 vector<double>d(H*W,numeric_limits<double>::infinity());vector<unsigned char>prev(H*W,255);
 int dr[]={-1,-1,-1,0,0,1,1,1},dc[]={-1,0,1,-1,1,-1,0,1};
 int start=sr*W+sc,goal=tr*W+tc;priority_queue<Node>q;
 auto heuristic=[&](int r,int c){return hypot(r-tr,c-tc)*ms;};
 d[start]=0;q.push({heuristic(sr,sc),0,start});long expanded=0;
 while(!q.empty()){
  auto a=q.top();q.pop();if(a.d>d[a.i]+1e-8)continue;if(a.f>maxDistance)break;if(a.i==goal)break;
  int r=a.i/W,c=a.i%W;expanded++;
  for(int k=0;k<8;k++){
   int rr=r+dr[k],cc=c+dc[k];if(rr<0||rr>=H||cc<0||cc>=W)continue;int j=rr*W+cc;
   if(s[j]>limit)continue;
   if(dr[k]&&dc[k]&&(s[r*W+cc]>limit||s[rr*W+c]>limit))continue;
   double nd=d[a.i]+hypot(dr[k],dc[k])*(spacing[r]+spacing[rr])*.5;
   if(nd+heuristic(rr,cc)<=maxDistance && nd<d[j]-1e-8){d[j]=nd;prev[j]=k;q.push({nd+heuristic(rr,cc),d[j],j});}
  }
 }
 if(!isfinite(d[goal])){cerr<<"No path\n";return 2;}
 vector<int>path;int i=goal;
 while(i!=start){path.push_back(i);int k=prev[i];if(k==255)return 3;i-=(dr[k]*W+dc[k]);}path.push_back(start);
 ofstream out(argv[8],ios::binary);for(auto it=path.rbegin();it!=path.rend();it++){int r=*it/W,c=*it%W;out.write((char*)&r,4);out.write((char*)&c,4);}
 cout<<"{\"distance_m\":"<<d[goal]<<",\"cells\":"<<path.size()<<",\"expanded\":"<<expanded<<"}"<<endl;
}
