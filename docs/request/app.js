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
const GOOGLE_CLIENT_ID = "PASTE_CLIENT_ID_HERE.apps.googleusercontent.com";
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
function shareBlock(r) {
  const url = SITE + "?r=" + encodeURIComponent(r.slug);
  const text = `Help get ${r.venue_name}, ${r.area} checked for food safety by Dine Check — ${plural(r.votes, "person has", "people have")} asked so far. Add your voice:`;
  const d = document.createElement("div");
  d.className = "share";
  d.innerHTML = `<div class="small muted">Your share link</div>
    <div class="row"><input readonly value="${esc(url)}" aria-label="Share link" style="flex:1;min-width:0;font-family:var(--mono);font-size:13px">
      <button class="btn small" type="button" data-copy>Copy</button></div>
    <div class="row">
      <a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + " " + url)}">WhatsApp</a>
      <a class="btn small" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">X</a>
      <a class="btn small" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">Facebook</a>
      <a class="btn small" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}">Telegram</a>
      ${navigator.share ? `<button class="btn small" type="button" data-more>More…</button>` : ""}
    </div>`;
  d.querySelector("[data-copy]").addEventListener("click", async e => {
    try { await navigator.clipboard.writeText(url); e.target.textContent = "Copied"; }
    catch (err) { const i = d.querySelector("input"); i.select(); }
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
  const slug = qs.get("r");
  if (slug && /^[a-f0-9]{6,20}$/i.test(slug)) showShared(slug);
  let stored = null; try { stored = sessionStorage.getItem("dc-cred"); } catch (e) {}
  if (stored && adopt(stored)) signedIn();
  $("cityhint").hidden = city() === HOME_CITY;
  loadBoard();
  initGsi();
})();
