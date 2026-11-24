const manifest={"layers": [[3, 64], [64, 64], [64, 128], [128, 128], [128, 256], [256, 256], [256, 256], [256, 256], [256, 512], [512, 256], [256, 256], [256, 256], [256, 256], [256, 128], [128, 128], [128, 64], [64, 64], [64, 3]], "encoder": 14022912, "decoder": 14027878, "sections": [[2880, 4718592], [4721600, 1024], [5763904, 2359296], [8123328, 1024], [8124480, 2359296], [10483904, 1024], [10485056, 2359296], [12844480, 1024], [12845632, 1179648], [14025408, 512], [4722752, 589824], [5312704, 512], [5313344, 294912], [5608384, 256], [5608768, 147456], [5756352, 256], [5756736, 6912], [5763776, 12]]};
const kernel64="AGFzbQEAAAABCAFgBH9/f38AAg8BA2VudgZtZW1vcnkCAAEDAgEABwgBBHRpbGUAAAr/AwH8AwIDfxV7IAAgA0ECdGohBCAEIANBAnRqIQUgBSADQQJ0aiEGA0AgAf0AAgAhByAB/QACECEIIAH9AAIgIQkgAf0AAjAhCiAA/QkCACELIAwgCyAH/eYB/eQBIQwgDSALIAj95gH95AEhDSAOIAsgCf3mAf3kASEOIA8gCyAK/eYB/eQBIQ8gAEEEaiEAIAT9CQIAIQsgECALIAf95gH95AEhECARIAsgCP3mAf3kASERIBIgCyAJ/eYB/eQBIRIgEyALIAr95gH95AEhEyAEQQRqIQQgBf0JAgAhCyAUIAsgB/3mAf3kASEUIBUgCyAI/eYB/eQBIRUgFiALIAn95gH95AEhFiAXIAsgCv3mAf3kASEXIAVBBGohBSAG/QkCACELIBggCyAH/eYB/eQBIRggGSALIAj95gH95AEhGSAaIAsgCf3mAf3kASEaIBsgCyAK/eYB/eQBIRsgBkEEaiEGIAFBwABqIQEgA0EBayIDDQALIAIgDP0LAgAgAiAN/QsCECACIA79CwIgIAIgD/0LAjAgAiAQ/QsCQCACIBH9CwJQIAIgEv0LAmAgAiAT/QsCcCACIBT9CwKAASACIBX9CwKQASACIBb9CwKgASACIBf9CwKwASACIBj9CwLAASACIBn9CwLQASACIBr9CwLgASACIBv9CwLwAQs=";
// NHWC activations; the model stores the original PyTorch OIHW float32 values.
async function buildNetwork(manifest, bytes, kernel, author) {
  const raw = new Float32Array(bytes, author ? 48 : 0);
  const maxK = Math.max(...manifest.layers.map(([cin]) => 9 * cin));
  const tileEnd = 4 * maxK + 64;
  const packedCount = manifest.layers.reduce((n,[cin,cout]) => n + 9*cin*Math.ceil(cout/16)*16, 0);
  const memory = new WebAssembly.Memory({initial: Math.ceil((tileEnd + packedCount)*4 / 65536)});
  const buf = new Float32Array(memory.buffer);
  const {instance} = await WebAssembly.instantiate(kernel, {env:{memory}});
  const multiply = instance.exports.tile;
  let cursor = 0, packed = tileEnd;
  const layers = manifest.layers.map(([cin,cout]) => {
    const start = packed, k = 9*cin;
    for (let o=0; o<cout; o++) {
      for (let i=0; i<cin; i++) {
        for (let p=0; p<9; p++) {
          buf[start+((o>>4)*k+p*cin+i)*16+(o%16)] = raw[cursor+(o*cin+i)*9+p];
        }
      }
    }
    packed += Math.ceil(cout/16)*k*16;
    cursor += cout*k;
    const bias = raw.slice(cursor,cursor+cout);
    cursor += cout;
    return {cin,cout,k,start,bias};
  });
  if (cursor !== raw.length) throw Error("模型长度与网络结构不符。");

  function conv(image, index, reflect, relu) {
    const {cin,cout,k,start,bias} = layers[index];
    const {data,w,h} = image, stride=w*cin, destination=new Float32Array(w*h*cout);
    // A one-pixel halo implements the encoder's zero padding or the decoder's reflection padding.
    const paddedW=w+2, row=paddedW*cin, padded=new Float32Array((h+2)*row);
    for(let y=0;y<h;y++) {
      const from=y*stride, to=(y+1)*row+cin;
      padded.set(data.subarray(from,from+stride),to);
      if(reflect) {
        padded.set(data.subarray(from+cin,from+2*cin),to-cin);
        padded.set(data.subarray(from+stride-2*cin,from+stride-cin),to+stride);
      }
    }
    if(reflect) {
      padded.copyWithin(0,2*row,3*row);
      padded.copyWithin((h+1)*row,(h-1)*row,h*row);
    }
    const out=4*maxK;
    for(let pix=0;pix<w*h;pix+=4) {
      const count=Math.min(4,w*h-pix);
      for(let s=0;s<count;s++) {
        const p=pix+s, origin=(Math.floor(p/w)*paddedW+p%w)*cin;
        for(let ky=0;ky<3;ky++) {
          const from=origin+ky*row;
          buf.set(padded.subarray(from,from+3*cin),s*k+ky*3*cin);
        }
      }
      for(let o=0;o<cout;o+=16) {
        multiply(0,(start+o*k)*4,out*4,k);
        const channels=Math.min(16,cout-o);
        for(let s=0;s<count;s++) {
          const at=(pix+s)*cout+o;
          for(let b=0;b<channels;b++) {
            const value=buf[out+16*s+b]+bias[o+b];
            destination[at+b]=relu ? Math.max(0,value) : value;
          }
        }
      }
    }
    return {w,h,c:cout,data:destination};
  }

  function encode(input) {
    let x=input;
    for(let layer=0;layer<9;layer++) {
      if(layer===2 || layer===4 || layer===8) x=maxPool(x,author);
      x=conv(x,layer,author,true);
    }
    return x;
  }
  return function run(content,style,alpha,progress=()=>{}) {
    progress("正在提取照片构图…");
    const c=encode(content);
    progress("正在读取画作笔触…");
    const s=encode(style), cs=statistics(c), ss=statistics(s);
    for(let i=0;i<c.data.length;i++) {
      const ch=i%c.c, value=c.data[i];
      const transferred=(value-cs.mean[ch])*ss.std[ch]/cs.std[ch]+ss.mean[ch];
      c.data[i]=alpha*transferred+(1-alpha)*value;
    }
    progress("正在重建画面…");
    let x=c;
    for(let j=0;j<9;j++) {
      if(j===1 || j===5 || j===7) x=upsample(x);
      x=conv(x,9+j,true,j!==8);
    }
    return x;
  };
}

function maxPool({w,h,c,data}, ceilMode) {
  const round=ceilMode ? Math.ceil : Math.floor;
  const width=round(w/2),height=round(h/2), out=new Float32Array(width*height*c);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const p=(2*y*w+2*x)*c, q=(y*width+x)*c;
    const right=2*x+1<w ? c : 0, down=2*y+1<h ? w*c : 0;
    for(let j=0;j<c;j++) out[q+j]=Math.max(data[p+j],data[p+right+j],data[p+down+j],data[p+down+right+j]);
  }
  return {w:width,h:height,c,data:out};
}

function upsample({w,h,c,data}) {
  const out=new Float32Array(4*w*h*c), row=2*w*c;
  for(let y=0;y<h;y++) {
    for(let x=0;x<w;x++) {
      const p=(y*w+x)*c, q=(4*y*w+2*x)*c, pixel=data.subarray(p,p+c);
      out.set(pixel,q); out.set(pixel,q+c);
    }
    out.copyWithin((2*y+1)*row,2*y*row,(2*y+1)*row);
  }
  return {w:2*w,h:2*h,c,data:out};
}

function statistics({w,h,c,data}) {
  const n=w*h, mean=new Float64Array(c), std=new Float64Array(c);
  for(let i=0;i<data.length;i++) mean[i%c]+=data[i];
  for(let j=0;j<c;j++) mean[j]/=n;
  for(let i=0;i<data.length;i++) std[i%c]+=(data[i]-mean[i%c])**2;
  // torch.var in the training code uses Bessel's correction.
  for(let j=0;j<c;j++) std[j]=Math.sqrt(std[j]/(n-1)+1e-5);
  return {mean,std};
}

const models=new Map();
const postStatus = message => self.postMessage({message});
async function getModelFile(name, size, embedded) {
  if (embedded) return Uint8Array.from(atob(embedded), c => c.charCodeAt(0));
  const response = await fetch(new URL(name, self.location.href));
  if (!response.ok) throw Error(name + " 下载失败（HTTP " + response.status + "）。");
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length !== size) throw Error(name + " 下载不完整。");
  return data;
}
async function loadModel(modelId, offline) {
  postStatus("正在载入模型（约 28 MB）…");
  const author=modelId==="author";
  const decoderSize=manifest.sections.reduce((sum,section)=>sum+section[1],0);
  const [encoder, decoder] = await Promise.all([
    getModelFile(author ? "author-encoder.bin" : "encoder.bin",manifest.encoder+(author ? 48 : 0),offline?.encoder),
    getModelFile(author ? "author-decoder.bin" : "decoder_epoch_10.pth",author ? decoderSize : manifest.decoder,offline?.decoder)
  ]);
  const raw=new Uint8Array(encoder.length+decoderSize);
  raw.set(encoder);
  if(author) {
    raw.set(decoder,encoder.length);
  } else {
    let at=encoder.length;
    for(const [offset,length] of manifest.sections) {
      raw.set(decoder.subarray(offset,offset+length),at);
      at+=length;
    }
  }
  // The author's VGG starts with a learned 1×1 RGB preprocessing convolution.
  const preprocess=author ? new Float32Array(encoder.buffer,encoder.byteOffset,12).slice() : null;
  const run=await buildNetwork(manifest,raw.buffer,Uint8Array.from(atob(kernel64), c=>c.charCodeAt(0)),author);
  return {run,preprocess};
}
const mean=[.485,.456,.406], std=[.229,.224,.225];
function normalized({width,height,data}, preprocess) {
  const out=new Float32Array(width*height*3);
  for(let i=0;i<width*height;i++) {
    for(let j=0;j<3;j++) {
      if(preprocess) {
        const offset=3*j;
        out[3*i+j]=(data[4*i]*preprocess[offset]+data[4*i+1]*preprocess[offset+1]+data[4*i+2]*preprocess[offset+2])/255+preprocess[9+j];
      } else {
        out[3*i+j]=(data[4*i+j]/255-mean[j])/std[j];
      }
    }
  }
  return {w:width,h:height,c:3,data:out};
}
self.onmessage=async ({data})=>{
  try {
    const id=data.model??"ours";
    if(id!=="ours" && id!=="author") throw Error("未知模型。");
    if(!models.has(id)) models.set(id,await loadModel(id,data.offline));
    const {run,preprocess}=models.get(id);
    const image=run(normalized(data.content,preprocess),normalized(data.style,preprocess),data.alpha,postStatus);
    const rgba=new Uint8ClampedArray(image.w*image.h*4);
    for(let p=0;p<image.w*image.h;p++) {
      for(let ch=0;ch<3;ch++) {
        const value=image.data[3*p+ch];
        if(!Number.isFinite(value)) throw Error("模型输出含非有限数值。");
        rgba[p*4+ch]=(preprocess ? value : value*std[ch]+mean[ch])*255;
      }
      rgba[p*4+3]=255;
    }
    self.postMessage({w:image.w,h:image.h,rgba},[rgba.buffer]);
  } catch(error) {self.postMessage({error:error.message});}
};
