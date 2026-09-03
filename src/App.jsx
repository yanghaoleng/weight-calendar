import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Backspace,
  CalendarBlank,
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
  Sparkle,
  UserCircle,
  X,
} from "@phosphor-icons/react";
import {
  addMonths,
  calendarCells,
  formatKg,
  isMonthAfter,
  monthKey,
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

function AuthPanel({ initialMode, onClose, onSuccess }) {
  const [mode, setMode] = useState(initialMode);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setPin("");
    setError("");
  };

  const submit = async () => {
    if (pin.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(mode === "create" ? "/api/accounts" : "/api/sessions", {
        method: "POST",
        body: JSON.stringify({ passcode: pin }),
      });
      onSuccess(data);
    } catch (requestError) {
      if (requestError.code === "PASSCODE_EXISTS") {
        setError("这个六位密码已经有账户，不能重复创建");
      } else if (requestError.code === "INVALID_CREDENTIALS") {
        setError("密码不正确，请重新输入");
      } else if (requestError.code === "RATE_LIMITED") {
        setError("尝试次数太多，请稍后再试");
      } else {
        setError(requestError.message);
      }
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer" role="presentation">
      <section className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" className="close-button" aria-label="关闭" onClick={onClose}>
          <X />
        </button>
        <div className="auth-icon" aria-hidden="true"><LockKey weight="duotone" /></div>
        <h2 id="auth-title">{mode === "create" ? "创建你的账户" : "回到你的记录"}</h2>
        <p>{mode === "create" ? "设置一个没有被使用过的六位数字密码" : "输入创建账户时使用的六位密码"}</p>

        <div className="mode-switch" aria-label="账户操作">
          <button type="button" aria-pressed={mode === "create"} onClick={() => switchMode("create")}>新建</button>
          <button type="button" aria-pressed={mode === "login"} onClick={() => switchMode("login")}>登录</button>
        </div>

        <div className={`pin-dots ${error ? "has-error" : ""}`} aria-label={`已输入 ${pin.length} 位`}>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={index < pin.length ? "filled" : ""} />
          ))}
        </div>
        <div className="auth-message" role={error ? "alert" : "status"}>
          {error || (busy ? "正在确认..." : "密码只保存在服务端的加密摘要中")}
        </div>
        <Keypad value={pin} onChange={setPin} disabled={busy} />
        <button id="auth-submit" type="button" className="primary-button auth-submit" disabled={pin.length !== 6 || busy} onClick={submit}>
          {busy ? "请稍候" : mode === "create" ? "创建账户" : "进入记录"}
        </button>
      </section>
    </div>
  );
}

function CoverPreview() {
  const sample = [
    { day: "01", weight: "60.0", delta: null },
    { day: "02", weight: "59.8", delta: -0.2 },
    { day: "03", weight: "59.6", delta: -0.2 },
  ];
  return (
    <div className="cover-preview" aria-label="体重月历示意">
      <div className="preview-month"><span>初始 60.0 kg</span><strong>2026.07</strong></div>
      <div className="preview-days">
        {sample.map((item) => (
          <div className="preview-day" key={item.day}>
            <div className="preview-scale">
              <strong>{item.weight}</strong>
              {item.delta == null ? <span>起点</span> : <span className="down"><CaretDown weight="fill" />{Math.abs(item.delta).toFixed(1)}kg</span>}
            </div>
            <b>{item.day}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Cover({ onDemo, onAuth }) {
  return (
    <section className="cover-screen">
      <div className="cover-copy">
        <div className="brand-mark" aria-hidden="true"><CalendarBlank weight="duotone" /></div>
        <p className="cover-label">体重日历</p>
        <h1>按天记录，看清每一次变化</h1>
        <p className="cover-description">点开日期，记下体重。月历会自动算出与上一次记录的差值。</p>
        <div className="cover-actions">
          <button id="cover-demo" type="button" className="primary-button" onClick={onDemo}><Sparkle />查看 Demo</button>
          <button id="cover-create" type="button" className="secondary-button" onClick={() => onAuth("create")}><UserCircle />创建账户</button>
        </div>
        <button type="button" className="text-button" onClick={() => onAuth("login")}>已有账户，输入密码</button>
      </div>
      <CoverPreview />
      <p className="privacy-note">无需手机号或昵称。六位密码是你的唯一入口。</p>
    </section>
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

function ScaleDay({ cell, record, todayKey, initialDate, onSelect }) {
  if (!cell) return <div className="day-cell empty" aria-hidden="true" />;
  const unavailable = cell.key > todayKey || (initialDate && cell.key < initialDate);
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

function CalendarApp({ initialData, demo, onBackToCover, onCreateAccount, onLogout }) {
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
  const earliestMonth = data.account.initialDate ? startOfMonth(parseDateKey(data.account.initialDate)) : currentMonth;

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
    let blob;
    let filename = `体重记录-${todayKey}.json`;
    if (demo) {
      blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), demo: true, ...data }, null, 2)], { type: "application/json" });
      filename = `体重记录-Demo-${todayKey}.json`;
    } else {
      const response = await fetch("/api/export", { credentials: "same-origin" });
      if (!response.ok) {
        setNotice("导出失败，请重新登录后再试");
        return;
      }
      blob = await response.blob();
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("JSON 已导出");
  };

  return (
    <main className="app-shell" data-theme={data.account.theme || "rose"}>
      <header className="app-header">
        <button type="button" className="icon-button" aria-label={demo ? "返回封面" : "退出账户"} onClick={demo ? onBackToCover : onLogout}>
          {demo ? <ArrowLeft /> : <SignOut />}
        </button>
        <div className="app-title"><strong>体重记录</strong><span>{todayKey.replaceAll("-", ".")}</span></div>
        <div className="header-actions">
          <button id="theme-button" type="button" className="icon-button" aria-label="更改背景颜色" onClick={() => setShowThemes((value) => !value)}><Palette /></button>
          <button id="export-button" type="button" className="icon-button" aria-label="导出 JSON" onClick={exportData}><DownloadSimple /></button>
        </div>
        {showThemes && <ThemePicker value={data.account.theme} onChange={changeTheme} onClose={() => setShowThemes(false)} />}
      </header>

      {demo && <div className="demo-banner"><Sparkle weight="fill" />这是可操作的 Demo，修改只保留在当前页面<button type="button" onClick={onCreateAccount}>创建账户</button></div>}

      <section className="calendar-panel" aria-label="体重月历">
        <div className="calendar-summary">
          <div><span>初始体重</span><strong>{data.account.initialWeightGrams ? formatKg(data.account.initialWeightGrams) : "未设置"}</strong>{data.account.initialWeightGrams && <small>kg</small>}</div>
          <div className="month-control">
            <button type="button" aria-label="上一个月" disabled={!demo && monthKey(month) <= monthKey(earliestMonth)} onClick={() => setMonth(addMonths(month, -1))}><CaretLeft /></button>
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
              initialDate={data.account.initialDate}
              onSelect={setSelectedDate}
            />
          ))}
        </div>
        <p className="calendar-help">点击日期记录或修改体重。红色表示增加，绿色表示减少。</p>
      </section>

      <div className="toast" role="status" aria-live="polite" data-visible={Boolean(notice)}>{notice}</div>

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
  const [screen, setScreen] = useState("checking");
  const [authMode, setAuthMode] = useState(null);
  const [accountData, setAccountData] = useState(null);

  useEffect(() => {
    api("/api/me")
      .then((data) => {
        setAccountData(data);
        setScreen("account");
      })
      .catch((error) => {
        if (error.status !== 401) console.error(error);
        setScreen("cover");
      });
  }, []);

  const logout = async () => {
    try {
      await api("/api/sessions", { method: "DELETE" });
    } finally {
      setAccountData(null);
      setScreen("cover");
    }
  };

  if (screen === "checking") {
    return <main className="loading-screen"><div className="loading-calendar" /><p>正在打开体重日历</p></main>;
  }

  if (screen === "demo") {
    return (
      <CalendarApp
        initialData={makeDemoData()}
        demo
        onBackToCover={() => setScreen("cover")}
        onCreateAccount={() => {
          setScreen("cover");
          setAuthMode("create");
        }}
      />
    );
  }

  if (screen === "account" && accountData) {
    return <CalendarApp initialData={accountData} demo={false} onLogout={logout} />;
  }

  return (
    <main className="public-shell" data-theme="rose">
      <Cover onDemo={() => setScreen("demo")} onAuth={setAuthMode} />
      {authMode && (
        <AuthPanel
          initialMode={authMode}
          onClose={() => setAuthMode(null)}
          onSuccess={(data) => {
            setAccountData(data);
            setAuthMode(null);
            setScreen("account");
          }}
        />
      )}
    </main>
  );
}
