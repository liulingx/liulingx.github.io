/* Liu Ling 的运行日志：读 data.json，渲染各区块；开场、飘落物、主题、播放器 */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function isObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
  function str(x) { return typeof x === "string" && x.trim() ? x.trim() : ""; }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function span(cls, text) { return el("span", cls, text); }
  function validDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), dd = +s.slice(8, 10);
    var d = new Date(y, m - 1, dd);
    // 2 月 30 日这类会被自动进位的日期按未知处理
    return d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === dd ? d : null;
  }
  function mmdd(s) { return validDate(s) ? s.slice(5) : "--·--"; }
  function count(c) {
    if (!isObj(c)) return null;
    var d = Number.isInteger(c.done) && c.done >= 0 ? c.done : null;
    var t = Number.isInteger(c.total) && c.total >= 0 ? c.total : null;
    if (d != null && t != null && d > t) return { done: null, total: null, bad: true };
    return { done: d, total: t };
  }
  // “5/6”“5/?”“?/6”；两边都不知道才算未记录
  function frac(c) {
    if (!c || (c.done == null && c.total == null)) return null;
    return (c.done == null ? "?" : c.done) + "/" + (c.total == null ? "?" : c.total);
  }
  function rate(c) {
    c = count(c);
    if (!c || c.done == null || !c.total) return null;
    return Math.round((c.done / c.total) * 100);
  }
  function safeUrl(u) {
    u = str(u);
    if (!u || /[\\\s]/.test(u) || u.slice(0, 2) === "//") return null;
    try {
      var url = new URL(u, location.href);
      if (/^https?:\/\//i.test(u)) return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
      // 本地相对路径：不带协议、不跳出站点根目录，保留查询和片段
      if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.charAt(0) === "/" || u.split(/[?#]/)[0].split("/").indexOf("..") >= 0) return null;
      return url.origin === location.origin ? u : null;
    } catch (e) { return null; }
  }
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }
  // 一行代码：parts 是 [class, text] 或 DOM 节点
  function line(box, parts, cls) {
    var row = el("div", "ln" + (cls ? " " + cls : ""));
    var s = el("span");
    parts.forEach(function (p) {
      if (p instanceof Node) s.appendChild(p);
      else if (Array.isArray(p)) s.appendChild(span(p[0], p[1]));
      else s.appendChild(document.createTextNode(p));
    });
    row.appendChild(s);
    box.appendChild(row);
    return row;
  }
  function gap(box) { box.appendChild(el("div", "gap")); }

  var STATUS = [["health", "作息与体能"], ["math", "数学独立掌握"], ["delivery", "有人验收的交付"]];
  var weekCounts = {}, lastWeeks = [], periodDay = "", recordJumpFrame = 0;
  var archiveItems = [], archiveButtons = [], entryKeyCounts = Object.create(null), entriesById = Object.create(null);
  function statusOf(w, key) {
    var s = isObj(w.statuses) ? w.statuses[key] : undefined;
    return s === "passed" || s === "failed" || s === "unrated" ? s : "none";
  }

  function todayInShanghai() {
    var fields = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).forEach(function (p) { fields[p.type] = p.value; });
    return fields.year + "-" + fields.month + "-" + fields.day;
  }
  function dayNumber(s) { return Date.parse(s + "T00:00:00Z") / 86400000; }
  function weekId(w) { return validDate(w.start) && weekCounts[w.start] === 1 ? "week-" + w.start : null; }
  function weekRange(w) { return (validDate(w.start) ? w.start : "起始日期未记录") + " — " + (validDate(w.end) ? w.end : "结束日期未记录"); }
  function completeRange(w) { return validDate(w.start) && validDate(w.end) && w.start <= w.end; }
  function weekMonday(s) {
    var d = new Date(s + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0, 10);
  }
  function validWeekRange(w) { return completeRange(w) && weekMonday(w.start) === weekMonday(w.end); }
  function periodOf(weeks) {
    var today = todayInShanghai(), from = weekMonday(today), monday = new Date(from + "T00:00:00Z");
    monday.setUTCDate(monday.getUTCDate() + 6);
    var to = monday.toISOString().slice(0, 10);
    var current = weeks.filter(function (w) { return completeRange(w) && weekId(w) && w.start >= from && w.end <= to && w.start <= today; })[0];
    var lead = current || weeks.filter(function (w) { return validDate(w.start) && w.start <= today; })[0] || weeks[0];
    var kind = !lead ? "empty" : current ? "current" : weekCounts[lead.start] > 1 ? "conflict" : validDate(lead.start) && lead.start > today ? "future" : !validWeekRange(lead) ? "unknown" : "recent";
    var notices = {
      current: "本周记录 · 按北京时间的自然周判断。",
      recent: "本周（" + from + " — " + to + "）尚未记录。以下为最近一次记录。",
      future: "这份周报尚未开始，不能作为本周的验收结果。",
      unknown: "记录日期不完整或跨越自然周，无法认定为本周记录。",
      conflict: "同一起始日期存在重复周报，请核对；不据此判断本周结果或绘制完成率。",
      empty: "尚无周报，本周结果未记录。"
    };
    return { lead: lead, kind: kind, today: today, notice: notices[kind] };
  }
  function showPeriod(period) {
    periodDay = period.today;
    var current = period.kind === "current", future = period.kind === "future", latest = period.lead;
    $("#hero-period-label").textContent = current ? "本周" : future ? "预录周报" : "最近记录";
    $("#report-title").textContent = current ? "本周测试报告" : future ? "预录周报" : latest ? "最近一次记录" : "验收记录";
    $("#report-link-label").textContent = current ? "查看本周验收" : future ? "查看预录周报" : latest ? "查看最近记录" : "查看验收记录";
    $("#report-nav-label").textContent = current ? "本周验收" : future ? "预录周报" : latest ? "最近记录" : "验收记录";
    $("#record-context").textContent = period.notice;
    $("#record-context").hidden = current;
    $("#report-context").textContent = period.notice;
    $("#bar-week").textContent = latest && validDate(latest.start) ? String(isoWeek(validDate(latest.start))) : "··";
    var hs = $("#hero-status"); hs.textContent = "";
    if (!latest) { hs.textContent = "还没有记录"; return; }
    if (period.kind === "conflict") { hs.textContent = "日期重复，请核对周报"; return; }
    var p = 0, f = 0, u = 0;
    STATUS.forEach(function (s) { var v = statusOf(latest, s[0]); if (v === "passed") p++; else if (v === "failed") f++; else u++; });
    hs.appendChild(span("ok", p + " passed")); hs.appendChild(document.createTextNode(" · "));
    hs.appendChild(span(f ? "bad" : "", f + " failed")); hs.appendChild(document.createTextNode(" · "));
    hs.appendChild(span(null, u + " 未评"));
    var r = rate(latest.blocks);
    if (r != null) { hs.appendChild(document.createTextNode(" · ")); hs.appendChild(span(null, "已记录计划块 " + frac(count(latest.blocks)) + " · " + r + "%")); }
  }
  function recordHead(node, w) {
    var id = weekId(w);
    if (id) node.id = id; else node.removeAttribute("id");
    node.tabIndex = -1; node.setAttribute("aria-label", "周报：" + weekRange(w));
    var head = el("header", "week-head");
    head.appendChild(el("h3", "week-date", weekRange(w)));
    if (weekCounts[w.start] > 1) head.appendChild(span("week-tag", "日期重复"));
    else {
      if (validDate(w.start) && w.start > periodDay) head.appendChild(span("week-tag", "预录"));
      if (!validWeekRange(w)) head.appendChild(span("week-tag", "日期待核对"));
    }
    if (id) { var link = el("a", "week-permalink", "周报链接 ↗"); link.href = "#" + id; link.setAttribute("aria-label", "周报链接：" + weekRange(w)); head.appendChild(link); }
    return head;
  }

  /* ---------- 渲染 ---------- */
  function render(data) {
    data = isObj(data) ? data : {};
    var profile = isObj(data.profile) ? data.profile : {};
    var crew = isObj(data.crew) ? data.crew : {};
    var weeks = arr(data.weeks).filter(isObj).slice().sort(function (a, b) {
      var da = validDate(a.start), db = validDate(b.start);
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return db - da;
    });
    var achievements = arr(data.achievements).filter(isObj);
    var issues = arr(data.issues).filter(isObj);
    var principles = arr(data.principles).map(str).filter(Boolean);

    var name = str(profile.name) || "Liu Ling";
    $("#name").textContent = name;
    $("#name").classList.toggle("name-long", Array.from(name).length > 24);
    document.title = name + " · 你好，世界";
    if (str(profile.tagline)) $("#tagline").textContent = profile.tagline;
    $("#updated").textContent = validDate(profile.updated) ? profile.updated : "未记录";

    weekCounts = {};
    weeks.forEach(function (w) { if (validDate(w.start)) weekCounts[w.start] = (weekCounts[w.start] || 0) + 1; });
    lastWeeks = weeks;
    var period = periodOf(weeks);
    showPeriod(period);

    // 台词和点评
    var who = { claude: crew.claude, chatgpt: crew.chatgpt, deepseek: crew.deepseek };
    var DEF = { claude: "Claude", chatgpt: "ChatGPT", deepseek: "DeepSeek" };
    var nameOf = function (k) { return (isObj(who[k]) && str(who[k].name)) || DEF[k]; };
    $$(".scroll").forEach(function (fig) {
      var k = fig.dataset.who, c = who[k];
      $(".bubble", fig).textContent = isObj(c) ? str(c.line) : "";
      $(".vname", fig).textContent = nameOf(k);
      fig.setAttribute("aria-label", nameOf(k) + "：" + (isObj(c) && str(c.line) ? "点按查看她的一句话" : "画像"));
    });
    $$(".sec[data-host]").forEach(function (sec) {
      var n = $(".host-name", sec);
      if (n && n.firstChild) n.firstChild.textContent = nameOf(sec.dataset.host) + " ";
    });
    var rv = function (w, k) { var c = who[w]; return isObj(c) && isObj(c.reviews) ? str(c.reviews[k]) : ""; };
    var reviewText = {
      weeks: rv("chatgpt", "weeks"),
      achievements: achievements.length ? rv("claude", "achievements") : rv("claude", "emptyAchievements"),
      trend: rv("deepseek", "trend"),
      issues: rv("deepseek", "issues"),
      footer: rv("deepseek", "footer")
    };
    $$("[data-review]").forEach(function (n) { n.textContent = reviewText[n.dataset.review] || ""; });

    renderReport(weeks, period.lead);
    renderLog(achievements);
    renderTrend(weeks);
    renderIssues(issues);
    renderPrinciples(principles);
    setMusic(data.music);
    return data;
  }

  function dots(c) {
    var w = el("span", "dots");
    if (!c || c.total == null) { w.appendChild(span("c-un", c && c.bad ? "数据有误" : c && c.done != null ? "" : "未记录")); return w; }
    for (var i = 0; i < Math.min(c.total, 14); i++) w.appendChild(span(c.done != null && i < c.done ? "f" : "e", c.done != null && i < c.done ? "●" : "○"));
    return w;
  }

  function renderReport(weeks, w) {
    var box = $("#report-body");
    box.textContent = "";
    var latestHead = $("#latest-week-head"), latestRecord = box.closest(".week-record");
    latestHead.textContent = ""; latestHead.hidden = !w;
    $("#past-body").textContent = "";
    if (!w) {
      latestRecord.removeAttribute("id"); latestRecord.removeAttribute("aria-label");
      line(box, [["c-cmd", "$ "], el("b", null, "pytest"), ["c-cmd", " this_week"]]);
      line(box, [["c-dim", "collected 0 items · 这周还没有记录"]]);
      $("#past-weeks").hidden = true;
      return;
    }
    latestHead.appendChild(recordHead(latestRecord, w));
    var cmd = span("c-cmd", "$ ");
    var b = el("b", null, "pytest");
    line(box, [cmd, b, ["c-cmd", " week --from "], ["c-date", mmdd(w.start)], ["c-cmd", " --to "], ["c-date", mmdd(w.end)]], "report-command");
    gap(box);
    var p = 0, f = 0, u = 0;
    STATUS.forEach(function (s) {
      var v = statusOf(w, s[0]);
      var mark = v === "passed" ? ["c-ok", "[✓] "] : v === "failed" ? ["c-bad", "[✗] "] : ["c-un", "[–] "];
      var word = v === "passed" ? ["c-ok", "PASSED"] : v === "failed" ? ["c-bad", "FAILED"] : ["c-un", v === "unrated" ? "未评" : "未记录"];
      if (v === "passed") p++; else if (v === "failed") f++; else u++;
      line(box, [mark, ["zh", s[1]], word], "test-result");
    });
    line(box, [["c-ok", p + " passed"], ["c-dim", ", "], [f ? "c-bad" : "c-dim", f + " failed"], ["c-dim", ", " + u + " unrated"]], "report-summary");
    gap(box);

    // 计划块：一格一块
    var c = count(w.blocks);
    var r = rate(w.blocks);
    line(box, [["c-dim", "# 计划块：一格是一块，填上的是做完的"]], "report-rate-label");
    var big = el("div", "big-rate");
    var num = el("span", "num");
    num.textContent = r == null ? "—" : String(r);
    if (r != null) num.appendChild(el("small", null, "%"));
    big.appendChild(num);
    big.appendChild(el("span", "of", c && c.bad ? "数据有误" : frac(c) ? frac(c).replace("/", " / ") + " 块" : "未记录"));
    var cells = el("div", "cells");
    cells.style.setProperty("--cell-cols", c && c.total ? Math.min(c.total, 25) : 25);
    if (c && c.total) for (var i = 0; i < Math.min(c.total, 60); i++) { var ci = el("i"); if (c.done != null && i < c.done) ci.className = "f"; cells.appendChild(ci); }
    var holder = el("div", "ln report-rate");
    var inner = el("span");
    inner.appendChild(big);
    if (c && c.total) inner.appendChild(cells);
    holder.appendChild(inner);
    box.appendChild(holder);
    gap(box);

    [["writing", "早写作"], ["strength", "力量"], ["run", "跑步"]].forEach(function (k) {
      var cc = count(w[k[0]]);
      line(box, [["zh", k[1] + " "], ["c-dim", "·".repeat(5 - k[1].length) + " "], dots(cc), ["c-dim", frac(cc) ? "  " + frac(cc) : ""]], "report-habit");
    });
    if (str(w.note)) {
      gap(box);
      line(box, [["c-dim", "# 备注"]], "report-note-label");
      line(box, [["serif", w.note]], "report-note");
    }

    // 往周
    var past = weeks.filter(function (pw) { return pw !== w; });
    var pd = $("#past-weeks");
    pd.hidden = !past.length;
    $("summary", pd).textContent = past.some(function (pw) { return !validDate(pw.start) || pw.start > periodDay; }) ? "其他周记录" : "往周记录";
    var pb = $("#past-body");
    pb.textContent = "";
    past.forEach(function (pw) {
      var entry = el("article", "week-record past-week");
      entry.appendChild(recordHead(entry, pw));
      var code = el("div", "code code-compact"); entry.appendChild(code); pb.appendChild(entry);
      var marks = STATUS.map(function (s) {
        var v = statusOf(pw, s[0]);
        return span("past-status " + (v === "passed" ? "c-ok" : v === "failed" ? "c-bad" : "c-un"), s[1] + " " + (v === "passed" ? "✓ 达标" : v === "failed" ? "✗ 没达标" : v === "unrated" ? "– 未评" : "– 未记录"));
      });
      var pr = rate(pw.blocks);
      var pc = count(pw.blocks);
      line(code, marks);
      line(code, [["c-dim", "计划块 "], pr == null ? ["c-un", pc && pc.bad ? "数据有误" : "未记录"] : [null, pr + "%"],
        ["c-dim", frac(pc) ? " (" + frac(pc) + ")" : ""]
      ]);
      line(code, [["c-dim", "写作 " + (frac(count(pw.writing)) || "未记录") + " · 力量 " + (frac(count(pw.strength)) || "未记录") + " · 跑步 " + (frac(count(pw.run)) || "未记录")]]);
      if (str(pw.note)) line(code, [["serif", pw.note]]);
    });
  }

  function entryKey(a) {
    var identity = JSON.stringify([str(a.date), str(a.type) || "未分类", str(a.title) || "未命名提交"]).normalize("NFC");
    var hash = 2166136261;
    for (var i = 0; i < identity.length; i++) { hash ^= identity.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return "entry-" + (validDate(a.date) ? a.date : "undated") + "-" + (hash >>> 0).toString(36);
  }
  function applyEntryFilter(type, fromButton) {
    var visible = [];
    archiveItems.forEach(function (item) {
      item.node.hidden = type !== null && item.type !== type;
      item.node.classList.remove("is-last-visible");
      if (!item.node.hidden) visible.push(item.node);
    });
    if (visible.length) visible[visible.length - 1].classList.add("is-last-visible");
    archiveButtons.forEach(function (button) { button.node.setAttribute("aria-pressed", String(button.type === type)); });
    $("#archive-status").textContent = type === null ? "显示全部 " + visible.length + " 条记录" : "显示“" + type + "” " + visible.length + " 条记录";
    if (fromButton) {
      $("#entry-link-status").hidden = true;
      var selected = entriesById[location.hash.slice(1)];
      if (location.hash.indexOf("#entry-") === 0 && (!selected || selected.hidden)) {
        history.replaceState(null, "", "#log");
        $$(".commit-entry.is-selected").forEach(function (n) { n.classList.remove("is-selected"); });
      }
    }
  }
  function renderLog(items) {
    var box = $("#log-body");
    box.textContent = "";
    archiveItems = []; archiveButtons = [];
    entryKeyCounts = Object.create(null); entriesById = Object.create(null);
    var filters = $("#archive-filters"); filters.textContent = "";
    $("#archive-tools").hidden = !items.length; $("#entry-link-status").hidden = true;
    $("#log-link-label").textContent = items.length ? "查看 " + items.length + " 条成果" : "提交记录";
    line(box, [["c-cmd", "$ "], el("b", null, "git log"), ["c-cmd", " --oneline"]]);
    gap(box);
    if (!items.length) {
      line(box, [["c-dim", "nothing to commit, working tree clean"]]);
      line(box, [["c-dim", "# 这段时间还没有新成果。有就有，没有就没有。"]]);
      return;
    }
    var categories = new Map();
    items.forEach(function (a) {
      var key = entryKey(a), type = (str(a.type) || "未分类").normalize("NFC");
      entryKeyCounts[key] = (entryKeyCounts[key] || 0) + 1;
      categories.set(type, (categories.get(type) || 0) + 1);
    });
    var dates = items.map(function (a) { return validDate(a.date) ? a.date : ""; }).filter(Boolean).sort();
    $("#archive-overview").textContent = items.length + " 条记录" + (dates.length ? " · " + dates[0] + (dates[0] === dates[dates.length - 1] ? "" : " — " + dates[dates.length - 1]) : " · 日期未记录");
    filters.hidden = categories.size < 2;
    function filterButton(type, label, total) {
      var button = el("button"); button.type = "button";
      button.appendChild(span(null, label)); button.appendChild(document.createTextNode(" "));
      button.appendChild(span("archive-filter-count", String(total)));
      button.addEventListener("click", function () { applyEntryFilter(type, true); });
      filters.appendChild(button); archiveButtons.push({ type: type, node: button });
    }
    filterButton(null, "全部", items.length);
    categories.forEach(function (total, type) { filterButton(type, type === "全部" ? "全部（分类）" : type, total); });
    items.forEach(function (a) {
      var key = entryKey(a), type = (str(a.type) || "未分类").normalize("NFC"), title = str(a.title) || "未命名提交";
      var entry = el("article", "commit-entry"); entry.tabIndex = -1;
      entry.setAttribute("aria-label", "成果记录：" + title);
      if (entryKeyCounts[key] === 1) { entry.id = key; entriesById[key] = entry; }
      archiveItems.push({ type: type, node: entry });
      box.appendChild(entry);
      var meta = el("div", "commit-meta"), date = el("time", "hash", validDate(a.date) ? a.date : "日期未记录");
      if (validDate(a.date)) date.dateTime = a.date;
      meta.appendChild(date); meta.appendChild(span("tag", type));
      if (entry.id) {
        var permalink = el("a", "entry-permalink", "此条链接 ↗"); permalink.href = "#" + entry.id;
        permalink.setAttribute("aria-label", "成果链接：" + title); meta.appendChild(permalink);
      } else meta.appendChild(span("entry-unlinked", "此条无法单独定位"));
      var url = safeUrl(a.url);
      var heading = el("h3", "title");
      if (url) {
        var resource = el("a", null, title); resource.href = url;
        if (/^https?:/i.test(url)) { resource.target = "_blank"; resource.rel = "noopener noreferrer"; }
        heading.appendChild(resource);
      } else heading.textContent = title;
      var row = el("div", "ln commit"), content = el("div", "commit-content");
      content.appendChild(meta); content.appendChild(heading); row.appendChild(content); entry.appendChild(row);
      if (str(a.description)) line(entry, [["zh c-dim", a.description]], "commit-note");
    });
    applyEntryFilter(null, false);
  }

  function chartControls(box, weeks) {
    var links = weeks.filter(function (w) { return weekId(w); });
    if (!links.length) return;
    var controls = el("div", "chart-controls"), label = el("label", null, "查看周报");
    var select = el("select"); select.setAttribute("aria-label", "选择一周查看原始周报");
    var first = el("option", null, "选择一周…"); first.value = ""; select.appendChild(first);
    links.forEach(function (w) {
      var r = rate(w.blocks), future = w.start > periodDay;
      var option = el("option", null, weekRange(w) + " · " + (future ? "预录" : !validWeekRange(w) ? "日期待核对" : r == null ? "未记录" : r + "%"));
      option.value = "#" + weekId(w); select.appendChild(option);
    });
    select.addEventListener("change", function () { var hash = select.value; select.value = ""; if (hash) goRecord(hash); });
    label.appendChild(select); controls.appendChild(label);
    controls.appendChild(el("p", "chart-hint", "点选图中数据点，或选择一周查看原始记录。"));
    box.appendChild(controls);
  }
  function renderTrend(weeks) {
    var box = $("#trend-body");
    box.textContent = "";
    // 所有有日期的周都占一个位置；没记完成率的周留空、线在那里断开
    var seen = {}, all = [];
    weeks.filter(function (w) { return validDate(w.start); }).slice().reverse().forEach(function (w) {
      if (seen[w.start]) return; seen[w.start] = true;
      var reason = weekCounts[w.start] > 1 ? "日期重复" : !validWeekRange(w) ? "日期待核对" : w.start > periodDay ? "预录" : "";
      all.push({ d: w.start, r: reason ? null : rate(w.blocks), reason: reason, w: w });
    });
    var valid = all.filter(function (p) { return p.r != null; });
    if (valid.length < 2) {
      box.appendChild(el("p", "chart-empty", valid.length ? "只有一周的数据：" + valid[0].r + "%。再攒一周才画得出线。" : "还没有可以画的周。再攒两周才画得出线。"));
      chartControls(box, weeks);
      return;
    }
    var NS = "http://www.w3.org/2000/svg";
    // 按容器实际宽度画，手机上字不会缩到看不清
    var missing = all.some(function (p, i) { return p.r == null || i && dayNumber(p.d) - dayNumber(all[i - 1].d) > 7; });
    var W = Math.max(300, Math.round(box.clientWidth || 640)), H = Math.round(Math.min(280, Math.max(200, W * .42))), L = 40, R = 24, T = 26, B = missing ? 54 : 34;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", "各周计划块完成率，选择数据点查看周报：" + all.map(function (p) { return p.d + " " + (p.reason || (p.r == null ? "未记录" : p.r + "%")); }).join("，"));
    function n(tag, attrs, text, parent) {
      var e = document.createElementNS(NS, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      if (text != null) e.textContent = text;
      (parent || svg).appendChild(e);
      return e;
    }
    var defs = document.createElementNS(NS, "defs");
    defs.innerHTML = '<linearGradient id="seaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient>';
    svg.appendChild(defs);
    svg.style.color = "var(--ds)";
    var x = function (i) { return L + (all.length === 1 ? 0 : (i * (W - L - R)) / (all.length - 1)); };
    var y = function (r) { return T + ((100 - Math.max(0, Math.min(100, r))) * (H - T - B)) / 100; };
    [0, 50, 100].forEach(function (v) {
      n("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "axis", "stroke-dasharray": v === 0 ? "" : "2 5" });
      n("text", { x: L - 10, y: y(v) + 4, "text-anchor": "end", class: "lbl" }, v + "%");
    });
    // 连续的有效点连成一段
    var segs = [], cur = [];
    all.forEach(function (p, i) {
      if (p.r == null || i && dayNumber(p.d) - dayNumber(all[i - 1].d) > 7) { if (cur.length) segs.push(cur); cur = []; }
      if (p.r != null) cur.push(i);
    });
    if (cur.length) segs.push(cur);
    // 虚线只提示断档的两端关系，不把缺测伪装成连续实测
    segs.forEach(function (sg, i) {
      if (!i) return;
      var from = segs[i - 1][segs[i - 1].length - 1], to = sg[0];
      n("path", { d: "M" + x(from) + " " + y(all[from].r) + " L" + x(to) + " " + y(all[to].r), class: "gap-line" });
    });
    var gaps = [];
    for (var gi = 0; gi < all.length; gi++) {
      if (all[gi].r != null) continue;
      var start = gi;
      while (gi + 1 < all.length && all[gi + 1].r == null) gi++;
      var reason = all.slice(start, gi + 1).map(function (p) { return p.reason; }).filter(Boolean);
      gaps.push({ x: (x(start) + x(gi)) / 2, label: reason.length ? reason[0] : "未记录" });
    }
    all.forEach(function (p, i) {
      if (i && dayNumber(p.d) - dayNumber(all[i - 1].d) > 7) gaps.push({ x: (x(i - 1) + x(i)) / 2, label: "缺少周报" });
    });
    gaps.sort(function (a, b) { return a.x - b.x; });
    // 密集断档合用一个说明，各缺口仍有标记和虚线；完整日期留在可访问描述里
    for (var gj = 0; gj < gaps.length; gj++) {
      var first = gj;
      while (gj + 1 < gaps.length && gaps[gj + 1].x - gaps[gj].x < 72) gj++;
      for (var gm = first; gm <= gj; gm++) n("line", { x1: gaps[gm].x, x2: gaps[gm].x, y1: H - 24, y2: H - 20, class: "gap-mark" });
      n("text", { x: (gaps[first].x + gaps[gj].x) / 2, y: H - 6, "text-anchor": "middle", class: "gap-label" }, gj > first ? "多处未绘制" : gaps[first].label);
    }
    segs.forEach(function (sg) {
      var d = sg.map(function (i, k) { return (k ? "L" : "M") + x(i).toFixed(1) + " " + y(all[i].r).toFixed(1); }).join(" ");
      if (sg.length > 1) {
        n("path", { d: d + " L" + x(sg[sg.length - 1]).toFixed(1) + " " + y(0) + " L" + x(sg[0]).toFixed(1) + " " + y(0) + " Z", class: "area" });
        n("path", { d: d, class: "line" });
      }
    });
    // 标签太挤就隔几个标一个，数据点一个不少
    var room = Math.max(2, Math.floor((W - L - R) / 52));
    var step = Math.ceil(all.length / room);
    var lastValid = all.map(function (p) { return p.r != null; }).lastIndexOf(true);
    all.forEach(function (p, i) {
      // 最后一周必标；前一个标签要给它留下实际文字的宽度
      var tick = i === all.length - 1 || (i % step === 0 && x(all.length - 1) - x(i) >= 52);
      if (tick) n("text", { x: x(i), y: H - (missing ? 30 : 10), "text-anchor": "middle", class: "lbl" }, mmdd(p.d));
      if (p.r == null) return;
      var last = i === lastValid;
      var link = n("a", { href: "#" + weekId(p.w), class: "chart-week", tabindex: "0", "aria-label": weekRange(p.w) + "，完成率 " + p.r + "%，查看周报" });
      n("circle", { cx: x(i), cy: y(p.r), r: Math.min(22, (W - L - R) / Math.max(1, all.length - 1) / 2.2), class: "hit" }, null, link);
      n("circle", { cx: x(i), cy: y(p.r), r: 11, class: "focus-ring" }, null, link);
      n("circle", { cx: x(i), cy: y(p.r), r: last ? 5.5 : 4, class: "pt" + (last ? " last" : "") }, null, link);
      if (last || (tick && Math.abs(x(i) - x(lastValid)) >= 40)) n("text", { x: x(i), y: y(p.r) - 12, "text-anchor": "middle", class: "val" }, p.r + "%");
    });
    box.appendChild(svg);
    chartControls(box, weeks);
  }

  function renderIssues(items) {
    var box = $("#issues-body");
    box.textContent = "";
    line(box, [["c-cmd", "$ "], el("b", null, "issue list"), ["c-cmd", " --all"]]);
    gap(box);
    if (!items.length) { line(box, [["c-dim", "还没有登记问题。"]]); return; }
    items.forEach(function (it, i) {
      var st = it.status === "closed" ? ["st st-closed", "closed"] : it.status === "改善中" ? ["st st-doing", "改善中"] : it.status === "open" ? ["st st-open", "open"] : ["st c-un", "未记录"];
      var id = Number.isInteger(it.id) && it.id >= 0 ? it.id : i + 1;
      line(box, [["c-c", "#" + id + "  "], st, ["zh", " " + (str(it.problem) || "问题未填写")]], "issue");
      line(box, [["c-dim", "      → "], ["zh c-dim", str(it.rule) || "对应制度尚未填写"]]);
      if (i < items.length - 1) gap(box);
    });
  }

  function renderPrinciples(items) {
    var ol = $("#principles-body");
    ol.textContent = "";
    var sec = ol.closest(".principles");
    if (!items.length) { ol.appendChild(el("li", "principle-empty", "尚未写下。")); return; }
    items.forEach(function (t) {
      var li = el("li");
      var k = t.indexOf("：");
      if (k > 0 && k < 14) { li.appendChild(el("strong", null, t.slice(0, k + 1))); li.appendChild(document.createTextNode(t.slice(k + 1))); }
      else li.textContent = t;
      ol.appendChild(li);
    });
  }

  /* 章节与记录链接均在数据读完后定位；单条记录先恢复可见，再转移焦点。 */
  function focusRecord(target, selected) {
    var parent = target.parentElement;
    while (parent) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
    if (selected !== false) target.classList.add("is-selected");
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }
  function openRecord() {
    if (!lastData) return;
    var hash = location.hash, match = /^#week-(\d{4}-\d{2}-\d{2})$/.exec(hash), message = $("#week-link-status");
    message.hidden = true; message.textContent = "";
    var entryMessage = $("#entry-link-status"); entryMessage.hidden = true; entryMessage.textContent = "";
    $$(".week-record.is-selected, .commit-entry.is-selected").forEach(function (n) { n.classList.remove("is-selected"); });
    if (hash.indexOf("#entry-") === 0) {
      var entry = entriesById[hash.slice(1)];
      if (entry) {
        if (entry.hidden) applyEntryFilter(null, false);
        focusRecord(entry);
      } else {
        applyEntryFilter(null, false);
        entryMessage.textContent = entryKeyCounts[hash.slice(1)] > 1 ? "这条链接对应多条记录，请在列表中查看。" : "没有找到这条成果记录，内容可能已更名或尚未公开。";
        entryMessage.hidden = false; entryMessage.tabIndex = -1; focusRecord(entryMessage, false);
      }
      return;
    }
    if (!match) {
      var section = document.getElementById(hash.slice(1));
      if (section && section.matches(".sec, .principles")) {
        section.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
      }
      return;
    }
    var target = document.getElementById(hash.slice(1));
    if (!target) {
      message.textContent = weekCounts[match[1]] > 1 ? "该日期有重复周报，无法定位唯一记录。请查看周报档案并核对数据。" : "没有找到 " + match[1] + " 的周报，该记录可能尚未公开。";
      message.hidden = false;
      if (weekCounts[match[1]] > 1) $("#past-weeks").open = true;
      return;
    }
    focusRecord(target);
  }
  function queueRecord() {
    if (recordJumpFrame) cancelAnimationFrame(recordJumpFrame);
    recordJumpFrame = requestAnimationFrame(function () { recordJumpFrame = 0; openRecord(); });
  }
  function goRecord(hash) {
    if (location.hash !== hash) history.pushState(null, "", hash);
    queueRecord();
  }
  document.addEventListener("click", function (e) {
    var link = e.target.closest && e.target.closest("a[href^='#week-'], a[href^='#entry-']");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); goRecord(link.getAttribute("href"));
  });
  window.addEventListener("hashchange", queueRecord);
  window.addEventListener("popstate", queueRecord);
  function refreshPeriod() {
    if (!lastData || todayInShanghai() === periodDay) return;
    var wasOpen = $("#past-weeks").open, period = periodOf(lastWeeks);
    showPeriod(period); renderReport(lastWeeks, period.lead); renderTrend(lastWeeks);
    $("#past-weeks").open = wasOpen;
    if (location.hash.indexOf("#week-") === 0) queueRecord();
  }
  window.addEventListener("focus", refreshPeriod);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshPeriod(); });
  setInterval(refreshPeriod, 60000);

  // data.json 没读到：别装成“还没有记录”，直接说出来
  function loadFailed(msg) {
    ["#report-body", "#log-body"].forEach(function (id) {
      var box = $(id);
      if (!box) return;
      box.textContent = "";
      line(box, [["c-bad", "! data.json 没读到（" + msg + "）"]]);
      line(box, [["c-dim", "# 本地预览要用 python3 -m http.server 打开，不能直接双击 index.html"]]);
    });
    $("#hero-status").textContent = "数据没读到";
    $("#record-context").textContent = $("#report-context").textContent = "周报数据读取失败，请稍后刷新。";
    $("#record-context").hidden = false;
  }

  /* ---------- 画前的飘落物 ---------- */
  var DRIFT = {
    claude: { n: 7, cols: ["#d9822f", "#e89a55", "#c96a22"], kind: "petal" },
    chatgpt: { n: 5, cols: ["#4d6a57", "#7f9467", "#a3a77a"], kind: "leaf" },
    deepseek: { n: 6, cols: ["#5b7db6", "#7f9bcf", "#3f5f97"], kind: "speck" }
  };
  function drift() {
    if (reduced) return;
    $$(".scroll").forEach(function (fig) {
      var cfg = DRIFT[fig.dataset.who];
      var box = $(".drift", fig);
      if (!cfg || !box) return;
      for (var i = 0; i < cfg.n; i++) {
        var p = el("i");
        var s = cfg.kind === "speck" ? 4 + Math.random() * 5 : 7 + Math.random() * 7;
        p.style.setProperty("--x", (8 + Math.random() * 84).toFixed(1) + "%");
        p.style.setProperty("--s", s.toFixed(1) + "px");
        p.style.setProperty("--col", cfg.cols[i % cfg.cols.length]);
        p.style.setProperty("--d", (11 + Math.random() * 9).toFixed(1) + "s");
        p.style.setProperty("--delay", (-Math.random() * 20).toFixed(1) + "s");
        p.style.setProperty("--sway", ((Math.random() - .5) * 60).toFixed(0) + "px");
        p.style.setProperty("--r", ((Math.random() - .5) * 540).toFixed(0) + "deg");
        p.style.setProperty("--o", (cfg.kind === "speck" ? .55 : .7).toFixed(2));
        if (cfg.kind === "leaf") p.style.borderRadius = "0 90% 0 90%";
        if (cfg.kind === "speck") p.style.borderRadius = "40% 60% 50% 50%";
        box.appendChild(p);
      }
      if (fig.dataset.who === "deepseek") {
        for (var j = 0; j < 2; j++) {
          var b = el("i", "bubbleo");
          b.style.setProperty("--x", (55 + Math.random() * 30).toFixed(1) + "%");
          b.style.setProperty("--s", (6 + Math.random() * 5).toFixed(1) + "px");
          b.style.setProperty("--col", "rgba(91,125,182,.6)");
          b.style.setProperty("--d", (9 + Math.random() * 6).toFixed(1) + "s");
          b.style.setProperty("--delay", (-Math.random() * 12).toFixed(1) + "s");
          b.style.setProperty("--sway", ((Math.random() - .5) * 30).toFixed(0) + "px");
          b.style.setProperty("--o", ".7");
          box.appendChild(b);
        }
      }
    });
  }

  /* ---------- 画像的点按（手机上没有悬停） ---------- */
  function scrolls() {
    var figs = $$(".scroll");
    function close(fig, shut) {
      fig.classList.remove("on");
      fig.setAttribute("aria-expanded", "false");
      if (shut) fig.classList.add("shut");   // Escape 后即使鼠标还停在上面也收起
    }
    figs.forEach(function (fig, i) {
      var bub = $(".bubble", fig);
      bub.id = "bubble-" + i;
      fig.setAttribute("role", "button");
      fig.setAttribute("aria-expanded", "false");
      fig.setAttribute("aria-describedby", bub.id);
      fig.addEventListener("click", function () {
        var on = fig.classList.contains("on");
        figs.forEach(function (x) { close(x); });
        fig.classList.remove("shut");
        if (!on) { fig.classList.add("on"); fig.setAttribute("aria-expanded", "true"); }
        else fig.classList.add("shut");
      });
      fig.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fig.click(); }
        else if (e.key === "Escape") { close(fig, true); }
      });
      fig.addEventListener("mouseleave", function () { fig.classList.remove("shut"); });
      fig.addEventListener("blur", function () { fig.classList.remove("shut"); });
    });
    document.addEventListener("click", function (e) { if (!e.target.closest(".scroll")) figs.forEach(function (x) { close(x); }); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") figs.forEach(function (x) { if (x.classList.contains("on")) close(x, true); }); });
  }

  /* ---------- 主题 ---------- */
  function theme() {
    var btn = $("#theme"), label = $("#theme-label");
    var media = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    var names = { light: "白天", dark: "夜里" };
    var system = function () { return media && media.matches ? "dark" : "light"; };
    var opposite = function () { return system() === "dark" ? "light" : "dark"; };
    var q = /[?&]theme=(light|dark|system|opposite)\b/.exec(location.search);
    var cur = q ? q[1] : store("showcase-theme");
    // 兼容旧的固定明暗偏好，归一为当前视觉等效的两态；URL仅影响本次页面
    if (cur === "light" || cur === "dark") {
      cur = cur === system() ? "system" : "opposite";
      if (!q) store("showcase-theme", cur);
    }
    if (cur !== "opposite") cur = "system";
    function apply() {
      var actual = cur === "system" ? system() : opposite();
      if (cur === "system") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", actual);
      label.textContent = cur === "system" ? "跟随系统" : names[actual];
      btn.dataset.mode = cur;
      var hint = "当前" + names[actual] + (cur === "system" ? "（跟随系统），点击切换为" + names[opposite()] + "（与系统相反）" : "（与系统相反），点击恢复跟随系统");
      btn.setAttribute("aria-label", hint); btn.title = hint;
    }
    apply();
    btn.addEventListener("click", function () {
      cur = cur === "system" ? "opposite" : "system";
      store("showcase-theme", cur);
      apply();
    });
    if (media && media.addEventListener) media.addEventListener("change", apply);
    else if (media && media.addListener) media.addListener(apply);
  }

  /* ---------- 播放器 ---------- */
  function player() {
    var view = $("#player"), a = $("#audio"), btn = $("#play"), icon = $(".play-icon", btn);
    var toggle = $("#music-toggle"), panel = $("#music-panel"), title = $("#music-title"), note = $("#music-note"), status = $("#music-status");
    var seek = $("#seek"), now = $("#player-now"), dur = $("#player-dur"), mini = $("#mini-progress");
    var dragging = false, sourcePromise = null, wantedPlaying = false, playVersion = 0, musicSrc = "", musicTitle = "音乐";
    var fmt = function (t) { t = Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0; return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
    function opened(on) {
      panel.hidden = !on;
      toggle.setAttribute("aria-expanded", String(on));
      toggle.setAttribute("aria-label", (on ? "收起" : "展开") + "音乐信息：" + musicTitle);
    }
    function playing(on) {
      wantedPlaying = on; btn.classList.toggle("on", on);
      icon.textContent = on ? "Ⅱ" : "♪";
      btn.setAttribute("aria-label", (on ? "暂停 " : "播放 ") + musicTitle);
    }
    function failed() {
      playing(false); status.textContent = "音乐暂时无法播放，请重试。"; opened(true);
    }
    function play() {
      if (!wantedPlaying) return;
      var version = playVersion, pr = a.play();
      if (pr && pr.catch) pr.catch(function (e) { if (wantedPlaying && version === playVersion && e.name !== "AbortError") failed(); });
    }
    function source() {
      // 用户播放时才读取；Blob 兼容没有 HTTP Range 的静态预览服务
      if (!sourcePromise) sourcePromise = fetch(musicSrc)
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); })
        .then(function (blob) { a.src = URL.createObjectURL(blob); })
        .catch(function (e) { sourcePromise = null; throw e; });
      return sourcePromise;
    }
    function paint() {
      var percent = seek.max > 0 ? Math.max(0, Math.min(100, seek.value / seek.max * 100)) : 0;
      seek.style.setProperty("--p", percent.toFixed(2) + "%"); mini.style.width = percent.toFixed(2) + "%";
      seek.setAttribute("aria-valuetext", fmt(+seek.value) + " / " + (Number.isFinite(a.duration) ? fmt(a.duration) : "时长未加载"));
    }
    btn.addEventListener("click", function () {
      var version = ++playVersion;
      status.textContent = ""; playing(!wantedPlaying);
      if (!wantedPlaying) { a.pause(); return; }
      if (a.getAttribute("src")) play();
      else source().then(function () { if (version === playVersion) play(); }).catch(function () { if (wantedPlaying && version === playVersion) failed(); });
    });
    toggle.addEventListener("click", function () { opened(panel.hidden); });
    document.addEventListener("click", function (e) { if (!e.target.closest("#player")) opened(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { opened(false); toggle.focus(); } });
    a.addEventListener("play", function () { playing(true); });
    a.addEventListener("pause", function () { playing(false); });
    a.addEventListener("ended", function () { playing(false); });
    a.addEventListener("error", function () {
      // 解码失败也释放坏的 Blob，下一次点击能重新获取修复后的音频
      var src = a.getAttribute("src");
      if (src && src.indexOf("blob:") === 0) URL.revokeObjectURL(src);
      a.removeAttribute("src"); sourcePromise = null; seek.disabled = true;
      if (wantedPlaying) failed();
    });
    a.addEventListener("loadedmetadata", function () {
      var valid = Number.isFinite(a.duration) && a.duration > 0;
      seek.max = valid ? a.duration.toFixed(1) : 0; seek.disabled = !valid;
      dur.textContent = valid ? fmt(a.duration) : "—"; paint();
    });
    a.addEventListener("timeupdate", function () {
      if (!dragging) { now.textContent = fmt(a.currentTime); seek.value = a.currentTime; paint(); }
    });
    seek.addEventListener("input", function () { dragging = true; now.textContent = fmt(+seek.value); paint(); });
    seek.addEventListener("change", function () {
      dragging = false;
      if (a.readyState >= 1) { a.currentTime = Math.min(+seek.value, a.duration); now.textContent = fmt(a.currentTime); }
    });
    paint();
    var whale = $("#tiny-whale");
    whale.addEventListener("click", function () { whale.classList.remove("go"); void whale.offsetWidth; whale.classList.add("go"); setTimeout(function () { whale.classList.remove("go"); }, 1000); });
    return function (music) {
      var src = isObj(music) ? str(music.src) : "", valid = false;
      try {
        var url = new URL(src, location.href), path = decodeURIComponent(src.split(/[?#]/)[0]);
        var safe = src && !/[\s\\]/.test(src) && path.indexOf("\\") < 0;
        if (/^https?:\/\/[^/?#]+/i.test(src)) valid = safe && !!url.hostname && (url.protocol === "http:" || url.protocol === "https:");
        else valid = safe && !!path && !/^[a-z][a-z0-9+.-]*:/i.test(src) && path.charAt(0) !== "/" && path.split("/").indexOf("..") < 0;
      } catch (e) { valid = false; }
      view.closest(".bar").classList.toggle("has-music", !!valid);
      if (!valid) { playing(false); a.pause(); view.hidden = true; opened(false); return; }
      musicSrc = src; musicTitle = str(music.title) || "音乐";
      title.textContent = musicTitle; note.textContent = str(music.note); note.hidden = !note.textContent;
      view.hidden = false; playing(false); opened(false);
    };
  }

  /* ---------- 开场：hello, world → 字海 → 三个光点 → 你好。→ 水洗开 ----------
     不等 data.json：开场立刻开始，字海在数据到了以后才补上；任何情况下 6 秒内一定收尾 */
  var introData = null;
  function seaLines(data) {
    if (!isObj(data)) return [];
    var lines = arr(data.sea).map(str).filter(Boolean);
    if (!lines.length) {
      if (isObj(data.profile) && str(data.profile.tagline)) lines.push(data.profile.tagline);
      arr(data.achievements).forEach(function (a) { if (isObj(a) && str(a.title)) lines.push(a.title); });
      arr(data.weeks).forEach(function (w) { if (isObj(w) && str(w.note)) lines.push(w.note); });
    }
    return lines.map(function (t) { return t.replace(/【示例】/g, ""); }).filter(Boolean);
  }
  function intro() {
    var box = $("#intro");
    if (!box) return;
    if (reduced || /[?&]intro=0\b/.test(location.search) || /^#week-\d{4}-\d{2}-\d{2}$/.test(location.hash) || /^#entry-/.test(location.hash)) { box.classList.add("gone"); return; }
    var seen = store("showcase-visited") === "1";
    var cv = $("#intro-canvas"), ctx = cv.getContext && cv.getContext("2d");
    if (!ctx) { box.classList.add("gone"); return; }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W, H, centers;
    function geometry() {
      W = window.innerWidth; H = window.innerHeight;
      if (cv.width !== W * dpr || cv.height !== H * dpr) {
        cv.width = W * dpr; cv.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#07090b";
        ctx.fillRect(0, 0, W, H);
      }
      // 数据和字体会改变手机首屏高度；每个阶段开始前都从实际画像重取坐标
      var faces = { claude: .64, deepseek: .76, chatgpt: .38 };
      centers = $$(".scroll").map(function (fig) {
        var r = $(".scroll-paper", fig).getBoundingClientRect();
        var c = { claude: "#e08a3c", chatgpt: "#6f9a84", deepseek: "#6f93d0" }[fig.dataset.who];
        return { x: r.left + r.width * faces[fig.dataset.who], y: Math.min(H * .9, r.top + r.height * .32), c: c };
      });
    }
    geometry();
    box.classList.add("ready");
    document.documentElement.style.overflow = "hidden";

    var done = false, timers = [];
    var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
    var EVS = ["keydown", "pointerdown", "wheel", "touchstart"];
    function finish() {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      box.classList.add("gone");
      document.documentElement.style.overflow = "";
      store("showcase-visited", "1");
      EVS.forEach(function (ev) { window.removeEventListener(ev, finish, true); });
      window.removeEventListener("resize", finish);
    }
    EVS.forEach(function (ev) { window.addEventListener(ev, finish, { capture: true, passive: true }); });
    window.addEventListener("resize", finish);   // 旋转屏幕后直接进入完整页面，不拉伸旧画布
    later(finish, seen ? 1500 : 6000);   // 保险：卡在哪一步都能进页面

    function wash(ms, cb) {
      geometry();
      var t0 = performance.now(), maxR = Math.hypot(W, H) * .75;
      var seeds = centers.map(function () { return Array.from({ length: 14 }, function () { return { a: Math.random() * Math.PI * 2, d: Math.random(), k: .55 + Math.random() * .6 }; }); });
      function step(now) {
        if (done) return;
        var t = Math.min(1, (now - t0) / ms);
        var e = 1 - Math.pow(1 - t, 3);
        ctx.globalCompositeOperation = "destination-out";
        centers.forEach(function (c, i) {
          seeds[i].forEach(function (sd) {
            var r = Math.max(1, maxR * e * sd.k);
            var ox = Math.cos(sd.a) * r * .35 * sd.d, oy = Math.sin(sd.a) * r * .35 * sd.d;
            var g = ctx.createRadialGradient(c.x + ox, c.y + oy, 0, c.x + ox, c.y + oy, r);
            g.addColorStop(0, "rgba(0,0,0,.20)");
            g.addColorStop(.7, "rgba(0,0,0,.08)");
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(c.x + ox, c.y + oy, r, 0, Math.PI * 2); ctx.fill();
          });
        });
        if (t < 1) requestAnimationFrame(step);
        else { ctx.clearRect(0, 0, W, H); cb && cb(); }
      }
      requestAnimationFrame(step);
    }
    function lights(ms) {
      geometry();
      var t0 = performance.now();
      function step(now) {
        if (done) return;
        var t = Math.min(1, (now - t0) / ms);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#07090b";
        ctx.fillRect(0, 0, W, H);
        centers.forEach(function (c, i) {
          var tt = Math.max(0, Math.min(1, t * 1.6 - i * .25));
          var r = 4 + tt * 26;
          var g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 3);
          g.addColorStop(0, c.c);
          g.addColorStop(.25, c.c + "aa");
          g.addColorStop(1, c.c + "00");
          ctx.globalAlpha = tt;
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(c.x, c.y, r * 3, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        });
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    function sea() {
      var lines = seaLines(introData);
      if (!lines.length) return;   // 没有可用的文字就不生成字海
      var holder = $("#intro-sea");
      for (var i = 0; i < 20; i++) {
        var sp = span(null, lines[i % lines.length]);
        sp.style.left = (Math.random() * 100 - 15).toFixed(1) + "%";
        var top = Math.random() * 84 + 4;   // 避开中间那一行字
        if (top > 36 && top < 58) top += top < 47 ? -14 : 14;
        sp.style.top = top.toFixed(1) + "%";
        sp.style.animationDelay = (-Math.random() * 6).toFixed(1) + "s";
        sp.style.fontSize = (10 + Math.random() * 4).toFixed(0) + "px";
        holder.appendChild(sp);
      }
      holder.style.opacity = "1";
    }

    var typed = $("#intro-typed"), enter = $("#intro-enter"), lineEl = $(".intro-line"), hello = $("#intro-hello");
    if (seen) {
      lineEl.style.opacity = "0";
      wash(600, finish);
      return;
    }
    var text = "hello, world";
    for (var i = 0; i < text.length; i++) (function (k) { later(function () { typed.textContent = text.slice(0, k + 1); }, 300 + k * 62); })(i);
    later(function () { enter.classList.add("show"); }, 300 + text.length * 62 + 120);
    later(sea, 1100);
    later(function () { lights(500); }, 1450);
    later(function () { hello.classList.add("show"); }, 1800);
    later(function () {
      lineEl.style.opacity = "0";
      hello.classList.remove("show");
      $("#intro-sea").style.opacity = "0";
      wash(900, finish);
    }, 2250);
  }

  var lastData = null, lastW = 0;
  window.addEventListener("resize", function () {
    var w = ($("#trend-body") || {}).clientWidth || 0;
    if (lastData && Math.abs(w - lastW) > 40) { lastW = w; renderTrend(lastWeeks); }
  });

  /* ---------- 启动 ---------- */
  theme();
  scrolls();
  drift();
  var setMusic = player();
  intro();
  fetch("data.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (data) {
      introData = data;
      data = render(data);
      lastData = data; lastW = ($("#trend-body") || {}).clientWidth || 0;
      queueRecord();
      // 本地字体加载也会改变换行和章节高度，字体稳定后按当前片段校正。
      if (document.fonts) document.fonts.ready.then(queueRecord);
    })
    .catch(function (e) {
      render({});
      loadFailed(String(e && e.message || e));
    });
})();
