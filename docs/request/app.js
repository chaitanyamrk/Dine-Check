/* Dine Check — ask for an audit (dinecheck.in/request).

   People sign in with Google, pick the restaurant from Google Maps
   suggestions, and share a link so friends can add their voice. Every
   request and vote goes through our "requests" function, which checks the
   Google sign-in itself; this page is trusted with nothing. The only thing
   it reads directly is a request's public page (name, area, count) and
   the requests we have chosen to show. */

const API = "https://data.dinecheck.in";
const KEY = "sb_publishable_sp23L2CI2Buds-RFaJMVHA_O73aOv2n";
/* From Google Cloud → APIs & Services → Credentials → OAuth client (Web). Public by design. */
const GOOGLE_CLIENT_ID = "558944594305-5fkublg74boecs0bk8khpk6fornl9gdg.apps.googleusercontent.com";
const SITE = "https://dinecheck.in/request/";
const HOME_CITY = "Hyderabad";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const STAGE = {
  open: "Collecting requests",
  contacted: "We've contacted the restaurant",
  agreed: "The restaurant has agreed to an audit",
  audited: "Audited by Dine Check"
};

/* ------------------------------------------------------------------ server */
async function call(action, body = {}) {
  try {
    const r = await fetch(API + "/functions/v1/requests", {
      method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ action, credential: cred, ...body })
    });
    let json = null; try { json = await r.json(); } catch (e) {}
    if (r.status === 401 && action !== "suggest") signOut(true);
    return { ok: r.ok, status: r.status, json, error: (json && json.error) || (r.ok ? "" : "That didn't work. Please try again.") };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: "You appear to be offline. Nothing was sent — try again when you have a connection." };
  }
}
async function rpc(name, body) {
  try {
    const r = await fetch(API + "/rest/v1/rpc/" + name, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

/* ------------------------------------------------------------------ sign-in */
let cred = null, user = null, pendingVote = null;

function decode(jwt) {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(p + "===".slice((p.length + 3) % 4)))));
  } catch (e) { return null; }
}
function adopt(c) {
  const p = decode(c);
  if (!p || !p.exp || p.exp * 1000 < Date.now() + 60000) return false;
  cred = c; user = { name: p.name || "", email: p.email || "", exp: p.exp };
  try { sessionStorage.setItem("dc-cred", c); } catch (e) {}
  return true;
}
function signedIn() {
  $("signedOut").hidden = true; $("signedIn").hidden = false;
  $("step1").classList.add("done");
  $("whoName").textContent = user.name || "Signed in";
  $("whoEmail").textContent = user.email;
  $("av").textContent = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  $("ask").classList.remove("locked"); $("ask").removeAttribute("aria-disabled");
  loadMine();
  if (pendingVote) { const s = pendingVote; pendingVote = null; vote(s); }
  if ($("q").value.trim().length >= 3 && !$("searchBox").hidden) { lastQ = ""; search(); }
}
function signOut(expired) {
  cred = null; user = null;
  try { sessionStorage.removeItem("dc-cred"); } catch (e) {}
  try { google.accounts.id.disableAutoSelect(); } catch (e) {}
  $("signedOut").hidden = false; $("signedIn").hidden = true;
  $("step1").classList.remove("done");
  $("ask").classList.add("locked"); $("ask").setAttribute("aria-disabled", "true");
  $("mineCard").hidden = true;
  if (expired) $("gsiErr").innerHTML = `<div class="err">Your sign-in has expired. Please sign in again.</div>`;
}
$("signOut").addEventListener("click", () => signOut(false));

function initGsi() {
  if (initGsi.done || !window.google || !google.accounts) return;
  initGsi.done = true;
  if (GOOGLE_CLIENT_ID.startsWith("PASTE_")) {
    $("gsiErr").innerHTML = `<div class="err">Sign-in isn't switched on yet. Please check back soon.</div>`;
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: r => { $("gsiErr").innerHTML = ""; if (adopt(r.credential)) signedIn(); },
    cancel_on_tap_outside: true, context: "signin", itp_support: true, use_fedcm_for_prompt: true
  });
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  google.accounts.id.renderButton($("gsi"), { type: "standard", theme: dark ? "filled_black" : "outline", size: "large",
    text: "signin_with", shape: "pill", logo_alignment: "left", width: Math.min(320, $("gsi").clientWidth || 320) });
  if (!cred) google.accounts.id.prompt();
}
window.onGoogleLibraryLoad = initGsi;

/* ------------------------------------------------------------------ search */
let session = null, picked = null, manual = false, timer = null, lastQ = "";
const newSession = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const city = () => $("city").value;

$("city").addEventListener("change", () => {
  $("cityhint").hidden = city() === HOME_CITY;
  lastQ = ""; hideSugg(); if ($("q").value.trim().length >= 3) search();
  loadBoard();
});
$("q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 300); });
$("q").addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { const b = $("sugg").querySelector("button"); if (b) { e.preventDefault(); b.focus(); } }
  if (e.key === "Escape") hideSugg();
});
function hideSugg() { $("sugg").hidden = true; $("sugg").innerHTML = ""; $("q").setAttribute("aria-expanded", "false"); }

async function search() {
  const q = $("q").value.trim();
  if (q.length < 3 || !cred) { hideSugg(); return; }
  if (q + "|" + city() === lastQ) return;
  lastQ = q + "|" + city();
  session = session || newSession();
  const res = await call("suggest", { input: q, city: city(), session });
  if ($("q").value.trim() !== q) return;               // they kept typing
  const box = $("sugg");
  if (!res.ok) { box.hidden = false; box.innerHTML = `<div class="err" style="margin:8px">${esc(res.error)}</div>`; return; }
  const list = res.json.suggestions || [];
  box.hidden = false; $("q").setAttribute("aria-expanded", "true");
  box.innerHTML = (list.length
      ? list.map((s, i) => `<button type="button" role="option" data-i="${i}"><b>${esc(s.main)}</b><em>${esc(s.secondary)}</em></button>`).join("")
      : `<div class="small muted" style="padding:10px 13px">No match. Try another spelling, or type it in yourself below.</div>`)
    + `<div class="attrib">Suggestions from Google Maps</div>`;
  box.querySelectorAll("button").forEach(b => {
    /* choose on press, not on release: the page can shift when the search box loses focus,
       and a release somewhere else is not a click on this row */
    b.addEventListener("mousedown", e => { e.preventDefault(); choose(list[+b.dataset.i]); });
    b.addEventListener("click", e => { if (e.detail === 0) choose(list[+b.dataset.i]); });   // keyboard
    b.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" && b.nextElementSibling && b.nextElementSibling.tagName === "BUTTON") { e.preventDefault(); b.nextElementSibling.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (b.previousElementSibling || $("q")).focus(); }
    });
  });
}

async function choose(s) {
  hideSugg();
  $("picked").hidden = false;
  $("picked").innerHTML = `<div class="picked"><span class="spin"></span> Getting the details…</div>`;
  const res = await call("place", { placeId: s.placeId, session });
  session = null;                                       // one search, one billed lookup
  if (!res.ok) { $("picked").innerHTML = `<div class="err">${esc(res.error)}</div>`; return; }
  picked = res.json;
  $("searchBox").hidden = true;
  $("picked").innerHTML = `<div class="picked">
      <b>${esc(picked.name)}</b>
      <div class="small">${esc(picked.address)}</div>
      ${picked.closed ? `<div class="warnbox" style="margin:10px 0 0">Google lists this place as permanently closed.</div>` : ""}
      <div class="row" style="margin-top:10px">
        ${picked.maps ? `<a class="small" href="${esc(picked.maps)}" target="_blank" rel="noopener">View on Google Maps</a>` : ""}
        <button class="btn small" type="button" id="unpick" style="margin-left:auto">Not this one</button>
      </div></div>`;
  $("unpick").addEventListener("click", unpick);
  if (!picked.area) {                                   // rare: Google gave no locality — ask for it
    manual = true; $("manual").hidden = false; $("manualClose").hidden = true;
    $("mName").value = picked.name; $("mArea").value = ""; $("mArea").focus();
    picked.sig = null;
  }
  refreshSend();
}
function unpick() {
  picked = null; $("picked").hidden = true; $("picked").innerHTML = "";
  $("searchBox").hidden = false; $("q").value = ""; lastQ = "";
  if (manual) { manual = false; $("manual").hidden = true; $("manualClose").hidden = false; }
  $("q").focus(); refreshSend();
}
$("manualOpen").addEventListener("click", () => {
  manual = true; picked = null; $("searchBox").hidden = true; $("picked").hidden = true; $("manual").hidden = false;
  $("mName").value = $("q").value.trim(); $("mName").focus(); refreshSend();
});
$("manualClose").addEventListener("click", () => { manual = false; $("manual").hidden = true; $("searchBox").hidden = false; refreshSend(); });
["mName", "mArea"].forEach(id => $(id).addEventListener("input", refreshSend));
function refreshSend() {
  $("send").disabled = !(manual ? $("mName").value.trim().length >= 2 && $("mArea").value.trim().length >= 2 : !!picked);
}

/* ------------------------------------------------------------------ send */
$("send").addEventListener("click", async () => {
  const btn = $("send");
  const body = manual
    ? { name: $("mName").value.trim(), area: $("mArea").value.trim(), placeId: picked && picked.placeId, sig: null }
    : { name: picked.name, area: picked.area, placeId: picked.placeId, sig: picked.sig };
  btn.disabled = true; btn.textContent = "Sending…"; $("msg").innerHTML = "";
  const res = await call("submit", { ...body, city: city(), updates: $("updates").checked });
  btn.textContent = "Ask for an audit";
  if (!res.ok) { btn.disabled = false; $("msg").innerHTML = `<div class="err">${esc(res.error)}</div>`; return; }
  const r = res.json;
  const lead = r.created ? `<b>Thank you — you're the first to ask for ${esc(r.venue_name)}.</b>`
    : r.counted ? `<b>Added. ${esc(plural(r.votes, "person has", "people have"))} now asked for ${esc(r.venue_name)}.</b>`
    : `<b>You've already asked for ${esc(r.venue_name)} — thank you.</b>`;
  $("msg").innerHTML = `<div class="ok" style="margin-top:14px">${lead}
      <div class="small" style="margin-top:4px">Share it: every person who adds their voice moves it up our list.</div></div>`;
  $("msg").firstElementChild.append(shareBlock(r));
  picked = null; manual = false;
  $("picked").hidden = true; $("manual").hidden = true; $("searchBox").hidden = false; $("q").value = ""; lastQ = "";
  $("mName").value = ""; $("mArea").value = "";
  refreshSend(); loadMine(); loadBoard();
});

/* ------------------------------------------------------------------ sharing */
/* Small line icons (generic pictograms, not the platforms' own logos). */
const ICON = {
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8.5 7l1.5-2.5h4L15.5 7"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-3.3 2.8-5 5.5-5s5 1.7 5.5 5"/><circle cx="17" cy="9" r="2.3"/><path d="M16 14.2c2.4-.3 4.2 1.2 4.6 3.8"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>'
};

/* A 1080×1920 picture for an Instagram story: the count, the restaurant, and where to add a voice. */
async function storyImage(r) {
  try { await Promise.all([document.fonts.load('600 80px "IBM Plex Serif"'), document.fonts.load('600 40px "IBM Plex Sans"')]); } catch (e) {}
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
  const g = c.getContext("2d");
  g.fillStyle = "#0E1217"; g.fillRect(0, 0, 1080, 1920);
  g.fillStyle = "#3FB5A8"; g.fillRect(0, 0, 1080, 18);
  const sans = w => `${w} "IBM Plex Sans", system-ui, sans-serif`, serif = w => `${w} "IBM Plex Serif", Georgia, serif`;
  const wrap = (text, x, y, max, lh) => {
    const words = String(text).split(/\s+/); let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (g.measureText(t).width > max && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t;
    }
    if (line) { g.fillText(line, x, y); y += lh; }
    return y;
  };
  g.textBaseline = "alphabetic";
  g.fillStyle = "#3FB5A8"; g.font = sans("700 44px"); g.fillText("DINE CHECK", 96, 200);
  g.fillStyle = "#3FB5A8"; g.font = serif("500 300px"); g.fillText(String(r.votes), 90, 620);
  g.fillStyle = "#A3AEBB"; g.font = sans("400 52px");
  let y = wrap(`${r.votes === 1 ? "person has" : "people have"} asked Dine Check to audit`, 96, 720, 888, 70);
  g.fillStyle = "#E8EDF2"; g.font = serif("600 96px");
  y = wrap(r.venue_name, 96, y + 70, 888, 112);
  g.fillStyle = "#A3AEBB"; g.font = sans("400 52px");
  y = wrap(`${r.area}${r.city && r.city !== "Other" ? ", " + r.city : ""}`, 96, y + 10, 888, 66);
  g.fillStyle = "#E8EDF2"; g.font = sans("400 50px");
  wrap("Want it checked for food safety too? Add your voice — the more people ask, the sooner we go.", 96, 1500, 888, 68);
  g.fillStyle = "#3FB5A8"; g.font = sans("700 56px"); g.fillText("dinecheck.in/request", 96, 1760);
  const blob = await new Promise(res => c.toBlob(res, "image/png"));
  return blob ? new File([blob], "dinecheck-request.png", { type: "image/png" }) : null;
}

function shareBlock(r) {
  const url = SITE + "?r=" + encodeURIComponent(r.slug);
  const text = `Help get ${r.venue_name}, ${r.area} checked for food safety by Dine Check — ${plural(r.votes, "person has", "people have")} asked so far. Add your voice:`;
  const d = document.createElement("div");
  d.className = "share";
  d.innerHTML = `<div class="small muted">Share it</div>
    <div class="row sharebtns">
      <button class="btn small" type="button" data-ig>${ICON.instagram}Instagram</button>
      <a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + " " + url)}">${ICON.whatsapp}WhatsApp</a>
      <a class="btn small" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">${ICON.facebook}Facebook</a>
      <a class="btn small" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">${ICON.x}X</a>
    </div>
    <div class="row sharebtns">
      <input readonly value="${esc(url)}" aria-label="Share link" style="flex:1;min-width:0;font-family:var(--mono);font-size:13px">
      <button class="btn small" type="button" data-copy>${ICON.link}Copy</button>
      ${navigator.share ? `<button class="btn small" type="button" data-more>${ICON.more}More</button>` : ""}
    </div>
    <div class="small" data-ighint hidden></div>`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); return true; } catch (err) { d.querySelector("input").select(); return false; } };
  d.querySelector("[data-copy]").addEventListener("click", async e => { if (await copy()) e.currentTarget.lastChild.textContent = "Copied"; });
  /* Instagram has no web "share" link. On a phone we hand the story picture to the
     share sheet (pick Instagram); everywhere, the link is copied for the Link sticker. */
  d.querySelector("[data-ig]").addEventListener("click", async e => {
    const btn = e.currentTarget, hint = d.querySelector("[data-ighint]");
    btn.disabled = true;
    const copied = await copy();
    hint.hidden = false;
    hint.innerHTML = `<div class="warnbox" style="margin:10px 0 0">${copied ? "Link copied. " : ""}In Instagram, post the picture to your story and add the link with the <b>Link</b> sticker (paste it), or put it in your bio.</div>`;
    try {
      const file = await storyImage(r);
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] }).catch(() => {});
      } else if (file) {
        const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        hint.firstChild.insertAdjacentHTML("beforeend", " The story picture has been downloaded.");
        window.open("https://www.instagram.com/", "_blank", "noopener");
      }
    } finally { btn.disabled = false; }
  });
  const more = d.querySelector("[data-more]");
  if (more) more.addEventListener("click", () => navigator.share({ title: "Dine Check", text, url }).catch(() => {}));
  return d;
}

/* ------------------------------------------------------------------ a shared request */
async function showShared(slug) {
  const r = await rpc("request_page", { p_slug: slug });
  if (!r) { $("shared").innerHTML = `<div class="err">That request link isn't valid any more. You can still ask for a restaurant below.</div>`; return; }
  document.title = `Help get ${r.venue_name} audited — Dine Check`;
  $("title").textContent = "Or ask for another restaurant";
  const h = document.createElement("section");
  h.className = "hero";
  h.innerHTML = `<div class="count">${esc(r.votes)}</div>
    <div class="small muted">${r.votes === 1 ? "person has" : "people have"} asked Dine Check to audit</div>
    <h2>${esc(r.venue_name)}</h2>
    <div class="area">${esc(r.area)}${r.city && r.city !== "Other" ? ", " + esc(r.city) : ""}</div>
    ${r.rank && r.rank <= 50 && r.city !== "Other" ? `<div class="small" style="margin-top:6px">#${esc(r.rank)} most requested in ${esc(r.city)}</div>` : ""}
    <span class="stage">${esc(STAGE[r.stage] || STAGE.open)}</span>
    <p class="small muted" style="margin:14px 0 0">Dine Check is an independent food-safety audit bureau. When enough people ask, we approach the restaurant and offer an audit of how its food is stored, cooked, handled and cleaned. We audit only with the restaurant's agreement.</p>
    <div class="row" style="margin-top:14px"><button class="btn primary" type="button" id="voteBtn">Add my voice</button>
      ${r.place_id ? `<a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(r.place_id)}">View on Google Maps</a>` : ""}</div>
    <div id="voteMsg"></div>`;
  h.append(shareBlock(r));
  $("shared").replaceChildren(h);
  $("voteBtn").addEventListener("click", () => {
    if (!cred) {
      pendingVote = slug;
      $("voteMsg").innerHTML = `<div class="warnbox" style="margin:12px 0 0">Sign in with Google just below — your voice is added as soon as you do.</div>`;
      $("signin").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    vote(slug);
  });
}
async function vote(slug) {
  const btn = $("voteBtn"); if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  const res = await call("vote", { slug, updates: $("updates").checked });
  if (btn) { btn.textContent = "Add my voice"; btn.disabled = false; }
  if (!res.ok) { $("voteMsg").innerHTML = `<div class="err">${esc(res.error)}</div>`; return; }
  const r = res.json;
  const c = document.querySelector(".hero .count"); if (c) c.textContent = r.votes;
  $("voteMsg").innerHTML = `<div class="ok" style="margin-top:12px">${r.counted
    ? `<b>Thank you — you're in.</b> ${esc(plural(r.votes, "person has", "people have"))} asked now. Share it to bring more.`
    : `<b>You've already added your voice — thank you.</b> Share it to bring more.`}</div>`;
  if (btn) btn.hidden = true;
  loadMine();
}

/* ------------------------------------------------------------------ your requests */
async function loadMine() {
  if (!cred) return;
  const res = await call("me");
  if (!res.ok) return;
  const m = res.json;
  $("mineCard").hidden = false;
  $("updatesAll").checked = !!m.updates;
  $("mineList").innerHTML = (m.requests || []).length
    ? m.requests.map(r => `<div class="mine"><div class="nm">${esc(r.venue_name)}<em>${esc(r.area)} · ${esc(STAGE[r.stage] || STAGE.open)}</em></div>
        <span class="votes">${esc(plural(r.votes, "request", "requests"))}</span>
        <a class="btn small" href="?r=${encodeURIComponent(r.slug)}">Share</a></div>`).join("")
    : `<div class="empty">Nothing yet — find a restaurant above.</div>`;
}
$("updatesAll").addEventListener("change", async e => {
  const res = await call("updates", { on: e.target.checked });
  $("mineMsg").innerHTML = res.ok ? `<div class="small muted" style="margin-top:6px">${e.target.checked ? "Updates on." : "No more update emails."}</div>`
    : `<div class="err">${esc(res.error)}</div>`;
});
$("forget").addEventListener("click", async () => {
  if (!confirm("Delete your name and email from Dine Check? Your requests stay counted, but no longer point at you, and you won't get any more emails.")) return;
  const res = await call("forget");
  if (!res.ok) { $("mineMsg").innerHTML = `<div class="err">${esc(res.error)}</div>`; return; }
  signOut(false);
  $("notice").innerHTML = `<div class="ok" style="margin-top:18px"><b>Your details are deleted.</b> Thank you for helping.</div>`;
});

/* ------------------------------------------------------------------ the public board */
async function loadBoard() {
  const box = $("board");
  let rows = null;
  try {
    const r = await fetch(API + "/rest/v1/audit_requests?select=venue_name,area,votes,public_rank,share_slug"
      + "&is_public=eq.true&city=eq." + encodeURIComponent(city()) + "&order=public_rank.asc.nullslast,votes.desc&limit=10", { headers: { apikey: KEY } });
    if (r.ok) rows = await r.json();
  } catch (e) {}
  if (!Array.isArray(rows)) { box.innerHTML = `<div class="empty">Couldn't load this just now.</div>`; return; }
  if (!rows.length) { box.innerHTML = `<div class="empty">Nothing here yet. We show a request only when we've chosen to.</div>`; return; }
  box.innerHTML = rows.map((r, i) => `<a class="brow" href="?r=${encodeURIComponent(r.share_slug)}">
      <span class="rank">${i + 1}</span>
      <span class="nm">${esc(r.venue_name)}<em>${esc(r.area)}</em></span>
      <span class="votes">${esc(plural(r.votes, "request", "requests"))}</span></a>`).join("");
}

/* ------------------------------------------------------------------ start */
(async function start() {
  const qs = new URLSearchParams(location.search);
  const unsub = qs.get("unsub");
  if (unsub) {
    const ok = await rpc("request_unsubscribe", { p_token: unsub });
    $("notice").innerHTML = ok ? `<div class="ok" style="margin-top:18px"><b>Done — no more emails.</b> You can switch updates back on here after signing in.</div>`
                               : `<div class="err">That unsubscribe link didn't work. Sign in below and untick "Email me updates" instead.</div>`;
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
  }
  const pre = (qs.get("q") || "").trim().slice(0, 120);
  if (pre) { $("q").value = pre; $("mName").value = pre; }   // from a search on the main site
  const slug = qs.get("r");
  if (slug && /^[a-f0-9]{6,20}$/i.test(slug)) showShared(slug);
  let stored = null; try { stored = sessionStorage.getItem("dc-cred"); } catch (e) {}
  if (stored && adopt(stored)) signedIn();
  $("cityhint").hidden = city() === HOME_CITY;
  loadBoard();
  initGsi();
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
