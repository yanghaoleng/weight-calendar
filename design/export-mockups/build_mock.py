#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成三种设计风格的导出预览稿（Minimal / Brutalist / Bento）。
读 data.json，输出同目录下 minimal.html / brutalist.html / bento.html。"""
import json, html
from datetime import date, timedelta
from collections import OrderedDict

DATA = json.load(open("data.json", encoding="utf-8"))

# ---------- 数据准备 ----------
recs = sorted(DATA["records"], key=lambda r: r["date"])
weight_by_date = {r["date"]: r["weight"] for r in recs}
# 每条记录相对前一条的 delta
prev = None
delta_by_date = {}
for r in recs:
    if prev is None:
        delta_by_date[r["date"]] = None  # 起点
    else:
        delta_by_date[r["date"]] = round(r["weight"] - prev, 1)
    prev = r["weight"]

start_d = date.fromisoformat(recs[0]["date"])
end_d = date.fromisoformat(recs[-1]["date"])
months = OrderedDict()
d = start_d
while d <= end_d:
    key = (d.year, d.month)
    months.setdefault(key, [])
    # 月内所有天
    if d.month == 12:
        nxt = date(d.year + 1, 1, 1)
    else:
        nxt = date(d.year, d.month + 1, 1)
    days_in = (nxt - d).days
    months[key] = [date(d.year, d.month, i + 1) for i in range(days_in)]
    d = nxt

NAMES = ["一", "二", "三", "四", "五", "六", "日"]
NAME_TITLE = {1: "一月", 2: "二月", 3: "三月", 4: "四月", 5: "五月", 6: "六月",
              7: "七月", 8: "八月", 9: "九月", 10: "十月", 11: "十一月", 12: "十二月"}

def esc(s):
    return html.escape(str(s))

def month_cells(days):
    """返回 7 列的周数组，空位 None。周一为列 0。"""
    first = days[0]
    lead = first.weekday()  # 周一=0
    grid = [None] * lead + days
    while len(grid) % 7 != 0:
        grid.append(None)
    rows = [grid[i:i + 7] for i in range(0, len(grid), 7)]
    return rows

cur = recs[-1]["weight"]
total_delta = round(cur - DATA["startWeight"], 1)

CSS_COMMON_HEAD = """<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">"""

# =====================================================================
# A. MINIMAL 极简
# =====================================================================
def build_minimal():
    accent = "#D9577A"
    months_html = []
    for (y, m), days in months.items():
        rows = month_cells(days)
        head = "".join(f"<th>{n}</th>" for n in NAMES)
        body_rows = []
        for row in rows:
            cells = []
            for day in row:
                if day is None:
                    cells.append('<td class="empty"></td>')
                    continue
                key = day.isoformat()
                if key in weight_by_date:
                    w = weight_by_date[key]
                    dv = delta_by_date[key]
                    if dv is None:
                        cls = "start"
                        dtxt = "起点"
                    else:
                        cls = "up" if dv > 0 else ("down" if dv < 0 else "flat")
                        dtxt = ("+" if dv > 0 else "") + f"{dv:g}"
                    cells.append(
                        f'<td class="rec"><span class="d">{day.day}</span>'
                        f'<span class="w">{w:g}</span>'
                        f'<span class="delta {cls}">{dtxt}</span></td>'
                    )
                else:
                    cells.append(f'<td class="nodata"><span class="d">{day.day}</span></td>')
            body_rows.append("<tr>" + "".join(cells) + "</tr>")
        months_html.append(f"""
        <section class="month">
          <h2>{y}年{m}月</h2>
          <table><thead><tr>{head}</tr></thead>
          <tbody>{''.join(body_rows)}</tbody></table>
        </section>""")
    return f"""<!doctype html><html><head>{CSS_COMMON_HEAD}<title>体重日历 - 极简</title>
<style>
  :root {{ --bg:#FAFAF9; --ink:#1C1917; --muted:#A8A29E; --line:#E7E5E4; --accent:{accent}; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ background:var(--bg); color:var(--ink); font-family:-apple-system,"Helvetica Neue","PingFang SC",sans-serif;
         font-feature-settings:"tnum"; line-height:1.5; padding:64px 24px 96px; }}
  .wrap {{ max-width:760px; margin:0 auto; }}
  .head {{ margin-bottom:56px; }}
  .head .eyebrow {{ font-size:12px; letter-spacing:.2em; color:var(--muted); text-transform:uppercase; margin-bottom:20px; }}
  h1 {{ font-size:40px; font-weight:600; letter-spacing:-.02em; line-height:1.1; }}
  h1 .name {{ color:var(--accent); font-weight:600; }}
  .meta {{ margin-top:16px; font-size:14px; color:var(--muted); }}
  .stats {{ display:flex; gap:40px; margin:40px 0 8px; padding:24px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }}
  .stat .num {{ font-size:32px; font-weight:600; letter-spacing:-.02em; }}
  .stat .lbl {{ font-size:12px; color:var(--muted); margin-top:4px; }}
  .stat .num.down {{ color:#1B8C59; }}
  section.month {{ margin-top:48px; }}
  h2 {{ font-size:16px; font-weight:600; margin-bottom:16px; color:var(--ink); }}
  table {{ width:100%; border-collapse:collapse; table-layout:fixed; }}
  th {{ font-size:11px; font-weight:500; color:var(--muted); text-align:left; padding:0 8px 8px; }}
  td {{ border-top:1px solid var(--line); padding:10px 8px; vertical-align:top; height:76px; }}
  td.empty, td.nodata {{ color:#D6D3D1; }}
  td.rec {{ background:transparent; }}
  .d {{ display:block; font-size:11px; color:var(--muted); }}
  td.rec .d {{ color:var(--ink); font-weight:500; }}
  .w {{ display:block; font-size:15px; font-weight:600; margin-top:6px; letter-spacing:-.01em; }}
  .delta {{ display:block; font-size:11px; margin-top:3px; color:var(--muted); }}
  .delta.up {{ color:#C44242; }} .delta.down {{ color:#1B8C59; }} .delta.start {{ color:var(--accent); }}
  footer {{ margin-top:72px; padding-top:24px; border-top:1px solid var(--line);
            display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--muted); }}
  footer a {{ color:var(--ink); text-decoration:none; border-bottom:1px solid var(--line); padding-bottom:1px; }}
</style></head>
<body><div class="wrap">
  <header class="head">
    <h1><span class="name">{esc(DATA['name'])}</span> 的体重日历</h1>
    <div class="meta">导出于 {DATA['exportDate']} · 共 {DATA['count']} 条记录 · 单位 {DATA['unit']}</div>
    <div class="stats">
      <div class="stat"><div class="num">{DATA['startWeight']:g}</div><div class="lbl">起始体重 · {DATA['startDate']}</div></div>
      <div class="stat"><div class="num">{cur:g}</div><div class="lbl">当前体重</div></div>
      <div class="stat"><div class="num down">{total_delta:g}</div><div class="lbl">累计变化</div></div>
    </div>
  </header>
  {''.join(months_html)}
  <footer>
    <span>由体重日历生成 · {DATA['exportDate']}</span>
    <a href="{DATA['toolUrl']}">打开体重日历 ↗</a>
  </footer>
</div></body></html>"""

# =====================================================================
# B. BRUTALIST
# =====================================================================
def build_brutalist():
    accent = "#FF5C28"  # 亮橙
    ink = "#141414"
    months_html = []
    for (y, m), days in months.items():
        rows = month_cells(days)
        head = "".join(f"<th>{n}</th>" for n in NAMES)
        body_rows = []
        for row in rows:
            cells = []
            for day in row:
                if day is None:
                    cells.append('<td class="empty"></td>')
                    continue
                key = day.isoformat()
                if key in weight_by_date:
                    w = weight_by_date[key]
                    dv = delta_by_date[key]
                    if dv is None:
                        cls = "start"; dtxt = "起点"
                    else:
                        cls = "up" if dv > 0 else ("down" if dv < 0 else "flat")
                        dtxt = ("+" if dv > 0 else "") + f"{dv:g}"
                    cells.append(
                        f'<td class="rec"><span class="d">{day.day}</span>'
                        f'<span class="w">{w:g}</span>'
                        f'<span class="delta {cls}">{dtxt}</span></td>')
                else:
                    cells.append(f'<td class="nodata"><span class="d">{day.day}</span></td>')
            body_rows.append("<tr>" + "".join(cells) + "</tr>")
        months_html.append(f"""
        <section class="month">
          <h2>// {y}.{m:02d}</h2>
          <table><thead><tr>{head}</tr></thead>
          <tbody>{''.join(body_rows)}</tbody></table>
        </section>""")
    return f"""<!doctype html><html><head>{CSS_COMMON_HEAD}<title>体重日历 - 粗野</title>
<style>
  :root {{ --paper:#EDEDEA; --ink:{ink}; --accent:{accent}; --line:{ink}; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ background:var(--paper); color:var(--ink);
         font-family:"SF Mono","Menlo",ui-monospace,monospace;
         font-feature-settings:"tnum"; line-height:1.4; padding:40px 20px 80px; }}
  .wrap {{ max-width:820px; margin:0 auto; }}
  .head {{ border:3px solid var(--ink); box-shadow:8px 8px 0 var(--ink); padding:28px; background:#fff; margin-bottom:32px; }}
  .tag {{ display:inline-block; background:var(--accent); color:#fff; font-weight:700;
          padding:4px 10px; font-size:12px; letter-spacing:.1em; margin-bottom:16px; }}
  h1 {{ font-size:38px; font-weight:800; letter-spacing:-.03em; text-transform:lowercase; line-height:1; }}
  h1 b {{ background:var(--ink); color:#fff; padding:0 6px; }}
  .meta {{ margin-top:14px; font-size:13px; }}
  .stats {{ display:grid; grid-template-columns:repeat(3,1fr); border:3px solid var(--ink);
            box-shadow:8px 8px 0 var(--ink); background:#fff; margin-bottom:40px; }}
  .stat {{ padding:18px; border-right:3px solid var(--ink); }}
  .stat:last-child {{ border-right:none; }}
  .stat .num {{ font-size:28px; font-weight:800; letter-spacing:-.02em; }}
  .stat.delta .num {{ color:#fff; background:var(--accent); display:inline-block; padding:0 6px; }}
  .stat .lbl {{ font-size:11px; margin-top:6px; }}
  section.month {{ margin-bottom:36px; border:3px solid var(--ink); box-shadow:6px 6px 0 var(--ink); background:#fff; }}
  h2 {{ font-size:15px; font-weight:800; padding:14px 16px; border-bottom:3px solid var(--ink); }}
  table {{ width:100%; border-collapse:collapse; table-layout:fixed; }}
  th {{ font-size:11px; font-weight:700; text-align:left; padding:8px; border-right:1px solid var(--line); border-bottom:3px solid var(--ink); }}
  td {{ border-right:1px solid var(--line); border-bottom:1px solid var(--line);
        padding:8px 8px; vertical-align:top; height:82px; }}
  td.empty {{ background:transparent; }}
  td.nodata {{ color:#BFBFBF; }}
  td.rec {{ background:#FFE9E0; }}
  .d {{ display:block; font-size:11px; font-weight:700; }}
  .w {{ display:block; font-size:14px; font-weight:800; margin-top:6px; }}
  .delta {{ display:block; font-size:11px; margin-top:3px; }}
  .delta.up {{ color:#C44242; }} .delta.down {{ color:#1B8C59; }}
  .delta.start {{ background:var(--ink); color:#fff; display:inline-block; padding:0 4px; }}
  footer {{ margin-top:40px; border:3px solid var(--ink); box-shadow:6px 6px 0 var(--accent);
            background:#fff; padding:18px; display:flex; justify-content:space-between; align-items:center; font-size:12px; }}
  footer a {{ color:var(--ink); font-weight:800; text-transform:uppercase; text-decoration:none;
             border-bottom:3px solid var(--accent); padding-bottom:2px; }}
</style></head>
<body><div class="wrap">
  <div class="head">
    <span class="tag">EXPORT / {DATA['exportDate']}</span>
    <h1><b>{esc(DATA['name'])}</b> weight log</h1>
    <div class="meta">{DATA['count']} records · {DATA['unit']} · from {DATA['startDate']}</div>
  </div>
  <div class="stats">
    <div class="stat"><div class="num">{DATA['startWeight']:g}</div><div class="lbl">start weight</div></div>
    <div class="stat"><div class="num">{cur:g}</div><div class="lbl">current</div></div>
    <div class="stat delta"><div class="num">{total_delta:g}</div><div class="lbl">total change</div></div>
  </div>
  {''.join(months_html)}
  <footer>
    <span>GENERATED BY WEIGHT CALENDAR</span>
    <a href="{DATA['toolUrl']}">OPEN ↗</a>
  </footer>
</div></body></html>"""

# =====================================================================
# C. BENTO
# =====================================================================
def build_bento():
    accent = "#D9577A"
    months_html = []
    for (y, m), days in months.items():
        rows = month_cells(days)
        head = "".join(f"<th>{n}</th>" for n in NAMES)
        body_rows = []
        for row in rows:
            cells = []
            for day in row:
                if day is None:
                    cells.append('<td class="empty"></td>')
                    continue
                key = day.isoformat()
                if key in weight_by_date:
                    w = weight_by_date[key]
                    dv = delta_by_date[key]
                    if dv is None:
                        cls = "start"; dtxt = "起点"
                    else:
                        cls = "up" if dv > 0 else ("down" if dv < 0 else "flat")
                        dtxt = ("+" if dv > 0 else "") + f"{dv:g}"
                    cells.append(
                        f'<td class="rec"><span class="d">{day.day}</span>'
                        f'<span class="w">{w:g}</span>'
                        f'<span class="delta {cls}">{dtxt}</span></td>')
                else:
                    cells.append(f'<td class="nodata"><span class="d">{day.day}</span></td>')
            body_rows.append("<tr>" + "".join(cells) + "</tr>")
        tint = "pink" if m % 2 else "gray"
        months_html.append(f"""
        <section class="tile month {tint}">
          <h2>{y}年{m}月</h2>
          <table><thead><tr>{head}</tr></thead>
          <tbody>{''.join(body_rows)}</tbody></table>
        </section>""")
    return f"""<!doctype html><html><head>{CSS_COMMON_HEAD}<title>体重日历 - Bento</title>
<style>
  :root {{ --bg:#EFF1F3; --ink:#1C1917; --muted:#78716C; --accent:{accent};
           --tile:#FFFFFF; --pink:#FDE8EE; --gray:#F1F1F0; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ background:var(--bg); color:var(--ink);
         font-family:-apple-system,"Helvetica Neue","PingFang SC",sans-serif;
         font-feature-settings:"tnum"; padding:40px 20px; line-height:1.4; }}
  .wrap {{ max-width:860px; margin:0 auto; display:block; }}
  .grid {{ display:grid; grid-template-columns:2fr 1fr 1fr; gap:16px; margin-bottom:16px; }}
  .tile {{ background:var(--tile); border-radius:20px; padding:24px; }}
  .hero {{ background:linear-gradient(135deg,{accent},#E87893); color:#fff;
           border-radius:20px; padding:28px; grid-column:span 2; display:flex; flex-direction:column; justify-content:space-between; }}
  .hero .lbl {{ font-size:12px; opacity:.85; letter-spacing:.1em; }}
  .hero .big {{ font-size:56px; font-weight:700; letter-spacing:-.03em; line-height:1; margin-top:12px; }}
  .hero .sub {{ font-size:14px; margin-top:8px; opacity:.9; }}
  .side {{ display:flex; flex-direction:column; justify-content:center; }}
  .side .num {{ font-size:30px; font-weight:700; letter-spacing:-.02em; }}
  .side .lbl {{ font-size:12px; color:var(--muted); margin-top:6px; }}
  .side .num.down {{ color:#1B8C59; }}
  .span2 {{ display:flex; gap:24px; align-items:center; margin-bottom:16px; }}
  .chip-row {{ display:flex; gap:10px; flex-wrap:wrap; }}
  .chip {{ font-size:12px; padding:6px 12px; border-radius:999px; background:var(--gray); color:var(--ink); }}
  .chip.accent {{ background:var(--pink); color:var(--accent); font-weight:600; }}
  section.month {{ background:var(--tile); border-radius:20px; padding:24px; margin-bottom:16px; }}
  section.month.pink {{ background:var(--pink); }}
  section.month.gray {{ background:#F7F7F6; }}
  h2 {{ font-size:15px; font-weight:600; margin-bottom:14px; }}
  table {{ width:100%; border-collapse:collapse; table-layout:fixed; }}
  th {{ font-size:11px; font-weight:500; color:var(--muted); text-align:left; padding:0 6px 8px; }}
  td {{ padding:8px 6px; vertical-align:top; height:74px; border-radius:10px; }}
  td.rec {{ background:#fff; }}
  td.nodata, td.empty {{ background:transparent; color:#CBC9C6; }}
  .d {{ display:block; font-size:11px; color:var(--muted); }}
  td.rec .d {{ color:var(--ink); font-weight:500; }}
  .w {{ display:block; font-size:14px; font-weight:600; margin-top:5px; }}
  .delta {{ display:block; font-size:10.5px; margin-top:2px; color:var(--muted); }}
  .delta.up {{ color:#C44242; }} .delta.down {{ color:#1B8C59; }}
  .delta.start {{ color:var(--accent); font-weight:600; }}
  footer {{ display:flex; justify-content:space-between; align-items:center;
            background:var(--tile); border-radius:20px; padding:20px 24px; font-size:12px; color:var(--muted); margin-top:16px; }}
  footer a {{ color:var(--ink); font-weight:600; text-decoration:none; display:flex; align-items:center; gap:8px; }}
</style></head>
<body><div class="wrap">
  <div class="grid">
    <div class="tile hero">
      <div class="lbl">{esc(DATA['name'])} · 当前体重</div>
      <div class="big">{cur:g}<span style="font-size:22px;font-weight:500;opacity:.8">{DATA['unit']}</span></div>
      <div class="sub">{DATA['count']} 条记录 · {DATA['startDate']} 起</div>
    </div>
    <div class="tile side"><div class="num">{DATA['startWeight']:g}</div><div class="lbl">起始体重</div></div>
    <div class="tile side"><div class="num down">{total_delta:g}</div><div class="lbl">累计变化</div></div>
  </div>
  <div class="tile span2">
    <div class="chip-row">
      <span class="chip accent">玫瑰粉主题</span>
      <span class="chip">{DATA['count']} 条记录</span>
      <span class="chip">单位 {DATA['unit']}</span>
      <span class="chip">导出 {DATA['exportDate']}</span>
    </div>
  </div>
  {''.join(months_html)}
  <footer>
    <span>由体重日历生成 · {DATA['exportDate']}</span>
    <a href="{DATA['toolUrl']}">打开体重日历 ↗</a>
  </footer>
</div></body></html>"""

open("minimal.html", "w", encoding="utf-8").write(build_minimal())
open("brutalist.html", "w", encoding="utf-8").write(build_brutalist())
open("bento.html", "w", encoding="utf-8").write(build_bento())
print("done")
