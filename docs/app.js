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

// FSSAI Hygiene Rating bands. A separate scale on purpose: these come from a
// voluntary paid audit, carry no marks and no date, and are never compared with
// an inspection percentage.
// `short` is what fits the 54px badge; the full band name is always shown in
// the detail sheet, so nothing is lost by abbreviating here.
var BANDS = {
  "Excellent":          {css:"exc",  color:"var(--exc)",  rank:0, short:"Excellent"},
  "Very Good":          {css:"good", color:"var(--good)", rank:1, short:"Very good"},
  "Good":               {css:"avg",  color:"var(--avg)",  rank:2, short:"Good"},
  "Needs Improvement":  {css:"poor", color:"var(--poor)", rank:3, short:"Needs work"},
  "Urgent Improvement": {css:"poor", color:"var(--poor)", rank:4, short:"Urgent"},
  "Poor":               {css:"poor", color:"var(--poor)", rank:5, short:"Poor"}
};
function bandOf(v){ return BANDS[v.band] || {css:"unrated", color:"var(--unr)", rank:9, short:v.band||"Rated"}; }

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
var INDEX=null, DATA=null, VENUES=[], me=null;
var state={ q:"", grade:"", area:"", sort:"score-desc", favOnly:false, city:"" };
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
    else if(state.grade==="__cert"){ if(v.kind!=="certification") return false; }
    else if(state.grade && (v.kind!=="inspection" || v.grade!==state.grade)) return false;
    if(state.area && v.area!==state.area) return false;
    if(q){
      var hay=(v.name+" "+v.area+" "+(v.location||"")+" "+(v.aka||[]).join(" ")).toLowerCase();
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
    if(s==="band"){
      var ra=bandOf(a).rank, rb=bandOf(b).rank;
      if(ra!==rb) return ra-rb;
      return a.name.localeCompare(b.name);
    }
    if(s==="date"){
      // Certifications carry no date at all, so they cannot take part in a
      // date sort and sit at the end rather than pretending to be undated-recent.
      var oa=a.kind==="certification"?2:(a.kind==="enforcement"?1:0);
      var ob=b.kind==="certification"?2:(b.kind==="enforcement"?1:0);
      if(oa!==ob) return oa-ob;
      var la=a.lastInspected||"", lb=b.lastInspected||"";
      if(la!==lb) return la<lb?1:-1;
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
  // a drive that named the place and the action but not its own violations: show the action, not "0 issues"
  if(!v.violations&&v.history&&v.history[0]&&v.history[0].action){
    m.appendChild(el("b",null,"!"));
    m.appendChild(el("s",null,"action"));
    return m;
  }
  m.appendChild(el("b",null,String(v.violations||0)));
  m.appendChild(el("s",null,v.violations===1?"issue":"issues"));
  return m;
}

function bandNode(v){
  var b=bandOf(v);
  var n=el("div","band "+b.css);
  n.style.setProperty("--c",b.color);
  n.appendChild(el("b",null,b.short||v.band||"Rated"));
  n.appendChild(el("s",null,"FSSAI"));
  return n;
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
  var cert = v.kind==="certification";
  if(enf) row.classList.add("enf");
  if(cert) row.classList.add("cert");

  // Only scored venues are ranked. Enforcement records and voluntary
  // certifications carry no position, because neither is a score.
  if(!enf&&!cert&&state.sort==="score-desc"&&!state.q&&!state.grade&&!state.area&&!state.favOnly){
    row.appendChild(el("div","rank","#"+(i+1)));
  }
  row.appendChild(cert ? bandNode(v) : enf ? markNode(v) : ringNode(v.score,v.grade));

  var main=el("div","cmain");
  var name=el("div","cname");
  name.appendChild(el("span",null,v.name));
  if(cert){
    name.appendChild(el("span","tag cert","FSSAI rated"));
  } else if(enf){
    // what the authority did, when the record says (improvement / show-cause notice, licence suspension, closure)
    var act=(v.history[0]&&v.history[0].action)||"";
    if(/closed|closure|sealed/i.test(act)) name.appendChild(el("span","tag enf","Closed by the authority"));
    else if(/suspen/i.test(act)) name.appendChild(el("span","tag enf","Licence being suspended"));
    else if(/show.?cause/i.test(act)) name.appendChild(el("span","tag notice","Show-cause notice"));
    else if(/improvement notice/i.test(act)) name.appendChild(el("span","tag notice","Improvement notice"));
    else name.appendChild(el("span","tag enf","Violations recorded"));
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
  // FSSAI addresses are full postal addresses and swamp the card, so the list
  // shows the locality and the detail sheet carries the address in full.
  seg(cert ? (v.area||v.location) : (v.location||v.area));
  if(v._d!=null) seg(fmtKm(v._d),"dist");
  if(cert){
    // The directory publishes no audit date, so there is nothing honest to put
    // here beyond what the rating is.
    seg("Voluntary rating, undated");
  } else {
    seg(isStale(v.lastInspected)
          ? "Inspected "+fmtDate(v.lastInspected)   // exact date once it is old
          : "Inspected "+ago(v.lastInspected));
  }
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

// Delhi alone carries 3,332 venues. Building a card for every one of them cost
// ~1.9s on each keystroke — the search box felt broken. The list is therefore
// capped and extended on demand; the count above it always states the real
// total, so nothing is hidden, only deferred.
var PAGE = 150, shown = PAGE;

function render(resetPage){
  if(resetPage) shown = PAGE;
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
      var cityName=DATA?DATA.city:"this city";
      body='<p>Nothing on record for <span class="q">'+esc(state.q.trim())+'</span>.</p>'+
           "<p>That is not a bad sign. Only "+(DATA?DATA.stats.venues:"a few hundred")+
           " establishments in "+esc(cityName)+" appear in any public food-safety record, so most places "+
           "are simply not here yet. Try another spelling, browse by area, or switch city.</p>"+
           '<p><a class="reqlink" href="request/?q='+encodeURIComponent(state.q.trim())+'">Ask us to audit '+esc(state.q.trim())+' →</a></p>';
    } else {
      body="<p>Nothing matches those filters.</p>";
    }
    e.innerHTML=icon+body;
    list.appendChild(e);
  } else {
    var slice=rows.slice(0,shown);
    var frag=document.createDocumentFragment();
    slice.forEach(function(v,i){ frag.appendChild(card(v,i)); });
    list.appendChild(frag);
    if(rows.length>slice.length){
      var wrap=el("div","more");
      wrap.appendChild(el("p",null,"Showing "+slice.length+" of "+rows.length+" places."));
      var btn=el("button","morebtn","Show "+Math.min(PAGE,rows.length-slice.length)+" more");
      btn.addEventListener("click",function(){ shown+=PAGE; render(); });
      wrap.appendChild(btn);
      list.appendChild(wrap);
    }
  }

  var active = state.q||state.grade||state.area||state.favOnly;
  $("#count").textContent = rows.length+(rows.length===1?" place":" places")+
    (state.grade==="__enf"?" with violations recorded":"")+
    (state.grade==="__cert"?" with an FSSAI rating":"")+
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
  var cert=v.kind==="certification";
  var h='';

  if(cert){
    var cb=bandOf(v);
    h+='<div class="scorebox" style="--c:'+cb.color+'">'+
       '<div><div class="big" style="font-size:22px;line-height:1.2">'+esc(v.band||"Rated")+'</div></div>'+
       '<div style="flex:1"><div class="meta"><b>FSSAI Hygiene Rating</b><br>'+
       'Awarded after a voluntary audit. No date is published.</div></div></div>';
    h+='<div class="enfnote certnote"><b>This is a certificate, not an inspection.</b> '+
       'The business applied for an FSSAI hygiene audit and paid an accredited agency to carry it out. '+
       'It is not a routine inspection, it is not ranked against inspection scores, and the directory '+
       'publishes no audit date, no marks and no findings — only the band above. '+
       'Ratings are valid for two years.</div>';
  }

  if(enf){
    h+='<div class="enfnote"><b>Enforcement record — no hygiene score.</b> '+
       'Inspectors recorded violations here; this is not a scored audit and is '+
       'not ranked against places that have one.</div>';
    if(!(latest.bad&&latest.bad.length)&&latest.action){
      h+='<div class="note"><b>The authority named this place and the action it took, but not its own violations.</b> '+
         'On a drive, the violations are often listed for every place inspected together — open the original post below for the full list.</div>';
    }
    if(isStale(latest.date)){
      h+='<div class="note"><b>This record is from '+fmtDate(latest.date)+'.</b> '+
         'It describes conditions on that day and may not reflect the place today.</div>';
    }
  }

  if(!enf&&!cert) h+='<div class="scorebox" style="--c:'+g.color+'">'+
       '<div><div class="big">'+(v.score==null?'—':v.score+'<span>/100</span>')+'</div></div>'+
       '<div style="flex:1"><div class="meta"><b>'+g.label+'</b>'+(g.range?' · '+g.range+' band':'')+'<br>'+
       'Inspected '+fmtDate(latest.date)+
       (latest.obtained!=null&&latest.total?'<br>'+latest.obtained+' of '+latest.total+' marks on that checklist':'')+'</div>'+
       (v.score==null?'':'<div class="bar"><i style="width:'+v.score+'%"></i></div>')+
       '</div></div>';

  if(!enf && !cert && latest.notice||(!cert&&/notice/i.test(latest.action||""))){
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
    h+='<h3 class="sec">Record history</h3><div class="hist">';
    v.history.forEach(function(x){
      var isCert=x.kind==="certification";
      var xg=isCert
        ? (BANDS[x.band]||{color:"var(--unr)"})
        : GRADES[x.pct==null?'unrated':(x.pct>=90?'excellent':x.pct>=80?'good':x.pct>=70?'average':'poor')];
      h+='<div class="hrow" style="--c:'+xg.color+'"><div class="hp">'+(isCert?'★':(x.pct==null?'—':x.pct))+'</div>'+
         '<div class="hd">'+(isCert?'FSSAI rating'+(x.band?' — '+esc(x.band):''):fmtDate(x.date))+
         ' · '+esc(x.location||v.location||v.area)+'</div>'+
         (safeUrl(x.url)
            ? '<a class="srcbtn" style="margin:0;height:30px;padding:0 10px" href="'+esc(safeUrl(x.url))+'" target="_blank" rel="noopener noreferrer">Report</a>'
            : '')+'</div>';
    });
    h+='</div>';
  }

  var visits=v.history.filter(function(x){ return x.kind!=="certification"; });
  h+='<h3 class="sec">Source</h3>'+
     '<a class="srcbtn" href="'+esc(safeUrl(latest.url))+'" target="_blank" rel="noopener noreferrer">'+
     '<svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"/></svg>'+
     (cert?'Look this up in the FSSAI directory':'Original report from '+esc(latest.source||'the inspecting authority'))+'</a>'+
     '<p style="font-size:12.5px;color:var(--ink-3);margin:10px 0 4px;line-height:1.55">'+
     (cert
       ? 'The FSSAI directory does not publish a permanent link per venue, so the button opens the '+
         'search page — look the name up there to confirm the rating is still current.'
       : (enf?'':'Checklist totals differ by business type, so compare places on the percentage, never on raw marks. ')+
         (visits.length>1
            ? 'Based on '+visits.length+' recorded visits, the most recent on '+fmtDate(latest.date)+'. '+
              'The findings above are from that visit; earlier ones are listed under record history.'
            : 'This reflects a single visit on '+fmtDate(latest.date)+'.'))+'</p>';

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
    render(true); return;
  }
  if(!navigator.geolocation){
    msg.className="geomsg on err"; msg.textContent="This browser cannot share your location. Pick your area from the dropdown instead.";
    return;
  }
  // A city with no gazetteer has no venue coordinates. Sorting by distance
  // there would order the list at random, so say so rather than pretend.
  if(!VENUES.some(function(v){ return v.lat!=null; })){
    msg.className="geomsg on err";
    msg.textContent="Distances are not available for "+(DATA?DATA.city:"this city")+" yet — its localities have not been mapped. "+
      "Filtering by area works, and the search box covers addresses.";
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
    render(true);
  },function(err){
    btn.disabled=false; $("#nearLabel").textContent="Near me";
    msg.className="geomsg on err";
    msg.textContent = err.code===1
      ? "Location permission was declined. Pick your area from the dropdown instead — it works just as well."
      : "Could not read your location. Pick your area from the dropdown instead.";
  },{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
});

// ----------------------------------------------------------------- controls
$("#q").addEventListener("input",function(){ state.q=this.value; render(true); });
$("#clearQ").addEventListener("click",function(){ $("#q").value=""; state.q=""; $("#q").focus(); render(true); });
$("#sort").addEventListener("change",function(){
  if(this.value==="near"&&!me){ this.value=state.sort; $("#nearBtn").click(); return; }
  state.sort=this.value; render(true);
});
$("#area").addEventListener("change",function(){ state.area=this.value; render(true); });
$("#favBtn").addEventListener("click",function(){ state.favOnly=!state.favOnly; render(true); });
$("#reset").addEventListener("click",function(){
  state.q=""; state.grade=""; state.area=""; state.favOnly=false;
  $("#q").value=""; $("#area").value=""; render(true);
});

// --------------------------------------------------------------------- boot
function loadFailed(what){
  $("#list").innerHTML='<div class="empty"><p>Could not load '+what+'.<br>'+
    'If you opened this file directly from disk, serve the folder instead — for example <code>python -m http.server</code> — because browsers block <code>fetch</code> on <code>file://</code> URLs.</p></div>';
}

function bootCity(d){
  DATA=d;
  VENUES=d.venues.map(function(v){ v._d=null; return v; });
  me=null;
  state.grade=""; state.area=""; state.q=""; state.favOnly=false;
  $("#q").value="";
  $("#nearBtn").classList.remove("active");
  $("#nearLabel").textContent="Near me";
  $("#geomsg").className="geomsg";

  var s=d.stats;
  var hasScores = s.scoredVenues>0;
  // With no scored venues there is nothing to rank, so the list opens in the
  // only order that means anything for a certification-only city.
  state.sort = hasScores ? "score-desc" : "band";
  $("#sort").value = state.sort;
  $("#sortScore").hidden = !hasScores;
  $("#sortScoreAsc").hidden = !hasScores;
  $("#sortBand").hidden = s.certifiedVenues===0;

  // The average and grade counts describe the SCORED set only — enforcement
  // records and voluntary certifications have no score and must not be
  // averaged into it.
  var stats="";
  if(hasScores){
    stats+='<div class="stat"><div class="n">'+s.scoredVenues+'</div><div class="l">scored</div></div>'+
           '<div class="stat"><div class="n">'+s.avgScore+'</div><div class="l">avg score</div></div>';
  }
  if(s.enforcementVenues) stats+='<div class="stat poor"><div class="n">'+s.enforcementVenues+'</div><div class="l">with violations</div></div>';
  if(s.certifiedVenues)   stats+='<div class="stat"><div class="n">'+s.certifiedVenues+'</div><div class="l">FSSAI rated</div></div>';
  stats+='<div class="stat"><div class="n">'+s.areas+'</div><div class="l">areas</div></div>';
  $("#stats").innerHTML=stats;

  var chips=$("#grades");
  chips.textContent="";
  var mk=function(key,label,color){
    var b=el("button","chip"); b.dataset.g=key; b.setAttribute("aria-pressed","false");
    if(color){ var dot=el("span","dot"); dot.style.background=color; b.appendChild(dot); }
    b.appendChild(el("span",null,label));
    b.addEventListener("click",function(){ state.grade = state.grade===key?"":key; render(true); });
    chips.appendChild(b);
  };
  mk("","All records",null);
  if(hasScores){
    mk("excellent","Excellent "+s.excellent,"var(--exc)");
    mk("good","Good "+s.good,"var(--good)");
    mk("average","Average "+s.average,"var(--avg)");
    mk("poor","Needs work "+s.poor,"var(--poor)");
  }
  if(s.enforcementVenues) mk("__enf","Violations "+s.enforcementVenues,"var(--poor)");
  if(s.certifiedVenues)   mk("__cert","FSSAI rated "+s.certifiedVenues,"var(--exc)");

  var sel=$("#area");
  sel.textContent="";
  sel.appendChild(el("option",null,"All areas"));
  sel.firstChild.value="";
  d.areas.forEach(function(a){
    var o=el("option",null,a.name+" ("+a.count+")"); o.value=a.name; sel.appendChild(o);
  });

  var hero=$("#heroLine");
  if(hero){
    if(s.scoredVenues||s.enforcementVenues){
      hero.innerHTML="Hygiene scores for "+esc(d.city)+" restaurants, cafés and stores, taken straight from "+
        "<b>official "+esc((s.sources||[]).slice(0,3).map(function(x){return x.handle;}).join(", ")||"food-safety")+"</b> inspection reports"+
        (s.certifiedVenues?", alongside "+s.certifiedVenues+" FSSAI hygiene ratings.":".");
    } else {
      hero.innerHTML="<b>"+s.certifiedVenues+" FSSAI hygiene ratings</b> for "+esc(d.city)+
        " restaurants, cafés and stores. No routine inspection reports are published for "+
        esc(d.city)+" yet — see what this covers, below.";
    }
  }

  // Attribution has to follow the city. Crediting the Telangana handles on a
  // Delhi page would be a plain misstatement of where the data came from.
  var attrib=$("#attrib");
  if(attrib){
    var parts=[];
    if(s.inspections){
      var handles=(s.sources||[]).map(function(x){
        var h=String(x.handle||"");
        return h.charAt(0)==="@"
          ? '<a href="https://x.com/'+esc(h.slice(1))+'" target="_blank" rel="noopener">'+esc(h)+'</a>'
          : esc(h);
      });
      if(handles.length) parts.push("<b>Where this comes from.</b> Inspection records on this page are "+
        "transcribed from public reports published by "+handles.join(", ")+
        ". Every listing links back to its original report — check it.");
    }
    if(s.certifiedVenues){
      parts.push((parts.length?"":"<b>Where this comes from.</b> ")+
        "Hygiene ratings come from the <a href=\"https://hygiene.fssai.gov.in/knowRating.php\" "+
        "target=\"_blank\" rel=\"noopener\">FSSAI Hygiene Rating directory</a>, a voluntary scheme "+
        "a business applies and pays to be audited under.");
    }
    attrib.innerHTML=parts.join(" ");
  }
  var pct=$("#pctnote");
  if(pct) pct.hidden = !hasScores;   // no percentages in a certification-only city

  coverageNote(d);

  var bits=[];
  if(s.inspections) bits.push(s.inspections+" inspection report"+(s.inspections===1?"":"s"));
  if(s.certifiedVenues) bits.push(s.certifiedVenues+" FSSAI hygiene rating"+(s.certifiedVenues===1?"":"s"));
  $("#gen").textContent="Built from "+bits.join(" and ")+" covering "+s.venues+
    " establishments across "+s.areas+" localities in "+d.city+
    (s.latest?". Most recent inspection: "+fmtDate(s.latest)+".":".");

  render(true);
}

// ---- coverage note: describe the dataset's limits from the dataset itself,
//      so it stays true as the archive grows and as cities are added.
function coverageNote(d){
  var s=d.stats;
  var line=$("#coverageLine"), body=$("#coverageBody");
  if(!line||!body) return;

  line.textContent = s.venues+" places on record in "+d.city+" — not every restaurant in the city.";

  var html="", kinds=[];
  if(s.scoredVenues)      kinds.push("<b>"+s.scoredVenues+"</b> with a scored hygiene audit");
  if(s.enforcementVenues) kinds.push("<b>"+s.enforcementVenues+"</b> with an enforcement record");
  if(s.certifiedVenues)   kinds.push("<b>"+s.certifiedVenues+"</b> with a voluntary FSSAI hygiene rating");

  html += "<p>"+(kinds.length>1?"Three kinds of record can appear here, and they are never ranked against each other: "
                               :"Records here: ")+kinds.join("; ")+".</p>";

  if(s.scoredVenues){
    html += "<p>A <b>scored audit</b> gives marks out of a checklist — those are the only ones ranked. "+
            "An <b>enforcement record</b> means inspectors listed violations but published no score.</p>";
  }

  if(s.certifiedVenues){
    var bands=(s.bands||[]);
    var topBand=bands[0];
    var share = topBand ? Math.round(topBand.count*100/s.certifiedVenues) : 0;
    html += "<p>The <b>FSSAI hygiene rating</b> is voluntary and paid for: a business applies and "+
            "hires an accredited agency to audit it. So this part of the list shows who chose to be "+
            "audited and passed, not who is clean"+
            (topBand&&share>=60 ? " — "+share+"% of the ratings here are “"+esc(topBand.band)+"”, which is what a self-selected list looks like" : "")+
            ". No audit date is published with it, so these entries cannot be aged the way inspections are.</p>";
  }

  var top=(s.sources||[])[0];
  var topAreas=d.areas.slice(0,4).map(function(a){ return a.name; });
  if(top && s.inspections){
    html += "<p><b>"+top.count+" of "+s.inspections+"</b> inspections here were published by "+
            esc(top.handle)+". Coverage follows whoever publishes, so "+
            topAreas.slice(0,3).join(", ")+" and "+(topAreas[3]||"nearby areas")+
            " are well represented while much of the city is barely covered at all.</p>";
  }

  // Point-in-time note, Hyderabad only. Telangana's food-safety department was
  // merged into TG SAFE on 16 Aug 2026 and has not yet published inspections
  // itself. DELETE THIS once TG SAFE publishes its own feed — see MAINTAINING.md.
  if(d.cityKey==="hyderabad"){
    html += "<p>Telangana's food-safety department was reorganised into <b>TG SAFE</b> in "+
            "August 2026. Its enforcement drives — including in areas missing from this list — "+
            "are not shown here, because TG SAFE does not yet publish inspections itself. "+
            "Only reports traceable to the inspecting authority are included.</p>";
  }

  if(!s.located){
    html += "<p>Localities in "+esc(d.city)+" have not been mapped yet, so <b>distance sorting is "+
            "switched off here</b>. Rather than place every venue at the city centre and show "+
            "distances that mean nothing, the site leaves it out. Filtering by area still works.</p>";
  }

  if(s.earliest && s.latest){
    html += "<p>The inspection record runs from "+fmtDate(s.earliest)+" to "+fmtDate(s.latest)+
            ". Older entries are marked <b>Historic</b> — they describe one day, "+
            "sometimes years ago, and a place may have changed completely since.</p>";
  }
  html += "<p><b>A place missing from this list has no public food-safety record.</b> "+
          "That is not a mark against it, and not a clean bill of health either — "+
          "there is simply nothing on record.</p>";
  body.innerHTML=html;
}

function selectCity(key,remember){
  var c=null;
  INDEX.cities.forEach(function(x){ if(x.key===key) c=x; });
  if(!c) c=INDEX.cities[0];
  state.city=c.key;
  $("#city").value=c.key;
  if(remember) store.set("dinecheck.city",c.key);
  $("#list").innerHTML='<div class="empty"><p>Loading '+esc(c.name)+'…</p></div>';
  return fetch(c.file,{cache:"no-cache"})
    .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(bootCity)
    .catch(function(){ loadFailed("the data for "+c.name); });
}

fetch("data.json",{cache:"no-cache"})
  .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
  .then(function(idx){
    INDEX=idx;
    var sel=$("#city");
    idx.cities.forEach(function(c){
      var o=el("option",null,c.name+" ("+c.venues+")"); o.value=c.key; sel.appendChild(o);
    });
    sel.addEventListener("change",function(){ selectCity(this.value,true); });
    var saved=store.get("dinecheck.city",null);
    var known=idx.cities.some(function(c){ return c.key===saved; });
    return selectCity(known?saved:idx.defaultCity,false);
  })
  .catch(function(){ loadFailed("the inspection data"); });
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

/* ------------------------------------------------------------------ notice
   A one-time bar pointing to the Terms and Privacy Policy. It remembers only
   that it has been seen, in this browser. */
(function () {
  var KEY = "dc-notice-ok";
  try { if (localStorage.getItem(KEY)) return; } catch (e) {}
  var bar = document.createElement("div");
  bar.className = "noticebar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Terms and privacy");
  bar.innerHTML = '<p>By using Dine Check you agree to our <a href="/terms/">Terms of Use</a>. We don’t use tracking or advertising cookies — see our <a href="/privacy/">Privacy Policy</a>.</p>' +
    '<button type="button">OK</button>';
  bar.querySelector("button").addEventListener("click", function () {
    try { localStorage.setItem(KEY, "1"); } catch (e) {}
    bar.remove();
  });
  document.body.appendChild(bar);
})();
