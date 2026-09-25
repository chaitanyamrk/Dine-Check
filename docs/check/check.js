/* Dine Check — "Would your kitchen pass a TG SAFE inspection?" (dinecheck.in/check).
   Twenty yes/no questions built from what TG SAFE's officers found on
   24 September 2026. The score is worked out here, in the browser; nothing
   is sent unless the owner fills in the form at the end and ticks consent —
   then only their details, the score and the codes of the questions answered
   No go to owner_lead_submit. */
(function () {
  const API = "https://data.dinecheck.in", KEY = "sb_publishable_sp23L2CI2Buds-RFaJMVHA_O73aOv2n";
  const $ = id => document.getElementById(id);
  const el = (t, a, ...k) => { const n = document.createElement(t); Object.entries(a || {}).forEach(([x, y]) => { if (y == null || y === false) return; if (x === "class") n.className = y; else if (x.startsWith("on")) n.addEventListener(x.slice(2), y); else n.setAttribute(x, y); });
    k.flat().forEach(c => c != null && n.append(c.nodeType ? c : document.createTextNode(String(c)))); return n; };
  // [code, group, question, weight, critical, rule, what to do, how Dine Check helps]
  const Q = [
    ["expired", "Storage and use-by dates", "Nothing in any fridge, freezer or store is past its use-by or best-before date", 3, true, "FSS Act 2006 s.26(2): no business may store or sell unsafe food",
      "Go through every fridge, freezer and shelf today and throw out anything past its date. Then do it every morning.", "The kitchen app's daily expiry sweep lists everything due today, and staff close each label as used or thrown away."],
    ["labels", "Storage and use-by dates", "Everything opened, prepared, thawed or portioned has a label with its date and use-by", 2, false, "FSSAI catering guidance §2.3(h): pre-prepared items date-tagged",
      "Label every container when it is filled: what it is, when it was made, use by when. Coloured day-dots work too.", "Label & Use-by prints labels from a phone, or gives the day-dot colour, and works out the use-by for you."],
    ["cooked24", "Storage and use-by dates", "Cooked food kept in the fridge is used within 24 hours", 2, false, "FSSAI catering guidance §2.4(f)",
      "Cool cooked food quickly, refrigerate it and throw away anything older than 24 hours.", "Labels for cooked food get a 24-hour use-by automatically — the app never allows longer."],
    ["produce", "Storage and use-by dates", "Vegetables, fruit, meat and fish are checked every day — nothing rotten, mouldy or smelly is kept", 3, true, "FSS Act 2006 s.26(2) and s.3(1)(zz): spoiled food is unsafe food",
      "Check the vegetable store and the fridges every morning; throw rotten stock away and record it.", "The storage walk asks this for every store, with a photo, and the discard log records what was thrown and why."],
    ["floor", "Storage and use-by dates", "All food is on racks or shelves, at least 15 cm off the floor", 2, false, "FSSAI catering guidance §1.4.6; FSS Regulations Schedule 4",
      "Put sacks, crates and tins on racks or pallets — never on the floor, and away from the wall.", "Part of every storage walk."],
    ["covered", "Storage and use-by dates", "All stored food is covered, in food-grade containers — no newspaper, no paint or chemical buckets", 2, false, "FSSAI catering guidance §2.2",
      "Move open sacks and tins into lidded food-grade containers; no newspaper wrapping.", "Part of every storage walk."],
    ["rawbelow", "Storage and use-by dates", "Raw meat and fish are on the bottom shelf, below cooked and ready-to-eat food", 2, false, "FSSAI catering guidance §2.2",
      "Re-arrange every fridge: raw at the bottom, cooked and ready-to-eat above.", "Part of every storage walk for fridges."],
    ["fefo", "Storage and use-by dates", "Oldest stock is used first — first expiry, first out", 1, false, "FSSAI catering guidance §2.2(h); FSS Regulations Schedule 4",
      "When a delivery comes in, move older stock to the front.", "Part of every storage walk and the weekly store clean."],
    ["temps", "Fridges and freezers", "Fridges are at 5 °C or below and freezers at −18 °C, checked and written down twice a day", 2, false, "FSSAI catering guidance §2.2(e)",
      "Put a thermometer in each unit and record it morning and evening.", "Temperature rounds in the kitchen app, with an alert when one is missed or out of limit."],
    ["fridgeclean", "Fridges and freezers", "Fridges are clean, door seals whole, no ice build-up, not over-filled", 1, false, "Audit checks C04-011, C06-028",
      "Deep-clean each fridge weekly: empty, wash, check the seals, defrost.", "A weekly fridge deep-clean task with a checklist."],
    ["pests", "Cleanliness and pests", "No sign of cockroaches, rats or flies anywhere — kitchen, stores or drains", 3, true, "FSS Regulations Schedule 4; FSSAI catering guidance §3.3",
      "Call your pest-control contractor now; seal gaps, cover drains, keep bins closed.", "A pest check in every storage walk; pest-control visits kept with reminders in Comply."],
    ["pestvisit", "Cleanliness and pests", "A pest-control contractor visits at least every 15 days and leaves a report", 2, false, "FSSAI catering guidance §2.2(b): pest control every 15 days",
      "Sign a contract with a licensed pest-control company and keep every visit report.", "Comply reminds you before each visit is due and keeps the reports."],
    ["floors", "Cleanliness and pests", "Floors are clean and dry, drains covered, no standing water", 2, false, "FSSAI catering guidance §1.4.2, §3.1",
      "Mop and dry floors after every shift; fit drain covers and cockroach traps.", "A daily floors, drains and bins cleaning task."],
    ["exhaust", "Cleanliness and pests", "Exhaust hoods, filters and chimneys are degreased at least once a month", 1, false, "FSS Regulations Schedule 4: cleaning programme",
      "Degrease hood filters weekly and the ducts and chimney monthly (or by a contractor).", "A monthly exhaust and chimney task in the cleaning schedule."],
    ["handlers", "People", "Every food handler wears a clean apron and cap, has short nails and no jewellery", 2, false, "FSSAI catering guidance §4.3–4.4",
      "Give each person two aprons and caps; check before every shift.", "A 30-second pre-shift hygiene check for each person."],
    ["illness", "People", "Staff who are ill (diarrhoea, vomiting, fever, jaundice, infected cuts) do not handle food", 3, true, "FSSAI catering guidance §4.2(b)",
      "Tell every worker to report illness before starting work, and keep them away from food until well.", "The pre-shift check asks 'fit to work with food today?' — yes or no, nothing more."],
    ["fostac", "People", "A FoSTaC-trained Food Safety Supervisor is on every shift", 2, false, "FSS Regulations Schedule 4, Part II(b): FoSTaC-trained supervisor",
      "Enrol a supervisor on FoSTaC training (FSSAI's programme) and keep the certificate.", "Comply tracks certificates and when they expire."],
    ["licence", "Paperwork", "A valid FSSAI licence or registration is displayed where customers can see it", 3, true, "FSS Act 2006 s.31: no food business without a licence or registration",
      "If you have no licence or it has expired, apply on FoSCoS today — operating without one is what gets a kitchen closed.", "Comply checks your licence number and reminds you 60, 30 and 7 days before it expires."],
    ["records", "Paperwork", "Records are kept: temperatures, cleaning, pest control, deliveries — for at least a year", 2, false, "FSS Regulations Schedule 4; FSSAI catering guidance §7.2",
      "Keep one register for each; sign and date every entry.", "Every check in the kitchen app is a signed, dated record, kept two years and printable for an inspector."],
    ["suppliers", "Paperwork", "Suppliers have FSSAI licences, and every delivery is checked before it is accepted", 2, false, "FSS Act 2006 s.26; FSSAI catering guidance §2.1",
      "Collect each supplier's FSSAI licence; check temperature, dates and packaging at every delivery and refuse bad stock.", "Supplier files with the law each one must meet, and delivery checks in the kitchen app."]
  ];
  const ans = {};
  const box = $("qs");
  let grp = null;
  Q.forEach(([code, g, text, , crit, rule]) => {
    if (g !== grp) { box.append(el("div", { class: "grp" }, g)); grp = g; }
    const y = el("button", { type: "button", class: "y", "aria-pressed": "false" }, "Yes"), n = el("button", { type: "button", class: "n", "aria-pressed": "false" }, "No");
    const set = v => { ans[code] = v; y.setAttribute("aria-pressed", String(v)); n.setAttribute("aria-pressed", String(!v)); progress(); };
    y.onclick = () => set(true); n.onclick = () => set(false);
    box.append(el("div", { class: "q" }, el("div", { class: "t" }, el("b", {}, text), crit ? el("span", { class: "crit" }, "critical") : null, el("div", { class: "why" }, rule)),
      el("div", { class: "yn", role: "group", "aria-label": text }, y, n)));
  });
  function progress() {
    const done = Object.keys(ans).length;
    $("bar").style.width = Math.round(100 * done / Q.length) + "%";
    $("done").disabled = done < Q.length;
    $("left").textContent = done < Q.length ? `${Q.length - done} to go` : "";
  }
  progress();

  let result = null;
  $("done").onclick = () => {
    const total = Q.reduce((a, q) => a + q[3], 0), got = Q.reduce((a, q) => a + (ans[q[0]] ? q[3] : 0), 0);
    const score = Math.round(100 * got / total), noes = Q.filter(q => !ans[q[0]]), crit = noes.filter(q => q[4]);
    result = { score, failed: noes.map(q => q[0]), critical_failed: crit.length };
    const cls = crit.length || score < 70 ? "bad" : score < 90 ? "warn" : "ok";
    const head = crit.length ? "At risk — these are the problems that got licences suspended" : score < 70 ? "At risk — several things an officer would write up" : score < 90 ? "Nearly there — a few fixes needed" : "Likely to pass — keep it up every day";
    const r = $("res"); r.hidden = false; r.innerHTML = "";
    r.append(el("div", { class: "result " + cls }, el("div", { class: "score" }, score + "%"), el("h2", { style: "margin-top:6px" }, head),
      el("p", { class: "small", style: "margin:8px 0 0" }, crit.length ? `You answered No to ${crit.length} critical question${crit.length === 1 ? "" : "s"}. On TG SAFE's drive, kitchens with problems like these had their licence suspended or were closed. Put ${crit.length === 1 ? "it" : "them"} right today.`
        : noes.length ? `You answered No to ${noes.length} question${noes.length === 1 ? "" : "s"}. None is critical, but an officer would issue an improvement notice for them.` : "Everything an officer looked for on the drive is in place. The hard part is doing it every day — and having the records to show it.")));
    if (noes.length) {
      const c = el("div", { class: "card" }, el("h2", {}, "What to put right, most serious first"));
      noes.slice().sort((a, b) => (b[4] - a[4]) || (b[3] - a[3])).forEach(q => c.append(el("div", { class: "fix" }, el("b", {}, (q[4] ? "Critical — " : "") + q[2]),
        el("div", { class: "how" }, q[6]), el("div", { class: "dc" }, "With Dine Check: " + q[7]))));
      r.append(c);
    }
    r.append(el("div", { class: "row noprint", style: "margin-top:14px" }, el("button", { class: "btn", type: "button", onclick: () => window.print() }, "Print this"),
      el("button", { class: "btn", type: "button", onclick: () => { $("quiz").scrollIntoView({ behavior: "smooth" }); } }, "Change an answer")));
    $("lead").hidden = false;
    r.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  $("send").onclick = async () => {
    const msg = $("msg"); msg.innerHTML = "";
    const fail = t => { msg.innerHTML = ""; msg.append(el("div", { class: "err" }, t)); };
    if (!$("consent").checked) return fail("Tick the box to let us contact you.");
    if (!$("lPhone").value.trim() && !$("lEmail").value.trim()) return fail("Give a phone number or an email address.");
    const wants = ["call"].concat($("wAudit").checked ? ["audit"] : [], $("wApp").checked ? ["app"] : [], $("wTraining").checked ? ["training"] : []);
    const body = { p: { name: $("lName").value, restaurant: $("lRest").value, area: $("lArea").value, city: $("lCity").value, phone: $("lPhone").value.trim() || null,
      email: $("lEmail").value.trim() || null, kitchen_type: $("lType").value, wants, score: result && result.score, critical_failed: result && result.critical_failed,
      failed: result ? result.failed : [], consent: true, website: $("website").value } };
    $("send").disabled = true;
    try {
      const r = await fetch(API + "/rest/v1/rpc/owner_lead_submit", { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let j = null; try { j = await r.json(); } catch (e) {}
      if (!r.ok) { $("send").disabled = false; return fail((j && j.message) || "That didn't work. Please try again."); }
      $("lead").innerHTML = ""; $("lead").append(el("div", { class: "okbox" }, el("b", {}, "Thank you — we'll be in touch."),
        el("div", { class: "small", style: "margin-top:4px" }, j === "already" ? "We already have your details from today; a Dine Check auditor will call you." : "A Dine Check auditor will call you within two working days.")));
    } catch (e) { $("send").disabled = false; fail("You appear to be offline. Nothing was sent — try again when you have a connection."); }
  };
})();
