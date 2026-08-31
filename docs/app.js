/* Dine Check — application script.
 *
 * Kept in a separate file (rather than inline in index.html) so the page can
 * ship a Content-Security-Policy without 'unsafe-inline' on script-src. That
 * is what makes the CSP worth having: it blocks injected inline event handlers
 * and javascript: URLs, which is exactly the bug class the escaping in esc()
 * and safeUrl() defends against. Inlining this again would silently undo that.
 */

(function(){
"use strict";

// ------------------------------------------------------------------ helpers
var $ = function(s){ return document.querySelector(s); };
var el = function(t,c,txt){ var n=document.createElement(t); if(c)n.className=c; if(txt!=null)n.textContent=txt; return n; };
var esc = function(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
};

// Only ever emit http(s) links. Blocks javascript:, data: and friends reaching href.
var safeUrl = function(u){
  u = String(u==null?"":u).trim();
  return /^https?:\/\//i.test(u) ? u : "";
};

var store = {
  get:function(k,f){ try{ var v=localStorage.getItem(k); return v===null?f:JSON.parse(v);}catch(e){return f;} },
  set:function(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
};

var GRADES = {
  excellent:{label:"Excellent", short:"Excellent", css:"exc", color:"var(--exc)", track:"var(--exc-bg)", range:"90–100"},
  good:     {label:"Good",      short:"Good",      css:"good",color:"var(--good)",track:"var(--good-bg)",range:"80–89"},
  average:  {label:"Average",   short:"Average",   css:"avg", color:"var(--avg)", track:"var(--avg-bg)", range:"70–79"},
  poor:     {label:"Needs work",short:"Needs work",css:"poor",color:"var(--poor)",track:"var(--poor-bg)",range:"under 70"},
  unrated:  {label:"No score",  short:"No score",  css:"unrated",color:"var(--unr)",track:"var(--unr-bg)",range:""}
};

var MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso){
  if(!iso) return "Date not recorded";
  var p=iso.split("-"); if(p.length!==3) return iso;
  return (+p[2])+" "+MONTHS[(+p[1])-1]+" "+p[0];
}
function ago(iso){
  if(!iso) return "";
  var d=new Date(iso+"T00:00:00"), now=new Date();
  var days=Math.round((now-d)/86400000);
  if(days<0) return fmtDate(iso);
  if(days===0) return "today";
  if(days===1) return "yesterday";
  if(days<30) return days+" days ago";
  var m=Math.round(days/30.4);
  if(m<12) return m+(m===1?" month ago":" months ago");
  var y=Math.floor(days/365);
  return y+(y===1?" year ago":" years ago");
}
function km(a,b,c,d){
  var R=6371, r=Math.PI/180;
  var dLat=(c-a)*r, dLon=(d-b)*r;
  var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(a*r)*Math.cos(c*r)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));
}
function fmtKm(v){
  if(v<0.6) return "in your area";
  if(v<10) return v.toFixed(1)+" km away";
  return Math.round(v)+" km away";
}

// -------------------------------------------------------------------- state
var DATA=null, VENUES=[], me=null;
var state={ q:"", grade:"", area:"", sort:"score-desc", favOnly:false };
var favs=store.get("dinecheck.favs",[]);

// -------------------------------------------------------------------- theme
var themeBtn=$("#themeBtn"), themeIcon=$("#themeIcon");
var SUN="M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6L4.5 4.5M19.5 19.5L18 18M18 6l1.5-1.5M4.5 19.5L6 18M16 12a4 4 0 11-8 0 4 4 0 018 0z";
var MOON="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z";
function applyTheme(t){
  if(t) document.documentElement.setAttribute("data-theme",t);
  else document.documentElement.removeAttribute("data-theme");
  var dark = t==="dark" || (!t && matchMedia("(prefers-color-scheme:dark)").matches);
  themeIcon.innerHTML='<path d="'+(dark?SUN:MOON)+'"/>';
}
applyTheme(store.get("dinecheck.theme",null));
themeBtn.addEventListener("click",function(){
  var cur=document.documentElement.getAttribute("data-theme");
  var dark = cur ? cur==="dark" : matchMedia("(prefers-color-scheme:dark)").matches;
  var next = dark?"light":"dark";
  store.set("dinecheck.theme",next); applyTheme(next);
});

// ------------------------------------------------------------------ ranking
function filtered(){
  var q=state.q.trim().toLowerCase();
  var out=VENUES.filter(function(v){
    if(state.favOnly && favs.indexOf(v.id)<0) return false;
    if(state.grade==="__enf"){ if(v.kind!=="enforcement") return false; }
    else if(state.grade && (v.kind!=="inspection" || v.grade!==state.grade)) return false;
    if(state.area && v.area!==state.area) return false;
    if(q){
      var hay=(v.name+" "+v.area+" "+v.location+" "+(v.aka||[]).join(" ")).toLowerCase();
      if(hay.indexOf(q)<0) return false;
    }
    return true;
  });

  var s=state.sort;
  out.sort(function(a,b){
    if(s==="near"){
      var da=a._d==null?Infinity:a._d, db=b._d==null?Infinity:b._d;
      if(da!==db) return da-db;
      return (b.score==null?-1:b.score)-(a.score==null?-1:a.score);
    }
    if(s==="name") return a.name.localeCompare(b.name);
    if(s==="date"){
      var ea=a.kind==="enforcement", eb=b.kind==="enforcement";
      if(ea!==eb) return ea?1:-1;
      if(a.lastInspected!==b.lastInspected) return a.lastInspected<b.lastInspected?1:-1;
      return a.name.localeCompare(b.name);
    }
    var sa=a.score, sb=b.score;
    if(sa==null&&sb==null) return a.name.localeCompare(b.name);
    if(sa==null) return 1;
    if(sb==null) return -1;
    if(sa!==sb) return s==="score-asc" ? sa-sb : sb-sa;
    return a.name.localeCompare(b.name);
  });
  return out;
}

// ------------------------------------------------------------------- render
// A record older than a year is labelled Historic and shows its full date, so
// a 2024 inspection is never mistaken for a current one.
var STALE_AFTER_DAYS = 365;
function isStale(iso){
  if(!iso) return false;
  var d=new Date(iso+"T00:00:00");
  return (Date.now()-d.getTime()) > STALE_AFTER_DAYS*86400000;
}

function markNode(v){
  var m=el("div","mark");
  m.appendChild(el("b",null,String(v.violations||0)));
  m.appendChild(el("s",null,v.violations===1?"issue":"issues"));
  return m;
}

function ringNode(score,grade){
  var g=GRADES[grade]||GRADES.unrated;
  var r=el("div","ring"+(score==null?" none":""));
  r.style.setProperty("--c",g.color);
  r.style.setProperty("--ct",g.track);
  r.style.setProperty("--p",score==null?0:score);
  r.appendChild(el("i"));
  r.appendChild(el("b",null,score==null?"—":String(score)));
  return r;
}

function card(v,i){
  var row=el("div","card");
  row.tabIndex=0; row.setAttribute("role","button");
  row.setAttribute("aria-label",v.name+", score "+(v.score==null?"not recorded":v.score));

  var enf = v.kind==="enforcement";
  if(enf) row.classList.add("enf");

  // Only scored venues are ranked; enforcement records carry no position.
  if(!enf&&state.sort==="score-desc"&&!state.q&&!state.grade&&!state.area&&!state.favOnly){
    row.appendChild(el("div","rank","#"+(i+1)));
  }
  row.appendChild(enf ? markNode(v) : ringNode(v.score,v.grade));

  var main=el("div","cmain");
  var name=el("div","cname");
  name.appendChild(el("span",null,v.name));
  if(enf){
    name.appendChild(el("span","tag enf","Violations recorded"));
    if(isStale(v.lastInspected)) name.appendChild(el("span","tag stale","Historic"));
  } else {
    var g=GRADES[v.grade]||GRADES.unrated;
    name.appendChild(el("span","tag "+g.css,g.short));
    if(v.history[0].notice) name.appendChild(el("span","tag notice","Notice issued"));
  }
  main.appendChild(name);

  var meta=el("div","cmeta");
  var seg=function(text,cls){
    var w=el("span","seg");
    if(meta.childNodes.length) w.appendChild(el("span","sep","·"));
    w.appendChild(el("span",cls||null,text));
    meta.appendChild(w);
  };
  seg(v.location||v.area);
  if(v._d!=null) seg(fmtKm(v._d),"dist");
  seg(isStale(v.lastInspected)
        ? "Inspected "+fmtDate(v.lastInspected)     // exact date once it is old
        : "Inspected "+ago(v.lastInspected));
  main.appendChild(meta);
  row.appendChild(main);

  var fav=el("button","fav");
  var on=favs.indexOf(v.id)>=0;
  fav.setAttribute("aria-pressed",on?"true":"false");
  fav.setAttribute("aria-label",(on?"Remove ":"Save ")+v.name);
  fav.innerHTML='<svg viewBox="0 0 24 24"><path d="M20.8 8.6c0 4.9-8.8 10.4-8.8 10.4S3.2 13.5 3.2 8.6a4.6 4.6 0 018.8-1.8 4.6 4.6 0 018.8 1.8z"/></svg>';
  fav.addEventListener("click",function(e){
    e.stopPropagation();
    var k=favs.indexOf(v.id);
    if(k<0) favs.push(v.id); else favs.splice(k,1);
    store.set("dinecheck.favs",favs);
    render();
  });
  row.appendChild(fav);

  row.addEventListener("click",function(){ openSheet(v); });
  row.addEventListener("keydown",function(e){
    if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openSheet(v); }
  });
  return row;
}

function render(){
  var rows=filtered(), list=$("#list");
  list.textContent="";
  if(!rows.length){
    var e=el("div","empty");
    var icon='<svg viewBox="0 0 24 24" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>';
    var body;
    if(state.favOnly){
      body="<p>You have not saved any places yet. Tap the heart on a card to keep it here.</p>";
    } else if(state.q.trim()){
      // A search that finds nothing is an answer, not a failure — say what it means.
      body='<p>No inspection has been published for <span class="q">'+esc(state.q.trim())+'</span>.</p>'+
           "<p>That is not a bad sign. Only "+(DATA?DATA.stats.venues:"a few hundred")+
           " establishments in Hyderabad have an inspection on public record, so most places "+
           "are simply not here yet. Try another spelling, or browse by area.</p>";
    } else {
      body="<p>Nothing matches those filters.</p>";
    }
    e.innerHTML=icon+body;
    list.appendChild(e);
  } else {
    var frag=document.createDocumentFragment();
    rows.forEach(function(v,i){ frag.appendChild(card(v,i)); });
    list.appendChild(frag);
  }

  var active = state.q||state.grade||state.area||state.favOnly;
  $("#count").textContent = rows.length+(rows.length===1?" place":" places")+
    (state.grade==="__enf"?" with violations recorded":"")+
    (state.area?" in "+state.area:"")+
    (state.favOnly?" saved":"");
  $("#reset").hidden = !active;
  $("#clearQ").classList.toggle("on",!!state.q);
  $("#favBtn").setAttribute("aria-pressed",state.favOnly?"true":"false");
  $("#favBtn").style.color = state.favOnly?"#e11d48":"";
  Array.prototype.forEach.call(document.querySelectorAll("#grades .chip"),function(c){
    c.setAttribute("aria-pressed", c.dataset.g===state.grade ? "true":"false");
  });
}

// -------------------------------------------------------------------- sheet
var lastFocus=null;
function openSheet(v){
  lastFocus=document.activeElement;
  var g=GRADES[v.grade]||GRADES.unrated;
  $("#sheetTitle").textContent=v.name;
  var sub=[v.location||v.area];
  if(v._d!=null) sub.push(fmtKm(v._d));
  if(v.aka&&v.aka.length) sub.push("Also listed as "+v.aka.join(", "));
  $("#sheetSub").textContent=sub.join(" · ");

  var latest=v.history[0];
  var enf=v.kind==="enforcement";
  var h='';

  if(enf){
    h+='<div class="enfnote"><b>Enforcement record — no hygiene score.</b> '+
       'Inspectors recorded violations here; this is not a scored audit and is '+
       'not ranked against places that have one.</div>';
    if(isStale(latest.date)){
      h+='<div class="note"><b>This record is from '+fmtDate(latest.date)+'.</b> '+
         'It describes conditions on that day and may not reflect the place today.</div>';
    }
  }

  if(!enf) h+='<div class="scorebox" style="--c:'+g.color+'">'+
       '<div><div class="big">'+(v.score==null?'—':v.score+'<span>/100</span>')+'</div></div>'+
       '<div style="flex:1"><div class="meta"><b>'+g.label+'</b>'+(g.range?' · '+g.range+' band':'')+'<br>'+
       'Inspected '+fmtDate(latest.date)+
       (latest.obtained!=null&&latest.total?'<br>'+latest.obtained+' of '+latest.total+' marks on that checklist':'')+'</div>'+
       (v.score==null?'':'<div class="bar"><i style="width:'+v.score+'%"></i></div>')+
       '</div></div>';

  if(!enf && latest.notice||/notice/i.test(latest.action||"")){
    h+='<div class="note"><b>An improvement notice was issued</b> at this inspection.'+
       (latest.bad&&latest.bad.length?'':' The published report did not itemise what triggered it — open the original report below.')+
       '</div>';
  }

  if(latest.good&&latest.good.length){
    h+='<h3 class="sec">Good practices observed</h3><ul class="pts ok">';
    latest.good.forEach(function(t){
      h+='<li><svg viewBox="0 0 24 24" stroke="currentColor"><path d="M20 6L9 17l-5-5"/></svg><span>'+esc(t)+'</span></li>';
    });
    h+='</ul>';
  }
  if(latest.bad&&latest.bad.length){
    h+='<h3 class="sec">'+(enf?"Violations recorded":"Problems recorded")+'</h3><ul class="pts bad">';
    latest.bad.forEach(function(t){
      h+='<li><svg viewBox="0 0 24 24" stroke="currentColor"><path d="M12 8v5M12 16.5v.01M10.3 3.9L2.6 17.2A2 2 0 004.3 20h15.4a2 2 0 001.7-2.8L13.7 3.9a2 2 0 00-3.4 0z"/></svg><span>'+esc(t)+'</span></li>';
    });
    h+='</ul>';
  }
  if(latest.action){
    h+='<h3 class="sec">Action taken</h3><p style="margin:0;font-size:14px;line-height:1.55;color:var(--ink-2)">'+esc(latest.action)+'</p>';
  }

  if(v.history.length>1){
    h+='<h3 class="sec">Inspection history</h3><div class="hist">';
    v.history.forEach(function(x){
      var xg=GRADES[x.pct==null?'unrated':(x.pct>=90?'excellent':x.pct>=80?'good':x.pct>=70?'average':'poor')];
      h+='<div class="hrow" style="--c:'+xg.color+'"><div class="hp">'+(x.pct==null?'—':x.pct)+'</div>'+
         '<div class="hd">'+fmtDate(x.date)+' · '+esc(x.location||v.area)+'</div>'+
         (safeUrl(x.url)
            ? '<a class="srcbtn" style="margin:0;height:30px;padding:0 10px" href="'+esc(safeUrl(x.url))+'" target="_blank" rel="noopener noreferrer">Report</a>'
            : '')+'</div>';
    });
    h+='</div>';
  }

  h+='<h3 class="sec">Source</h3>'+
     '<a class="srcbtn" href="'+esc(safeUrl(latest.url))+'" target="_blank" rel="noopener noreferrer">'+
     '<svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"/></svg>'+
     'Original report from '+esc(latest.source||'the inspecting authority')+'</a>'+
     '<p style="font-size:12.5px;color:var(--ink-3);margin:10px 0 4px;line-height:1.55">'+
     'Checklist totals differ by business type, so compare places on the percentage, never on raw marks. '+
     'This reflects a single visit on '+fmtDate(latest.date)+'.</p>';

  $("#sheetBody").innerHTML=h;
  $("#sheetBody").scrollTop=0;
  $("#sheet").hidden=false;
  requestAnimationFrame(function(){
    $("#sheet").classList.add("on"); $("#scrim").classList.add("on");
  });
  document.body.style.overflow="hidden";
  $("#closeSheet").focus();
}
function closeSheet(){
  $("#sheet").classList.remove("on"); $("#scrim").classList.remove("on");
  document.body.style.overflow="";
  setTimeout(function(){ $("#sheet").hidden=true; },260);
  if(lastFocus&&lastFocus.focus) lastFocus.focus();
}
$("#closeSheet").addEventListener("click",closeSheet);
$("#scrim").addEventListener("click",closeSheet);
document.addEventListener("keydown",function(e){ if(e.key==="Escape"&&!$("#sheet").hidden) closeSheet(); });

// ------------------------------------------------------------------ near me
$("#nearBtn").addEventListener("click",function(){
  var btn=this, msg=$("#geomsg");
  if(me){ // toggle off
    me=null; VENUES.forEach(function(v){ v._d=null; });
    btn.classList.remove("active"); $("#nearLabel").textContent="Near me";
    msg.className="geomsg"; if(state.sort==="near"){ state.sort="score-desc"; $("#sort").value="score-desc"; }
    render(); return;
  }
  if(!navigator.geolocation){
    msg.className="geomsg on err"; msg.textContent="This browser cannot share your location. Pick your area from the dropdown instead.";
    return;
  }
  btn.disabled=true; $("#nearLabel").textContent="Locating…";
  msg.className="geomsg on"; msg.textContent="Asking your browser for your location…";
  navigator.geolocation.getCurrentPosition(function(pos){
    me={lat:pos.coords.latitude,lng:pos.coords.longitude};
    var placed=0;
    VENUES.forEach(function(v){
      v._d = (v.lat==null) ? null : km(me.lat,me.lng,v.lat,v.lng);
      if(v._d!=null) placed++;
    });
    btn.disabled=false; btn.classList.add("active"); $("#nearLabel").textContent="Using your location";
    var unplaced=VENUES.length-placed;
    msg.className="geomsg on";
    msg.textContent="Sorted by distance from you. Distances are to the centre of each locality, so treat them as approximate."+
      (unplaced?" "+unplaced+" place"+(unplaced===1?" has":"s have")+" no mapped locality and sit at the end.":"");
    state.sort="near"; $("#sort").value="near";
    render();
  },function(err){
    btn.disabled=false; $("#nearLabel").textContent="Near me";
    msg.className="geomsg on err";
    msg.textContent = err.code===1
      ? "Location permission was declined. Pick your area from the dropdown instead — it works just as well."
      : "Could not read your location. Pick your area from the dropdown instead.";
  },{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
});

// ----------------------------------------------------------------- controls
$("#q").addEventListener("input",function(){ state.q=this.value; render(); });
$("#clearQ").addEventListener("click",function(){ $("#q").value=""; state.q=""; $("#q").focus(); render(); });
$("#sort").addEventListener("change",function(){
  if(this.value==="near"&&!me){ this.value=state.sort; $("#nearBtn").click(); return; }
  state.sort=this.value; render();
});
$("#area").addEventListener("change",function(){ state.area=this.value; render(); });
$("#favBtn").addEventListener("click",function(){ state.favOnly=!state.favOnly; render(); });
$("#reset").addEventListener("click",function(){
  state.q=""; state.grade=""; state.area=""; state.favOnly=false;
  $("#q").value=""; $("#area").value=""; render();
});

// --------------------------------------------------------------------- boot
function boot(d){
  DATA=d; VENUES=d.venues.map(function(v){ v._d=null; return v; });

  var s=d.stats;
  // The average and grade counts describe the SCORED set only - enforcement
  // records have no score and must not be averaged into it.
  $("#stats").innerHTML=
    '<div class="stat"><div class="n">'+s.scoredVenues+'</div><div class="l">scored</div></div>'+
    '<div class="stat"><div class="n">'+s.avgScore+'</div><div class="l">avg score</div></div>'+
    '<div class="stat poor"><div class="n">'+s.enforcementVenues+'</div><div class="l">with violations</div></div>'+
    '<div class="stat"><div class="n">'+s.areas+'</div><div class="l">areas</div></div>';

  var counts={excellent:s.excellent,good:s.good,average:s.average,poor:s.poor};
  var chips=$("#grades");
  var mk=function(key,label,color){
    var b=el("button","chip"); b.dataset.g=key; b.setAttribute("aria-pressed","false");
    if(color){ var dot=el("span","dot"); dot.style.background=color; b.appendChild(dot); }
    b.appendChild(el("span",null,label));
    b.addEventListener("click",function(){ state.grade = state.grade===key?"":key; render(); });
    chips.appendChild(b);
  };
  mk("","All ratings",null);
  mk("excellent","Excellent "+counts.excellent,"var(--exc)");
  mk("good","Good "+counts.good,"var(--good)");
  mk("average","Average "+counts.average,"var(--avg)");
  mk("poor","Needs work "+counts.poor,"var(--poor)");
  mk("__enf","Violations "+s.enforcementVenues,"var(--poor)");

  var sel=$("#area");
  d.areas.forEach(function(a){
    var o=el("option",null,a.name+" ("+a.count+")"); o.value=a.name; sel.appendChild(o);
  });

  // ---- coverage note: describe the dataset's limits from the dataset itself,
  //      so it stays true as the archive grows.
  (function(){
    var src = (s.sources||[]);
    var top = src[0];
    var topAreas = d.areas.slice(0,4).map(function(a){ return a.name; });
    var line = $("#coverageLine"), body = $("#coverageBody");
    if(!line || !body) return;

    line.textContent = s.venues+" places with a published inspection — not every restaurant in Hyderabad.";

    var html = "";
    html += "<p>Two kinds of record appear here. <b>"+s.scoredVenues+"</b> places have a "+
            "scored hygiene audit, with marks out of a checklist — those are the ones ranked. "+
            "<b>"+s.enforcementVenues+"</b> have an <b>enforcement record</b> instead: inspectors "+
            "listed violations but published no score, so they are never ranked against a scored place.</p>";

    if(top){
      html += "<p><b>"+top.count+" of "+s.inspections+"</b> inspections here were published by "+
              esc(top.handle)+". Coverage follows whoever publishes, so "+
              topAreas.slice(0,3).join(", ")+" and "+(topAreas[3]||"nearby areas")+
              " are well represented while much of the city — including the old city — is barely covered at all.</p>";
    }
    // Point-in-time note. Telangana's food-safety department was merged into
    // TG SAFE on 16 Aug 2026 and has not yet published inspections itself; its
    // drives reach the public only through press reports, which this site does
    // not list because they cannot be traced to the inspecting authority.
    // DELETE THIS PARAGRAPH once TG SAFE publishes its own feed and the scraper
    // picks it up — see MAINTAINING.md.
    html += "<p>Telangana's food-safety department was reorganised into <b>TG SAFE</b> in "+
            "August 2026. Its enforcement drives — including in areas missing from this list — "+
            "are not shown here, because TG SAFE does not yet publish inspections itself. "+
            "Only reports traceable to the inspecting authority are included.</p>";

    if(s.earliest && s.latest){
      html += "<p>The record runs from "+fmtDate(s.earliest)+" to "+fmtDate(s.latest)+
              ". Older entries are marked <b>Historic</b> — they describe one day, "+
              "sometimes years ago, and a place may have changed completely since.</p>";
    }
    html += "<p><b>A place missing from this list has not been inspected in public.</b> "+
            "That is not a mark against it, and not a clean bill of health either — "+
            "there is simply nothing on record.</p>";
    body.innerHTML = html;
  })();

  $("#gen").textContent="Built from "+s.inspections+" inspection reports covering "+s.venues+
    " establishments across "+s.areas+" localities. Most recent inspection: "+fmtDate(s.latest)+".";

  render();
}

fetch("data.json",{cache:"no-cache"})
  .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
  .then(boot)
  .catch(function(){
    $("#list").innerHTML='<div class="empty"><p>Could not load the inspection data.<br>'+
      'If you opened this file directly from disk, serve the folder instead — for example <code>python -m http.server</code> — because browsers block <code>fetch</code> on <code>file://</code> URLs.</p></div>';
  });
})();

/* ------------------------------------------------------------------ analytics
   Cloudflare Web Analytics. Cookieless and stores nothing on the visitor's
   device, so no consent banner is required.

   Left empty, TOKEN loads nothing and the site makes zero external requests.
   Visits from localhost and file:// are never counted.
------------------------------------------------------------------------------ */

(function () {
  "use strict";
  var TOKEN = "287dce2107984ab08701ae530a83af58";                       // Cloudflare Web Analytics site token (public by design)

  if (!TOKEN) return;                                  // not configured yet
  var host = location.hostname;
  if (location.protocol === "file:" ||                 // opened from disk
      host === "localhost" || host === "127.0.0.1" ||  // local preview
      host === "") return;                             // don't count your own testing

  var s = document.createElement("script");
  s.type = "module";                    // Cloudflare ships the beacon as an ES module
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: TOKEN }));
  s.onerror = function () { /* analytics must never break the page */ };
  document.head.appendChild(s);
})();
