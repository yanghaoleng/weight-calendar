import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Backspace,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Check,
  DownloadSimple,
  Gauge,
  LockKey,
  Palette,
  SignOut,
  X,
} from "@phosphor-icons/react";
import {
  addMonths,
  calendarCells,
  formatKg,
  isMonthAfter,
  monthLabel,
  parseDateKey,
  recordsWithDeltas,
  startOfMonth,
  toDateKey,
} from "./lib/calendar.js";

const THEMES = [
  { id: "rose", label: "樱粉", color: "#f2cbd5" },
  { id: "mint", label: "薄荷", color: "#d9eee2" },
  { id: "sky", label: "晴蓝", color: "#d8eaf4" },
  { id: "lilac", label: "浅紫", color: "#e6ddf2" },
  { id: "peach", label: "杏桃", color: "#f2dfd2" },
];

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(payload?.message || "请求没有完成，请稍后再试");
    error.code = payload?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function makeDemoData() {
  const weights = [61000, 59900, 59700, 59400, 59100, 58400, 58100, 58000, 57300, 60000, 59800, 59700, 59600, 59500, 59100, 58900];
  return {
    account: {
      theme: "rose",
      initialWeightGrams: 60000,
      initialDate: "2026-07-01",
      createdAt: "2026-07-01T08:00:00+08:00",
    },
    records: weights.map((weightGrams, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      weightGrams,
      updatedAt: "2026-07-16T08:00:00+08:00",
    })),
  };
}

function formatChineseDate(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function makeMarkdownExport(data, { demo, todayKey }) {
  const sortedRecords = recordsWithDeltas(data.records);
  const recordMap = new Map(sortedRecords.map((record) => [record.date, record]));
  const months = new Set(sortedRecords.map((record) => record.date.slice(0, 7)));
  if (data.account.initialDate) months.add(data.account.initialDate.slice(0, 7));
  if (months.size === 0) months.add(todayKey.slice(0, 7));

  const title = demo
    ? "Demo 体重日历"
    : data.account.displayName
      ? `${data.account.displayName.replaceAll("|", "\\|")}的体重日历`
      : "我的体重日历";
  const lines = [
    `# ${title}`,
    "",
    `- 导出日期：${todayKey}`,
    `- 初始日期：${data.account.initialDate || "未设置"}`,
    `- 初始体重：${data.account.initialWeightGrams ? `${formatKg(data.account.initialWeightGrams)} kg` : "未设置"}`,
    "",
  ];

  [...months].sort().forEach((monthKey) => {
    const monthDate = parseDateKey(`${monthKey}-01`);
    const monthCells = calendarCells(monthDate);
    lines.push(`## ${monthLabel(monthDate)}`, "", "| 一 | 二 | 三 | 四 | 五 | 六 | 日 |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (let index = 0; index < monthCells.length; index += 7) {
      const week = monthCells.slice(index, index + 7).map((cell) => {
        if (!cell) return "";
        const record = recordMap.get(cell.key);
        if (!record) return String(cell.day).padStart(2, "0");
        const delta = record.deltaGrams;
        const change = delta > 0
          ? `↑${formatKg(delta)}kg`
          : delta < 0
            ? `↓${formatKg(Math.abs(delta))}kg`
            : "起点";
        return `${String(cell.day).padStart(2, "0")} · ${formatKg(record.weightGrams)}kg · ${change}`;
      });
      lines.push(`| ${week.join(" | ")} |`);
    }
    lines.push("");
  });

  lines.push("↑ 表示增加，↓ 表示减少；差值均相对于上一次记录。", "");
  return lines.join("\n");
}

function Keypad({ value, onChange, disabled = false }) {
  const push = (digit) => {
    if (!disabled && value.length < 6) onChange(`${value}${digit}`);
  };

  return (
    <div className="pin-keypad" aria-label="六位密码数字键盘">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
        <button id={`pin-key-${digit}`} key={digit} type="button" onClick={() => push(digit)} disabled={disabled}>
          {digit}
        </button>
      ))}
      <span aria-hidden="true" />
      <button id="pin-key-0" type="button" onClick={() => push(0)} disabled={disabled}>0</button>
      <button
        type="button"
        id="pin-key-delete"
        className="key-icon"
        aria-label="删除一位"
        onClick={() => onChange(value.slice(0, -1))}
        disabled={disabled || value.length === 0}
      >
        <Backspace weight="regular" />
      </button>
    </div>
  );
}

function AccessPanel({ onClose, onSuccess }) {
  const [stage, setStage] = useState("enter");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [createdData, setCreatedData] = useState(null);
  const [qrData, setQrData] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const accountUrl = `${window.location.origin}/`;

  useEffect(() => {
    if (stage !== "created") return undefined;
    let active = true;
    QRCode.toDataURL(accountUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#292529", light: "#fffafd" },
    })
      .then((dataUrl) => {
        if (active) setQrData(dataUrl);
      })
      .catch(() => {
        if (active) setError("二维码生成失败，请保存下面的网址和密码");
      });
    return () => {
      active = false;
    };
  }, [accountUrl, stage]);

  const checkPin = async (candidate) => {
    if (candidate.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      if (stage === "enter") {
        const data = await api("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ passcode: candidate }),
        });
        onSuccess(data);
        return;
      }

      if (stage === "confirm") {
        if (candidate !== firstPin) {
          setError("两次输入的密码不一致，请重新输入");
          setPin("");
          return;
        }
        const data = await api("/api/accounts", {
          method: "POST",
          body: JSON.stringify({ passcode: candidate }),
        });
        setCreatedData(data);
        setPin("");
        setStage("created");
      }
    } catch (requestError) {
      if (requestError.code === "INVALID_CREDENTIALS" && stage === "enter") {
        setFirstPin(candidate);
        setPin("");
        setStage("ask");
      } else if (requestError.code === "PASSCODE_EXISTS") {
        setFirstPin("");
        setPin("");
        setStage("enter");
        setError("这个密码刚刚被使用了，请重新输入");
      } else if (requestError.code === "RATE_LIMITED") {
        setError("尝试次数太多，请稍后再试");
        setPin("");
      } else {
        setError(requestError.message);
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  };

  const updatePin = (nextPin) => {
    setPin(nextPin);
    setError("");
    if (nextPin.length === 6) void checkPin(nextPin);
  };

  const restart = () => {
    setStage("enter");
    setPin("");
    setFirstPin("");
    setError("");
  };

  if (stage === "created") {
    return (
      <div className="modal-layer" role="presentation">
        <section className="auth-panel created-panel" role="dialog" aria-modal="true" aria-labelledby="created-title">
          <div className="auth-icon success" aria-hidden="true"><Check weight="bold" /></div>
          <h2 id="created-title">账户已经创建</h2>
          <p>请现在截图保存。以后打开这个网址，再输入你的六位密码。</p>

          <div className="qr-card">
            {qrData
              ? <img id="account-qr" src={qrData} alt={`打开 ${accountUrl} 的二维码`} />
              : <div className="qr-loading" aria-label="正在生成二维码" />}
            <small>二维码只包含网址，不包含密码</small>
          </div>

          <div className="account-details">
            <div className="account-detail"><span>网址</span><strong>{accountUrl}</strong></div>
            <div className="account-detail password-detail"><span>密码</span><strong>{firstPin}</strong></div>
          </div>
          <div className="screenshot-reminder">建议把网址、二维码和密码一起截图保存。</div>
          <div className="auth-message" role={error ? "alert" : "status"}>{error}</div>
          <button id="screenshot-confirm" type="button" className="primary-button screenshot-button" onClick={() => onSuccess(createdData)}>
            <Check weight="bold" />已截图
          </button>
        </section>
      </div>
    );
  }

  if (stage === "ask") {
    return (
      <div className="modal-layer" role="presentation">
        <section className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button type="button" className="close-button" aria-label="关闭" onClick={onClose}><X /></button>
          <div className="auth-icon" aria-hidden="true"><LockKey weight="duotone" /></div>
          <h2 id="auth-title">没有找到这个账户</h2>
          <p>要用刚才输入的六位密码创建一个新账户吗？</p>
          <div className="masked-pin" aria-label="已记住六位密码">
            {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
          </div>
          <div className="access-actions">
            <button type="button" className="secondary-button" onClick={restart}>重新输入</button>
            <button id="confirm-create" type="button" className="primary-button" onClick={() => {
              setStage("confirm");
              setPin("");
              setError("");
            }}>创建账户</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-layer" role="presentation">
      <section className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" className="close-button" aria-label="关闭" onClick={onClose}>
          <X />
        </button>
        <div className="auth-icon" aria-hidden="true"><LockKey weight="duotone" /></div>
        <h2 id="auth-title">{stage === "confirm" ? "再输入一次密码" : "打开我的体重日历"}</h2>
        <p>{stage === "confirm" ? "请再次输入，确认你记住了这组六位密码" : "输入六位密码，输入完成后自动继续"}</p>

        <div className={`pin-dots ${error ? "has-error" : ""}`} aria-label={`已输入 ${pin.length} 位`}>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={index < pin.length ? "filled" : ""} />
          ))}
        </div>
        <div className="auth-message" role={error ? "alert" : "status"}>
          {error || (busy ? "正在确认..." : stage === "confirm" ? "再次输入相同的六位密码" : "密码只保存在服务端的加密摘要中")}
        </div>
        <Keypad value={pin} onChange={updatePin} disabled={busy} />
      </section>
    </div>
  );
}

function WeightKeypad({ value, onChange }) {
  const push = (key) => {
    if (key === "delete") {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === ".") {
      if (!value.includes(".") && value.length > 0) onChange(`${value}.`);
      return;
    }
    const [whole, decimal = ""] = value.split(".");
    if (value.includes(".") && decimal.length >= 1) return;
    if (!value.includes(".") && whole.length >= 3) return;
    onChange(`${value}${key}`);
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "delete"];
  return (
    <div className="weight-keypad" aria-label="体重数字键盘">
      {keys.map((key) => (
        <button id={`weight-key-${key === "." ? "decimal" : key}`} key={key} type="button" onClick={() => push(key)} aria-label={key === "delete" ? "删除一位" : key}>
          {key === "delete" ? <Backspace /> : key}
        </button>
      ))}
    </div>
  );
}

function WeightSheet({ mode, date, existingGrams, busy, onCancel, onSave }) {
  const initialValue = existingGrams ? formatKg(existingGrams) : "";
  const [value, setValue] = useState(initialValue);
  const [selectedDate, setSelectedDate] = useState(date);
  const kilograms = Number(value);
  const valid = Number.isFinite(kilograms) && kilograms >= 20 && kilograms <= 400;

  return (
    <div className="modal-layer align-end" role="presentation">
      <section className="weight-sheet" role="dialog" aria-modal="true" aria-labelledby="weight-title">
        {mode !== "initial" && (
          <button type="button" className="close-button" aria-label="关闭" onClick={onCancel}><X /></button>
        )}
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="weight-title">{mode === "initial" ? "先记下初始体重" : existingGrams ? "修改这一天" : "记录这一天"}</h2>
        {mode === "initial" ? (
          <label className="date-field">
            <span>初始日期</span>
            <input id="initial-date" type="date" value={selectedDate} max={toDateKey(new Date())} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
        ) : (
          <p className="selected-date">{formatChineseDate(date)}</p>
        )}
        <div className="weight-display" aria-live="polite">
          <strong>{value || "0"}</strong><span>kg</span>
        </div>
        <p className={`weight-hint ${value && !valid ? "invalid" : ""}`}>
          {value && !valid ? "请输入 20.0 到 400.0 kg" : "支持记录到 0.1 kg"}
        </p>
        <WeightKeypad value={value} onChange={setValue} />
        <button
          type="button"
          id="weight-save"
          className="primary-button sheet-save"
          disabled={!valid || busy || !selectedDate}
          onClick={() => onSave({ date: selectedDate, weightGrams: Math.round(kilograms * 1000) })}
        >
          <Check weight="bold" />{busy ? "保存中" : "保存体重"}
        </button>
      </section>
    </div>
  );
}

function ThemePicker({ value, onChange, onClose }) {
  return (
    <section className="theme-popover" aria-label="背景颜色">
      <div className="theme-title"><strong>背景颜色</strong><button type="button" aria-label="关闭颜色选择" onClick={onClose}><X /></button></div>
      <div className="theme-options">
        {THEMES.map((theme) => (
          <button
            type="button"
            key={theme.id}
            id={`theme-${theme.id}`}
            aria-label={theme.label}
            aria-pressed={value === theme.id}
            onClick={() => onChange(theme.id)}
          >
            <span style={{ background: theme.color }} />
            <b>{theme.label}</b>
            {value === theme.id && <Check weight="bold" />}
          </button>
        ))}
      </div>
    </section>
  );
}

function ScaleDay({ cell, record, todayKey, onSelect }) {
  if (!cell) return <div className="day-cell empty" aria-hidden="true" />;
  const unavailable = cell.key > todayKey;
  const delta = record?.deltaGrams || 0;
  const label = record
    ? `${formatChineseDate(cell.key)}，${formatKg(record.weightGrams)} 千克${delta === 0 ? "，起点" : `，比上次${delta > 0 ? "增加" : "减少"}${formatKg(Math.abs(delta))}千克`}`
    : `${formatChineseDate(cell.key)}，${unavailable ? "不可记录" : "尚未记录"}`;

  return (
    <button id={`day-${cell.key}`} type="button" className={`day-cell ${record ? "recorded" : ""}`} disabled={unavailable} onClick={() => onSelect(cell.key)} aria-label={label}>
      <span className="scale-face">
        {record ? (
          <>
            <strong>{formatKg(record.weightGrams)}</strong>
            <span className={`delta ${delta > 0 ? "rise" : delta < 0 ? "fall" : "same"}`}>
              {delta > 0 && <CaretUp weight="fill" />}
              {delta < 0 && <CaretDown weight="fill" />}
              {delta === 0 ? "起点" : `${formatKg(Math.abs(delta))}kg`}
            </span>
          </>
        ) : (
          <Gauge className="empty-gauge" weight="regular" />
        )}
      </span>
      <b className="day-number">{String(cell.day).padStart(2, "0")}</b>
    </button>
  );
}

function CalendarApp({ initialData, demo, onOpenAccount, onLogout }) {
  const [data, setData] = useState(initialData);
  const [month, setMonth] = useState(() => demo ? new Date(2026, 6, 1) : startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(null);
  const [showThemes, setShowThemes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const todayKey = toDateKey(new Date());
  const needsInitial = !data.account.initialWeightGrams || !data.account.initialDate;
  const records = useMemo(() => recordsWithDeltas(data.records), [data.records]);
  const recordMap = useMemo(() => new Map(records.map((item) => [item.date, item])), [records]);
  const cells = useMemo(() => calendarCells(month), [month]);
  const selectedRecord = selectedDate ? recordMap.get(selectedDate) : null;
  const currentMonth = startOfMonth(new Date());
  const calendarTitle = !demo && data.account.displayName
    ? `${data.account.displayName}的体重日历`
    : "体重日历";

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES.find((item) => item.id === data.account.theme)?.color || THEMES[0].color);
  }, [data.account.theme]);

  const saveWeight = async ({ date, weightGrams }) => {
    setBusy(true);
    setNotice("");
    try {
      if (demo) {
        const nextRecords = [...data.records.filter((item) => item.date !== date), { date, weightGrams, updatedAt: new Date().toISOString() }];
        setData((current) => ({
          ...current,
          account: needsInitial ? { ...current.account, initialWeightGrams: weightGrams, initialDate: date } : current.account,
          records: nextRecords,
        }));
      } else {
        const nextData = await api(needsInitial ? "/api/profile" : "/api/records", {
          method: "PUT",
          body: JSON.stringify({ date, weightGrams }),
        });
        setData(nextData);
      }
      setSelectedDate(null);
      setMonth(startOfMonth(parseDateKey(date)));
      setNotice("已保存");
      window.setTimeout(() => setNotice(""), 1800);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const changeTheme = async (theme) => {
    setData((current) => ({ ...current, account: { ...current.account, theme } }));
    if (!demo) {
      try {
        const nextData = await api("/api/theme", { method: "PUT", body: JSON.stringify({ theme }) });
        setData(nextData);
      } catch (error) {
        setNotice(error.message);
      }
    }
  };

  const exportData = async () => {
    const markdown = makeMarkdownExport(data, { demo, todayKey });
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const filename = `体重日历${demo ? "-Demo" : ""}-${todayKey}.md`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Markdown 日历已导出");
  };

  return (
    <main className={`app-shell ${demo ? "is-demo" : ""}`} data-theme={data.account.theme || "rose"}>
      <header className="app-header">
        {demo
          ? <span className="header-spacer" aria-hidden="true" />
          : <button type="button" className="icon-button" aria-label="退出账户" onClick={onLogout}><SignOut /></button>}
        <div className="app-title"><strong>{calendarTitle}</strong><span>{todayKey.replaceAll("-", ".")}</span></div>
        <div className="header-actions">
          <button id="theme-button" type="button" className="icon-button" aria-label="更改背景颜色" onClick={() => setShowThemes((value) => !value)}><Palette /></button>
          <button id="export-button" type="button" className="icon-button" aria-label="导出 Markdown 日历" onClick={exportData}><DownloadSimple /></button>
        </div>
        {showThemes && <ThemePicker value={data.account.theme} onChange={changeTheme} onClose={() => setShowThemes(false)} />}
      </header>

      <section className="calendar-panel" aria-label="体重月历">
        <div className="calendar-summary">
          <div><span>初始体重</span><strong>{data.account.initialWeightGrams ? formatKg(data.account.initialWeightGrams) : "未设置"}</strong>{data.account.initialWeightGrams && <small>kg</small>}</div>
          <div className="month-control">
            <button type="button" aria-label="上一个月" onClick={() => setMonth(addMonths(month, -1))}><CaretLeft /></button>
            <strong>{monthLabel(month)}</strong>
            <button type="button" aria-label="下一个月" disabled={!demo && !isMonthAfter(currentMonth, month)} onClick={() => setMonth(addMonths(month, 1))}><CaretRight /></button>
          </div>
        </div>
        <div className="weekday-row">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">
          {cells.map((cell, index) => (
            <ScaleDay
              key={cell?.key || `blank-${index}`}
              cell={cell}
              record={cell ? recordMap.get(cell.key) : null}
              todayKey={demo ? "2026-07-31" : todayKey}
              onSelect={setSelectedDate}
            />
          ))}
        </div>
        <p className="calendar-help">今天以前的日期都可以补记。红色表示增加，绿色表示减少。</p>
      </section>

      <div className="toast" role="status" aria-live="polite" data-visible={Boolean(notice)}>{notice}</div>

      {demo && (
        <div className="demo-access-gradient">
          <button id="open-my-calendar" type="button" className="primary-button demo-access-button" onClick={onOpenAccount}>
            打开我的体重日历
          </button>
        </div>
      )}

      {(needsInitial || selectedDate) && (
        <WeightSheet
          key={`${needsInitial ? "initial" : "record"}-${selectedDate || todayKey}`}
          mode={needsInitial ? "initial" : "record"}
          date={selectedDate || todayKey}
          existingGrams={selectedRecord?.weightGrams}
          busy={busy}
          onCancel={() => setSelectedDate(null)}
          onSave={saveWeight}
        />
      )}
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState("demo");
  const [showAccess, setShowAccess] = useState(false);
  const [accountData, setAccountData] = useState(null);

  const logout = async () => {
    try {
      await api("/api/sessions", { method: "DELETE" });
    } finally {
      setAccountData(null);
      setScreen("demo");
    }
  };

  if (screen === "account" && accountData) {
    return <CalendarApp key="account" initialData={accountData} demo={false} onLogout={logout} />;
  }

  return (
    <div className="app-root" data-theme="rose">
      <CalendarApp key="demo" initialData={makeDemoData()} demo onOpenAccount={() => setShowAccess(true)} />
      {showAccess && (
        <AccessPanel
          onClose={() => setShowAccess(false)}
          onSuccess={(data) => {
            setAccountData(data);
            setShowAccess(false);
            setScreen("account");
          }}
        />
      )}
    </div>
  );
}
