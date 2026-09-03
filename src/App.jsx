import { useEffect, useMemo, useRef, useState } from "react";
import { Calligraph } from "calligraph";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import QRCode from "qrcode";
import { createUISFX } from "uisfx";
import "@fontsource-variable/lora/wght.css";
import "@fontsource-variable/fredoka/wght.css";
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
  ForkKnife,
  GearSix,
  Gauge,
  Heart,
  LockKey,
  MoonStars,
  PersonSimpleRun,
  Sparkle,
  SpeakerHigh,
  SpeakerSlash,
  SignOut,
  Trash,
  Users,
  Warning,
  WechatLogo,
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
  { id: "system", label: "System UI", description: "默认西文字体" },
  { id: "serif", label: "Lora", description: "温和的衬线西文" },
  { id: "handwriting", label: "Fredoka", description: "圆润可爱的西文" },
];

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const DONATION_THANKS_COPIES = [
  "谢谢认真记录、认真生活的你！",
  "能把变化一天天记下来，你真的很有耐心。",
  "谢谢你让这本小日历有机会陪你久一点。",
  "愿意长期记录的人，都有一种安静的厉害。",
  "数字会变化，你对自己的耐心更珍贵。",
  "谢谢你用行动支持一个小而认真的产品。",
  "你不是在追赶数字，你是在慢慢了解自己。",
  "谢谢你愿意为喜欢的小工具送上一份鼓励。",
  "你的支持，会变成下一次更顺手的更新。",
  "谢谢你和体重日历一起，把小事认真做下去。",
];

const SETTINGS_PAGE_ACTIVE = { opacity: 1, x: 0 };
const SETTINGS_PAGE_ENTER = { opacity: 0, x: 22 };
const SETTINGS_PAGE_EXIT_BACK = { opacity: 0, x: 22 };
const SETTINGS_PAGE_EXIT_FORWARD = { opacity: 0, x: -18 };
const SETTINGS_PAGE_TRANSITION = { duration: 0.24, ease: [0.22, 1, 0.36, 1] };

const uiSfx = createUISFX({
  pack: "zen",
  volume: 0.65,
  preferences: { key: "weight-calendar:sound" },
});

function playSfx(cue, options) {
  try {
    return uiSfx.play(cue, options);
  } catch {
    return null;
  }
}

function useInterfaceSounds() {
  useEffect(() => {
    const unlock = () => {
      void uiSfx.unlock();
    };
    const playControlSound = (event) => {
      const control = event.target instanceof Element ? event.target.closest("button") : null;
      if (control && !control.disabled) playSfx(control.dataset.sfx || "press");

      const summary = event.target instanceof Element ? event.target.closest("summary") : null;
      if (summary) playSfx(summary.parentElement?.open ? "collapse" : "expand");
    };

    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    document.addEventListener("click", playControlSound);
    return () => {
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      document.removeEventListener("click", playControlSound);
    };
  }, []);
}

function useNumericKeyboard({ value, onChange, disabled = false, onEnter }) {
  useEffect(() => {
    if (disabled) return undefined;
    const handleKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        if (value.length < 6) {
          playSfx("typing");
          onChange(`${value}${event.key}`);
        }
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        if (value.length > 0) {
          playSfx("deselect");
          onChange(value.slice(0, -1));
        }
        return;
      }
      if (event.key === "Enter" && onEnter) {
        event.preventDefault();
        onEnter();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, onChange, onEnter, value]);
}

function AppIcon({ className = "", theme }) {
  const themeId = theme?.id || THEMES[0].id;
  return <img className={className} src={`/app-icon-${themeId}.webp`} alt="" aria-hidden="true" draggable="false" />;
}

function InteractiveAppIcon({ theme }) {
  const [motionMode, setMotionMode] = useState("enter");
  const replayFrameRef = useRef(null);

  useEffect(() => {
    return () => window.cancelAnimationFrame(replayFrameRef.current);
  }, []);

  const replayMotion = () => {
    window.cancelAnimationFrame(replayFrameRef.current);
    setMotionMode("idle");
    replayFrameRef.current = window.requestAnimationFrame(() => {
      replayFrameRef.current = window.requestAnimationFrame(() => setMotionMode("bounce"));
    });
  };

  return (
    <button
      className="app-brand-icon-button"
      type="button"
      aria-label="重播体重秤图标动画"
      title="点一下，让体重秤弹一弹"
      onClick={replayMotion}
    >
      <AppIcon className={`app-brand-icon app-brand-icon--${motionMode}`} theme={theme} />
    </button>
  );
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

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) throw new Error("复制失败");
}

function makeDemoData() {
  const weights = [61000, 59900, 59700, 59400, 59100, 58400, 58100, 58000, 57300, 60000, 59800, 59700, 59600, 59500, 59100, 58900];
  return {
    account: {
      theme: "rose",
      fontStyle: "system",
      heightCm: null,
      bodyFatPercent: null,
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

function formatShortChineseDate(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  return `${date.getMonth() + 1}月${date.getDate()}号`;
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
        <button data-sfx="typing" id={`pin-key-${digit}`} key={digit} type="button" onClick={() => push(digit)} disabled={disabled}>
          {digit}
        </button>
      ))}
      <span aria-hidden="true" />
      <button data-sfx="typing" id="pin-key-0" type="button" onClick={() => push(0)} disabled={disabled}>0</button>
      <button
        type="button"
        id="pin-key-delete"
        data-sfx="deselect"
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

function AccessDialogFrame({ children, panelClassName = "", labelledBy }) {
  return (
    <motion.div
      className="modal-layer"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.section
        className={`auth-panel ${panelClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 29, mass: 0.8 }}
      >
        {children}
      </motion.section>
    </motion.div>
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
        playSfx("unlock");
        onSuccess(data);
        return;
      }

      if (stage === "confirm") {
        if (candidate !== firstPin) {
          playSfx("error");
          setError("两次输入的密码不一致，请重新输入");
          setPin("");
          return;
        }
        playSfx("forward");
        setPin("");
        setStage("name");
      }
    } catch (requestError) {
      if (requestError.code === "INVALID_CREDENTIALS" && stage === "enter") {
        playSfx("info");
        setFirstPin(candidate);
        setPin("");
        setStage("ask");
      } else if (requestError.code === "PASSCODE_EXISTS") {
        playSfx("error");
        setFirstPin("");
        setPin("");
        setStage("enter");
        setError("这个密码刚刚被使用了，请重新输入");
      } else if (requestError.code === "RATE_LIMITED") {
        playSfx("blocked");
        setError("尝试次数太多，请稍后再试");
        setPin("");
      } else {
        playSfx("error");
        setError(requestError.message);
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ passcode: firstPin, displayName: displayName.trim() }),
      });
      setCreatedData(data);
      playSfx("success");
      setStage("created");
    } catch (requestError) {
      if (requestError.code === "PASSCODE_EXISTS") {
        playSfx("error");
        setFirstPin("");
        setPin("");
        setStage("enter");
        setError("这个密码刚刚被使用了，请重新输入");
      } else if (requestError.code === "RATE_LIMITED") {
        playSfx("blocked");
        setError("尝试次数太多，请稍后再试");
      } else {
        playSfx("error");
        setError(requestError.message);
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

  useNumericKeyboard({
    value: pin,
    onChange: updatePin,
    disabled: busy || (stage !== "enter" && stage !== "confirm"),
  });

  if (stage === "created") {
    return (
      <AccessDialogFrame panelClassName="created-panel" labelledBy="created-title">
          <div className="auth-icon success" aria-hidden="true"><Check weight="bold" /></div>
          <h2 id="created-title">账户已经创建</h2>

          <div className="qr-card">
            {qrData
              ? <img id="account-qr" src={qrData} alt={`打开 ${accountUrl} 的二维码`} />
              : <div className="qr-loading" aria-label="正在生成二维码" />}
            <small>{accountUrl}</small>
          </div>

          <div className="account-details">
            <div className="account-detail"><span>昵称</span><strong>{displayName.trim() || "未填写"}</strong></div>
            <div className="account-detail password-detail"><span>密码</span><strong>{firstPin}</strong></div>
          </div>
          <div className="auth-message" role={error ? "alert" : "status"}>{error}</div>
          <button data-sfx="complete" id="screenshot-confirm" type="button" className="primary-button screenshot-button" onClick={() => onSuccess(createdData)}>
            <Check weight="bold" />已截图
          </button>
      </AccessDialogFrame>
    );
  }

  if (stage === "ask") {
    return (
      <AccessDialogFrame labelledBy="auth-title">
          <button data-sfx="close" type="button" className="close-button" aria-label="关闭" onClick={onClose}><X /></button>
          <div className="auth-icon plain" aria-hidden="true"><LockKey weight="duotone" /></div>
          <h2 id="auth-title">没有找到这个账户</h2>
          <p>要用刚才输入的六位密码创建一个新账户吗？</p>
          <div className="masked-pin" aria-label="已记住六位密码">
            {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
          </div>
          <div className="access-actions">
            <button data-sfx="back" type="button" className="secondary-button" onClick={restart}>重新输入</button>
            <button data-sfx="forward" id="confirm-create" type="button" className="primary-button" onClick={() => {
              setStage("confirm");
              setPin("");
              setError("");
            }}>创建账户</button>
          </div>
      </AccessDialogFrame>
    );
  }

  if (stage === "name") {
    return (
      <AccessDialogFrame labelledBy="name-title">
          <button data-sfx="close" type="button" className="close-button" aria-label="关闭" onClick={onClose}><X /></button>
          <div className="auth-icon" aria-hidden="true"><Users weight="duotone" /></div>
          <h2 id="name-title">您的称呼</h2>
          <label className="name-field">
            <input
              id="display-name"
              type="text"
              value={displayName}
              autoComplete="nickname"
              placeholder="选填，后面可在设置里修改"
              autoFocus
              aria-label="昵称（选填）"
              onChange={(event) => {
                playSfx("typing");
                setDisplayName(limitCharacters(event.target.value, 10));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  void createAccount();
                }
              }}
            />
          </label>
          <div className="access-actions">
            <button data-sfx="back" type="button" className="secondary-button" onClick={() => {
              setStage("confirm");
              setPin("");
              setError("");
            }} disabled={busy}>上一步</button>
            <button
              data-sfx="forward"
              id="confirm-name"
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void createAccount()}
            >{busy ? "正在创建..." : displayName.trim() ? "继续" : "跳过"}</button>
          </div>
          {error && <div className="auth-message" role="alert">{error}</div>}
      </AccessDialogFrame>
    );
  }

  return (
    <AccessDialogFrame labelledBy="auth-title">
        <button data-sfx="close" type="button" className="close-button" aria-label="关闭" onClick={onClose}>
          <X />
        </button>
        <div className="auth-icon plain" aria-hidden="true"><LockKey weight="duotone" /></div>
        <h2 id="auth-title">{stage === "confirm" ? "再输入一次密码" : "打开我的体重日历"}</h2>
        {stage === "confirm" && <p>请再次输入，确认你记住了这组六位密码</p>}

        <div className={`pin-dots ${error ? "has-error" : ""}`} aria-label={`已输入 ${pin.length} 位`}>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={index < pin.length ? "filled" : ""} />
          ))}
        </div>
        {(error || busy || stage === "confirm") && (
          <div className="auth-message" role={error ? "alert" : "status"}>
            {error || (busy ? "正在确认..." : "再次输入相同的六位密码")}
          </div>
        )}
        <Keypad value={pin} onChange={updatePin} disabled={busy} />
    </AccessDialogFrame>
  );
}

function WeightKeypad({ value, onChange, replaceOnNextInput, onInputStarted }) {
  const push = (key) => {
    if (replaceOnNextInput) {
      onInputStarted();
      if (key === "delete") {
        onChange("");
      } else if (key === ".") {
        onChange("0.");
      } else {
        onChange(key);
      }
      return;
    }
    if (key === "delete") {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === ".") {
      if (!value.includes(".") && value.length > 0 && Number(value) < 999) onChange(`${value}.`);
      return;
    }
    const [whole, decimal = ""] = value.split(".");
    if (value.includes(".") && decimal.length >= 1) return;
    if (!value.includes(".") && whole.length >= 3) return;
    const nextValue = `${value}${key}`;
    if (Number(nextValue) <= 999) onChange(nextValue);
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "delete"];
  return (
    <div className="weight-keypad" aria-label="体重数字键盘">
      {keys.map((key) => (
        <button data-sfx={key === "delete" ? "deselect" : "typing"} id={`weight-key-${key === "." ? "decimal" : key}`} key={key} type="button" onClick={() => push(key)} aria-label={key === "delete" ? "删除一位" : key}>
          {key === "delete" ? <Backspace /> : key}
        </button>
      ))}
    </div>
  );
}

function WeightSheet({ date, existingGrams, busy, onCancel, onSave }) {
  const initialValue = existingGrams ? formatKg(existingGrams) : "";
  const [value, setValue] = useState(initialValue);
  const [replaceOnNextInput, setReplaceOnNextInput] = useState(Boolean(existingGrams));
  const kilograms = Number(value);
  const isClearing = value !== "" && kilograms === 0;
  const valid = value !== ""
    && Number.isFinite(kilograms)
    && kilograms <= 999
    && kilograms >= 0;
  const closeFromDrag = (_, info) => {
    if (info.offset.y > 92 || info.velocity.y > 680) {
      playSfx("swipe");
      onCancel();
    } else {
      playSfx("snap");
    }
  };

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
        drag={busy ? false : "y"}
        dragConstraints={{ top: 0, bottom: 280 }}
        dragElastic={{ top: 0, bottom: 0.24 }}
        dragMomentum={false}
        dragSnapToOrigin
        onDragStart={() => playSfx("drag-start")}
        onDragEnd={closeFromDrag}
      >
        <button data-sfx="close" type="button" className="close-button" aria-label="关闭" onClick={onCancel}><X /></button>
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="weight-title">
          {`${existingGrams ? "修改记录" : "记录"}：${formatShortChineseDate(date)}`}
        </h2>
        <div className="weight-display" aria-live="polite">
          <strong>{value || "0"}</strong><span>kg</span>
        </div>
        <WeightKeypad
          value={value}
          onChange={setValue}
          replaceOnNextInput={replaceOnNextInput}
          onInputStarted={() => setReplaceOnNextInput(false)}
        />
        <button
          type="button"
          id="weight-save"
          className="primary-button sheet-save"
          disabled={!valid || busy}
          onClick={() => onSave({ date, weightGrams: Math.round(kilograms * 1000) })}
        >
          {isClearing ? <Trash weight="bold" /> : <Check weight="bold" />}
          {busy ? (isClearing ? "清空中" : "保存中") : (isClearing ? "清空当天记录" : "保存体重")}
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
            data-sfx="select"
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
          data-sfx="select"
          data-font={font.id}
          aria-pressed={value === font.id}
          onClick={() => onChange(font.id)}
        >
          <span><b>{font.label}</b><small>{font.description}</small></span>
          <strong>Weight 58.6</strong>
          {value === font.id && <Check weight="bold" />}
        </button>
      ))}
    </div>
  );
}

function DeleteAccountDialog({ displayName, busy, onCancel, onDelete }) {
  const [step, setStep] = useState(1);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");

  const updatePasscode = (nextPasscode) => {
    setPasscode(nextPasscode);
    setError("");
  };

  const confirmDelete = async () => {
    if (passcode.length !== 6 || busy) return;
    setError("");
    try {
      await onDelete(passcode);
    } catch (requestError) {
      setPasscode("");
      setError(requestError.message);
    }
  };

  useNumericKeyboard({
    value: passcode,
    onChange: updatePasscode,
    disabled: busy || step !== 2,
    onEnter: confirmDelete,
  });

  return (
    <div className="modal-layer" role="presentation">
      <section className="auth-panel danger-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <button data-sfx="close" type="button" className="close-button" aria-label="关闭" onClick={onCancel}><X /></button>
        <div className="auth-icon danger" aria-hidden="true"><Warning weight="duotone" /></div>
        <h2 id="delete-title">{step === 1 ? "注销账户" : "最后确认一次"}</h2>
        {step === 1 ? (
          <>
            <p>注销后，{displayName}将无法再访问以前的体重记录。</p>
            <div className="danger-note">此操作不可撤销，请使用当前密码再次确认。</div>
            <div className="access-actions">
              <button data-sfx="cancel" type="button" className="secondary-button" onClick={onCancel}>取消</button>
              <button data-sfx="warning" id="delete-continue" type="button" className="danger-button" onClick={() => {
                setStep(2);
                setPasscode("");
                setError("");
              }}>我要继续</button>
            </div>
          </>
        ) : (
          <>
            <p>请输入当前账户的六位密码。</p>
            <div className={`pin-dots ${error ? "has-error" : ""}`} aria-label={`已输入 ${passcode.length} 位`}>
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} className={index < passcode.length ? "filled" : ""} />
              ))}
            </div>
            <div className="auth-message" role={error ? "alert" : "status"}>{error || (busy ? "正在确认..." : "")}</div>
            <Keypad value={passcode} onChange={updatePasscode} disabled={busy} />
            <div className="access-actions">
              <button data-sfx="back" type="button" className="secondary-button" onClick={() => {
                setStep(1);
                setPasscode("");
                setError("");
              }} disabled={busy}>上一步</button>
              <button
                data-sfx="warning"
                id="delete-account-confirm"
                type="button"
                className="danger-button"
                disabled={passcode.length !== 6 || busy}
                onClick={confirmDelete}
              >{busy ? "正在注销" : "确认注销"}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function bodyFatEstimate(value) {
  if (value < 16) return "偏瘦";
  if (value <= 28) return "适中";
  return "偏胖";
}

function ProfileSlider({ id, label, value, minimum, maximum, unit, onChange, helper }) {
  return (
    <label className="profile-slider" htmlFor={id}>
      <span><b>{label}</b><strong>{value}<small>{unit}</small></strong></span>
      <input
        id={id}
        type="range"
        min={minimum}
        max={maximum}
        step="1"
        value={value}
        onChange={(event) => {
          playSfx("volume-change");
          onChange(Number(event.target.value));
        }}
      />
      {helper && <small>{helper}</small>}
    </label>
  );
}

function AIAnalysisPage({ data, onBack, onAnalyze }) {
  const [heightCm, setHeightCm] = useState(data.account.heightCm || 170);
  const [bodyFatPercent, setBodyFatPercent] = useState(data.account.bodyFatPercent || 22);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const analyze = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const processing = playSfx("processing");
    try {
      const result = await onAnalyze({ heightCm, bodyFatPercent });
      setAnalysis(result.analysis);
      playSfx("complete");
    } catch (requestError) {
      setError(requestError.message);
      playSfx("error");
    } finally {
      processing?.stop();
      setBusy(false);
    }
  };

  const sections = analysis ? [
    { key: "diet", title: "饮食", icon: <ForkKnife />, items: analysis.diet },
    { key: "exercise", title: "运动", icon: <PersonSimpleRun />, items: analysis.exercise },
    { key: "sleep", title: "睡眠", icon: <MoonStars />, items: analysis.sleep },
  ] : [];

  return (
    <motion.main
      className="settings-shell ai-analysis-shell"
      data-theme={data.account.theme || "rose"}
      data-font={data.account.fontStyle || "system"}
      data-page-leaving={isLeaving}
      initial={SETTINGS_PAGE_ENTER}
      animate={isLeaving ? SETTINGS_PAGE_EXIT_BACK : SETTINGS_PAGE_ACTIVE}
      transition={SETTINGS_PAGE_TRANSITION}
      onAnimationComplete={() => { if (isLeaving) onBack(); }}
    >
      <header className="settings-header">
        <button data-sfx="back" type="button" className="icon-button" aria-label="返回设置" disabled={isLeaving} onClick={() => setIsLeaving(true)}><ArrowLeft /></button>
        <div><strong>AI 体重分析</strong><span>豆包 Seed 2.0 Mini</span></div>
      </header>

      <div className="ai-analysis-content">
        <section className="settings-section ai-profile-card" aria-labelledby="ai-profile-title">
          <div className="ai-section-heading">
            <span><Sparkle weight="fill" /></span>
            <div><h2 id="ai-profile-title">补充基础数据</h2><p>结合近期体重记录，生成一份简洁建议。</p></div>
          </div>
          <div className="profile-sliders">
            <ProfileSlider id="height-slider" label="身高" value={heightCm} minimum={120} maximum={230} unit="cm" onChange={setHeightCm} />
            <ProfileSlider
              id="body-fat-slider"
              label="估算体脂率"
              value={bodyFatPercent}
              minimum={3}
              maximum={60}
              unit="%"
              onChange={setBodyFatPercent}
              helper={`参考：${bodyFatEstimate(bodyFatPercent)}，不区分年龄与性别，仅供估算输入`}
            />
          </div>
          <button id="run-ai-analysis" type="button" className="primary-button ai-analyze-button" onClick={analyze} disabled={busy}>
            <Sparkle weight="fill" />{busy ? "正在分析" : "AI 分析"}
          </button>
          <div className="ai-error" role={error ? "alert" : "status"}>{error}</div>
        </section>

        {analysis && (
          <motion.section className="ai-result" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <p className="ai-summary">{analysis.summary}</p>
            <div className="ai-advice-grid">
              {sections.map((section) => (
                <article key={section.key}>
                  <header><span>{section.icon}</span><h2>{section.title}</h2></header>
                  <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
                </article>
              ))}
            </div>
            <p className="ai-disclaimer">内容仅作一般生活方式参考，不替代医生、营养师或其他专业人士的判断。</p>
          </motion.section>
        )}
      </div>
    </motion.main>
  );
}

function DonationPage({ data, onBack }) {
  const [method, setMethod] = useState("wechat");
  const [copyStatus, setCopyStatus] = useState("");
  const [qrFailed, setQrFailed] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [thanksCopy] = useState(
    () => DONATION_THANKS_COPIES[Math.floor(Math.random() * DONATION_THANKS_COPIES.length)],
  );
  const isWechat = method === "wechat";

  useEffect(() => {
    setQrFailed(false);
  }, [method]);

  const copyAuthorWechat = async () => {
    try {
      await copyText("yanghaoleng");
      setCopyStatus("已复制微信号 yanghaoleng");
      playSfx("success");
    } catch {
      setCopyStatus("复制失败，请手动复制 yanghaoleng");
      playSfx("error");
    }
  };

  return (
    <motion.main
      className="settings-shell donation-shell"
      data-theme={data.account.theme || "rose"}
      data-font={data.account.fontStyle || "system"}
      data-page-leaving={isLeaving}
      initial={SETTINGS_PAGE_ENTER}
      animate={isLeaving ? SETTINGS_PAGE_EXIT_BACK : SETTINGS_PAGE_ACTIVE}
      transition={SETTINGS_PAGE_TRANSITION}
      onAnimationComplete={() => { if (isLeaving) onBack(); }}
    >
      <header className="settings-header">
        <button data-sfx="back" type="button" className="icon-button" aria-label="返回设置" disabled={isLeaving} onClick={() => setIsLeaving(true)}><ArrowLeft /></button>
        <div><strong>打赏作者</strong><span>自愿支持体重日历</span></div>
      </header>

      <div className="donation-page-content">
        <section className="settings-section donation-card" aria-labelledby="donation-title">
          <span className="donation-heart" aria-hidden="true"><Heart weight="fill" /></span>
          <h2 id="donation-title">谢谢你的支持</h2>
          <p className="donation-intro">如果这个小工具帮你记录体重轻松了一点，请随意打赏。</p>
          <motion.p
            className="donation-thanks-copy"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
          >{thanksCopy}</motion.p>

          <div className="donation-tabs" role="tablist" aria-label="选择打赏方式">
            <button
              id="donation-tab-wechat"
              data-sfx="select"
              type="button"
              role="tab"
              aria-selected={isWechat}
              aria-controls="donation-qr-panel"
              className={isWechat ? "is-selected" : ""}
              onClick={() => setMethod("wechat")}
            ><WechatLogo weight="fill" />微信</button>
            <button
              id="donation-tab-alipay"
              data-sfx="select"
              type="button"
              role="tab"
              aria-selected={!isWechat}
              aria-controls="donation-qr-panel"
              className={!isWechat ? "is-selected" : ""}
              onClick={() => setMethod("alipay")}
            ><span className="alipay-mark" aria-hidden="true">支</span>支付宝</button>
          </div>

          <div
            id="donation-qr-panel"
            className="donation-qr-panel"
            role="tabpanel"
            aria-labelledby={isWechat ? "donation-tab-wechat" : "donation-tab-alipay"}
          >
            {!qrFailed ? (
              <img
                key={method}
                src={`${import.meta.env.BASE_URL}donate/${isWechat ? "wechat-appreciation-code.jpg" : "alipay-qr.webp"}`}
                alt={isWechat ? "作者的微信赞赏码" : "作者的支付宝打赏二维码"}
                onError={() => setQrFailed(true)}
                draggable="false"
              />
            ) : (
              <p className="donation-qr-error" role="alert">二维码加载失败，请刷新后再试。</p>
            )}
          </div>
          <p className="donation-contact">
            如果你有任何建议反馈，都可以联系我：
            <button data-sfx="copy" type="button" onClick={copyAuthorWechat}>复制微信号（yanghaoleng）</button>
          </p>
          <p className="donation-copy-status" role="status" aria-live="polite">{copyStatus}</p>
        </section>
      </div>
    </motion.main>
  );
}

function SettingsPage({ data, busy, notice, onBack, onThemeChange, onFontChange, onDisplayNameChange, onAnalyze, onExport, onLogout, onDelete }) {
  const [showDelete, setShowDelete] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showDonation, setShowDonation] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => uiSfx.isEnabled());
  const [nickname, setNickname] = useState(data.account.displayName || "");
  const [isLeaving, setIsLeaving] = useState(false);
  const [pendingView, setPendingView] = useState(null);
  const displayName = data.account.displayName || "我";
  const normalizedNickname = nickname.trim();

  useEffect(() => {
    setNickname(data.account.displayName || "");
  }, [data.account.displayName]);

  const toggleSounds = () => {
    const nextEnabled = !soundEnabled;
    uiSfx.setEnabled(nextEnabled);
    setSoundEnabled(nextEnabled);
    if (nextEnabled) playSfx("toggle-on");
  };

  const leaveSettings = (destination) => {
    if (isLeaving) return;
    setPendingView(destination);
    setIsLeaving(true);
  };

  const finishSettingsExit = () => {
    if (!isLeaving) return;
    if (pendingView === "calendar") {
      onBack();
      return;
    }
    if (pendingView === "ai") setShowAi(true);
    if (pendingView === "donation") setShowDonation(true);
    setPendingView(null);
    setIsLeaving(false);
  };

  if (showAi) {
    return <AIAnalysisPage data={data} onBack={() => setShowAi(false)} onAnalyze={onAnalyze} />;
  }

  if (showDonation) {
    return <DonationPage data={data} onBack={() => setShowDonation(false)} />;
  }

  return (
    <motion.main
      className="settings-shell"
      data-theme={data.account.theme || "rose"}
      data-font={data.account.fontStyle || "system"}
      data-page-leaving={isLeaving}
      initial={SETTINGS_PAGE_ENTER}
      animate={isLeaving ? (pendingView === "calendar" ? SETTINGS_PAGE_EXIT_BACK : SETTINGS_PAGE_EXIT_FORWARD) : SETTINGS_PAGE_ACTIVE}
      transition={SETTINGS_PAGE_TRANSITION}
      onAnimationComplete={finishSettingsExit}
    >
      <header className="settings-header">
        <button data-sfx="back" type="button" className="icon-button" aria-label="返回体重日历" disabled={isLeaving} onClick={() => leaveSettings("calendar")}><ArrowLeft /></button>
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
          <p>仅切换西文字体，中文始终使用系统黑体。</p>
          <FontOptions value={data.account.fontStyle || "system"} onChange={onFontChange} />
        </section>

        <section className="settings-section" aria-labelledby="sound-title">
          <h2 id="sound-title">声音</h2>
          <button
            id="settings-sound"
            type="button"
            className="settings-row"
            aria-pressed={soundEnabled}
            onClick={toggleSounds}
          >
            <span className="settings-row-icon">{soundEnabled ? <SpeakerHigh /> : <SpeakerSlash />}</span>
            <span><strong>操作音效</strong><small>Zen 风格轻音效，设置保存在当前设备</small></span>
            <span className={`settings-toggle ${soundEnabled ? "is-on" : ""}`} aria-hidden="true"><i /></span>
          </button>
        </section>

        <section className="settings-section" aria-labelledby="ai-title">
          <h2 id="ai-title">AI 分析</h2>
          <button data-sfx="open" id="settings-ai-analysis" type="button" className="settings-row" onClick={() => leaveSettings("ai")}>
            <span className="settings-row-icon"><Sparkle weight="fill" /></span>
            <span><strong>体重健康建议</strong><small>结合身高、估算体脂和近期记录</small></span>
            <CaretRight />
          </button>
        </section>

        <section className="settings-section" aria-labelledby="data-title">
          <h2 id="data-title">数据</h2>
          <button data-sfx="complete" id="settings-export" type="button" className="settings-row" onClick={onExport}>
            <span className="settings-row-icon"><DownloadSimple /></span>
            <span><strong>导出数据</strong><small>下载 {data.records.length} 条，按月排列的 Markdown 体重记录</small></span>
            <CaretRight />
          </button>
        </section>

        <section className="settings-section" aria-labelledby="support-title">
          <h2 id="support-title">支持</h2>
          <button data-sfx="open" id="settings-donation" type="button" className="settings-row" onClick={() => leaveSettings("donation")}>
            <span className="settings-row-icon"><Heart weight="fill" /></span>
            <span><strong>打赏作者</strong><small>微信或支付宝，自愿支持体重日历</small></span>
            <CaretRight />
          </button>
        </section>

        <section className="settings-section" aria-labelledby="account-title">
          <h2 id="account-title">账户</h2>
          <label className="nickname-settings-field">
            <span>昵称</span>
            <div>
              <input
                id="settings-nickname"
                type="text"
                value={nickname}
                maxLength={10}
                placeholder="未填写"
                autoComplete="nickname"
                onChange={(event) => {
                  playSfx("typing");
                  setNickname(limitCharacters(event.target.value, 10));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && normalizedNickname !== (data.account.displayName || "")) {
                    event.preventDefault();
                    void onDisplayNameChange(nickname);
                  }
                }}
                disabled={busy}
              />
              <button
                data-sfx="success"
                id="settings-nickname-save"
                type="button"
                className="secondary-button"
                disabled={busy || normalizedNickname === (data.account.displayName || "")}
                onClick={() => onDisplayNameChange(nickname)}
              >{busy ? "保存中" : "保存"}</button>
            </div>
          </label>
          <button data-sfx="lock" id="settings-logout" type="button" className="settings-row" onClick={onLogout}>
            <span className="settings-row-icon"><SignOut /></span>
            <span><strong>退出登录</strong><small>保留账户和所有数据</small></span>
            <CaretRight />
          </button>
          <button data-sfx="warning" id="delete-account" type="button" className="settings-row danger-row" onClick={() => setShowDelete(true)}>
            <span className="settings-row-icon"><Trash /></span>
            <span><strong>注销账户</strong></span>
            <CaretRight />
          </button>
        </section>
      </div>

      <div className="toast" role="status" aria-live="polite" data-visible={Boolean(notice)}>{notice}</div>

      {showDelete && (
        <DeleteAccountDialog
          displayName={displayName}
          busy={busy}
          onCancel={() => setShowDelete(false)}
          onDelete={onDelete}
        />
      )}
    </motion.main>
  );
}

function ScaleDay({ cell, record, todayKey, onSelect, recentlyUpdated }) {
  const [blocked, setBlocked] = useState(false);
  if (!cell) return <div className="day-cell empty" aria-hidden="true" />;
  const unavailable = cell.key > todayKey;
  const delta = record?.deltaGrams || 0;
  const isTodayPrompt = cell.key === todayKey && !record;
  const label = record
    ? `${formatChineseDate(cell.key)}，${formatKg(record.weightGrams)} 千克${delta === 0 ? "，起点" : `，比上次${delta > 0 ? "增加" : "减少"}${formatKg(Math.abs(delta))}千克`}`
    : `${formatChineseDate(cell.key)}，${unavailable ? "不可记录" : "尚未记录"}`;

  const selectDate = () => {
    if (!unavailable) {
      onSelect(cell.key);
      return;
    }
    setBlocked(false);
    window.requestAnimationFrame(() => setBlocked(true));
  };

  return (
    <button
      id={`day-${cell.key}`}
      type="button"
      className={`day-cell ${record ? "recorded" : ""} ${unavailable ? "is-unavailable" : ""} ${blocked ? "is-blocked" : ""} ${recentlyUpdated ? "is-just-saved" : ""} ${isTodayPrompt ? "is-today-prompt" : ""}`}
      aria-disabled={unavailable}
      data-sfx={unavailable ? "blocked" : "open"}
      onClick={selectDate}
      onAnimationEnd={() => setBlocked(false)}
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
  const [monthDirection, setMonthDirection] = useState(1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [sheetVisible, setSheetVisible] = useState(false);
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
  const canGoNext = demo || isMonthAfter(currentMonth, month);
  const calendarTitle = demo
    ? "体重日历"
    : data.account.displayName
      ? `${data.account.displayName}的体重日历`
      : "我的体重日历";

  useEffect(() => {
    const favicon = document.querySelector('link[data-dynamic-favicon]');
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", currentTheme.color);
    document.documentElement.style.backgroundColor = currentTheme.color;
    document.body.style.backgroundColor = currentTheme.color;
    favicon?.setAttribute("href", `/app-icon-${currentTheme.id}.webp`);
    favicon?.setAttribute("type", "image/webp");
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
    setNotice(pending.clearing ? "当天记录已清空" : "已保存");
    const savedRecord = pending.clearing
      ? null
      : recordsWithDeltas(pending.nextData.records).find((record) => record.date === pending.date);
    const resultCue = pending.clearing
      ? "delete"
      : savedRecord?.deltaGrams > 0
        ? "toggle-on"
        : savedRecord?.deltaGrams < 0
          ? "toggle-off"
          : "success";
    playSfx(resultCue);
    window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setFeedbackDate(null), 1100);
    window.setTimeout(() => setNotice(""), 1800);
  };

  const openWeightSheet = (date) => {
    setSelectedDate(date);
    setSheetVisible(true);
  };

  const changeMonth = (direction) => {
    if (direction > 0 && !canGoNext) {
      playSfx("blocked");
      return false;
    }
    setMonthDirection(direction);
    setMonth((current) => addMonths(current, direction));
    return true;
  };

  const finishMonthSwipe = (_, info) => {
    if (info.offset.x < -54 || info.velocity.x < -520) {
      if (changeMonth(1)) playSfx("swipe");
      return;
    }
    if (info.offset.x > 54 || info.velocity.x > 520) {
      changeMonth(-1);
      playSfx("swipe");
      return;
    }
    playSfx("snap");
  };

  const saveWeight = async ({ date, weightGrams }) => {
    setBusy(true);
    setNotice("");
    try {
      if (demo) {
        const remainingRecords = data.records.filter((item) => item.date !== date);
        const nextRecords = weightGrams === 0
          ? remainingRecords
          : [...remainingRecords, { date, weightGrams, updatedAt: new Date().toISOString() }];
        const sortedRecords = [...nextRecords].sort((left, right) => left.date.localeCompare(right.date));
        const firstRecord = sortedRecords[0];
        pendingSaveRef.current = {
          date,
          clearing: weightGrams === 0,
          nextData: {
            ...data,
            account: {
              ...data.account,
              initialWeightGrams: firstRecord?.weightGrams || null,
              initialDate: firstRecord?.date || null,
            },
            records: nextRecords,
          },
        };
      } else {
        const nextData = await api(weightGrams === 0 ? "/api/records" : needsInitial ? "/api/profile" : "/api/records", {
          method: "PUT",
          body: JSON.stringify({ date, weightGrams }),
        });
        pendingSaveRef.current = { date, nextData, clearing: weightGrams === 0 };
      }
      setSheetVisible(false);
    } catch (error) {
      playSfx("error");
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
        playSfx("error");
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
        playSfx("error");
        setNotice(error.message);
      }
    }
  };

  const changeDisplayName = async (displayName) => {
    setBusy(true);
    setNotice("");
    try {
      const nextData = await api("/api/display-name", {
        method: "PUT",
        body: JSON.stringify({ displayName }),
      });
      setData(nextData);
      setNotice("昵称已保存");
      playSfx("success");
      window.setTimeout(() => setNotice(""), 1800);
    } catch (error) {
      playSfx("error");
      setNotice(error.message);
      window.setTimeout(() => setNotice(""), 2400);
    } finally {
      setBusy(false);
    }
  };

  const analyzeWeight = async ({ heightCm, bodyFatPercent }) => {
    const result = await api("/api/ai-analysis", {
      method: "POST",
      body: JSON.stringify({ heightCm, bodyFatPercent }),
    });
    setData((current) => ({
      ...current,
      account: { ...current.account, ...result.account },
    }));
    return result;
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

  const deleteAccount = async (passcode) => {
    setBusy(true);
    try {
      await api("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ passcode }),
      });
      playSfx("delete");
      onDeleted();
    } catch (error) {
      playSfx("error");
      throw error;
    } finally {
      setBusy(false);
    }
  };

  if (showSettings && !demo) {
    return (
      <SettingsPage
        data={data}
        busy={busy}
        notice={notice}
        onBack={() => setShowSettings(false)}
        onThemeChange={changeTheme}
        onFontChange={changeFont}
        onDisplayNameChange={changeDisplayName}
        onAnalyze={analyzeWeight}
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
          <InteractiveAppIcon theme={currentTheme} />
          <div className="app-title"><strong>{calendarTitle}</strong><span>{todayKey.replaceAll("-", ".")}</span></div>
        </div>
        <div className="header-actions">
          {!demo && <button data-sfx="open" id="settings-button" type="button" className="icon-button" aria-label="打开设置" onClick={() => setShowSettings(true)}><GearSix /></button>}
        </div>
      </header>

      <section className="calendar-panel" aria-label="体重月历">
        <div className="calendar-summary">
          <div><span>初始体重</span><strong>{data.account.initialWeightGrams ? formatKg(data.account.initialWeightGrams) : "未设置"}</strong>{data.account.initialWeightGrams && <small>kg</small>}</div>
          <div className="month-control">
            <button data-sfx="back" type="button" aria-label="上一个月" onClick={() => changeMonth(-1)}><CaretLeft /></button>
            <strong>{monthLabel(month)}</strong>
            <button data-sfx="forward" type="button" aria-label="下一个月" disabled={!canGoNext} onClick={() => changeMonth(1)}><CaretRight /></button>
          </div>
        </div>
        <AnimatePresence initial={false} mode="popLayout" custom={monthDirection}>
          <motion.div
            key={`${month.getFullYear()}-${month.getMonth()}`}
            className="calendar-month-content"
            custom={monthDirection}
            variants={{
              enter: (direction) => ({ opacity: 0, x: direction > 0 ? 28 : -28 }),
              center: { opacity: 1, x: 0 },
              exit: (direction) => ({ opacity: 0, x: direction > 0 ? -28 : 28 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.12}
            dragMomentum={false}
            onDragStart={() => playSfx("drag-start")}
            onDragEnd={finishMonthSwipe}
          >
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
          </motion.div>
        </AnimatePresence>
      </section>

      <div className="toast" role="status" aria-live="polite" data-visible={Boolean(notice)}>{notice}</div>

      {demo && (
        <div className="demo-access-gradient">
          <button data-sfx="open" id="open-my-calendar" type="button" className="primary-button demo-access-button" onClick={onOpenAccount}>
            打开我的体重日历
          </button>
        </div>
      )}

      <AnimatePresence onExitComplete={finishSheetExit}>
        {sheetVisible && (
          <WeightSheet
            key={`record-${selectedDate || todayKey}`}
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
          <div><dt>身高</dt><dd>{user.heightCm ? `${user.heightCm} cm` : "未填写"}</dd></div>
          <div><dt>估算体脂</dt><dd>{user.bodyFatPercent ? `${user.bodyFatPercent}%` : "未填写"}</dd></div>
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
          <button data-sfx="retry" type="button" className="admin-secondary" onClick={onRefresh} disabled={refreshing}>{refreshing ? "刷新中" : "刷新"}</button>
          <button data-sfx="lock" type="button" className="admin-secondary" onClick={onLogout}>退出</button>
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
      else {
        playSfx("error");
        setError(requestError.message);
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const login = async (candidate) => {
    if (candidate.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ password: candidate }),
      });
      setDashboard(result);
      playSfx("unlock");
      setPassword("");
      setStatus("ready");
    } catch (requestError) {
      playSfx("error");
      setError(requestError.message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const updatePassword = (nextPassword) => {
    setPassword(nextPassword);
    setError("");
    if (nextPassword.length === 6) void login(nextPassword);
  };

  useNumericKeyboard({
    value: password,
    onChange: updatePassword,
    disabled: busy || status !== "locked",
  });

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
      <div className="admin-login-card">
        <div className="admin-lock"><LockKey weight="duotone" /></div>
        <h1>数据后台</h1>
        <p>输入管理密码后查看账户、体重记录、注销归档和访问数据。</p>
        <div className={`pin-dots ${error ? "has-error" : ""}`} aria-label={`已输入 ${password.length} 位`}>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={index < password.length ? "filled" : ""} />
          ))}
        </div>
        <div className="admin-login-error" role={error ? "alert" : "status"}>{error || (busy ? "正在验证..." : "")}</div>
        <Keypad value={password} onChange={updatePassword} disabled={busy} />
      </div>
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
      <AnimatePresence>
        {showAccess && (
          <AccessPanel
            key="account-access"
            onClose={() => setShowAccess(false)}
            onSuccess={(data) => {
              setAccountData(data);
              setShowAccess(false);
              setScreen("account");
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  useInterfaceSounds();
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return (
    <MotionConfig reducedMotion="user">
      {path === "/data" ? <AdminApp /> : <CalendarRoot />}
    </MotionConfig>
  );
}
