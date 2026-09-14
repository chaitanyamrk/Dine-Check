/* Dine Check — public audit request form.
   Talks to Supabase with the publishable key only. Every protection that
   matters is a row-level security policy on the server; nothing here is
   trusted. Notably this page CANNOT read back what it submits — an
   unpublished request is invisible to the public, by policy. */

const SUPABASE_URL = "https://nyagpcdlywklfukooqqp.supabase.co";
const SUPABASE_KEY = "sb_publishable_sp23L2CI2Buds-RFaJMVHA_O73aOv2n";
const CITY = "Hyderabad";

const H = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g,
  m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

/* A random id kept in this browser. It is not an identity — it exists only
   so one person cannot run the vote count up on their own. */
function voterKey() {
  let k = null;
  try { k = localStorage.getItem("dc-voter"); } catch (e) {}
  if (!k) {
    k = ([1e7] + "").replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16))
      + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem("dc-voter", k); } catch (e) {}
  }
  return k;
}
function votedFor(id) {
  try { return (JSON.parse(localStorage.getItem("dc-voted") || "[]")).includes(id); }
  catch (e) { return false; }
}
function rememberVote(id) {
  try {
    const v = JSON.parse(localStorage.getItem("dc-voted") || "[]");
    if (!v.includes(id)) { v.push(id); localStorage.setItem("dc-voted", JSON.stringify(v)); }
  } catch (e) {}
}

async function api(path, opts = {}) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: opts.method || "GET",
    headers: { ...H, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { ok: r.ok, status: r.status, json };
}

/* ------------------------------------------------------ duplicate check */
let searchTimer = null, lastQuery = "", currentHits = [];

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 350);
}
async function runSearch() {
  const q = ($("name").value.trim() + " " + $("area").value.trim()).trim();
  if (q.length < 3) { currentHits = []; return paintDupes(); }
  if (q === lastQuery) return;
  lastQuery = q;
  $("dupe").innerHTML = `<div class="dupe"><h2><span class="spin"></span> Checking for an existing request…</h2></div>`;
  const res = await api("rpc/search_requests", { method: "POST", body: { q, in_city: CITY } });
  currentHits = (res.ok && Array.isArray(res.json)) ? res.json.filter(h => h.similarity >= 0.25) : [];
  paintDupes();
}
function paintDupes() {
  const box = $("dupe");
  if (!currentHits.length) { box.innerHTML = ""; return; }
  const rows = currentHits.map(h => {
    const done = votedFor(h.id);
    return `<div class="hit">
      <span class="nm">${esc(h.venue_name)}<em>${esc(h.area)}</em></span>
      <span class="votes" id="v-${h.id}">${h.votes} ${h.votes === 1 ? "request" : "requests"}</span>
      <button type="button" class="btn small" data-vote="${h.id}" ${done ? "disabled" : ""}>
        ${done ? "Added" : "Add mine"}</button></div>`;
  }).join("");
  box.innerHTML = `<div class="dupe">
    <h2>Someone has already asked for this</h2>
    <p>Adding your name to the existing request counts for more than a second entry — it tells us how many people want it.</p>
    ${rows}</div>`;
  box.querySelectorAll("[data-vote]").forEach(b =>
    b.addEventListener("click", () => castVote(b.dataset.vote, b)));
}
async function castVote(id, btn) {
  btn.disabled = true; btn.textContent = "…";
  const res = await api("rpc/vote_request", { method: "POST",
    body: { p_request: id, p_voter: voterKey() } });
  if (res.ok) {
    rememberVote(id);
    btn.textContent = "Added";
    const v = $("v-" + id);
    if (v && typeof res.json === "number") v.textContent = `${res.json} ${res.json === 1 ? "request" : "requests"}`;
    $("msg").innerHTML = `<div class="ok" style="margin-top:14px"><b>Counted.</b>
      You've been added to that request. Thank you — that's genuinely useful to us.</div>`;
    loadBoard();
  } else {
    btn.disabled = false; btn.textContent = "Add mine";
    $("msg").innerHTML = `<div class="err">That didn't go through. Try again in a moment.</div>`;
  }
}

/* ------------------------------------------------------------- submit */
$("name").addEventListener("input", scheduleSearch);
$("area").addEventListener("input", scheduleSearch);

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("name").value.trim(), area = $("area").value.trim();
  const address = $("address").value.trim();
  $("msg").innerHTML = "";
  if (name.length < 2 || area.length < 2) {
    $("msg").innerHTML = `<div class="err">Give us a restaurant name and the area it's in.</div>`;
    return;
  }
  const btn = $("submit"); btn.disabled = true; btn.textContent = "Sending…";

  /* No Prefer: return=representation. The row is not readable by the public
     once written — asking for it back is refused by the select policy. */
  const res = await api("audit_requests", {
    method: "POST",
    body: { venue_name: name, area, city: CITY, address: address || null }
  });

  if (res.status === 201) {
    done(`<b>Request received.</b> We've added ${esc(name)}, ${esc(area)} to our list.
          We don't publish requests, and we'll only audit them with the establishment's agreement.`);
    /* register this browser's interest in the row we cannot read back */
    lastQuery = ""; runSearch();
  } else if (res.status === 409) {
    /* someone else got there first between the search and the submit */
    btn.disabled = false; btn.textContent = "Send request";
    lastQuery = ""; await runSearch();
    $("msg").innerHTML = `<div class="err">That one is already on the list — add your name to it above
      so it counts.</div>`;
  } else {
    btn.disabled = false; btn.textContent = "Send request";
    $("msg").innerHTML = `<div class="err">We couldn't record that just now. Please try again shortly.</div>`;
  }
  function done(html) {
    $("form").querySelectorAll("input,button").forEach(x => x.disabled = true);
    $("msg").innerHTML = `<div class="ok" style="margin-top:14px">${html}</div>`;
    loadBoard();
  }
});

/* --------------------------------------------------------- public board */
async function loadBoard() {
  const res = await api("audit_requests?select=venue_name,area,votes,public_rank"
    + "&is_public=eq.true&order=public_rank.asc,votes.desc&limit=10");
  const box = $("board");
  if (!res.ok || !Array.isArray(res.json)) { box.innerHTML = `<div class="empty">Not available right now.</div>`; return; }
  if (!res.json.length) {
    box.innerHTML = `<div class="empty">Nothing here yet. We show a request only when we've chosen to —
      the list is ours to curate, not a public tally.</div>`;
    return;
  }
  box.innerHTML = res.json.map((r, i) => `<div class="brow">
      <span class="rank">${i + 1}</span>
      <span class="nm">${esc(r.venue_name)}<em>${esc(r.area)}</em></span>
      <span class="votes">${r.votes} ${r.votes === 1 ? "request" : "requests"}</span>
    </div>`).join("");
}
loadBoard();
