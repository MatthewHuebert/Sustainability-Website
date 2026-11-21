fetch("data/swaps.json").then(r=>r.json()).then(j=>{
const D=j.map(o=>[o.cat,o.from,o.to,o.impact,o.cost,o.why,o.tip,o.keywords,o.match||[]]);
// [category, instead of, try, impact 1-3, cost s=saves e=even u=upfront, why, tip, keywords, match[]]
const COST={s:["Saves money",""],e:["About the same",""],u:["Costs more upfront","u"]};
const $=id=>document.getElementById(id);
let cat="All",saved=new Set();
try{saved=new Set(JSON.parse(localStorage.getItem("swaps")||"[]"))}catch(e){}
const persist=()=>{try{localStorage.setItem("swaps",JSON.stringify([...saved]))}catch(e){}};

// Text matching helpers
const stem=w=>w.length>4?w.replace(/(ies|es|s|ing|ed)$/,"").replace(/i$/,"y"):w;
const fuzzy=(w,hay)=>{
  const st=stem(w);
  if(st.length<3)return false;
  if(hay.includes(st))return true;
  // prefix match for longer words (catches "batteries"->"batteri", "thighs"->"thigh")
  if(w.length>5&&hay.includes(w.slice(0,w.length-2)))return true;
  return false;
};
const norm=s=>String(s??"").toLowerCase();

// Scoring
// Returns {score, hits[]} for one data row against query tokens
function scoreEntry(d,words){
  const matchArr=d[8].map(norm);
  const hay=`${d[0]} ${d[1]} ${d[2]} ${d[7]}`.toLowerCase();
  let s=0;const hits=[];
  for(const w of words){
    if(!w)continue;
    const inMatch=matchArr.some(m=>m.includes(w));
    if(inMatch){s+=3;hits.push(w);continue}
    if(hay.includes(w)){s+=1;hits.push(w);continue}
    if(fuzzy(w,matchArr.join(" "))){s+=2;hits.push(w);continue}
    if(fuzzy(w,hay)){s+=0.5;hits.push(w)}
  }
  return{score:s,hits};
}

// Category fallback
const CAT_HINTS={
  chicken:"Food",beef:"Food",pork:"Food",lamb:"Food",meat:"Food",fish:"Food",
  milk:"Food",cheese:"Food",egg:"Food",coffee:"Food",tea:"Food",snack:"Food",
  soda:"Food",juice:"Food",pizza:"Food",bread:"Food",rice:"Food",pasta:"Food",
  towel:"Kitchen",wrap:"Kitchen",foil:"Kitchen",sponge:"Kitchen",bag:"Kitchen",
  bottle:"Kitchen",cup:"Kitchen",cutlery:"Kitchen",straw:"Kitchen",plate:"Kitchen",
  soap:"Bathroom",shampoo:"Bathroom",razor:"Bathroom",toothbrush:"Bathroom",
  wipe:"Bathroom",tampon:"Bathroom",pad:"Bathroom",cotton:"Bathroom",
  cleaner:"Cleaning",spray:"Cleaning",detergent:"Cleaning",dryer:"Cleaning",
  bulb:"Home",light:"Home",battery:"Home",heating:"Home",thermostat:"Home",
  shower:"Home",laundry:"Home",mower:"Home",compost:"Home",
  clothes:"Shopping",shirt:"Shopping",jeans:"Shopping",book:"Shopping",
  gift:"Shopping",phone:"Shopping",laptop:"Shopping",tool:"Shopping",
  car:"Transport",flight:"Transport",train:"Transport",commute:"Transport"
};
function guessCategory(words){
  const counts={};
  for(const w of words){
    for(const k in CAT_HINTS){
      if(w.includes(k)||k.includes(w))counts[CAT_HINTS[k]]=(counts[CAT_HINTS[k]]||0)+1;
    }
  }
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  return top?top[0]:null;}
// Miss logging
function logMiss(q,words,catAtTime){
  try{
    const misses=JSON.parse(localStorage.getItem("misses")||"[]");
    misses.push({q,t:words,cat:catAtTime,ts:Date.now()});
    localStorage.setItem("misses",JSON.stringify(misses.slice(-200)));
  }catch(e){}
}

// Render
const cats=["All",...new Set(D.map(d=>d[0]))];
$("cats").innerHTML=cats.map(c=>`<button class="chip" aria-pressed="${c==="All"}" data-c="${c}">${c}</button>`).join("");
$("cats").onclick=e=>{const b=e.target.closest("button");if(!b)return;cat=b.dataset.c;
 document.querySelectorAll("#cats .chip").forEach(x=>x.setAttribute("aria-pressed",x===b));render()};
$("q").oninput=render;$("sort").onchange=render;

function render(){
  const raw=$("q").value.trim();
  const q=raw.toLowerCase();
  const words=q.split(/\s+/).filter(Boolean);

  // Score every row keep those with any signal
  let scored=D.map((d,i)=>{
    const r=scoreEntry(d,words);
    return{d,i,s:r.score,hits:r.hits};
  }).filter(x=>!only||only.has(x.i))
    .filter(x=>cat==="All"||x.d[0]===cat);

  // If there are no search words, keep everything in the pool (score 0)
  let pool=words.length ? scored.filter(x=>x.s>0) : scored;
  let fellBack=false,emptyCatHint=false;

  // If nothing scores and a category is active, first try suggesting clearing it
  if(!pool.length&&cat!=="All"&&words.length){
    const allCats=D.map((d,i)=>({d,i,...scoreEntry(d,words)}))
      .filter(x=>x.s>0);
    if(allCats.length){emptyCatHint=true;pool=allCats}
  }

  // Category-level fallback from hints
  if(!pool.length&&words.length){
    const guessed=guessCategory(words);
    if(guessed){
      pool=D.map((d,i)=>({d,i,s:0,hits:[]}))
        .filter(x=>x.d[0]===guessed&&(!only||only.has(x.i)));
      fellBack=pool.length>0;
    }
  }

  // Sort: by score desc when searching; impact desc when the checkbox is on
  if($("sort").checked)pool.sort((a,b)=>b.d[3]-a.d[3]||b.s-a.s);
  else if(words.length)pool.sort((a,b)=>b.s-a.s||b.d[3]-a.d[3]);

  
  const shown=pool.slice(0,words.length?40:pool.length);

  $("count").textContent=shown.length?`${shown.length} swap${shown.length>1?"s":""}`:"";

  if(!shown.length){
    if(words.length)logMiss(raw,words,cat);
    $("results").innerHTML=`<li class="empty" style="display:block;border:0;background:none">Nothing matches “${raw.replace(/[<>&]/g,"")}”. Try a broader word like “bags” or “cleaning”, or clear the category filter.</li>`;
    renderSaved();
    return;
  }

  let banner="";
  if(emptyCatHint)banner=`<li class="empty" style="display:block;border:0;background:none">No matches in <strong>${cat}</strong>. Showing results from other categories — <button class="btn ghost" id="clearCat" style="padding:.2rem .6rem;font-size:.85rem;margin:0">clear filter</button></li>`;
  else if(fellBack)banner=`<li class="empty" style="display:block;border:0;background:none">No exact swap for “${raw.replace(/[<>&]/g,"")}”. Here are popular <strong>${guessCategory(words)}</strong> swaps.</li>`;

  $("results").innerHTML=banner+shown.map(({d,i})=>{
    const on=saved.has(i);
    return `<li><details><summary><span class="from">${d[1]}</span><span class="to">${d[2]}</span>
    <span class="meta"><span class="leaves" role="img" aria-label="Impact ${d[3]} of 3">${[1,2,3].map(n=>`<i class="${n<=d[3]?"on":""}"></i>`).join("")}</span><span class="tag ${COST[d[4]][1]}">${COST[d[4]][0]}</span><span>${d[0]}</span></span></summary>
    <div class="body"><p>${d[5]}</p><p><strong>Tip:</strong> ${d[6]}</p></div></details>
    <button class="save" data-i="${i}" aria-pressed="${on}" aria-label="${on?"Remove from":"Add to"} my swap list">${on?"✓":"+"}</button></li>`;
  }).join("");

  const cc=$("clearCat");
  if(cc)cc.onclick=()=>{cat="All";document.querySelectorAll("#cats .chip").forEach(x=>x.setAttribute("aria-pressed",x.dataset.c==="All"));render()};

  renderSaved();
}

$("results").onclick=e=>{const b=e.target.closest(".save");if(!b)return;const i=+b.dataset.i;
 saved.has(i)?saved.delete(i):saved.add(i);persist();render()};

function renderSaved(){
 const a=[...saved].sort((x,y)=>x-y).map(i=>D[i]);
 $("saved").innerHTML=a.length?`<p style="margin:0;color:var(--muted)">${a.length} swap${a.length>1?"s":""} you’re planning to make.</p><ol>${a.map(d=>`<li style="display:list-item;background:none;border:0">${d[1]} → ${d[2]}</li>`).join("")}</ol>
 <button class="btn" id="copy">Copy list</button><button class="btn ghost" id="clear">Clear list</button> <span id="msg" aria-live="polite"></span>`
 :`<p class="empty" style="padding:.5rem 0">Tap + on any swap to start a list.</p>`;
 if(a.length){$("clear").onclick=()=>{saved.clear();persist();render()};
  $("copy").onclick=async()=>{const t=a.map(d=>`- ${d[1]} → ${d[2]}`).join("\n");
   try{await navigator.clipboard.writeText(t);$("msg").textContent="Copied."}catch(e){$("msg").textContent="Copy isn’t available here. Select the list above instead."}}}
}

// Product lookup (Open Food Facts)
let only=null,found=[];
const OFF="https://world.openfoodfacts.org",F="code,product_name,brands,categories_tags,packaging_tags,packaging";
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const clean=t=>(t||[]).map(x=>x.replace(/^\w\w:/,"").replace(/-/g," "));
const say=t=>{$("lkmsg").textContent=t};

function matchSwaps(p){
  const mainWords=norm((p.product_name||"")+" "+clean(p.categories_tags).join(" ")).split(/\s+/).filter(Boolean);
  const packWords=norm(clean(p.packaging_tags).join(" ")+" "+(p.packaging||"")).split(/\s+/).filter(Boolean);
  return D.map((d,i)=>{
    let s=0;const hits=[];
    for(const w of mainWords){
      if(w.length<3)continue;
      const r=scoreEntry(d,[w]);
      if(r.score){s+=r.score*2;hits.push(...r.hits)}
    }
    for(const w of packWords){
      if(w.length<3)continue;
      const r=scoreEntry(d,[w]);
      if(r.score){s+=r.score;hits.push(...r.hits)}
    }
    return{i,s,hits};
  })
  .filter(x=>x.s)
  .sort((a,b)=>b.s-a.s||D[b.i][3]-D[a.i][3])
  .slice(0,4);
}

function showProduct(p){
  const m=matchSwaps(p);only=new Set(m.map(x=>x.i));$("hits").innerHTML="";say("");
  const pk=clean(p.packaging_tags).join(", ")||"not listed";
  $("product").innerHTML=`<strong>${esc(p.product_name||"Unnamed product")}</strong> ${esc(p.brands)}<div class="meta">Packaging: ${esc(pk)}</div>
  <p>${m.length?`Suggested swaps are below. Matched on: ${esc([...new Set(m.flatMap(x=>x.hits))].join(", "))}.`:"No swap matches this product yet. Add one in data/swaps.json."}</p><button class="btn ghost" id="all">Show all swaps</button>`;
  $("all").onclick=()=>{only=null; $("product").innerHTML=""; $("q").value=""; render();
  };
  render();
}

async function lookup(){
  const q=$("lk").value.trim();if(!q)return;say("Looking up…");$("hits").innerHTML="";
  try{
    if(/^\d{8,14}$/.test(q)){
      const j=await (await fetch(`${OFF}/api/v2/product/${q}.json?fields=${F}`)).json();
      j.status===1?showProduct(j.product):say("That barcode isn’t in Open Food Facts yet. Try the product name instead.");
    }else{
      const j=await (await fetch(`${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=5&fields=${F}`)).json();
      found=j.products||[];
      if(!found.length)return say("No products found. Try a simpler name or the barcode.");
      say("Pick the closest product:");
      $("hits").innerHTML=found.map((p,n)=>`<button class="hit" data-n="${n}">${esc(p.product_name||"Unnamed")} <span class="meta">${esc(p.brands)}</span></button>`).join("");
    }
  }catch(e){say("Couldn’t reach Open Food Facts. Check your connection and try again.")}
}
$("lkf").onsubmit=e=>{e.preventDefault();lookup()};
$("hits").onclick=e=>{const b=e.target.closest(".hit");if(b)showProduct(found[+b.dataset.n])};
$("scan").onclick=async()=>{
 if(!("BarcodeDetector" in window))return say("Camera scanning isn’t supported in this browser. Type the barcode instead.");
 const v=$("cam");let s;
 try{s=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})}catch(e){return say("Couldn’t open the camera. Allow access, or type the barcode.")}
 v.srcObject=s;v.hidden=false;await v.play();say("Point the camera at a barcode.");
 const det=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e"]});
 const stop=()=>{v.hidden=true;s.getTracks().forEach(t=>t.stop())};
 const tick=async()=>{if(v.hidden)return;try{const r=await det.detect(v);if(r.length){stop();$("lk").value=r[0].rawValue;lookup();return}}catch(e){}setTimeout(tick,300)};
 tick();
};

// Debug helper (optional)
// put in console -- missReport()  → prints top missed queries.
window.missReport=()=>{
  const m=JSON.parse(localStorage.getItem("misses")||"[]");
  const c={};m.forEach(x=>c[x.q]=(c[x.q]||0)+1);
  return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,25).map(([q,n])=>`${n}×  ${q}`);
};

render();
}).catch(()=>{document.body.insertAdjacentHTML("beforeend","<p style=\"padding:1rem\">Couldn’t load data/swaps.json. Run this page from a local server (Live Server) rather than opening the file directly.</p>")});