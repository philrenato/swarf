/*! coi-serviceworker v0.1.7 - Guido Zuidhof, licensed under MIT */
if(typeof window==='undefined'){
  self.addEventListener("install",()=>self.skipWaiting());
  self.addEventListener("activate",(e)=>e.waitUntil(self.clients.claim()));
  self.addEventListener("fetch",function(e){
    if(e.request.cache==="only-if-cached"&&e.request.mode!=="same-origin")return;
    e.respondWith(fetch(e.request).then(function(r){
      if(r.status===0)return r;
      const h=new Headers(r.headers);
      h.set("Cross-Origin-Embedder-Policy","require-corp");
      h.set("Cross-Origin-Opener-Policy","same-origin");
      return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h});
    }).catch(e=>console.error(e)));
  });
}else{
  (async()=>{
    if(window.crossOriginIsolated!==false)return;
    const r=await navigator.serviceWorker.register(window.document.currentScript.src);
    if(r.active&&!navigator.serviceWorker.controller){window.location.reload();}
    else if(!r.active){
      await new Promise(resolve=>{
        r.installing.addEventListener("statechange",(e)=>{
          if(e.target.state==="activated")resolve();
        });
      });
      window.location.reload();
    }
  })();
}
