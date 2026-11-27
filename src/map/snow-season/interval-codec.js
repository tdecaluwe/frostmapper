/** Fixed-length ordered endpoints. Snow years use five half-open intervals. */
// Bounded 52-bit arithmetic state, no ranks, tables, or BigInts.
const falling=(t,o)=>{let p=t;for(let j=1;j<o;j++)p*=t-j;return p;};

export class NestedIntervalCodec {
  constructor(count, days=365) {
    if (!Number.isInteger(count) || count<1 || count>100 || ![365,366,367].includes(days)) throw new RangeError('Unsupported format');
    this.count=count;
    this.days=days;
    this.endpoints=2*count;
    let logStates=0;
    for(let j=1;j<=this.endpoints;j++)logStates+=Math.log2((days-1+j)/j);
    this.bitLength=Math.ceil(logStates);
    this.byteLength=Math.ceil(this.bitLength/8);
    // Select a tail size whose worst-case rounding loss fits the format's
    // unused code space. This depends only on count/year, never on the data.
    const margin=1-2**(logStates-this.bitLength),N=days-1+this.endpoints;
    this.tail=Math.min(6,this.endpoints);
    for(;;){
      let states=1;
      for(let j=1;j<=this.tail;j++)states=states*(days-1+j)/j;
      const loss=(4*states+4*N*N+4*(this.tail-1))/1125899906842624;
      if(loss<margin)break;
      if(--this.tail<1)throw new Error('Insufficient precision');
    }
  }

  encode(intervals) {
    const k=this.count,n=this.endpoints,B=this.bitLength;
    if(intervals.length!==k)throw new RangeError('Incorrect interval count');
    for(let i=0;i<k;i++){
      const [s,e]=intervals[i];
      if(!Number.isInteger(s)||!Number.isInteger(e)||s<0||e>=this.days||s>e||
         (i&&(s<intervals[i-1][0]||e>intervals[i-1][1])))throw new RangeError('Invalid nesting');
    }
    const data=new Uint8Array(this.byteLength);
    let bitIndex=0,sticky=0,lo=0,hi=4503599627370495,pending=0,o=n,z=this.days-1,previous=0;
    const put=b=>{
      if(bitIndex<B)data[bitIndex>>>3]|=b<<(7-(bitIndex&7));
      else sticky|=b;
      bitIndex++;
    };
    const emit=b=>{
      put(b);
      while(pending){put(1-b);pending--;}
    };
    // A zero run is simply the difference between successive endpoint dates.
    for(let i=0;i<n && z && o;i++){
      const date=i<k?intervals[i][0]:intervals[n-1-i][1];
      const zeros=date-previous;
      previous=date;
      if(o<=this.tail && (o===1 || z>24*o)) {
        const base=lo,R=hi-lo+1,t=z+o;
        if(o===1){
          lo=base+Math.floor(R*(z-zeros)/(z+1));
          hi=base+Math.floor(R*(z-zeros+1)/(z+1))-1;
        }else{
          const den=falling(t,o);
          let a=t-zeros,upper=(falling(a,o))/den;
          a--;
          const lower=zeros===z?0:(falling(a,o))/den;
          lo=base+Math.floor(R*lower);hi=base+Math.floor(R*upper)-1;
        }
        o--;z-=zeros;
        if(lo>hi)throw new Error('Collapsed interval');
        for(;;){
          if(hi<2251799813685248)emit(0);
          else if(lo>=2251799813685248){emit(1);lo-=2251799813685248;hi-=2251799813685248;}
          else if(lo>=1125899906842624&&hi<3377699720527872){pending++;lo-=1125899906842624;hi-=1125899906842624;}
          else break;
          lo*=2;hi=hi*2+1;
        }
        continue;
      }
      for(let j=0;j<=zeros;j++){
        if(!o||!z)break;
        const split=lo+Math.floor((hi-lo+1)*z/(o+z));
        if(j<zeros){hi=split-1;z--;}else{lo=split;o--;}
        for(;;){
          if(hi<2251799813685248)emit(0);
          else if(lo>=2251799813685248){emit(1);lo-=2251799813685248;hi-=2251799813685248;}
          else if(lo>=1125899906842624&&hi<3377699720527872){pending++;lo-=1125899906842624;hi-=1125899906842624;}
          else break;
          lo*=2;hi=hi*2+1;
        }
      }
    }
    emit(Math.floor(lo/2251799813685248));
    const remaining=B-bitIndex;
    if(remaining<0||remaining>51)throw new Error('Invalid termination width');
    for(let i=50;i>=51-remaining;i--)put(Math.floor(lo/2**i)%2);
    sticky|=Number(lo%2**(51-remaining)!==0);
    if(sticky){
      let i=B-1;
      for(;i>=0;i--){
        const mask=1<<(7-(i&7)),byte=i>>>3;
        if(!(data[byte]&mask)){data[byte]|=mask;break;}
        data[byte]&=~mask;
      }
      if(i<0)throw new Error('Point overflow');
    }
    return data;
  }

  decode(data) {
    if(data.length<this.byteLength)throw new RangeError('Truncated record');
    const n=this.endpoints,k=this.count,B=this.bitLength;
    const intervals=Array.from({length:k},()=>[0,0]);
    let bitIndex=52,lo=0,hi=4503599627370495,o=n,z=this.days-1,position=0,j=0;
    let v=0;
    for(let i=0;i<6;i++)v=v*256+(data[i]||0);
    v=v*16+((data[6]||0)>>>4);
    if(B<52){const padding=2**(52-B);v=Math.floor(v/padding)*padding;}
    const next=()=>{
      const i=bitIndex++;
      return i<B?(data[i>>>3]>>>(7-(i&7)))&1:0;
    };
    while(o){
      if(!z){
        for(;j<n;j++,position++){
          const date=position-j;
          if(j<k)intervals[j][0]=date;else intervals[n-1-j][1]=date;
        }
        break;
      }
      if(o<=this.tail && (o===1 || z>24*o)){
        const base=lo,R=hi-lo+1,t=z+o;
        let gap;
        if(o===1){
          gap=z-Math.floor(((v-base+1)*(z+1)-1)/R);
          // The estimate's product may exceed 53 bits; correct it against the
          // exact same boundaries used by the encoder (at most one step).
          while(gap<z && v<base+Math.floor(R*(z-gap)/(z+1)))gap++;
          while(gap>0 && v>=base+Math.floor(R*(z-gap+1)/(z+1)))gap--;
          lo=base+Math.floor(R*(z-gap)/(z+1));
          hi=base+Math.floor(R*(z-gap+1)/(z+1))-1;
        }else{
          const den=falling(t,o);
          let left=0,right=z;
          while(left<right){
            const middle=(left+right+1)>>>1,a=t-middle;
            const survival=(falling(a,o))/den;
            if(v<base+Math.floor(R*survival))left=middle;else right=middle-1;
          }
          gap=left;
          let a=t-gap,upper=(falling(a,o))/den;
          a--;
          const lower=gap===z?0:(falling(a,o))/den;
          lo=base+Math.floor(R*lower);hi=base+Math.floor(R*upper)-1;
        }
        position+=gap;z-=gap;o--;
        const date=position-j;
        if(j<k)intervals[j][0]=date;else intervals[n-1-j][1]=date;
        j++;position++;
        if(!o)break;
        for(;;){
          if(hi<2251799813685248){}
          else if(lo>=2251799813685248){lo-=2251799813685248;hi-=2251799813685248;v-=2251799813685248;}
          else if(lo>=1125899906842624&&hi<3377699720527872){lo-=1125899906842624;hi-=1125899906842624;v-=1125899906842624;}
          else break;
          lo*=2;hi=hi*2+1;v=v*2+next();
        }
        continue;
      }
      const split=lo+Math.floor((hi-lo+1)*z/(o+z));
      if(v<split){hi=split-1;z--;}
      else{
        lo=split;o--;
        const date=position-j;
        if(j<k)intervals[j][0]=date;else intervals[n-1-j][1]=date;
        j++;
      }
      position++;
      if(!o)break;
      for(;;){
        if(hi<2251799813685248){}
        else if(lo>=2251799813685248){lo-=2251799813685248;hi-=2251799813685248;v-=2251799813685248;}
        else if(lo>=1125899906842624&&hi<3377699720527872){lo-=1125899906842624;hi-=1125899906842624;v-=1125899906842624;}
        else break;
        lo*=2;hi=hi*2+1;v=v*2+next();
      }
    }
    return intervals;
  }
}
