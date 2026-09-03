import { useEffect, useMemo, useRef, useState } from "react";
import { Calligraph } from "calligraph";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import QRCode from "qrcode";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource/ma-shan-zheng/chinese-simplified-400.css";
import "@fontsource/ma-shan-zheng/latin-400.css";
import {
  Backspace,
  ArrowLeft,
  ChartLineUp,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Check,
  DownloadSimple,
  GearSix,
  Gauge,
  LockKey,
  SignOut,
  Trash,
  Users,
  Warning,
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
  { id: "rose", label: "樱粉", color: "#f6d8df", accent: "#b94468", icon: "#f6a8c0" },
  { id: "mint", label: "薄荷", color: "#dff1e7", accent: "#34785f", icon: "#9bd7bd" },
  { id: "sky", label: "晴蓝", color: "#dcecf5", accent: "#3b7396", icon: "#a7d3e8" },
  { id: "lilac", label: "浅紫", color: "#e9e1f5", accent: "#725991", icon: "#cab7e8" },
  { id: "peach", label: "杏桃", color: "#f4e2d6", accent: "#985b3d", icon: "#edb898" },
];

const FONT_STYLES = [
  { id: "system", label: "清爽黑体", description: "默认，清晰利落" },
  { id: "serif", label: "温柔宋体", description: "有衬线，更像日记" },
  { id: "handwriting", label: "可爱手写", description: "活泼、有一点童趣" },
];

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

let appIconSourcePromise;

function loadAppIconSource() {
  if (!appIconSourcePromise) {
    appIconSourcePromise = fetch("/app-icon.svg", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error("图标资源加载失败");
      return response.text();
    });
  }
  return appIconSourcePromise;
}

function themedIconDataUrl(source, theme) {
  const svg = source
    .replaceAll(/#FCA0BA/gi, theme.icon)
    .replaceAll(/#EC5A89/gi, theme.accent);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function AppIcon({ className = "", theme }) {
  const [source, setSource] = useState("");

  useEffect(() => {
    let active = true;
    loadAppIconSource()
      .then((svg) => {
        if (active) setSource(svg);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const src = useMemo(
    () => source ? themedIconDataUrl(source, theme) : "/app-icon.svg",
    [source, theme],
  );

  return <img className={className} src={src} alt="" aria-hidden="true" />;
}

function limitCharacters(value, maximum) {
  return Array.from(value).slice(0, maximum).join("");
}

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
      fontStyle: "system",
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
  const [displayName, setDisplayName] = useState("");
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
          body: JSON.stringify({ passcode: candidate, displayName: displayName.trim() }),
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
    setDisplayName("");
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
            <div className="account-detail"><span>昵称</span><strong>{displayName.trim() || "未填写"}</strong></div>
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
              setStage("name");
              setPin("");
              setError("");
            }}>创建账户</button>
          </div>
        </section>
      </div>
    );
  }

  if (stage === "name") {
    return (
      <div className="modal-layer" role="presentation">
        <section className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="name-title">
          <button type="button" className="close-button" aria-label="关闭" onClick={onClose}><X /></button>
          <div className="auth-icon" aria-hidden="true"><Users weight="duotone" /></div>
          <h2 id="name-title">你想怎么称呼</h2>
          <p>昵称选填，填写后会显示在体重日历左上角，最多 10 个字符。</p>
          <label className="name-field">
            <span>昵称（选填）</span>
            <b>{Array.from(displayName).length}/10</b>
            <input
              id="display-name"
              type="text"
              value={displayName}
              autoComplete="nickname"
              placeholder="例如：小乔"
              autoFocus
              onChange={(event) => setDisplayName(limitCharacters(event.target.value, 10))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setStage("confirm");
                  setPin("");
                }
              }}
            />
          </label>
          <div className="auth-message" role="status">创建后会显示“{displayName.trim() ? `${displayName.trim()}的体重日历` : "我的体重日历"}”</div>
          <div className="access-actions">
            <button type="button" className="secondary-button" onClick={() => setStage("ask")}>上一步</button>
            <button
              id="confirm-name"
              type="button"
              className="primary-button"
              onClick={() => {
                setStage("confirm");
                setPin("");
                setError("");
              }}
            >继续</button>
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
          {error || (busy ? "正在确认..." : stage === "confirm" ? "再次输入相同的六位密码" : "访问会记录 IP 和大致地区，用于安全与访问统计")}
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
    <motion.div
      className="modal-layer align-end"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.section
        className="weight-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weight-title"
        initial={{ y: "100%", scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: "105%", scale: 0.985 }}
        transition={{ type: "spring", stiffness: 360, damping: 30, mass: 0.82 }}
      >
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
          <Calligraph as="strong" variant="number" animation="snappy" initial>{value || "0"}</Calligraph><span>kg</span>
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
      </motion.section>
    </motion.div>
  );
}

function ThemeOptions({ value, onChange }) {
  return (
    <div className="theme-options" aria-label="背景颜色">
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
  );
}

function FontOptions({ value, onChange }) {
  return (
    <div className="font-options" aria-label="字体风格">
      {FONT_STYLES.map((font) => (
        <button
          type="button"
          key={font.id}
          id={`font-${font.id}`}
          data-font={font.id}
          aria-pressed={value === font.id}
          onClick={() => onChange(font.id)}
        >
          <span><b>{font.label}</b><small>{font.description}</small></span>
          <strong>体重日历 58.6</strong>
          {value === font.id && <Check weight="bold" />}
        </button>
      ))}
    </div>
  );
}

function DeleteAccountDialog({ displayName, busy, onCancel, onDelete }) {
  const [step, setStep] = useState(1);
  const [confirmation, setConfirmation] = useState("");

  return (
    <div className="modal-layer" role="presentation">
      <section className="auth-panel danger-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <button type="button" className="close-button" aria-label="关闭" onClick={onCancel}><X /></button>
        <div className="auth-icon danger" aria-hidden="true"><Warning weight="duotone" /></div>
        <h2 id="delete-title">{step === 1 ? "注销账户" : "最后确认一次"}</h2>
        {step === 1 ? (
          <>
            <p>注销后，{displayName}将无法再访问原有体重记录。数据会在服务器端归档，原六位密码可被重新注册。</p>
            <div className="danger-note">这个操作对当前账户不可撤销。</div>
            <div className="access-actions">
              <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
              <button id="delete-continue" type="button" className="danger-button" onClick={() => setStep(2)}>我要继续</button>
            </div>
          </>
        ) : (
          <>
            <p>请输入“注销”。确认后会立即退出，且不能用原账户找回数据。</p>
            <label className="confirm-field">
              <span>确认文字</span>
              <input
                id="delete-confirmation"
                type="text"
                value={confirmation}
                autoComplete="off"
                placeholder="输入：注销"
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={busy}
              />
            </label>
            <div className="access-actions">
              <button type="button" className="secondary-button" onClick={() => setStep(1)} disabled={busy}>上一步</button>
              <button
                id="delete-account-confirm"
                type="button"
                className="danger-button"
                disabled={confirmation !== "注销" || busy}
                onClick={() => onDelete(confirmation)}
              >{busy ? "正在注销" : "确认注销"}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SettingsPage({ data, busy, onBack, onThemeChange, onFontChange, onExport, onLogout, onDelete }) {
  const [showDelete, setShowDelete] = useState(false);
  const displayName = data.account.displayName || "我";

  return (
    <main className="settings-shell" data-theme={data.account.theme || "rose"} data-font={data.account.fontStyle || "system"}>
      <header className="settings-header">
        <button type="button" className="icon-button" aria-label="返回体重日历" onClick={onBack}><ArrowLeft /></button>
        <div><strong>设置</strong><span>{displayName}的体重日历</span></div>
      </header>

      <div className="settings-content">
        <section className="settings-section" aria-labelledby="appearance-title">
          <h2 id="appearance-title">背景颜色</h2>
          <p>颜色会跟随账户保存。</p>
          <ThemeOptions value={data.account.theme} onChange={onThemeChange} />
        </section>

        <section className="settings-section" aria-labelledby="font-title">
          <h2 id="font-title">字体风格</h2>
          <p>字体会跟随账户保存，三款字体均使用开源许可。</p>
          <FontOptions value={data.account.fontStyle || "system"} onChange={onFontChange} />
        </section>

        <section className="settings-section" aria-labelledby="data-title">
          <h2 id="data-title">数据</h2>
          <button id="settings-export" type="button" className="settings-row" onClick={onExport}>
            <span className="settings-row-icon"><DownloadSimple /></span>
            <span><strong>导出数据</strong><small>下载按月排列的 Markdown 体重日历</small></span>
            <CaretRight />
          </button>
        </section>

        <section className="settings-section" aria-labelledby="account-title">
          <h2 id="account-title">账户</h2>
          <div className="account-summary">
            <span>昵称</span><strong>{displayName}</strong>
            <span>记录数</span><strong>{data.records.length} 条</strong>
          </div>
          <button id="settings-logout" type="button" className="settings-row" onClick={onLogout}>
            <span className="settings-row-icon"><SignOut /></span>
            <span><strong>退出登录</strong><small>保留账户和所有数据</small></span>
            <CaretRight />
          </button>
        </section>

        <section className="settings-section danger-zone" aria-labelledby="danger-title">
          <h2 id="danger-title">危险操作</h2>
          <p>注销后，当前账户将无法访问已有数据。</p>
          <button id="delete-account" type="button" className="settings-row danger-row" onClick={() => setShowDelete(true)}>
            <span className="settings-row-icon"><Trash /></span>
            <span><strong>注销账户</strong><small>归档数据并释放这个六位密码</small></span>
            <CaretRight />
          </button>
        </section>
      </div>

      {showDelete && (
        <DeleteAccountDialog
          displayName={displayName}
          busy={busy}
          onCancel={() => setShowDelete(false)}
          onDelete={onDelete}
        />
      )}
    </main>
  );
}

function ScaleDay({ cell, record, todayKey, onSelect, recentlyUpdated }) {
  if (!cell) return <div className="day-cell empty" aria-hidden="true" />;
  const unavailable = cell.key > todayKey;
  const delta = record?.deltaGrams || 0;
  const isTodayPrompt = cell.key === todayKey && !record;
  const label = record
    ? `${formatChineseDate(cell.key)}，${formatKg(record.weightGrams)} 千克${delta === 0 ? "，起点" : `，比上次${delta > 0 ? "增加" : "减少"}${formatKg(Math.abs(delta))}千克`}`
    : `${formatChineseDate(cell.key)}，${unavailable ? "不可记录" : "尚未记录"}`;

  return (
    <button
      id={`day-${cell.key}`}
      type="button"
      className={`day-cell ${record ? "recorded" : ""} ${recentlyUpdated ? "is-just-saved" : ""} ${isTodayPrompt ? "is-today-prompt" : ""}`}
      disabled={unavailable}
      onClick={() => onSelect(cell.key)}
      aria-label={label}
    >
      <span className="scale-face">
        {record ? (
          <>
            <Calligraph as="strong" variant="number" animation="bouncy" initial={recentlyUpdated}>{formatKg(record.weightGrams)}</Calligraph>
            <span className={`delta ${delta > 0 ? "rise" : delta < 0 ? "fall" : "same"}`}>
              {delta > 0 && <CaretUp weight="fill" />}
              {delta < 0 && <CaretDown weight="fill" />}
              <Calligraph variant={delta === 0 ? "text" : "number"} animation="bouncy" initial={recentlyUpdated}>
                {delta === 0 ? "起点" : `${formatKg(Math.abs(delta))}kg`}
              </Calligraph>
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

function CalendarApp({ initialData, demo, onOpenAccount, onLogout, onDeleted }) {
  const [data, setData] = useState(initialData);
  const [month, setMonth] = useState(() => demo ? new Date(2026, 6, 1) : startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(null);
  const [sheetVisible, setSheetVisible] = useState(() => !initialData.account.initialWeightGrams || !initialData.account.initialDate);
  const [feedbackDate, setFeedbackDate] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pendingSaveRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const todayKey = toDateKey(new Date());
  const needsInitial = !data.account.initialWeightGrams || !data.account.initialDate;
  const records = useMemo(() => recordsWithDeltas(data.records), [data.records]);
  const recordMap = useMemo(() => new Map(records.map((item) => [item.date, item])), [records]);
  const cells = useMemo(() => calendarCells(month), [month]);
  const selectedRecord = selectedDate ? recordMap.get(selectedDate) : null;
  const currentMonth = startOfMonth(new Date());
  const currentTheme = THEMES.find((item) => item.id === data.account.theme) || THEMES[0];
  const calendarTitle = demo
    ? "体重日历"
    : data.account.displayName
      ? `${data.account.displayName}的体重日历`
      : "我的体重日历";

  useEffect(() => {
    let active = true;
    const favicon = document.querySelector('link[data-dynamic-favicon]');
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", currentTheme.color);
    document.documentElement.style.backgroundColor = currentTheme.color;
    document.body.style.backgroundColor = currentTheme.color;
    loadAppIconSource()
      .then((source) => {
        if (!active || !favicon) return;
        favicon.setAttribute("href", themedIconDataUrl(source, currentTheme));
        favicon.setAttribute("type", "image/svg+xml");
      })
      .catch(() => {});
    return () => { active = false; };
  }, [currentTheme]);

  useEffect(() => {
    document.body.classList.toggle("calendar-screen", !showSettings);
    return () => document.body.classList.remove("calendar-screen");
  }, [showSettings]);

  useEffect(() => () => window.clearTimeout(feedbackTimerRef.current), []);

  const finishSheetExit = () => {
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    setSelectedDate(null);
    if (!pending) return;
    setData(pending.nextData);
    setMonth(startOfMonth(parseDateKey(pending.date)));
    setFeedbackDate(pending.date);
    setNotice("已保存");
    window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setFeedbackDate(null), 1100);
    window.setTimeout(() => setNotice(""), 1800);
  };

  const openWeightSheet = (date) => {
    setSelectedDate(date);
    setSheetVisible(true);
  };

  const saveWeight = async ({ date, weightGrams }) => {
    setBusy(true);
    setNotice("");
    try {
      if (demo) {
        const nextRecords = [...data.records.filter((item) => item.date !== date), { date, weightGrams, updatedAt: new Date().toISOString() }];
        pendingSaveRef.current = {
          date,
          nextData: {
            ...data,
            account: needsInitial ? { ...data.account, initialWeightGrams: weightGrams, initialDate: date } : data.account,
            records: nextRecords,
          },
        };
      } else {
        const nextData = await api(needsInitial ? "/api/profile" : "/api/records", {
          method: "PUT",
          body: JSON.stringify({ date, weightGrams }),
        });
        pendingSaveRef.current = { date, nextData };
      }
      setSheetVisible(false);
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

  const changeFont = async (fontStyle) => {
    setData((current) => ({ ...current, account: { ...current.account, fontStyle } }));
    if (!demo) {
      try {
        const nextData = await api("/api/font", { method: "PUT", body: JSON.stringify({ fontStyle }) });
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

  const deleteAccount = async (confirmation) => {
    setBusy(true);
    try {
      await api("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation }),
      });
      onDeleted();
    } catch (error) {
      setNotice(error.message);
      window.setTimeout(() => setNotice(""), 2400);
    } finally {
      setBusy(false);
    }
  };

  if (showSettings && !demo) {
    return (
      <SettingsPage
        data={data}
        busy={busy}
        onBack={() => setShowSettings(false)}
        onThemeChange={changeTheme}
        onFontChange={changeFont}
        onExport={exportData}
        onLogout={onLogout}
        onDelete={deleteAccount}
      />
    );
  }

  return (
    <main className={`app-shell ${demo ? "is-demo" : ""}`} data-theme={data.account.theme || "rose"} data-font={data.account.fontStyle || "system"}>
      <header className="app-header">
        <div className="app-brand">
          <AppIcon className="app-brand-icon" theme={currentTheme} />
          <div className="app-title"><strong>{calendarTitle}</strong><span>{todayKey.replaceAll("-", ".")}</span></div>
        </div>
        <div className="header-actions">
          {!demo && <button id="settings-button" type="button" className="icon-button" aria-label="打开设置" onClick={() => setShowSettings(true)}><GearSix /></button>}
        </div>
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
              onSelect={openWeightSheet}
              recentlyUpdated={Boolean(cell && cell.key === feedbackDate)}
            />
          ))}
        </div>
      </section>

      <div className="toast" role="status" aria-live="polite" data-visible={Boolean(notice)}>{notice}</div>

      {demo && (
        <div className="demo-access-gradient">
          <button id="open-my-calendar" type="button" className="primary-button demo-access-button" onClick={onOpenAccount}>
            打开我的体重日历
          </button>
        </div>
      )}

      <AnimatePresence onExitComplete={finishSheetExit}>
        {sheetVisible && (
          <WeightSheet
            key={`${needsInitial ? "initial" : "record"}-${selectedDate || todayKey}`}
            mode={needsInitial ? "initial" : "record"}
            date={selectedDate || todayKey}
            existingGrams={selectedRecord?.weightGrams}
            busy={busy}
            onCancel={() => setSheetVisible(false)}
            onSave={saveWeight}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function useVisitTracking(path) {
  useEffect(() => {
    void api("/api/visits", {
      method: "POST",
      body: JSON.stringify({ path }),
    }).catch(() => undefined);
  }, [path]);
}

function formatAdminTime(value) {
  if (!value) return "暂无";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatVisitLocation(visit) {
  const parts = [visit.country, visit.region, visit.city]
    .filter(Boolean)
    .filter((part, index, values) => values.indexOf(part) === index);
  return parts.join(" · ") || "暂未识别";
}

function AdminRecords({ records }) {
  if (!records.length) return <p className="admin-empty">还没有体重记录</p>;
  return (
    <div className="admin-table-wrap">
      <table>
        <thead><tr><th>日期</th><th>体重</th><th>最后更新</th></tr></thead>
        <tbody>
          {records.map((record) => (
            <tr key={`${record.date}-${record.updatedAt}`}>
              <td>{record.date}</td>
              <td>{formatKg(record.weightGrams)} kg</td>
              <td>{formatAdminTime(record.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminUser({ user, archived = false }) {
  return (
    <details className={`admin-user ${archived ? "is-archived" : ""}`}>
      <summary>
        <span><strong>{user.displayName || "未设置昵称"}</strong><small>用户 #{archived ? user.originalUserId : user.id}</small></span>
        <span className="admin-password"><small>密码</small><b>{user.passcode || "旧账户不可恢复"}</b></span>
        <span><strong>{user.records.length}</strong><small>条记录</small></span>
        {archived && <span><strong>{formatAdminTime(user.archivedAt)}</strong><small>注销时间</small></span>}
      </summary>
      <div className="admin-user-body">
        <dl className="admin-meta">
          <div><dt>初始日期</dt><dd>{user.initialDate || "未设置"}</dd></div>
          <div><dt>初始体重</dt><dd>{user.initialWeightGrams ? `${formatKg(user.initialWeightGrams)} kg` : "未设置"}</dd></div>
          <div><dt>背景</dt><dd>{THEMES.find((theme) => theme.id === user.theme)?.label || user.theme}</dd></div>
          <div><dt>字体</dt><dd>{FONT_STYLES.find((font) => font.id === user.fontStyle)?.label || "清爽黑体"}</dd></div>
          <div><dt>创建时间</dt><dd>{formatAdminTime(user.createdAt)}</dd></div>
        </dl>
        <AdminRecords records={user.records} />
      </div>
    </details>
  );
}

function AdminDashboard({ data, onRefresh, onLogout, refreshing }) {
  const stats = [
    ["正在使用", data.stats.activeUsers],
    ["已归档", data.stats.archivedUsers],
    ["体重记录", data.stats.records],
    ["今日访问", data.stats.visitsToday],
    ["7 日访问", data.stats.visits7d],
    ["7 日访客", data.stats.uniqueVisitors7d],
  ];
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><span>体重日历</span><h1>数据后台</h1></div>
        <div>
          <button type="button" className="admin-secondary" onClick={onRefresh} disabled={refreshing}>{refreshing ? "刷新中" : "刷新"}</button>
          <button type="button" className="admin-secondary" onClick={onLogout}>退出</button>
        </div>
      </header>

      <section className="admin-stats" aria-label="访问和账户概况">
        {stats.map(([label, value], index) => (
          <div key={label}><span>{index < 3 ? <Users /> : <ChartLineUp />}</span><strong>{value}</strong><small>{label}</small></div>
        ))}
      </section>

      <section className="admin-section">
        <div className="admin-section-title"><h2>注册用户</h2><span>{data.activeUsers.length} 人</span></div>
        <p className="admin-security-note">密码仅在管理登录后由服务器解密。升级前创建的账户无法恢复原密码。</p>
        <div className="admin-users">
          {data.activeUsers.length
            ? data.activeUsers.map((user) => <AdminUser key={user.id} user={user} />)
            : <p className="admin-empty">暂无注册用户</p>}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title"><h2>注销归档</h2><span>{data.archivedUsers.length} 人</span></div>
        <div className="admin-users">
          {data.archivedUsers.length
            ? data.archivedUsers.map((user) => <AdminUser key={user.id} user={user} archived />)
            : <p className="admin-empty">还没有注销账户</p>}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title"><h2>最近访问</h2><span>累计 {data.stats.totalVisits}</span></div>
        {data.recentVisits.length ? (
          <div className="admin-table-wrap">
            <table>
              <thead><tr><th>时间</th><th>页面</th><th>原始 IP</th><th>大致位置</th><th>网络</th><th>账户</th><th>设备</th></tr></thead>
              <tbody>
                {data.recentVisits.map((visit, index) => (
                  <tr key={`${visit.occurredAt}-${visit.visitorId}-${index}`}>
                    <td>{formatAdminTime(visit.occurredAt)}</td>
                    <td>{visit.path}</td>
                    <td>{visit.ipAddress || "旧记录未保存"}</td>
                    <td>{formatVisitLocation(visit)}</td>
                    <td>{visit.network || "暂未识别"}</td>
                    <td>{visit.userId ? `#${visit.userId}` : "未登录"}</td>
                    <td className="admin-agent">{visit.userAgent || "未知"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="admin-empty">暂无访问记录</p>}
      </section>
      <p className="admin-updated">最后更新：{formatAdminTime(data.generatedAt)}</p>
    </main>
  );
}

function AdminApp() {
  const [status, setStatus] = useState("loading");
  const [password, setPassword] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useVisitTracking("/data");

  useEffect(() => {
    document.title = "数据后台 | 体重日历";
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.appendChild(robots);
    }
    robots.content = "noindex,nofollow,noarchive";
  }, []);

  const loadDashboard = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/admin/dashboard");
      setDashboard(result);
      setStatus("ready");
    } catch (requestError) {
      if (requestError.status === 401) setStatus("locked");
      else setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const login = async (event) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setDashboard(result);
      setPassword("");
      setStatus("ready");
    } catch (requestError) {
      setError(requestError.message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await api("/api/admin/session", { method: "DELETE" });
    } finally {
      setDashboard(null);
      setStatus("locked");
    }
  };

  if (status === "loading") {
    return <main className="admin-login"><div className="admin-login-card"><div className="loading-calendar" /><p>正在读取后台...</p></div></main>;
  }

  if (status === "ready" && dashboard) {
    return <AdminDashboard data={dashboard} onRefresh={loadDashboard} onLogout={logout} refreshing={busy} />;
  }

  return (
    <main className="admin-login">
      <form className="admin-login-card" onSubmit={login}>
        <div className="admin-lock"><LockKey weight="duotone" /></div>
        <h1>数据后台</h1>
        <p>输入管理密码后查看账户、体重记录、注销归档和访问数据。</p>
        <label className="admin-password-field">
          <span>管理密码</span>
          <input
            id="admin-password"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <div className="admin-login-error" role={error ? "alert" : "status"}>{error}</div>
        <button id="admin-login" type="submit" className="admin-primary" disabled={!password || busy}>{busy ? "正在验证" : "进入后台"}</button>
      </form>
    </main>
  );
}

function CalendarRoot() {
  const [screen, setScreen] = useState("demo");
  const [showAccess, setShowAccess] = useState(false);
  const [accountData, setAccountData] = useState(null);
  useVisitTracking("/");

  const logout = async () => {
    try {
      await api("/api/sessions", { method: "DELETE" });
    } finally {
      setAccountData(null);
      setScreen("demo");
    }
  };

  if (screen === "account" && accountData) {
    return <CalendarApp key="account" initialData={accountData} demo={false} onLogout={logout} onDeleted={() => {
      setAccountData(null);
      setScreen("demo");
    }} />;
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

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return (
    <MotionConfig reducedMotion="user">
      {path === "/data" ? <AdminApp /> : <CalendarRoot />}
    </MotionConfig>
  );
}
