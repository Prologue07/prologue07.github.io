const photos=["城楼石阶","商场中庭","夜游灯会"];
const paintings=["林间日光","星月夜","暖褐人像","蓝白色块","版画","点彩","花瓶","线描","几何构成","浓彩"];
const $=id=>document.getElementById(id);
const sides={
  c:{names:photos, prefix:"photo", selected:0},
  s:{names:paintings, prefix:"art", selected:1}
};
let photo=0, art=1, worker, busy=false, studioModel="ours", exhibitMode="original-ours", galleryLoading;
const frames=new Map(), loadedModels=new Set();
const modelNames={ours:"我们的模型",author:"论文作者模型"};
const asset=(prefix,i)=>gallery[prefix+"-"+i];

function makeChoices(parent, names, prefix, choose) {
  names.forEach((name,i)=>{
    const button=document.createElement("button"), img=new Image(), label=document.createElement("span");
    button.type="button";button.className="choice";img.src=asset(prefix,i);img.alt="";label.textContent=name;
    button.append(img,label);button.onclick=()=>choose(i);parent.append(button);
  });
}
function updateExhibit() {
  const key="print-"+photo+"-"+art;
  const modelPair=exhibitMode==="ours-author", showAuthor=exhibitMode!=="original-ours";
  $("before").src=modelPair ? gallery[key] : asset("photo",photo);
  $("after").src=showAuthor ? authorGallery[key] : gallery[key];
  const left=modelPair ? "我们" : "原片", right=showAuthor ? "论文作者" : "我们";
  $("compare").querySelector(".tag.left").textContent=left;
  $("compare").querySelector(".tag.right").textContent=right;
  $("before").alt=modelPair ? "我们的模型生成的作品" : "原始照片";
  $("after").alt=right+"的模型生成的作品";
  $("split").setAttribute("aria-label",left+"与"+right+"的对照分界线");
  $("pair-title").textContent=photos[photo]+" × "+paintings[art];
  for(const [id,n] of [["photos",photo],["paintings",art]]) {
    Array.from($(id).children).forEach((b,i)=>b.setAttribute("aria-pressed",String(i===n)));
  }
}
function loadAuthorGallery() {
  if(typeof authorGallery!=="undefined")return Promise.resolve();
  if(!galleryLoading)galleryLoading=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="author-gallery.js";
    script.onload=resolve;
    script.onerror=()=>{galleryLoading=null;script.remove();reject(Error("作者作品载入失败，请重新选择。"));};
    document.head.append(script);
  });
  return galleryLoading;
}
$("exhibit-mode").onchange=async()=>{
  const choice=$("exhibit-mode"), status=$("gallery-status");
  choice.disabled=true;
  try {
    if(choice.value!=="original-ours" && typeof authorGallery==="undefined"){
      status.hidden=false;status.textContent="正在载入作者作品…";await loadAuthorGallery();
    }
    exhibitMode=choice.value;updateExhibit();$("split").oninput();status.hidden=true;
  } catch(e){choice.value=exhibitMode;status.textContent=e.message;status.hidden=false;}
  finally{choice.disabled=false;}
};
function clearOutput() {
  for(const frame of frames.values())URL.revokeObjectURL(frame.url);
  frames.clear();hideOutput();
}
function hideOutput() {
  $("download").hidden=true;$("result").hidden=true;$("empty-art").hidden=false;
  $("status").textContent="等待生成";
}
function source(side) {
  const s=sides[side];
  return s.selected==="file" ? s.fileUrl : asset(s.prefix,s.selected);
}
function chooseSource(side,value) {
  sides[side].selected=value;
  $("pick-"+side).value=String(value);
  $("thumb-"+side).src=source(side);$("stack-"+side).src=source(side);clearOutput();
}
function selectExhibit(side,i) {
  if(side==="c") photo=i;else art=i;
  updateExhibit();
  if(!busy) chooseSource(side,i);
}
makeChoices($("photos"),photos,"photo",i=>selectExhibit("c",i));
makeChoices($("paintings"),paintings,"art",i=>selectExhibit("s",i));
updateExhibit();
$("split").oninput=()=>{const v=$("split").value;$("compare").style.setProperty("--split",v+"%");$("split").setAttribute("aria-valuetext",$("compare").querySelector(".tag.left").textContent+"占 "+v+"%");};
$("split").oninput();
function readImage(src) {
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);
    img.onerror=()=>reject(Error("图片无法解码，请选择浏览器能打开的 JPEG、PNG 或 WebP 图片。"));img.src=src;});
}
for(const [side,s] of Object.entries(sides)) {
  const pick=$("pick-"+side), file=$("file-"+side);
  s.names.forEach((name,i)=>pick.add(new Option(name,i)));
  pick.onchange=()=>chooseSource(side,pick.value==="file" ? "file" : Number(pick.value));
  file.onchange=async()=>{
    const selected=file.files[0];if(!selected)return;
    const url=URL.createObjectURL(selected);file.value="";
    try {
      const img=await readImage(url);
      sampleSize(img.naturalWidth,img.naturalHeight);
      if(s.fileUrl)URL.revokeObjectURL(s.fileUrl);s.fileUrl=url;
      let opt=pick.querySelector('option[value="file"]');
      if(!opt){opt=new Option("","file");pick.add(opt);}
      opt.textContent=selected.name;chooseSource(side,"file");
    } catch(e) {URL.revokeObjectURL(url);$("status").textContent=e.message;}
  };
  chooseSource(side,s.selected);
}
$("alpha").oninput=()=>{$("alpha-value").value=Number($("alpha").value).toFixed(2);clearOutput();};
function sampleSize(w,h) {
  const scale=Math.min(1,384/Math.max(w,h));
  const width=Math.floor(w*scale),height=Math.floor(h*scale);
  if(Math.min(width,height)<16)throw Error("缩放后短边须至少有 16 像素。请使用尺寸更大或不太狭长的图片。");
  return {width,height};
}
async function sample(src) {
  const img=await readImage(src), {width,height}=sampleSize(img.naturalWidth,img.naturalHeight);
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  ctx.fillStyle="white";ctx.fillRect(0,0,width,height);ctx.imageSmoothingQuality="high";
  ctx.drawImage(img,0,0,width,height);return ctx.getImageData(0,0,width,height);
}
function setBusy(value) {
  busy=value;$("controls").disabled=value;$("run").textContent=value?"正在生成…":"生成作品";
}
function showFrame(frame) {
  const canvas=$("result");
  canvas.width=frame.image.width;canvas.height=frame.image.height;
  canvas.getContext("2d").putImageData(frame.image,0,0);
  $("download").href=frame.url;
  $("download").download="borrowed-brushstrokes-"+studioModel+".png";
  $("download").hidden=false;canvas.hidden=false;$("empty-art").hidden=true;
  $("status").textContent=modelNames[studioModel]+" · "+canvas.width+" × "+canvas.height;
}
function attachWorker() {
  const w=new Worker(typeof offlineWorker!=="undefined"?offlineWorker:"worker.js?v=2");
  w.onmessage=async({data})=>{
    if(data.message){$("status").textContent=data.message;return;}
    if(data.error){$("status").textContent="生成失败 · "+data.error;setBusy(false);return;}
    loadedModels.add(studioModel);
    try {
      const canvas=$("result");canvas.width=data.w;canvas.height=data.h;
      const image=new ImageData(data.rgba,data.w,data.h);
      canvas.getContext("2d").putImageData(image,0,0);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      if(!blob) throw Error("浏览器无法导出 PNG。");
      const frame={image,url:URL.createObjectURL(blob)};
      frames.set(studioModel,frame);showFrame(frame);
    } catch(e){$("status").textContent=e.message;} finally{setBusy(false);}
  };
  w.onerror=()=>{w.terminate();worker=null;loadedModels.clear();setBusy(false);$("status").textContent="无法启动计算线程。请通过网页地址或离线单页版打开。";};
  return w;
}
async function generate() {
  if(busy)return;
  if(frames.has(studioModel)){showFrame(frames.get(studioModel));return;}
  hideOutput();setBusy(true);$("status").textContent="正在准备图片…";
  try {
    const [content,style]=await Promise.all([sample(source("c")),sample(source("s"))]);
    if(!worker)worker=attachWorker();
    const offline=(!loadedModels.has(studioModel) && typeof embeddedModel!=="undefined") ? embeddedModel[studioModel] : undefined;
    worker.postMessage({content,style,model:studioModel,alpha:Number($("alpha").value),offline},[content.data.buffer,style.data.buffer]);
  } catch(e){$("status").textContent=e.message;setBusy(false);}
}
$("run").onclick=generate;
for(const input of document.querySelectorAll('input[name="studio-model"]')){
  input.onchange=()=>{
    studioModel=input.value;
    if(frames.size)generate();else hideOutput();
  };
}
