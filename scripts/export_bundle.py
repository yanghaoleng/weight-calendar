#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""体重日历导出打包：Markdown（无每日增减）+ 极简 PDF（含增减）+ 极简单文件 HTML。

由 server.py 的 /api/export 调用，也可直接命令行运行生成示例包。
"""
from __future__ import annotations

import base64
import io
import json
import os
import tempfile
import sys
import zipfile
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VENDOR = PROJECT_ROOT / "vendor"
if VENDOR.is_dir() and str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

# ---------------------------------------------------------------- 常量 ------
UNIT_GRAMS = {"kg": 1000, "jin": 500, "lb": 453.59237, "st": 6350.29318}
UNIT_SYMBOL = {"kg": "kg", "jin": "斤", "lb": "lb", "st": "st"}

THEME_ACCENT = {
    "rose": "#b94468",
    "mint": "#34785f",
    "sky": "#3b7396",
    "lilac": "#725991",
    "peach": "#985b3d",
}

R_UP = "#c44242"
R_DOWN = "#1b8c59"

# 极简排版配色（与用户主题 accent 叠加）
PAPER = "#FAFAF9"
INK = "#1C1917"
MUTED = "#A8A29E"
LINE = "#E7E5E4"

I18N = {
    "zh-CN": {
        "weekdays": ["一", "二", "三", "四", "五", "六", "日"],
        "named": "{}的体重日历", "mine": "我的体重日历",
        "exported": "导出于 {}", "records_n": "共 {} 条记录", "unit": "单位 {}",
        "start_weight": "起始体重", "current": "当前体重", "total_change": "累计变化",
        "from_date": "从 {} 起", "start": "起点",
        "tool_url": "工具网址", "login_passcode": "登录密码", "initial_date": "初始日期",
        "unit_label": {"kg": "公斤", "jin": "市斤", "lb": "磅", "st": "英石"},
        "by_tool": "由体重日历生成", "open_tool": "打开体重日历",
    },
    "zh-HK": {
        "weekdays": ["一", "二", "三", "四", "五", "六", "日"],
        "named": "{}的體重日曆", "mine": "我的體重日曆",
        "exported": "導出於 {}", "records_n": "共 {} 條記錄", "unit": "單位 {}",
        "start_weight": "初始體重", "current": "當前體重", "total_change": "累計變化",
        "from_date": "從 {} 起", "start": "起點",
        "tool_url": "工具網址", "login_passcode": "登錄密碼", "initial_date": "初始日期",
        "unit_label": {"kg": "公斤", "jin": "市斤", "lb": "磅", "st": "英石"},
        "by_tool": "由體重日曆生成", "open_tool": "打開體重日曆",
    },
    "zh-TW": {
        "weekdays": ["一", "二", "三", "四", "五", "六", "日"],
        "named": "{}的體重日曆", "mine": "我的體重日曆",
        "exported": "導出於 {}", "records_n": "共 {} 條記錄", "unit": "單位 {}",
        "start_weight": "初始體重", "current": "當前體重", "total_change": "累計變化",
        "from_date": "從 {} 起", "start": "起點",
        "tool_url": "工具網址", "login_passcode": "登錄密碼", "initial_date": "初始日期",
        "unit_label": {"kg": "公斤", "jin": "市斤", "lb": "磅", "st": "英石"},
        "by_tool": "由體重日曆生成", "open_tool": "打開體重日曆",
    },
    "en": {
        "weekdays": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        "named": "{}'s Weight Calendar", "mine": "My Weight Calendar",
        "exported": "Exported {}", "records_n": "{} records", "unit": "Unit {}",
        "start_weight": "Starting weight", "current": "Current", "total_change": "Change",
        "from_date": "from {}", "start": "Start",
        "tool_url": "Tool URL", "login_passcode": "Passcode", "initial_date": "Start date",
        "unit_label": {"kg": "kilograms", "jin": "jin", "lb": "pounds", "st": "stone"},
        "by_tool": "Made with Weight Calendar", "open_tool": "Open Weight Calendar",
    },
    "ja": {
        "weekdays": ["月", "火", "水", "木", "金", "土", "日"],
        "named": "{}の体重カレンダー", "mine": "私の体重カレンダー",
        "exported": "出力日 {}", "records_n": "{} 件の記録", "unit": "単位 {}",
        "start_weight": "開始体重", "current": "現在", "total_change": "変化",
        "from_date": "{} から", "start": "開始",
        "tool_url": "ツールURL", "login_passcode": "パスコード", "initial_date": "開始日",
        "unit_label": {"kg": "キログラム", "jin": "斤", "lb": "ポンド", "st": "ストーン"},
        "by_tool": "体重カレンダーで生成", "open_tool": "体重カレンダーを開く",
    },
    "ko": {
        "weekdays": ["월", "화", "수", "목", "금", "토", "일"],
        "named": "{}의 체중 달력", "mine": "내 체중 달력",
        "exported": "내보낸 날짜 {}", "records_n": "{} 개 기록", "unit": "단위 {}",
        "start_weight": "시작 체중", "current": "현재", "total_change": "변화",
        "from_date": "{} 부터", "start": "시작",
        "tool_url": "도구 URL", "login_passcode": "암호", "initial_date": "시작 날짜",
        "unit_label": {"kg": "킬로그램", "jin": "근", "lb": "파운드", "st": "스톤"},
        "by_tool": "체중 달력에서 생성", "open_tool": "체중 달력 열기",
    },
}


def _lang(language: str | None) -> str:
    if language in I18N:
        return language
    if language and language.startswith("zh-HK"):
        return "zh-HK"
    if language and language.startswith("zh-TW"):
        return "zh-TW"
    if language and language.startswith("zh"):
        return "zh-CN"
    return "en"


def normalize_unit(unit: str | None) -> str:
    return unit if unit in UNIT_GRAMS else "kg"


def grams_to_unit(grams: float, unit: str) -> float:
    return grams / UNIT_GRAMS[unit]


def format_weight(grams: float, unit: str) -> str:
    v = grams_to_unit(grams, unit)
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def sorted_records(records: list[dict]) -> list[dict]:
    return sorted(records, key=lambda r: r["date"])


def records_with_deltas(records: list[dict]) -> list[dict]:
    """复刻前端 recordsWithDeltas：第一条为起点，delta 与上一条比较。"""
    out = []
    prev = None
    for r in sorted_records(records):
        grams = float(r["weightGrams"])
        out.append({
            "date": r["date"],
            "grams": grams,
            "isFirst": prev is None,
            "delta": 0.0 if prev is None else grams - prev,
        })
        prev = grams
    return out


def _fmt_delta(delta: float, unit: str) -> tuple[str, str]:
    """返回 (样式类, 文案)：持平归 0，升正红降负绿。"""
    if abs(delta) < 0.05:
        return "flat", "0"
    if delta > 0:
        return "up", "+" + format_weight(delta, unit)
    return "down", format_weight(delta, unit)


def calendar_cells(year: int, month: int) -> list[list[dict | None]]:
    """周一开头，返回 7 列的周数组，空位 None。"""
    first = date(year, month, 1)
    lead = first.weekday()  # Python 周一=0，与前端 mondayOffset 一致
    days_in = (date(year + (month == 12), 1 if month == 12 else month + 1, 1) - first).days
    cells: list[dict | None] = [None] * lead + [
        {"key": f"{year:04d}-{month:02d}-{day:02d}", "day": day}
        for day in range(1, days_in + 1)
    ]
    while len(cells) % 7:
        cells.append(None)
    return [cells[i:i + 7] for i in range(0, len(cells), 7)]


def month_list(records: list[dict], initial_date: str | None) -> list[tuple[int, int]]:
    keys = {r["date"][:7] for r in records}
    if initial_date:
        keys.add(initial_date[:7])
    return sorted(tuple(int(x) for x in k.split("-")) for k in keys)


# ------------------------------------------------------------ Markdown ------
def build_markdown(payload: dict, *, language: str, unit: str,
                   tool_url: str, passcode: str | None, today: date) -> str:
    L = I18N[_lang(language)]
    unit = normalize_unit(unit)
    account = payload["account"]
    recs = records_with_deltas(payload["records"])
    record_map = {r["date"]: r for r in recs}
    sym = UNIT_SYMBOL[unit]
    sep = "：" if _lang(language).startswith("zh") else ": "
    fsep = "；" if _lang(language).startswith("zh") else "; "

    name = account.get("displayName") or ""
    title = L["named"].format(name) if name else L["mine"]
    lines = [f"# {title}", ""]
    lines.append(f"- {L['exported'].format(today.isoformat())}")
    passcode_txt = passcode or "—"
    lines.append(f"- {L['tool_url']}{sep}{tool_url}{fsep}{L['login_passcode']}{sep}{passcode_txt}")
    if account.get("initialDate"):
        lines.append(f"- {L['initial_date']}{sep}{account['initialDate']}")
    if account.get("initialWeightGrams"):
        lines.append(f"- {L['start_weight']}{sep}{format_weight(float(account['initialWeightGrams']), unit)} {sym}")
    lines.append(f"- {L['unit'].format(L['unit_label'][unit])}{sep}({sym})")
    lines.append("")

    for (y, m) in month_list(recs, account.get("initialDate")):
        lines.append(f"## {y}年{m}月" if _lang(language).startswith("zh") else f"## {y}-{m:02d}")
        lines.append("")
        lines.append("| " + " | ".join(L["weekdays"]) + " |")
        lines.append("| " + " | ".join(["---"] * 7) + " |")
        for week in calendar_cells(y, m):
            cells = []
            for cell in week:
                if cell is None:
                    cells.append("")
                    continue
                rec = record_map.get(cell["key"])
                if not rec:
                    cells.append(f"{cell['day']:02d}")
                else:
                    cells.append(f"{cell['day']:02d} · {format_weight(rec['grams'], unit)} {sym}")
            lines.append("| " + " | ".join(cells) + " |")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------- PDF -------
_CJK_CACHE = Path(tempfile.gettempdir()) / "wcal-NotoSansSC-Regular.otf"


def _ensure_sc_otf(ttc_path: str) -> str:
    """从 NotoSansCJK ttc 提取 SC face 为单独 otf，避免 fpdf2 默认 face 0 (JP)
    在 macOS PDFKit 下把简体中文渲染成斜体。"""
    if _CJK_CACHE.exists() and _CJK_CACHE.stat().st_size > 1_000_000:
        return str(_CJK_CACHE)
    from fontTools.ttLib import TTCollection
    _CJK_CACHE.parent.mkdir(parents=True, exist_ok=True)
    TTCollection(ttc_path).fonts[2].save(str(_CJK_CACHE))
    return str(_CJK_CACHE)


def _find_cjk_font() -> str:
    candidates = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
        str(_CJK_CACHE),
        "/System/Library/Fonts/Supplemental/Songti.ttc",
    ]
    for p in candidates:
        if os.path.exists(p):
            if p.endswith(".ttc") and "NotoSansCJK" in p:
                return _ensure_sc_otf(p)
            return p
    raise RuntimeError("找不到中文字体文件")


def build_pdf(payload: dict, *, language: str, unit: str, theme: str, today: date,
              tool_url: str) -> bytes:
    from fpdf import FPDF

    L = I18N[_lang(language)]
    unit = normalize_unit(unit)
    accent = THEME_ACCENT.get(theme, THEME_ACCENT["rose"])
    account = payload["account"]
    recs = records_with_deltas(payload["records"])
    record_map = {r["date"]: r for r in recs}
    sym = UNIT_SYMBOL[unit]

    start_grams = float(account["initialWeightGrams"]) if account.get("initialWeightGrams") else (
        recs[0]["grams"] if recs else 0)
    current_grams = recs[-1]["grams"] if recs else start_grams
    total_delta = current_grams - start_grams

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_font("CJK", fname=_find_cjk_font())
    pdf.set_margins(18, 18, 18)
    pdf.add_page()

    def hex_rgb(h: str):
        h = h.lstrip("#")
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    # ---- 头部：大标题（无 eyebrow）----
    pdf.set_text_color(*hex_rgb(INK))
    pdf.set_font("CJK", size=24)
    name = account.get("displayName") or ""
    title = (L["named"].format(name) if name else L["mine"])
    pdf.cell(0, 12, title, new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("CJK", size=10)
    pdf.set_text_color(*hex_rgb(MUTED))
    meta = f"{L['exported'].format(today.isoformat())} · {L['records_n'].format(len(recs))} · {L['unit'].format(L['unit_label'][unit])}"
    pdf.cell(0, 7, meta, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # ---- 统计：hairline 上下分隔，三个数字横排 ----
    pdf.set_draw_color(*hex_rgb(LINE))
    y0 = pdf.get_y()
    pdf.line(18, y0, 192, y0)
    pdf.ln(6)
    col_w = (192 - 18) / 3
    stats = [
        (format_weight(start_grams, unit), L["start_weight"]),
        (format_weight(current_grams, unit), L["current"]),
        (("+" if total_delta > 0 else "") + format_weight(total_delta, unit), L["total_change"]),
    ]
    for i, (num, lbl) in enumerate(stats):
        x = 18 + i * col_w
        pdf.set_xy(x, pdf.get_y())
        is_total = i == 2
        pdf.set_text_color(*hex_rgb(R_DOWN if (is_total and total_delta < 0) else INK))
        pdf.set_font("CJK", size=18)
        pdf.cell(col_w, 9, num)
        pdf.set_xy(x, pdf.get_y() + 9)
        pdf.set_text_color(*hex_rgb(MUTED))
        pdf.set_font("CJK", size=8)
        pdf.cell(col_w, 5, lbl)
    pdf.set_y(y0 + 26)
    y1 = pdf.get_y()
    pdf.line(18, y1, 192, y1)
    pdf.ln(6)

    # ---- 每月表格（hairline 风格，含增减）----
    page_bottom = 297 - 18
    cell_w = (192 - 18) / 7.0
    row_h = 14
    header_h = 6

    for (y, m) in month_list(recs, account.get("initialDate")):
        rows = calendar_cells(y, m)
        block_h = 10 + header_h + ((len(rows) + 6) // 7) * row_h
        if pdf.get_y() + block_h > page_bottom:
            pdf.add_page()
        pdf.set_text_color(*hex_rgb(INK))
        pdf.set_font("CJK", size=13)
        pdf.cell(0, 8, f"{y}年{m}月" if _lang(language).startswith("zh") else f"{y}-{m:02d}",
                 new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
        # 表头
        pdf.set_font("CJK", size=8)
        for i, wname in enumerate(L["weekdays"]):
            pdf.set_xy(18 + i * cell_w, pdf.get_y())
            pdf.set_text_color(*hex_rgb(MUTED))
            pdf.cell(cell_w, header_h, wname)
        pdf.ln(header_h)
        # 行
        for row in rows:
            if pdf.get_y() + row_h > page_bottom:
                pdf.add_page()
                pdf.set_text_color(*hex_rgb(INK))
                pdf.set_font("CJK", size=13)
                pdf.cell(0, 8, f"{y}年{m}月" if _lang(language).startswith("zh") else f"{y}-{m:02d}",
                         new_x="LMARGIN", new_y="NEXT")
                pdf.ln(1)
                pdf.set_font("CJK", size=8)
                for i, wname in enumerate(L["weekdays"]):
                    pdf.set_xy(18 + i * cell_w, pdf.get_y())
                    pdf.set_text_color(*hex_rgb(MUTED))
                    pdf.cell(cell_w, header_h, wname)
                pdf.ln(header_h)
            ry = pdf.get_y()
            for i, cell in enumerate(row):
                x = 18 + i * cell_w
                pdf.set_draw_color(*hex_rgb(LINE))
                pdf.line(x, ry + row_h, x + cell_w, ry + row_h)
                if cell is None:
                    continue
                rec = record_map.get(cell["key"])
                pdf.set_xy(x + 1, ry + 1)
                pdf.set_font("CJK", size=7)
                pdf.set_text_color(*hex_rgb(MUTED))
                pdf.cell(cell_w - 2, 3.5, f"{cell['day']:02d}")
                if not rec:
                    continue
                pdf.set_xy(x + 1, ry + 4.5)
                pdf.set_font("CJK", size=9)
                pdf.set_text_color(*hex_rgb(INK))
                pdf.cell(cell_w - 2, 4.5, format_weight(rec["grams"], unit))
                pdf.set_xy(x + 1, ry + 9.5)
                pdf.set_font("CJK", size=7)
                if rec["isFirst"]:
                    pdf.set_text_color(*hex_rgb(accent))
                    txt = L["start"]
                else:
                    kind, txt = _fmt_delta(rec["delta"], unit)
                    if kind == "up":
                        pdf.set_text_color(*hex_rgb(R_UP))
                    elif kind == "down":
                        pdf.set_text_color(*hex_rgb(R_DOWN))
                    else:
                        pdf.set_text_color(*hex_rgb(MUTED))
                pdf.cell(cell_w - 2, 3.5, txt)
            pdf.set_y(ry + row_h)
        pdf.ln(5)

    # ---- 页脚 ----
    pdf.ln(2)
    pdf.set_draw_color(*hex_rgb(LINE))
    pdf.line(18, pdf.get_y(), 192, pdf.get_y())
    pdf.ln(2)
    pdf.set_font("CJK", size=8)
    pdf.set_text_color(*hex_rgb(MUTED))
    pdf.cell(0, 5, f"{L['by_tool']} · {today.isoformat()}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, tool_url, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


# ---------------------------------------------------------------- HTML ------
def _read_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _asset(*parts: str) -> Path | None:
    for base in (PROJECT_ROOT / "node_modules", PROJECT_ROOT):
        p = base.joinpath(*parts)
        if p.is_file():
            return p
    return None


def build_html(payload: dict, *, language: str, unit: str, theme: str,
               font_style: str, today: date, tool_url: str) -> str:
    from html import escape as h
    L = I18N[_lang(language)]
    unit = normalize_unit(unit)
    accent = THEME_ACCENT.get(theme, THEME_ACCENT["rose"])
    account = payload["account"]
    recs = records_with_deltas(payload["records"])
    record_map = {r["date"]: r for r in recs}
    sym = UNIT_SYMBOL[unit]

    start_grams = float(account["initialWeightGrams"]) if account.get("initialWeightGrams") else (
        recs[0]["grams"] if recs else 0)
    current_grams = recs[-1]["grams"] if recs else start_grams
    total_delta = current_grams - start_grams

    # 内嵌字体
    fredoka = lora = phosphor = None
    p = _asset("@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2")
    if p:
        fredoka = _read_b64(p)
    p = _asset("@fontsource-variable/lora/files/lora-latin-wght-normal.woff2")
    if p:
        lora = _read_b64(p)
    p = _asset("@phosphor-icons/web/src/regular/Phosphor.woff2")
    if p:
        phosphor = _read_b64(p)
    icon_path = PROJECT_ROOT / "public" / "app-icon.svg"
    icon_svg = icon_path.read_text(encoding="utf-8") if icon_path.is_file() else ""

    css_fonts = ""
    if lora:
        css_fonts += f"@font-face{{font-family:LoraVariable;src:url(data:font/woff2;base64,{lora}) format('woff2');font-weight:100 900;font-style:normal;}}"
    if fredoka:
        css_fonts += f"@font-face{{font-family:FredokaVariable;src:url(data:font/woff2;base64,{fredoka}) format('woff2');font-weight:100 900;font-style:normal;}}"
    if phosphor:
        css_fonts += f"@font-face{{font-family:Phosphor;src:url(data:font/woff2;base64,{phosphor}) format('woff2');font-weight:normal;font-style:normal;}}"

    if font_style == "serif":
        body_font = "'LoraVariable', Georgia, serif"
    elif font_style in ("handwriting", "cute"):
        body_font = "'FredokaVariable', system-ui, sans-serif"
    else:
        body_font = "-apple-system, 'Helvetica Neue', 'PingFang SC', sans-serif"

    # 月度表格
    months_html = []
    for (y, m) in month_list(recs, account.get("initialDate")):
        rows = calendar_cells(y, m)
        head = "".join(f"<th>{h(w)}</th>" for w in L["weekdays"])
        body = []
        for row in rows:
            cells = []
            for cell in row:
                if cell is None:
                    cells.append('<td class="e"></td>')
                    continue
                rec = record_map.get(cell["key"])
                if not rec:
                    cells.append(f'<td class="n"><span>{cell["day"]:02d}</span></td>')
                    continue
                if rec["isFirst"]:
                    cls = "start"; dt = L["start"]
                else:
                    cls, dt = _fmt_delta(rec["delta"], unit)
                cells.append(
                    f'<td><span class="d">{cell["day"]:02d}</span>'
                    f'<span class="w">{h(format_weight(rec["grams"], unit))}</span>'
                    f'<span class="delta {cls}">{h(dt)}</span></td>')
            body.append("<tr>" + "".join(cells) + "</tr>")
        mlabel = f"{y}年{m}月" if _lang(language).startswith("zh") else f"{y}-{m:02d}"
        months_html.append(
            f'<section class="month"><h2>{h(mlabel)}</h2>'
            f'<table><thead><tr>{head}</tr></thead><tbody>{"".join(body)}</tbody></table></section>')

    name = account.get("displayName") or ""
    title = L["named"].format(name) if name else L["mine"]
    # 拆分 h1：名字上色，其余正文
    if name and title.startswith(name):
        h1_name, h1_rest = name, title[len(name):]
    else:
        h1_name, h1_rest = "", title
    delta_cls = "down" if total_delta < 0 else "up"
    delta_txt = ("+" if total_delta > 0 else "") + format_weight(total_delta, unit)

    return f"""<!doctype html><html lang="{h(_lang(language))}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{h(title)}</title><style>
{css_fonts}
:root{{--bg:{PAPER};--ink:{INK};--muted:{MUTED};--line:{LINE};--accent:{accent};}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:var(--bg);color:var(--ink);font-family:{body_font};font-feature-settings:"tnum";padding:64px 24px 96px;line-height:1.5}}
.wrap{{max-width:760px;margin:0 auto}}
h1{{font-size:40px;font-weight:600;letter-spacing:-.02em;line-height:1.1}}
h1 .name{{color:var(--accent)}}
.meta{{margin-top:14px;font-size:14px;color:var(--muted)}}
.stats{{display:flex;gap:40px;margin:40px 0 0;padding:24px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}}
.num{{font-size:32px;font-weight:600;letter-spacing:-.02em}}
.lbl{{font-size:12px;color:var(--muted);margin-top:4px}}
.num.down{{color:{R_DOWN}}}
section.month{{margin-top:48px}}
h2{{font-size:16px;font-weight:600;margin-bottom:16px}}
table{{width:100%;border-collapse:collapse;table-layout:fixed}}
th{{font-size:11px;font-weight:500;color:var(--muted);text-align:left;padding:0 8px 8px}}
td{{border-top:1px solid var(--line);padding:10px 8px;vertical-align:top;height:76px}}
td.e,td.n{{color:#D6D3D1}}
.d{{display:block;font-size:11px;color:var(--muted)}}
td:not(.n):not(.e) .d{{color:var(--ink);font-weight:500}}
.w{{display:block;font-size:15px;font-weight:600;margin-top:6px}}
.delta{{display:block;font-size:11px;margin-top:3px;color:var(--muted)}}
.delta.up{{color:{R_UP}}}.delta.down{{color:{R_DOWN}}}.delta.start{{color:var(--accent)}}
footer{{margin-top:72px;padding-top:24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)}}
footer a{{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line);padding-bottom:1px;display:inline-flex;align-items:center;gap:8px}}
footer .ico{{width:18px;height:18px;display:inline-block}}
footer .ico svg{{width:100%;height:100%}}
</style></head><body><div class="wrap">
<h1><span class="name">{h(h1_name)}</span> {h(h1_rest)}</h1>
<div class="meta">{h(L['exported'].format(today.isoformat()))} · {h(L['records_n'].format(len(recs)))} · {h(L['unit'].format(L['unit_label'][unit]))}</div>
<div class="stats">
<div><div class="num">{h(format_weight(start_grams, unit))}</div><div class="lbl">{h(L['start_weight'])} · {h(account.get('initialDate') or '')}</div></div>
<div><div class="num">{h(format_weight(current_grams, unit))}</div><div class="lbl">{h(L['current'])}</div></div>
<div><div class="num {delta_cls}">{h(delta_txt)}</div><div class="lbl">{h(L['total_change'])}</div></div>
</div>
{''.join(months_html)}
<footer>
<span>{h(L['by_tool'])} · {today.isoformat()}</span>
<a href="{h(tool_url)}"><span class="ico">{icon_svg}</span>{h(L['open_tool'])} ↗</a>
</footer>
</div></body></html>"""


# --------------------------------------------------------------- bundle ------
def build_bundle(payload: dict, *, language: str | None = None, unit: str | None = None,
                 today: date | None = None, tool_url: str = "https://wcal.mikeywa.site/",
                 passcode: str | None = None) -> bytes:
    today = today or date.today()
    language = language or payload.get("account", {}).get("language") or "zh-CN"
    unit = unit or payload.get("account", {}).get("unit") or "kg"
    theme = payload.get("account", {}).get("theme") or "rose"
    font_style = payload.get("account", {}).get("fontStyle") or "system"

    md = build_markdown(payload, language=language, unit=unit,
                        tool_url=tool_url, passcode=passcode, today=today)
    pdf = build_pdf(payload, language=language, unit=unit, theme=theme,
                    today=today, tool_url=tool_url)
    html = build_html(payload, language=language, unit=unit, theme=theme,
                      font_style=font_style, today=today, tool_url=tool_url)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("weight-calendar.md", md)
        z.writestr("weight-calendar.pdf", pdf)
        z.writestr("weight-calendar.html", html)
    return buf.getvalue()


def _cli() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--payload", required=True, help="export_payload JSON 文件")
    ap.add_argument("--out", required=True, help="输出 zip 路径")
    ap.add_argument("--tool-url", default="https://wcal.mikeywa.site/")
    args = ap.parse_args()
    payload = json.load(open(args.payload, encoding="utf-8"))
    data = build_bundle(payload, tool_url=args.tool_url)
    Path(args.out).write_bytes(data)
    print("written", args.out, len(data), "bytes")


if __name__ == "__main__":
    _cli()
