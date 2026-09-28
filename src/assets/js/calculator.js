/* PowerScope — runtime calculator. Runs entirely in the browser.
   Needs window.__DB__ (db.js) and window.__CALC__ (config inlined by build.py). */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) { return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num(v) { return Math.round(v).toLocaleString("en-US"); }
  function dur(h) {
    if (!isFinite(h)) return "indefinitely";
    if (h < 1) return Math.round(h * 60) + " min";
    if (h < 48) return (h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h)) + " h";
    return (h / 24).toFixed(1).replace(/\.0$/, "") + " days";
  }
  function daysLabel(d) { return d === 0.5 ? "12 hours" : d + (d === 1 ? " day" : " days"); }

  function init() {
    var root = document.querySelector("[data-calc]");
    var DB = window.__DB__, CFG = window.__CALC__;
    if (!root || !DB || !CFG) return;
    var form = root.querySelector("[data-calc-form]");
    var customWrap = root.querySelector("[data-custom]");
    var tpl = document.querySelector("[data-custom-tpl]");
    var daysIn = root.querySelector("[data-days]"), daysOut = root.querySelector("[data-days-out]");
    var solarIn = root.querySelector("[data-solar]");
    var budget = root.querySelector("[data-budget]"), budgetOut = root.querySelector("[data-budget-out]");
    var needEl = root.querySelector("[data-need]"), viz = root.querySelector("[data-viz]");
    var summary = root.querySelector("[data-summary]"), list = root.querySelector("[data-list]");
    var focus = (new URLSearchParams(location.search).get("ids") || "").split(",").filter(Boolean);

    function val(el, sel, dflt) {
      var i = el.querySelector(sel);
      var v = i ? parseFloat(i.value) : NaN;
      return isFinite(v) && v >= 0 ? v : dflt;
    }

    function readDevices() {
      var out = [];
      root.querySelectorAll("[data-item]").forEach(function (el) {
        var on = el.querySelector("[data-on]");
        el.classList.toggle("is-on", !!(on && on.checked));
        if (!on || !on.checked) return;
        out.push({
          name: el.querySelector(".calc-item__name").textContent,
          qty: Math.max(1, Math.round(val(el, "[data-qty]", 1))),
          w: val(el, "[data-w]", 0), h: Math.min(24, val(el, "[data-h]", 0)),
          duty: parseFloat(el.getAttribute("data-duty")) || 1,
          surge: parseFloat(el.getAttribute("data-surge")) || 0
        });
      });
      root.querySelectorAll("[data-custom-item]").forEach(function (el) {
        var w = val(el, "[data-w]", 0);
        if (!w) return;
        var nm = (el.querySelector("[data-name]").value || "").trim() || "Your device";
        out.push({ name: nm, qty: Math.max(1, Math.round(val(el, "[data-qty]", 1))), w: w,
          h: Math.min(24, val(el, "[data-h]", 0)), duty: 1, surge: val(el, "[data-surge]", 0) });
      });
      return out;
    }

    function totals(devs, days) {
      var t = { daily: 0, peak: 0, start: 0, startDev: null, largest: 0, largestDev: null };
      devs.forEach(function (d) {
        t.daily += d.w * d.qty * d.h * d.duty;
        t.peak += d.w * d.qty;
        if (d.w > t.largest) { t.largest = d.w; t.largestDev = d.name; }
      });
      devs.forEach(function (d) {
        if (d.surge > d.w) {
          var s = t.peak - d.w + d.surge;
          if (s > t.start) { t.start = s; t.startDev = d.name; }
        }
      });
      t.need = t.daily * days;
      t.avg = t.daily / 24;
      return t;
    }

    function evaluate(p, t, a) {
      var s = p.specs, checks = [];
      function add(st, txt) { checks.push({ st: st, t: txt }); }
      var cap = s.capacity_wh || 0, out = s.ac_output_w || 0, surge = s.surge_w || out;
      var usable = cap * CFG.eff;
      var cover = t.avg > 0 ? usable / t.avg : Infinity;
      // 1. continuous output
      if (t.peak <= out) add("ok", "Runs everything at once: " + num(t.peak) + " W of its " + num(out) + " W");
      else if (t.largest <= out) add("warn", num(t.peak) + " W if everything runs at once, over its " + num(out) + " W — stagger the heavy appliances");
      else add("no", t.largestDev + " (" + num(t.largest) + " W) is more than its " + num(out) + " W output");
      // 2. startup surge
      if (t.start > 0) {
        if (t.start <= surge) add("ok", "Handles the " + t.startDev.toLowerCase() + " startup (~" + num(t.start) + " W peak" + (s.surge_w ? ", rated " + num(surge) + " W)" : ")"));
        else add("warn", "Startup of the " + t.startDev.toLowerCase() + " (~" + num(t.start) + " W) may exceed its " + num(surge) + " W " + (s.surge_w ? "surge" : "output (surge not published)") + " — start it first, alone");
      }
      // 3. energy
      var ratio = t.need > 0 ? usable / t.need : Infinity;
      if (t.daily > 0) {
        if (usable >= t.need) add("ok", "Lasts about " + dur(cover) + " at your usage — covers " + daysLabel(a.days));
        else if (s.expandable_wh && s.expandable_wh * CFG.eff >= t.need) add("warn", "Lasts about " + dur(cover) + " on its own; extra batteries (up to " + num(s.expandable_wh) + " Wh) cover " + daysLabel(a.days));
        else if (ratio >= 0.5) add("warn", "Lasts about " + dur(cover) + " — about " + Math.round(ratio * 100) + "% of " + daysLabel(a.days) + "; recharge midway");
        else add("no", "Lasts only about " + dur(cover) + " of " + daysLabel(a.days));
      }
      // 4. solar
      if (a.solar && t.daily > 0) {
        var panels = t.daily / (CFG.sun * CFG.derate);
        var need50 = Math.ceil(panels / 50) * 50;
        if (!s.solar_w) add("warn", "Max solar input not published — can't check a daily refill");
        else if (s.solar_w >= panels) add("ok", "About " + num(need50) + " W of panels refills a day's use (accepts up to " + num(s.solar_w) + " W)");
        else add("warn", "Max " + num(s.solar_w) + " W of solar refills about " + Math.round(s.solar_w / panels * 100) + "% of a day's use");
      }
      // 5. budget
      if (p.price != null && p.price > a.budget) add("no", "Over budget: " + money(p.price));
      var st = checks.some(function (c) { return c.st === "no"; }) ? "no" : checks.some(function (c) { return c.st === "warn"; }) ? "warn" : "ok";
      return { p: p, st: st, checks: checks, usable: usable, ratio: ratio };
    }

    function drawViz(t, results) {
      if (!(t.need > 0)) { viz.innerHTML = ""; viz.hidden = true; return; }
      viz.hidden = false;
      var rs = results.slice().sort(function (x, y) { return x.usable - y.usable; });
      var maxU = rs.length ? rs[rs.length - 1].usable : 1;
      var top = Math.max(maxU, t.need) * 1.08;
      var W = 640, H = 190, base = 158, plot = 138, bw = Math.min(26, (W - 30) / rs.length - 5);
      var y = function (wh) { return base - (wh / top) * plot; };
      var lineY = y(Math.min(t.need, top));
      var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Usable energy of each power station compared with the energy you need">';
      svg += '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" class="ff-floor"/>';
      rs.forEach(function (r, i) {
        var x = 18 + i * (bw + 5), h = (r.usable / top) * plot;
        svg += '<g class="ff-bar ff-bar--' + r.st + '"><title>' + esc(r.p.name) + " — " + num(r.usable) + ' usable Wh</title><rect x="' + x + '" y="' + (base - h) + '" width="' + bw + '" height="' + h + '" rx="3"/>' +
          '<text x="' + (x + bw / 2) + '" y="' + (base + 14) + '" text-anchor="middle">' + (r.p.specs.capacity_wh >= 1000 ? (r.p.specs.capacity_wh / 1000).toFixed(1) + "k" : r.p.specs.capacity_wh) + "</text></g>";
      });
      svg += '<line x1="0" x2="' + W + '" y1="' + lineY + '" y2="' + lineY + '" class="ff-line"/>';
      svg += '<text x="8" y="' + Math.max(12, lineY - 6) + '" class="ff-sofa-t calc-need-t">You need ' + num(t.need) + " Wh</text>";
      svg += "</svg>";
      viz.innerHTML = svg + '<p class="ff-viz__cap">Each bar is one power station\'s usable energy (rated Wh × ' + Math.round(CFG.eff * 100) + '%), labeled with its rated capacity. Green covers your plan, amber partly, red falls short or fails another check.</p>';
    }

    function renderNeed(t, a, devs) {
      if (!devs.length) {
        needEl.innerHTML = '<p class="calc-empty"><b>Tick at least one device</b> or pick a quick-start scenario to see which power stations can run it.</p>';
        return;
      }
      var stat = function (v, l) { return "<div><b>" + v + "</b><span>" + l + "</span></div>"; };
      needEl.innerHTML = '<div class="calc-stats">' +
        stat(num(t.peak) + " W", "if everything runs at once") +
        stat(t.start ? num(t.start) + " W" : "—", "biggest startup surge") +
        stat(num(t.daily) + " Wh", "energy per day") +
        stat(num(t.need) + " Wh", "needed for " + daysLabel(a.days)) + "</div>";
    }

    function render() {
      var a = { days: parseFloat(daysIn.value) || 1, solar: solarIn.checked, budget: parseFloat(budget.value) };
      daysOut.textContent = daysLabel(a.days);
      budgetOut.textContent = a.budget >= parseFloat(budget.max) ? "Any price" : "Up to $" + num(a.budget);
      if (a.budget >= parseFloat(budget.max)) a.budget = Infinity;
      var devs = readDevices();
      var t = totals(devs, a.days);
      renderNeed(t, a, devs);
      var results = DB.products.map(function (p) { return evaluate(p, t, a); });
      if (!devs.length) {
        results.forEach(function (r) { r.st = "ok"; r.checks = []; });
      }
      var rank = { ok: 0, warn: 1, no: 2 };
      results.sort(function (x, y) {
        var fx = focus.indexOf(x.p.id) > -1 ? 0 : 1, fy = focus.indexOf(y.p.id) > -1 ? 0 : 1;
        if (fx !== fy) return fx - fy;
        if (!devs.length) return y.p.score - x.p.score;
        if (rank[x.st] !== rank[y.st]) return rank[x.st] - rank[y.st];
        if (x.st === "warn") return Math.min(y.ratio, 9) - Math.min(x.ratio, 9) || (x.p.price || 0) - (y.p.price || 0);
        return (x.p.price || 0) - (y.p.price || 0);
      });
      drawViz(t, results);
      var nOk = results.filter(function (r) { return r.st === "ok"; }).length;
      var nWarn = results.filter(function (r) { return r.st === "warn"; }).length;
      var jump = document.querySelector("[data-jump]");
      if (jump) jump.textContent = devs.length ? "See results: " + nOk + " can do it all ↓" : "See all power stations ↓";
      summary.innerHTML = devs.length ? "<b>" + nOk + "</b> can do it all · <b>" + nWarn + "</b> with caveats · <b>" + (results.length - nOk - nWarn) + "</b> not enough" : "";
      var bestId = null;
      if (devs.length) { var b = results.filter(function (r) { return r.st === "ok"; }).sort(function (x, y) { return (x.p.price || 0) - (y.p.price || 0); })[0]; if (b) bestId = b.p.id; }
      var labels = { ok: devs.length ? "Can do it all" : "", warn: "Works, with caveats", no: "Not enough" };
      list.innerHTML = results.map(function (r) {
        var p = r.p, s = p.specs;
        var tag = p.id === bestId ? '<span class="chip chip--volt calc-best">Cheapest that does it all</span>' : "";
        var ppw = p.price && s.capacity_wh ? '<span class="calc-ppw">$' + (p.price / s.capacity_wh).toFixed(2) + "/Wh</span>" : "";
        return '<article class="ff-card ff-card--' + r.st + (focus.indexOf(p.id) > -1 ? " is-focus" : "") + '">' +
          '<a class="ff-card__img" href="' + esc(p.url) + '"><img src="' + esc(p.img) + '" alt="" loading="lazy"></a>' +
          '<div class="ff-card__body"><div class="ff-card__top">' + (labels[r.st] ? '<span class="ff-status">' + labels[r.st] + "</span>" : "") + tag + '<span class="score-pill" title="Editor score">' + p.score + "</span></div>" +
          '<h3><a href="' + esc(p.url) + '">' + esc(p.name) + "</a></h3>" +
          '<p class="calc-specs">' + num(s.capacity_wh) + " Wh · " + num(s.ac_output_w) + " W" + (s.surge_w ? " (" + num(s.surge_w) + " W surge)" : "") + (s.weight_lb ? " · " + s.weight_lb + " lb" : "") + "</p>" +
          (r.checks.length ? '<ul class="ff-checks">' + r.checks.map(function (c) { return '<li class="is-' + c.st + '">' + esc(c.t) + "</li>"; }).join("") + "</ul>" : "") +
          '<div class="ff-card__actions">' + (p.price != null ? '<span class="ff-price">' + money(p.price) + "</span>" : "") + ppw +
          '<a class="btn btn--amazon btn--xs" href="' + esc(p.aff) + '" target="_blank" rel="sponsored nofollow noopener">View on Amazon<svg class="ico"><use href="#i-ext"/></svg></a>' +
          '<a class="btn btn--ghost btn--xs" href="' + esc(p.url) + '">Review</a></div></div></article>';
      }).join("") + '<p class="note note--muted">Prices from Amazon.com as of ' + esc(DB.products[0].priceDate) + ". Specs are manufacturer claims and device draws are typical values; see each review for sources.</p>";
    }

    function applyScenario(id) {
      root.querySelectorAll("[data-item]").forEach(function (el) {
        var on = el.querySelector("[data-on]"); on.checked = false;
      });
      root.querySelectorAll("[data-custom-item]").forEach(function (el) { el.remove(); });
      if (id === "clear") { render(); return; }
      var sc = (CFG.scenarios || []).filter(function (x) { return x.id === id; })[0];
      if (!sc) return;
      Object.keys(sc.items).forEach(function (k) {
        var el = root.querySelector('[data-item="' + k + '"]');
        if (!el || !sc.items[k]) return;
        el.querySelector("[data-on]").checked = true;
        el.querySelector("[data-qty]").value = sc.items[k];
        var grp = el.closest("details"); if (grp) grp.open = true;
      });
      daysIn.value = sc.days;
      root.querySelectorAll("[data-scen]").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-scen") === id); });
      render();
    }

    root.addEventListener("click", function (e) {
      var sc = e.target.closest("[data-scen]");
      if (sc) { applyScenario(sc.getAttribute("data-scen")); return; }
      if (e.target.closest("[data-add]")) {
        var node = tpl.content.firstElementChild.cloneNode(true);
        customWrap.appendChild(node);
        var nm = node.querySelector("[data-name]"); if (nm) nm.focus();
        render(); return;
      }
      var rm = e.target.closest("[data-rm-custom]");
      if (rm) { rm.closest("[data-custom-item]").remove(); render(); }
    });
    form.addEventListener("input", render);
    form.addEventListener("change", render);

    // Start from a realistic state: an overnight outage with the usual essentials.
    applyScenario("overnight");
    if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
      root.querySelectorAll("details.calc-group").forEach(function (d) { if (!d.querySelector("[data-on]:checked")) d.open = false; });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
