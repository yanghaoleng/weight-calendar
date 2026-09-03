import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Calligraph } from "calligraph";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import QRCode from "qrcode";
import { createUISFX } from "uisfx";
import "@fontsource-variable/lora/wght.css";
import "@fontsource-variable/fredoka/wght.css";
import {
  Backspace,
  ArrowLeft,
  ArrowRight,
  ChartLineUp,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Check,
  DownloadSimple,
  GithubLogo,
  ForkKnife,
  GearSix,
  Gauge,
  Heart,
  Info,
  IconContext,
  LockKey,
  MoonStars,
  PersonSimpleRun,
  Sparkle,
  SpeakerHigh,
  SpeakerSlash,
  SignOut,
  ShieldCheck,
  Trash,
  Translate,
  Users,
  Warning,
  WechatLogo,
  X,
} from "@phosphor-icons/react";
import {
  addMonths,
  calendarCells,
  formatKg,
  formatWeight,
  isMonthAfter,
  maximumWeightInput,
  normalizeWeightUnit,
  parseDateKey,
  recordsWithDeltas,
  startOfMonth,
  toDateKey,
  unitToGrams,
  weightUnitSymbol,
} from "./lib/calendar.js";
import { makeMarkdownExport } from "./lib/markdown.js";
import {
  browserLanguage,
  DEFAULT_LANGUAGE,
  formatLocaleDate,
  formatLocaleMonth,
  LANGUAGES,
  normalizeLanguage,
  tFor,
} from "./lib/i18n.js";

const THEMES = [
  { id: "rose", labelKey: "themeRose", color: "#f6d8df", accent: "#b94468" },
  { id: "mint", labelKey: "themeMint", color: "#dff1e7", accent: "#34785f" },
  { id: "sky", labelKey: "themeSky", color: "#dcecf5", accent: "#3b7396" },
  { id: "lilac", labelKey: "themeLilac", color: "#e9e1f5", accent: "#725991" },
  { id: "peach", labelKey: "themePeach", color: "#f4e2d6", accent: "#985b3d" },
];

const FONT_STYLES = [
  { id: "system", name: "SF Pro", labelKey: "fontSansLabel", adminLabel: "SF Pro" },
  { id: "serif", name: "Lora", labelKey: "fontSerifLabel", adminLabel: "Lora" },
  { id: "handwriting", name: "Fredoka", labelKey: "fontRoundedLabel", adminLabel: "Fredoka" },
  { id: "humanist", name: "Optima", labelKey: "fontHumanistLabel", adminLabel: "Optima" },
  { id: "cute", name: "Fredoka Medium", labelKey: "fontCuteLabel", adminLabel: "Fredoka Medium" },
  { id: "light", name: "Avenir Next", labelKey: "fontLightLabel", adminLabel: "Avenir Next" },
];

const ICON_CONTEXT_BY_FONT = {
  regular: { weight: "regular" },
  handwriting: { weight: "bold" },
  humanist: { weight: "thin" },
  cute: { weight: "regular" },
  light: { weight: "light" },
};

function iconContextForFont(fontStyle) {
  return ICON_CONTEXT_BY_FONT[fontStyle] || ICON_CONTEXT_BY_FONT.regular;
}

const WEIGHT_UNITS = [
  { id: "kg", labelKey: "unitKg", hintKey: "unitKgHint" },
  { id: "jin", labelKey: "unitJin", hintKey: "unitJinHint" },
  { id: "lb", labelKey: "unitLb", hintKey: "unitLbHint" },
  { id: "st", labelKey: "unitSt", hintKey: "unitStHint" },
];

const I18nContext = createContext({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
  t: (key, values) => tFor(DEFAULT_LANGUAGE, key, values),
});

function useI18n() {
  return useContext(I18nContext);
}

const SETTINGS_PAGE_ACTIVE = { opacity: 1, x: 0 };
const SETTINGS_PAGE_ENTER = { opacity: 0, x: 22 };
const SETTINGS_PAGE_RETURN_ENTER = { opacity: 0, x: -22 };
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

function AppIcon({ className = "" }) {
  return <img className={className} src="/app-icon.webp" alt="" aria-hidden="true" draggable="false" />;
}

function InteractiveAppIcon() {
  const { t } = useI18n();
  const [motionMode, setMotionMode] = useState("idle");
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
      aria-label={t("replayIcon")}
      title={t("replayIconHint")}
      onClick={replayMotion}
    >
      <AppIcon className={`app-brand-icon app-brand-icon--${motionMode}`} />
    </button>
  );
}

function limitCharacters(value, maximum) {
  return Array.from(value).slice(0, maximum).join("");
}

async function api(path, options = {}) {
  const language = normalizeLanguage(document.documentElement.lang || DEFAULT_LANGUAGE);
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Accept-Language": language,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(payload?.message || tFor(language, "requestFailed"));
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
  if (!copied) throw new Error(tFor(document.documentElement.lang, "copyFailed"));
}

function makeDemoData() {
  const weights = [61000, 59900, 59700, 59400, 59100, 58400, 58100, 58000, 57300, 60000, 59800, 59700, 59600, 59500, 59100, 58900];
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)].id;
  const fontStyle = FONT_STYLES[Math.floor(Math.random() * FONT_STYLES.length)].id;
  return {
    account: {
      theme,
      fontStyle,
      soundEnabled: true,
      language: browserLanguage(),
      unit: "kg",
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

function Keypad({ value, onChange, disabled = false }) {
  const { t } = useI18n();
  const push = (digit) => {
    if (!disabled && value.length < 6) onChange(`${value}${digit}`);
  };

  return (
    <div className="pin-keypad" aria-label={t("pinKeypad")}>
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
        aria-label={t("deleteDigit")}
        onClick={() => onChange(value.slice(0, -1))}
        disabled={disabled || value.length === 0}
      >
        <Backspace />
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
  const { language, t } = useI18n();
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
        if (active) setError(t("qrFailed"));
      });
    return () => {
      active = false;
    };
  }, [accountUrl, stage, t]);

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
        onSuccess(data, candidate);
        return;
      }

      if (stage === "confirm") {
        if (candidate !== firstPin) {
          playSfx("error");
          setError(t("passcodeMismatch"));
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
        setError(t("passcodeUsed"));
      } else if (requestError.code === "RATE_LIMITED") {
        playSfx("blocked");
        setError(t("rateLimited"));
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
        body: JSON.stringify({ passcode: firstPin, displayName: displayName.trim(), language }),
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
        setError(t("passcodeUsed"));
      } else if (requestError.code === "RATE_LIMITED") {
        playSfx("blocked");
        setError(t("rateLimited"));
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
          <div className="auth-icon success" aria-hidden="true"><Check /></div>
          <h2 id="created-title">{t("accountCreated")}</h2>

          <div className="qr-card">
            {qrData
              ? <img id="account-qr" src={qrData} alt={t("qrAlt", { url: accountUrl })} />
              : <div className="qr-loading" aria-label={t("qrLoading")} />}
            <small>{accountUrl}</small>
          </div>

          <div className="account-details">
            <div className="account-detail"><span>{t("nickname")}</span><strong>{displayName.trim() || t("notFilled")}</strong></div>
            <div className="account-detail password-detail"><span>{t("passcode")}</span><strong>{firstPin}</strong></div>
          </div>
          <div className="auth-message" role={error ? "alert" : "status"}>{error}</div>
          <button data-sfx="complete" id="screenshot-confirm" type="button" className="primary-button screenshot-button" onClick={() => onSuccess(createdData, firstPin)}>
            <Check />{t("screenshotSaved")}
          </button>
      </AccessDialogFrame>
    );
  }

  if (stage === "ask") {
    return (
      <AccessDialogFrame labelledBy="auth-title">
          <button data-sfx="close" type="button" className="close-button" aria-label={t("close")} onClick={onClose}><X /></button>
          <div className="auth-icon plain" aria-hidden="true"><LockKey /></div>
          <h2 id="auth-title">{t("accountNotFound")}</h2>
          <p>{t("createQuestion")}</p>
          <div className="masked-pin" aria-label={t("rememberedPasscode")}>
            {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
          </div>
          <div className="access-actions">
            <button data-sfx="back" type="button" className="secondary-button" onClick={restart}>{t("reenter")}</button>
            <button data-sfx="forward" id="confirm-create" type="button" className="primary-button" onClick={() => {
              setStage("confirm");
              setPin("");
              setError("");
            }}>{t("createAccount")}</button>
          </div>
      </AccessDialogFrame>
    );
  }

  if (stage === "name") {
    return (
      <AccessDialogFrame labelledBy="name-title">
          <button data-sfx="close" type="button" className="close-button" aria-label={t("close")} onClick={onClose}><X /></button>
          <div className="auth-icon" aria-hidden="true"><Users /></div>
          <h2 id="name-title">{t("yourName")}</h2>
          <label className="name-field">
            <input
              id="display-name"
              type="text"
              value={displayName}
              autoComplete="nickname"
              placeholder={t("nicknamePlaceholder")}
              autoFocus
              aria-label={t("nicknameOptional")}
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
            }} disabled={busy}>{t("previous")}</button>
            <button
              data-sfx="forward"
              id="confirm-name"
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void createAccount()}
            >{busy ? t("creating") : displayName.trim() ? t("continue") : t("skip")}</button>
          </div>
          {error && <div className="auth-message" role="alert">{error}</div>}
      </AccessDialogFrame>
    );
  }

  return (
    <AccessDialogFrame labelledBy="auth-title">
        <button data-sfx="close" type="button" className="close-button" aria-label={t("close")} onClick={onClose}>
          <X />
        </button>
        <div className="auth-icon plain" aria-hidden="true"><LockKey /></div>
        <h2 id="auth-title">{stage === "confirm" ? t("confirmPasscode") : t("openCalendar")}</h2>
        {stage === "confirm" && <p>{t("confirmPasscodeHelp")}</p>}

        <div className={`pin-dots ${error ? "has-error" : ""}`} aria-label={t("enteredDigits", { count: pin.length })}>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={index < pin.length ? "filled" : ""} />
          ))}
        </div>
        {(error || busy || stage === "confirm") && (
          <div className="auth-message" role={error ? "alert" : "status"}>
            {error || (busy ? t("confirming") : t("samePasscode"))}
          </div>
        )}
        <Keypad value={pin} onChange={updatePin} disabled={busy} />
    </AccessDialogFrame>
  );
}

function WeightKeypad({ value, maximum, onChange, replaceOnNextInput, onInputStarted }) {
  const { t } = useI18n();
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
      if (!value.includes(".") && value.length > 0 && Number(value) < maximum) onChange(`${value}.`);
      return;
    }
    const [whole, decimal = ""] = value.split(".");
    const wholeDigitLimit = String(Math.floor(maximum)).length;
    if (value.includes(".") && decimal.length >= 1) return;
    if (!value.includes(".") && whole.length >= wholeDigitLimit) return;
    const nextValue = `${value}${key}`;
    if (Number(nextValue) <= maximum) onChange(nextValue);
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "delete"];
  return (
    <div className="weight-keypad" aria-label={t("weightKeypad")}>
      {keys.map((key) => (
        <button data-sfx={key === "delete" ? "deselect" : "typing"} id={`weight-key-${key === "." ? "decimal" : key}`} key={key} type="button" onClick={() => push(key)} aria-label={key === "delete" ? t("deleteDigit") : key}>
          {key === "delete" ? <Backspace /> : key}
        </button>
      ))}
    </div>
  );
}

function WeightSheet({ date, existingGrams, unit, busy, onCancel, onSave }) {
  const { language, t } = useI18n();
  const normalizedUnit = normalizeWeightUnit(unit);
  const unitSymbol = weightUnitSymbol(normalizedUnit);
  const maximum = maximumWeightInput(normalizedUnit);
  const initialValue = existingGrams ? formatWeight(existingGrams, normalizedUnit) : "";
  const [value, setValue] = useState(initialValue);
  const [replaceOnNextInput, setReplaceOnNextInput] = useState(Boolean(existingGrams));
  const [previewDeleteCount, setPreviewDeleteCount] = useState(0);
  const unitValue = Number(value);
  const isClearing = value !== "" && unitValue === 0;
  const weightGrams = unitToGrams(unitValue, normalizedUnit);
  const valid = value !== ""
    && Number.isFinite(unitValue)
    && unitValue <= maximum
    && weightGrams <= 999000
    && (weightGrams === 0 || weightGrams >= 100);
  const closeFromDrag = (_, info) => {
    if (info.offset.y > 92 || info.velocity.y > 680) {
      playSfx("swipe");
      onCancel();
    } else {
      playSfx("snap");
    }
  };
  const swipeDeleteCount = (offsetX) => {
    if (!value || offsetX > -30) return 0;
    return Math.min(offsetX <= -78 ? 2 : 1, value.length);
  };
  const previewKeptValue = previewDeleteCount > 0 ? value.slice(0, -previewDeleteCount) : value;
  const previewRemovedValue = previewDeleteCount > 0 ? value.slice(-previewDeleteCount) : "";
  const commitSwipeDelete = (_, info) => {
    const deleteCount = swipeDeleteCount(info.offset.x);
    setPreviewDeleteCount(0);
    if (deleteCount === 0) {
      if (info.offset.x < 0) playSfx("snap");
      return;
    }
    setReplaceOnNextInput(false);
    setValue((current) => current.slice(0, -deleteCount));
    playSfx("deselect");
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
        <button data-sfx="close" type="button" className="close-button" aria-label={t("close")} onClick={onCancel}><X /></button>
        <div className="sheet-handle" aria-hidden="true" />
        <h2 id="weight-title">
          {`${existingGrams ? t("editRecord") : t("record")}: ${formatLocaleDate(date, language, { short: true })}`}
        </h2>
        <div className="weight-display" aria-live="polite">
          <motion.strong
            className={`weight-value ${previewDeleteCount ? "is-previewing-delete" : ""}`}
            aria-label={t("weightSwipeHint", { value: value || "0", unit: unitSymbol })}
            drag={value ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.18, right: 0.02 }}
            dragMomentum={false}
            dragSnapToOrigin
            onPointerDown={(event) => event.stopPropagation()}
            onDrag={(_, info) => {
              const nextCount = swipeDeleteCount(info.offset.x);
              setPreviewDeleteCount((current) => current === nextCount ? current : nextCount);
            }}
            onDragEnd={commitSwipeDelete}
          >
            <Calligraph
              className="weight-value-calligraph"
              variant="text"
              animation="snappy"
              drift={{ x: 0, y: 18 }}
              trend={1}
              initial
              autoSize={false}
            >{value || "0"}</Calligraph>
            {previewDeleteCount > 0 && (
              <span className="weight-delete-preview" aria-hidden="true">
                <span>{previewKeptValue}</span><mark>{previewRemovedValue}</mark>
              </span>
            )}
          </motion.strong>
          <span className="weight-unit">{unitSymbol}</span>
        </div>
        <WeightKeypad
          value={value}
          maximum={maximum}
          onChange={setValue}
          replaceOnNextInput={replaceOnNextInput}
          onInputStarted={() => setReplaceOnNextInput(false)}
        />
        <button
          type="button"
          id="weight-save"
          className="primary-button sheet-save"
          disabled={!valid || busy}
          onClick={() => onSave({ date, weightGrams: isClearing ? 0 : weightGrams })}
        >
          {isClearing ? <Trash /> : <Check />}
          {busy ? (isClearing ? t("clearing") : t("saving")) : (isClearing ? t("clearDay") : t("saveWeight"))}
        </button>
      </motion.section>
    </motion.div>
  );
}

function ThemeOptions({ value, onChange }) {
  const { t } = useI18n();
  return (
    <div className="theme-options" aria-label={t("backgroundColor")}>
        {THEMES.map((theme) => (
          <button
            type="button"
            key={theme.id}
            id={`theme-${theme.id}`}
            data-sfx="select"
            aria-label={t(theme.labelKey)}
            aria-pressed={value === theme.id}
            onClick={() => onChange(theme.id)}
          >
            <span className="theme-swatch" style={{ background: theme.color }} />
            <b>{t(theme.labelKey)}</b>
            <AnimatePresence initial={false}>
              {value === theme.id && (
                <motion.span
                  key={`theme-check-${theme.id}`}
                  className="theme-check"
                  initial={{ opacity: 0, scale: 1.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.72 }}
                  transition={{ type: "spring", stiffness: 520, damping: 18, mass: 0.55 }}
                >
                  <Check />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        ))}
    </div>
  );
}

function FontOptions({ value, unit, onChange }) {
  const { t } = useI18n();
  const unitSymbol = weightUnitSymbol(unit);
  return (
    <div className="font-options" aria-label={t("fontStyle")}>
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
          <span><b>{font.name}</b><small>{t(font.labelKey)}</small></span>
          <strong>58.6 <small>{unitSymbol}</small></strong>
        </button>
      ))}
    </div>
  );
}

function DeleteAccountDialog({ displayName, busy, onCancel, onDelete, onSuccess }) {
  const { t } = useI18n();
  const [step, setStep] = useState("intro");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  const updatePasscode = (nextPasscode) => {
    setPasscode(nextPasscode);
    setError("");
    if (step === "passcode" && nextPasscode.length === 6) {
      void confirmDelete(nextPasscode);
    }
  };

  const confirmDelete = async (candidate = passcode) => {
    if (candidate.length !== 6 || busy || submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    try {
      await onDelete(candidate);
      setStep("success");
    } catch (requestError) {
      setPasscode("");
      setError(requestError.message);
    } finally {
      submittingRef.current = false;
    }
  };

  useNumericKeyboard({
    value: passcode,
    onChange: updatePasscode,
    disabled: busy || step !== "passcode",
  });

  if (step === "success") {
    return (
      <AccessDialogFrame panelClassName="delete-success-dialog" labelledBy="delete-success-title">
        <div className="auth-icon success" aria-hidden="true"><Check /></div>
        <h2 id="delete-success-title">{t("accountDeleted")}</h2>
        <p>{t("accountDeletedMessage")}</p>
        <button data-sfx="complete" id="delete-success-confirm" type="button" className="primary-button" onClick={onSuccess}>
          {t("confirm")}
        </button>
      </AccessDialogFrame>
    );
  }

  return (
    <div className="modal-layer" role="presentation">
      <section className="auth-panel danger-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <button data-sfx="close" type="button" className="close-button" aria-label={t("close")} onClick={onCancel}><X /></button>
        <div className="auth-icon danger" aria-hidden="true"><Warning /></div>
        <h2 id="delete-title">{step === "intro" ? t("deleteAccount") : t("deleteFinal")}</h2>
        {step === "intro" ? (
          <>
            <p>{t("deleteIntro", { name: displayName })}</p>
            <div className="danger-note">{t("deleteRetention")}</div>
            <div className="access-actions">
              <button data-sfx="cancel" type="button" className="secondary-button" onClick={onCancel}>{t("cancel")}</button>
              <button data-sfx="warning" id="delete-continue" type="button" className="danger-button" onClick={() => {
                setStep("passcode");
                setPasscode("");
                setError("");
              }}>{t("deleteContinue")}</button>
            </div>
          </>
        ) : (
          <>
            <p>{t("enterCurrentPasscode")}</p>
            <div className={`pin-dots ${error ? "has-error" : ""}`} aria-label={t("enteredDigits", { count: passcode.length })}>
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} className={index < passcode.length ? "filled" : ""} />
              ))}
            </div>
            <div className="auth-message" role={error ? "alert" : "status"}>{error || (busy ? t("confirming") : "")}</div>
            <Keypad value={passcode} onChange={updatePasscode} disabled={busy} />
          </>
        )}
      </section>
    </div>
  );
}

function bodyFatEstimate(value, t) {
  if (value < 16) return t("lean");
  if (value <= 28) return t("moderate");
  return t("high");
}

function ProfileSlider({ id, label, value, minimum, maximum, unit, onChange }) {
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
    </label>
  );
}

function dateKeyToUtcTime(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function WeightTrendChart({ records, unit }) {
  const { language, t } = useI18n();
  const normalizedUnit = normalizeWeightUnit(unit);
  const unitSymbol = weightUnitSymbol(normalizedUnit);
  const today = toDateKey(new Date());
  const endTime = dateKeyToUtcTime(today);
  const dayMs = 24 * 60 * 60 * 1000;
  const startTime = endTime - (29 * dayMs);
  const startDateKey = new Date(startTime).toISOString().slice(0, 10);
  const recentRecords = useMemo(
    () => records
      .filter((record) => {
        const time = dateKeyToUtcTime(record.date);
        return time >= startTime && time <= endTime;
      })
      .sort((left, right) => left.date.localeCompare(right.date)),
    [endTime, records, startTime],
  );
  const [selectedDate, setSelectedDate] = useState(recentRecords.at(-1)?.date || "");

  useEffect(() => {
    if (!recentRecords.some((record) => record.date === selectedDate)) {
      setSelectedDate(recentRecords.at(-1)?.date || "");
    }
  }, [recentRecords, selectedDate]);

  if (recentRecords.length === 0) {
    return (
      <section className="weight-trend-card" aria-labelledby="weight-trend-title">
        <header><div><h2 id="weight-trend-title">{t("thirtyDayTrend")}</h2></div><ChartLineUp /></header>
        <p className="weight-trend-empty">{t("trendEmpty")}</p>
      </section>
    );
  }

  const width = 560;
  const height = 220;
  const left = 24;
  const right = 16;
  const top = 18;
  const baseline = 184;
  const plotWidth = width - left - right;
  const values = recentRecords.map((record) => record.weightGrams);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const padding = Math.max((dataMax - dataMin) * 0.14, 500);
  const rangeMin = Math.max(0, dataMin - padding);
  const rangeMax = dataMax + padding;
  const plotHeight = baseline - top;
  const points = recentRecords.map((record) => {
    const dayOffset = (dateKeyToUtcTime(record.date) - startTime) / dayMs;
    return {
      ...record,
      x: left + (dayOffset / 29) * plotWidth,
      y: top + ((rangeMax - record.weightGrams) / (rangeMax - rangeMin)) * plotHeight,
    };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${points.at(-1).x.toFixed(2)} ${baseline} L ${points[0].x.toFixed(2)} ${baseline} Z`;
  const selected = recentRecords.find((record) => record.date === selectedDate) || recentRecords.at(-1);
  const selectPoint = (date) => {
    setSelectedDate(date);
    playSfx("select");
  };

  return (
    <section className="weight-trend-card" aria-labelledby="weight-trend-title">
      <header>
        <div>
          <h2 id="weight-trend-title">{t("thirtyDayTrend")}</h2>
          <p>{t("trendRange", {
            min: formatWeight(dataMin, normalizedUnit),
            max: formatWeight(dataMax, normalizedUnit),
            unit: unitSymbol,
          })}</p>
        </div>
        <ChartLineUp />
      </header>
      <div className="weight-trend-readout" aria-live="polite">
        <span>{formatLocaleDate(selected.date, language)}</span>
        <strong>{formatWeight(selected.weightGrams, normalizedUnit)} <small>{unitSymbol}</small></strong>
      </div>
      <div className="weight-trend-plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("trendChartLabel")}>
          {[0, 0.5, 1].map((ratio) => {
            const y = top + (plotHeight * ratio);
            return <line key={ratio} className="trend-grid-line" x1={left} y1={y} x2={width - right} y2={y} />;
          })}
          <line className="trend-axis-line" x1={left} y1={baseline} x2={width - right} y2={baseline} />
          <motion.path
            className="trend-area"
            d={areaPath}
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformBox: "view-box", transformOrigin: `0px ${baseline}px` }}
          />
          <motion.path
            className="trend-line"
            d={linePath}
            initial={{ opacity: 0, pathLength: 0, scaleY: 0 }}
            animate={{ opacity: 1, pathLength: 1, scaleY: 1 }}
            transition={{ opacity: { duration: 0.15 }, scaleY: { duration: 0.72, ease: [0.22, 1, 0.36, 1] }, pathLength: { duration: 1.05, delay: 0.14, ease: "easeOut" } }}
            style={{ transformBox: "view-box", transformOrigin: `0px ${baseline}px` }}
          />
          {points.map((point, index) => (
            <motion.g
              key={point.date}
              className={`trend-point ${selected.date === point.date ? "is-selected" : ""}`}
              role="button"
              tabIndex="0"
              aria-label={`${formatLocaleDate(point.date, language)}, ${formatWeight(point.weightGrams, normalizedUnit)} ${unitSymbol}`}
              onClick={() => selectPoint(point.date)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectPoint(point.date);
                }
              }}
              initial={{ opacity: 0, y: baseline - point.y }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.46, delay: 0.22 + (index * 0.025), ease: [0.22, 1, 0.36, 1] }}
            >
              <circle className="trend-point-hit" cx={point.x} cy={point.y} r="14" />
              <circle className="trend-point-ring" cx={point.x} cy={point.y} r="7" />
              <circle className="trend-point-dot" cx={point.x} cy={point.y} r="3.5" />
            </motion.g>
          ))}
          <text className="trend-date-label" x={left} y={height - 8}>{formatLocaleDate(startDateKey, language, { short: true })}</text>
          <text className="trend-date-label" x={width - right} y={height - 8} textAnchor="end">{formatLocaleDate(today, language, { short: true })}</text>
        </svg>
      </div>
    </section>
  );
}

function AIAnalysisPage({ data, onBack, onAnalyze }) {
  const { t } = useI18n();
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
    { key: "diet", title: t("diet"), icon: <ForkKnife />, items: analysis.diet },
    { key: "exercise", title: t("exercise"), icon: <PersonSimpleRun />, items: analysis.exercise },
    { key: "sleep", title: t("sleep"), icon: <MoonStars />, items: analysis.sleep },
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
        <button data-sfx="back" type="button" className="icon-button" aria-label={t("backSettings")} disabled={isLeaving} onClick={() => setIsLeaving(true)}><ArrowLeft /></button>
        <div><strong>{t("aiTitle")}</strong></div>
      </header>

      <div className="ai-analysis-content">
        <section className="settings-section ai-profile-card" aria-labelledby="ai-profile-title">
          <div className="ai-section-heading">
            <span><Sparkle /></span>
            <div><h2 id="ai-profile-title">{t("aiProfile")}</h2></div>
          </div>
          <div className="profile-sliders">
            <ProfileSlider id="height-slider" label={t("height")} value={heightCm} minimum={120} maximum={230} unit="cm" onChange={setHeightCm} />
            <ProfileSlider
              id="body-fat-slider"
              label={`${t("bodyFat")} · ${bodyFatEstimate(bodyFatPercent, t)}`}
              value={bodyFatPercent}
              minimum={3}
              maximum={60}
              unit="%"
              onChange={setBodyFatPercent}
            />
          </div>
          <button id="run-ai-analysis" type="button" className="primary-button ai-analyze-button" onClick={analyze} disabled={busy}>
            <Sparkle />{busy ? t("analyzing") : t("aiAnalysis")}
          </button>
          <div className="ai-error" role={error ? "alert" : "status"}>{error}</div>
        </section>

        {analysis && (
          <motion.section className="ai-result" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <p className="ai-summary">{analysis.summary}</p>
            <WeightTrendChart records={data.records} unit={data.account.unit} />
            <div className="ai-advice-grid">
              {sections.map((section) => (
                <article key={section.key}>
                  <header><span>{section.icon}</span><h2>{section.title}</h2></header>
                  <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
                </article>
              ))}
            </div>
            <p className="ai-disclaimer">{t("aiDisclaimer")}</p>
          </motion.section>
        )}
      </div>
    </motion.main>
  );
}

function DonationPage({ data, onBack }) {
  const { t } = useI18n();
  const [method, setMethod] = useState("wechat");
  const [copyStatus, setCopyStatus] = useState("");
  const [qrFailed, setQrFailed] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [thanksCopy] = useState(
    () => {
      const copies = t("donationThanks");
      return copies[Math.floor(Math.random() * copies.length)];
    },
  );
  const [visibleThanksLength, setVisibleThanksLength] = useState(0);
  const isWechat = method === "wechat";

  useEffect(() => {
    setQrFailed(false);
  }, [method]);

  useEffect(() => {
    const characters = Array.from(thanksCopy);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisibleThanksLength(characters.length);
      return undefined;
    }
    setVisibleThanksLength(0);
    let intervalId;
    const startId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        setVisibleThanksLength((length) => {
          if (length >= characters.length) {
            window.clearInterval(intervalId);
            return length;
          }
          return length + 1;
        });
      }, 32);
    }, 160);
    return () => {
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, [thanksCopy]);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const copyAuthorWechat = async () => {
    try {
      await copyText("yanghaoleng");
      setCopyStatus(t("wechatCopied"));
      playSfx("success");
    } catch {
      setCopyStatus(t("wechatCopyFailed"));
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
        <button data-sfx="back" type="button" className="icon-button" aria-label={t("backSettings")} disabled={isLeaving} onClick={() => setIsLeaving(true)}><ArrowLeft /></button>
        <div><strong>{t("donateAuthor")}</strong></div>
      </header>

      <div className="donation-page-content">
        <section className="settings-section donation-card" aria-labelledby="donation-message">
          <span className="donation-heart" aria-hidden="true"><Heart /></span>
          <p id="donation-message" className="donation-intro">{t("donationIntro")}</p>
          <Calligraph
            as="p"
            className="donation-thanks-copy"
            variant="text"
            animation="smooth"
            drift={{ x: 0, y: 12 }}
            trend={1}
            autoSize={false}
            style={{ display: "flex", flexWrap: "wrap" }}
          >{Array.from(thanksCopy).slice(0, visibleThanksLength).join("")}</Calligraph>

          <div className="donation-tabs" role="tablist" aria-label={t("donationMethod")}>
            <button
              id="donation-tab-wechat"
              data-sfx="select"
              type="button"
              role="tab"
              aria-selected={isWechat}
              aria-controls="donation-qr-panel"
              className={isWechat ? "is-selected" : ""}
              onClick={() => setMethod("wechat")}
            ><WechatLogo />{t("wechat")}</button>
            <button
              id="donation-tab-alipay"
              data-sfx="select"
              type="button"
              role="tab"
              aria-selected={!isWechat}
              aria-controls="donation-qr-panel"
              className={!isWechat ? "is-selected" : ""}
              onClick={() => setMethod("alipay")}
            ><span className="alipay-mark" aria-hidden="true">支</span>{t("alipay")}</button>
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
                alt={isWechat ? t("wechatQrAlt") : t("alipayQrAlt")}
                onError={() => setQrFailed(true)}
                draggable="false"
              />
            ) : (
              <p className="donation-qr-error" role="alert">{t("donationQrFailed")}</p>
            )}
          </div>
          <p className="donation-contact">
            {t("contactIntro")}
            <button data-sfx="copy" type="button" onClick={copyAuthorWechat}>{t("copyWechat")}</button>
          </p>
          <p className="donation-copy-status" role="status" aria-live="polite">{copyStatus}</p>
        </section>
      </div>
    </motion.main>
  );
}

function AboutPage({ data, onBack, standalone = false }) {
  const { t } = useI18n();
  const [isLeaving, setIsLeaving] = useState(false);
  const theme = data?.account?.theme || "rose";
  const fontStyle = data?.account?.fontStyle || "system";
  const leave = () => {
    if (standalone) {
      window.location.assign("/");
      return;
    }
    setIsLeaving(true);
  };

  return (
    <motion.main
      className="settings-shell about-shell"
      data-theme={theme}
      data-font={fontStyle}
      data-page-leaving={isLeaving}
      initial={SETTINGS_PAGE_ENTER}
      animate={isLeaving ? SETTINGS_PAGE_EXIT_BACK : SETTINGS_PAGE_ACTIVE}
      transition={SETTINGS_PAGE_TRANSITION}
      onAnimationComplete={() => { if (isLeaving) onBack?.(); }}
    >
      <header className="settings-header">
        <button data-sfx="back" type="button" className="icon-button" aria-label={standalone ? t("backCalendar") : t("backSettings")} disabled={isLeaving} onClick={leave}><ArrowLeft /></button>
        <div><strong>{t("aboutPrivacy")}</strong><span>{t("aboutSubtitle")}</span></div>
      </header>

      <div className="about-page-content">
        <section className="settings-section about-intro" aria-labelledby="about-intro-title">
          <span className="about-lead-icon" aria-hidden="true"><Info /></span>
          <h1 id="about-intro-title">{t("appName")}</h1>
          <p>{t("aboutLead")}</p>
        </section>

        <section className="settings-section about-section" aria-labelledby="about-highlights-title">
          <h2 id="about-highlights-title">{t("productHighlights")}</h2>
          <ul className="about-highlights">
            <li>{t("highlightSync")}</li>
            <li>{t("highlightExport")}</li>
            <li>{t("highlightDaily")}</li>
            <li>{t("highlightFocused")}</li>
            <li>{t("highlightPlatform")}</li>
          </ul>
          <div className="about-thanks">
            <Heart aria-hidden="true" />
            <p><strong>{t("specialThanks")}</strong><span>{t("jennieThanks")}</span></p>
          </div>
        </section>

        <section className="settings-section about-section" aria-labelledby="about-source-title">
          <h2 id="about-source-title">{t("openSource")}</h2>
          <p>{t("openSourceText")}</p>
          <a className="about-link-button" href="https://github.com/yanghaoleng/weight-calendar" target="_blank" rel="noreferrer">
            <GithubLogo /><span>{t("viewGithub")}</span><ArrowRight />
          </a>
        </section>

        <section className="settings-section about-section privacy-section" aria-labelledby="privacy-title">
          <div className="about-section-heading">
            <ShieldCheck aria-hidden="true" />
            <h2 id="privacy-title">{t("privacy")}</h2>
          </div>
          <p className="privacy-promise">{t("privacyPromise")}</p>
          <h3>{t("storedData")}</h3>
          <ul>
            <li>{t("storedAccount")}</li>
            <li>{t("storedRecords")}</li>
            <li>{t("storedTechnical")}</li>
            <li>{t("storedAi")}</li>
          </ul>
          <h3>{t("deletionTitle")}</h3>
          <p>{t("deletionText")}</p>
          <button className="about-contact-button" data-sfx="copy" type="button" onClick={() => void copyText("yanghaoleng")}>{t("contactWechat")}</button>
          <small>{t("lastUpdated")}</small>
        </section>
      </div>
    </motion.main>
  );
}

function LanguageOptions({ value, busy, onChange }) {
  const { t } = useI18n();
  return (
    <div className="language-options" role="radiogroup" aria-label={t("language")}>
      {LANGUAGES.map((item) => (
        <button
          key={item.id}
          id={`language-${item.id}`}
          type="button"
          role="radio"
          aria-checked={value === item.id}
          className={value === item.id ? "is-selected" : ""}
          disabled={busy}
          onClick={() => onChange(item.id)}
        >{item.label}</button>
      ))}
    </div>
  );
}

function UnitOptions({ value, busy, onChange }) {
  const { t } = useI18n();
  return (
    <div className="unit-options" role="radiogroup" aria-label={t("unit")}>
      {WEIGHT_UNITS.map((item) => (
        <button
          key={item.id}
          id={`unit-${item.id}`}
          type="button"
          role="radio"
          aria-checked={value === item.id}
          className={value === item.id ? "is-selected" : ""}
          disabled={busy}
          onClick={() => onChange(item.id)}
        >
          <strong>{t(item.labelKey)}</strong>
          <small>{t(item.hintKey)}</small>
        </button>
      ))}
    </div>
  );
}

function SettingsPage({ data, busy, notice, onBack, onThemeChange, onFontChange, onSoundChange, onUnitChange, onLanguageChange, onDisplayNameChange, onAnalyze, onExport, onLogout, onDelete, onDeleted }) {
  const { t } = useI18n();
  const [showDelete, setShowDelete] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showDonation, setShowDonation] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [nickname, setNickname] = useState(data.account.displayName || "");
  const [isLeaving, setIsLeaving] = useState(false);
  const [pendingView, setPendingView] = useState(null);
  const [returningFromChild, setReturningFromChild] = useState(false);
  const settingsScrollRef = useRef(0);
  const displayName = data.account.displayName || t("nickname");
  const soundEnabled = data.account.soundEnabled !== false;
  const normalizedNickname = nickname.trim();

  useEffect(() => {
    setNickname(data.account.displayName || "");
  }, [data.account.displayName]);

  useLayoutEffect(() => {
    if (!returningFromChild) return undefined;
    const restoreScroll = () => {
      window.scrollTo({ top: settingsScrollRef.current, left: 0, behavior: "auto" });
    };
    restoreScroll();
    const frame = window.requestAnimationFrame(restoreScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [returningFromChild]);

  const toggleSounds = () => {
    onSoundChange(!soundEnabled);
  };

  const leaveSettings = (destination) => {
    if (isLeaving) return;
    if (destination !== "calendar") settingsScrollRef.current = window.scrollY;
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
    if (pendingView === "about") setShowAbout(true);
    setPendingView(null);
    setIsLeaving(false);
  };

  const returnToSettings = (view) => {
    setReturningFromChild(true);
    if (view === "ai") setShowAi(false);
    if (view === "donation") setShowDonation(false);
    if (view === "about") setShowAbout(false);
  };

  if (showAi) {
    return <AIAnalysisPage data={data} onBack={() => returnToSettings("ai")} onAnalyze={onAnalyze} />;
  }

  if (showDonation) {
    return <DonationPage data={data} onBack={() => returnToSettings("donation")} />;
  }

  if (showAbout) {
    return <AboutPage data={data} onBack={() => returnToSettings("about")} />;
  }

  return (
    <motion.main
      className="settings-shell"
      data-theme={data.account.theme || "rose"}
      data-font={data.account.fontStyle || "system"}
      data-page-leaving={isLeaving}
      initial={returningFromChild ? SETTINGS_PAGE_RETURN_ENTER : SETTINGS_PAGE_ENTER}
      animate={isLeaving ? (pendingView === "calendar" ? SETTINGS_PAGE_EXIT_BACK : SETTINGS_PAGE_EXIT_FORWARD) : SETTINGS_PAGE_ACTIVE}
      transition={SETTINGS_PAGE_TRANSITION}
      onAnimationComplete={() => {
        finishSettingsExit();
        if (!isLeaving && returningFromChild) setReturningFromChild(false);
      }}
    >
      <header className="settings-header">
        <button data-sfx="back" type="button" className="icon-button" aria-label={t("backCalendar")} disabled={isLeaving} onClick={() => leaveSettings("calendar")}><ArrowLeft /></button>
        <div><strong>{t("settings")}</strong></div>
      </header>

      <div className="settings-content">
        <section className="settings-section settings-group" aria-labelledby="style-settings-title">
          <h2 id="style-settings-title">{t("styleSettings")}</h2>
          <div className="settings-subsection">
            <h3>{t("backgroundColor")}</h3>
            <ThemeOptions value={data.account.theme} onChange={onThemeChange} />
          </div>
          <div className="settings-subsection">
            <h3>{t("fontStyle")}</h3>
            <FontOptions value={data.account.fontStyle || "system"} unit={data.account.unit} onChange={onFontChange} />
          </div>
          <div className="settings-subsection">
            <h3>{t("sound")}</h3>
            <button
              id="settings-sound"
              type="button"
              className="settings-row"
              aria-pressed={soundEnabled}
              onClick={toggleSounds}
            >
              <span className="settings-row-icon">{soundEnabled ? <SpeakerHigh /> : <SpeakerSlash />}</span>
              <span><strong>{t("operationSounds")}</strong></span>
              <span className={`settings-toggle ${soundEnabled ? "is-on" : ""}`} aria-hidden="true"><i /></span>
            </button>
          </div>
          <div className="settings-subsection unit-section">
            <div className="settings-subsection-heading">
              <h3>{t("unit")}</h3>
              <Gauge aria-hidden="true" />
            </div>
            <p>{t("unitHint")}</p>
            <UnitOptions value={normalizeWeightUnit(data.account.unit)} busy={busy} onChange={onUnitChange} />
          </div>
          <div className="settings-subsection language-section">
            <div className="settings-subsection-heading">
              <h3>{t("language")}</h3>
              <Translate aria-hidden="true" />
            </div>
            <p>{t("languageHint")}</p>
            <LanguageOptions value={data.account.language || DEFAULT_LANGUAGE} busy={busy} onChange={onLanguageChange} />
          </div>
        </section>

        <section className="settings-section settings-group" aria-labelledby="account-title">
          <h2 id="account-title">{t("account")}</h2>
          <label className="nickname-settings-field">
            <span>{t("nickname")}</span>
            <div>
              <input
                id="settings-nickname"
                type="text"
                value={nickname}
                maxLength={10}
                placeholder={t("notFilled")}
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
              >{busy ? t("saving") : t("save")}</button>
            </div>
          </label>
          <div className="settings-row-stack account-row-stack">
            <button data-sfx="open" id="settings-ai-analysis" type="button" className="settings-row" onClick={() => leaveSettings("ai")}>
              <span className="settings-row-icon"><Sparkle /></span>
              <span><strong>{t("healthAdvice")}</strong><small>{t("healthAdviceHint")}</small></span>
              <CaretRight />
            </button>
            <button data-sfx="complete" id="settings-export" type="button" className="settings-row" onClick={onExport}>
              <span className="settings-row-icon"><DownloadSimple /></span>
              <span><strong>{t("exportData")}</strong><small>{t("exportHint", { count: data.records.length })}</small></span>
              <CaretRight />
            </button>
            <button data-sfx="lock" id="settings-logout" type="button" className="settings-row" onClick={onLogout}>
              <span className="settings-row-icon"><SignOut /></span>
              <span><strong>{t("logout")}</strong></span>
              <CaretRight />
            </button>
            <button data-sfx="warning" id="delete-account" type="button" className="settings-row danger-row" onClick={() => setShowDelete(true)}>
              <span className="settings-row-icon"><Trash /></span>
              <span><strong>{t("deleteAccount")}</strong><small>{t("deleteAccountHint")}</small></span>
              <CaretRight />
            </button>
          </div>
        </section>

        <section className="settings-section settings-group" aria-labelledby="support-title">
          <h2 id="support-title">{t("supportAndAbout")}</h2>
          <div className="settings-row-stack">
            <button data-sfx="open" id="settings-donation" type="button" className="settings-row" onClick={() => leaveSettings("donation")}>
              <span className="settings-row-icon"><Heart /></span>
              <span><strong>{t("donateAuthor")}</strong><small>{t("donateHint")}</small></span>
              <CaretRight />
            </button>
            <button data-sfx="open" id="settings-about" type="button" className="settings-row" onClick={() => leaveSettings("about")}>
              <span className="settings-row-icon"><ShieldCheck /></span>
              <span><strong>{t("aboutPrivacy")}</strong><small>{t("aboutPrivacyHint")}</small></span>
              <CaretRight />
            </button>
          </div>
        </section>

      </div>

      <div className="toast" role="status" aria-live="polite" data-visible={Boolean(notice)}>{notice}</div>

      {showDelete && (
        <DeleteAccountDialog
          displayName={displayName}
          busy={busy}
          onCancel={() => setShowDelete(false)}
          onDelete={onDelete}
          onSuccess={onDeleted}
        />
      )}
    </motion.main>
  );
}

function ScaleDay({ cell, record, unit, todayKey, onSelect, recentlyUpdated, animateTodayPrompt }) {
  const { language, t } = useI18n();
  const [blocked, setBlocked] = useState(false);
  if (!cell) return <div className="day-cell empty" aria-hidden="true" />;
  const unavailable = cell.key > todayKey;
  const delta = record?.deltaGrams || 0;
  const unitSymbol = weightUnitSymbol(unit);
  const isTodayPrompt = animateTodayPrompt && cell.key === todayKey && !record;
  const label = record
    ? `${formatLocaleDate(cell.key, language)}, ${formatWeight(record.weightGrams, unit)} ${unitSymbol}, ${delta === 0 ? t("start") : `${t(delta > 0 ? "comparedIncrease" : "comparedDecrease")} ${formatWeight(Math.abs(delta), unit)} ${unitSymbol}`}`
    : `${formatLocaleDate(cell.key, language)}, ${unavailable ? t("unavailable") : t("noRecord")}`;

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
      data-unit={normalizeWeightUnit(unit)}
      aria-disabled={unavailable}
      data-sfx={unavailable ? "blocked" : "open"}
      onClick={selectDate}
      onAnimationEnd={() => setBlocked(false)}
      aria-label={label}
    >
      <span className="scale-face">
        {record ? (
          <>
            <Calligraph as="strong" variant="number" animation="bouncy" initial={recentlyUpdated} autoSize={false}>{formatWeight(record.weightGrams, unit)}</Calligraph>
            <span className={`delta ${delta > 0 ? "rise" : delta < 0 ? "fall" : "same"}`}>
              {delta > 0 && <CaretUp weight="bold" />}
              {delta < 0 && <CaretDown weight="bold" />}
              <Calligraph variant={delta === 0 ? "text" : "number"} animation="bouncy" initial={recentlyUpdated} autoSize={false}>
                {delta === 0 ? t("start") : `${formatWeight(Math.abs(delta), unit)}${unitSymbol}`}
              </Calligraph>
            </span>
          </>
        ) : (
          <Gauge className="empty-gauge" />
        )}
      </span>
      <b className="day-number">{String(cell.day).padStart(2, "0")}</b>
    </button>
  );
}

function CalendarApp({ initialData, demo, accountPasscode = "", onOpenAccount, onLogout, onDeleted }) {
  const { language, setLanguage, t } = useI18n();
  const [data, setData] = useState(initialData);
  const [month, setMonth] = useState(() => demo ? new Date(2026, 6, 1) : startOfMonth(new Date()));
  const [monthDirection, setMonthDirection] = useState(1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [feedbackDate, setFeedbackDate] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [animateTodayPrompt, setAnimateTodayPrompt] = useState(true);
  const [demoCtaAttention, setDemoCtaAttention] = useState(false);
  const pendingSaveRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const todayKey = toDateKey(new Date());
  const effectiveTodayKey = demo ? "2026-07-31" : todayKey;
  const needsInitial = !data.account.initialWeightGrams || !data.account.initialDate;
  const records = useMemo(() => recordsWithDeltas(data.records), [data.records]);
  const recordMap = useMemo(() => new Map(records.map((item) => [item.date, item])), [records]);
  const cells = useMemo(() => {
    const monthCells = calendarCells(month);
    return monthCells.length === 42
      ? monthCells
      : [...monthCells, ...Array.from({ length: 42 - monthCells.length }, () => null)];
  }, [month]);
  const selectedRecord = selectedDate ? recordMap.get(selectedDate) : null;
  const currentMonth = startOfMonth(parseDateKey(effectiveTodayKey));
  const currentTheme = THEMES.find((item) => item.id === data.account.theme) || THEMES[0];
  const currentUnit = normalizeWeightUnit(data.account.unit);
  const currentUnitSymbol = weightUnitSymbol(currentUnit);
  const canGoNext = demo || isMonthAfter(currentMonth, month);
  const isViewingCurrentMonth = month.getFullYear() === currentMonth.getFullYear()
    && month.getMonth() === currentMonth.getMonth();
  const titleDisplayName = data.account.displayName
    && ["zh-CN", "zh-HK", "zh-TW", "ja", "ko"].includes(language)
    && /[A-Za-z]$/.test(data.account.displayName)
      ? `${data.account.displayName} `
      : data.account.displayName;
  const calendarTitle = demo
    ? t("appName")
    : titleDisplayName
      ? t("namedCalendar", { name: titleDisplayName })
      : t("myCalendar");

  useEffect(() => {
    const accountLanguage = normalizeLanguage(data.account.language || language);
    if (accountLanguage !== language) setLanguage(accountLanguage);
  }, [data.account.language, language, setLanguage]);

  useEffect(() => {
    const favicon = document.querySelector('link[data-dynamic-favicon]');
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", currentTheme.color);
    document.documentElement.style.backgroundColor = currentTheme.color;
    document.body.style.backgroundColor = currentTheme.color;
    favicon?.setAttribute("href", "/app-icon.webp");
    favicon?.setAttribute("type", "image/webp");
  }, [currentTheme]);

  useEffect(() => {
    document.body.classList.toggle("calendar-screen", !showSettings);
    return () => document.body.classList.remove("calendar-screen");
  }, [showSettings]);

  useEffect(() => {
    uiSfx.setEnabled(data.account.soundEnabled !== false);
  }, [data.account.soundEnabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAnimateTodayPrompt(false), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!demo) return undefined;
    const timer = window.setTimeout(() => setDemoCtaAttention(true), 5000);
    return () => window.clearTimeout(timer);
  }, [demo]);

  useEffect(() => () => {
    window.clearTimeout(feedbackTimerRef.current);
    window.clearTimeout(noticeTimerRef.current);
  }, []);

  const finishSheetExit = () => {
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    setSelectedDate(null);
    if (!pending) return;
    setData(pending.nextData);
    setMonth(startOfMonth(parseDateKey(pending.date)));
    setFeedbackDate(pending.date);
    setNotice(pending.clearing ? t("dayCleared") : t("saved"));
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

  const goToToday = () => {
    setMonthDirection(month < currentMonth ? 1 : -1);
    setMonth(currentMonth);
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

  const changeSound = async (soundEnabled) => {
    const previousSoundEnabled = data.account.soundEnabled !== false;
    if (soundEnabled) {
      uiSfx.setEnabled(true);
      playSfx("toggle-on");
    } else {
      playSfx("toggle-off");
      uiSfx.setEnabled(false);
    }
    setData((current) => ({ ...current, account: { ...current.account, soundEnabled } }));
    if (!demo) {
      try {
        const nextData = await api("/api/sound", {
          method: "PUT",
          body: JSON.stringify({ soundEnabled }),
        });
        setData(nextData);
      } catch (error) {
        uiSfx.setEnabled(previousSoundEnabled);
        setData((current) => ({
          ...current,
          account: { ...current.account, soundEnabled: previousSoundEnabled },
        }));
        playSfx("error");
        setNotice(error.message);
      }
    }
  };

  const changeLanguage = async (nextLanguage) => {
    const normalized = normalizeLanguage(nextLanguage);
    const previous = normalizeLanguage(data.account.language || language);
    setLanguage(normalized);
    setData((current) => ({ ...current, account: { ...current.account, language: normalized } }));
    if (demo) return;
    try {
      const nextData = await api("/api/language", {
        method: "PUT",
        body: JSON.stringify({ language: normalized }),
      });
      setData(nextData);
      setNotice(tFor(normalized, "languageSaved"));
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
    } catch (error) {
      setLanguage(previous);
      setData((current) => ({ ...current, account: { ...current.account, language: previous } }));
      playSfx("error");
      setNotice(error.message);
    }
  };

  const changeUnit = async (nextUnit) => {
    const normalized = normalizeWeightUnit(nextUnit);
    const previous = normalizeWeightUnit(data.account.unit);
    setData((current) => ({ ...current, account: { ...current.account, unit: normalized } }));
    if (demo) return;
    try {
      const nextData = await api("/api/unit", {
        method: "PUT",
        body: JSON.stringify({ unit: normalized }),
      });
      setData(nextData);
      setNotice(t("unitSaved"));
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
    } catch (error) {
      setData((current) => ({ ...current, account: { ...current.account, unit: previous } }));
      playSfx("error");
      setNotice(error.message);
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
      setNotice(t("nicknameSaved"));
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
    try {
      const markdown = makeMarkdownExport(data, {
        demo,
        todayKey,
        toolUrl: `${window.location.origin}/`,
        passcode: accountPasscode,
        language,
        unit: currentUnit,
      });
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const filename = `${t("appName")}${demo ? "-Demo" : ""}-${todayKey}.md`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(t("exportDone"));
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setNotice(""), 3000);
    } catch (error) {
      playSfx("error");
      setNotice(error.message);
    }
  };

  const deleteAccount = async (passcode) => {
    setBusy(true);
    try {
      await api("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ passcode }),
      });
      playSfx("delete");
    } catch (error) {
      playSfx("error");
      throw error;
    } finally {
      setBusy(false);
    }
  };

  if (showSettings && !demo) {
    return (
      <IconContext.Provider value={iconContextForFont(data.account.fontStyle)}>
        <SettingsPage
          data={data}
          busy={busy}
          notice={notice}
          onBack={() => setShowSettings(false)}
          onThemeChange={changeTheme}
          onFontChange={changeFont}
          onSoundChange={changeSound}
          onUnitChange={changeUnit}
          onLanguageChange={changeLanguage}
          onDisplayNameChange={changeDisplayName}
          onAnalyze={analyzeWeight}
          onExport={exportData}
          onLogout={onLogout}
          onDelete={deleteAccount}
          onDeleted={onDeleted}
        />
      </IconContext.Provider>
    );
  }

  return (
    <IconContext.Provider value={iconContextForFont(data.account.fontStyle)}>
      <main className={`app-shell ${demo ? "is-demo" : ""}`} data-theme={data.account.theme || "rose"} data-font={data.account.fontStyle || "system"}>
      <header className="app-header">
        <div className="app-brand">
          <InteractiveAppIcon />
          <div className="app-title"><strong>{calendarTitle}</strong><span>{todayKey.replaceAll("-", ".")}</span></div>
        </div>
        <div className="header-actions">
          {!demo && <button data-sfx="open" id="settings-button" type="button" className="icon-button" aria-label={t("openSettings")} onClick={() => setShowSettings(true)}><GearSix /></button>}
        </div>
      </header>

      <section className="calendar-panel" aria-label={t("weightCalendarLabel")}>
        <div className="calendar-summary">
          <div><span>{t("initialWeight")}</span><strong>{data.account.initialWeightGrams ? formatWeight(data.account.initialWeightGrams, currentUnit) : t("notSet")}</strong>{data.account.initialWeightGrams && <small>{currentUnitSymbol}</small>}</div>
          <div className="month-control">
            <button data-sfx="back" type="button" aria-label={t("previousMonth")} onClick={() => changeMonth(-1)}><CaretLeft /></button>
            <strong>{formatLocaleMonth(month, language)}</strong>
            <button data-sfx="forward" type="button" aria-label={t("nextMonth")} disabled={!canGoNext} onClick={() => changeMonth(1)}><CaretRight /></button>
          </div>
        </div>
        <div className="calendar-month-stack">
          <AnimatePresence initial={false} mode="sync" custom={monthDirection}>
            <motion.div
              key={`${month.getFullYear()}-${month.getMonth()}`}
              className="calendar-month-content"
              custom={monthDirection}
              variants={{
                enter: (direction) => ({ opacity: 0, x: direction > 0 ? 28 : -28, y: 0 }),
                center: { opacity: 1, x: 0, y: 0 },
                exit: (direction) => ({ opacity: 0, x: direction > 0 ? -28 : 28, y: 0 }),
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
              <div className="weekday-row">{t("weekdays").map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
              <div className="calendar-grid">
                {cells.map((cell, index) => (
                  <ScaleDay
                    key={cell?.key || `blank-${index}`}
                    cell={cell}
                    record={cell ? recordMap.get(cell.key) : null}
                    unit={currentUnit}
                    todayKey={effectiveTodayKey}
                    onSelect={openWeightSheet}
                    recentlyUpdated={Boolean(cell && cell.key === feedbackDate)}
                    animateTodayPrompt={animateTodayPrompt}
                  />
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <div className="toast" role="status" aria-live="polite" data-visible={Boolean(notice)}>{notice}</div>

      <AnimatePresence>
        {!isViewingCurrentMonth && (
          <motion.button
            key="today-button"
            data-sfx="back"
            type="button"
            className="today-button"
            initial={{ opacity: 0, scale: 0.9, x: "-50%" }}
            animate={{ opacity: 1, scale: 1, x: "-50%" }}
            exit={{ opacity: 0, scale: 0.92, x: "-50%" }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            onClick={goToToday}
          >{t("returnToday")}</motion.button>
        )}
      </AnimatePresence>

      {demo && (
        <div className="demo-access-gradient">
          <motion.div
            className="demo-access-button-motion"
            initial={{ opacity: 0, y: 44 }}
            animate={demoCtaAttention ? { opacity: 1, y: [0, -6, 0] } : { opacity: 1, y: 0 }}
            transition={demoCtaAttention
              ? { duration: 0.56, times: [0, 0.42, 1], repeat: Infinity, repeatDelay: 3.5, ease: [0.22, 1, 0.36, 1] }
              : { duration: 0.48, ease: [0.16, 1, 0.3, 1] }}
          >
            <button data-sfx="open" id="open-my-calendar" type="button" className="primary-button demo-access-button" onClick={onOpenAccount}>
              {t("openMyCalendar")}<ArrowRight />
            </button>
          </motion.div>
        </div>
      )}

      <AnimatePresence onExitComplete={finishSheetExit}>
        {sheetVisible && (
          <WeightSheet
            key={`record-${selectedDate || todayKey}`}
            date={selectedDate || todayKey}
            existingGrams={selectedRecord?.weightGrams}
            unit={currentUnit}
            busy={busy}
            onCancel={() => setSheetVisible(false)}
            onSave={saveWeight}
          />
        )}
      </AnimatePresence>
      </main>
    </IconContext.Provider>
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
  const countryCode = String(visit.countryCode || "").trim().toUpperCase();
  const flag = /^[A-Z]{2}$/.test(countryCode)
    ? [...countryCode].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("")
    : "";
  const parts = [flag, visit.country, visit.city]
    .filter(Boolean)
    .filter((part, index, values) => values.indexOf(part) === index);
  return parts.join(" ") || "暂未识别";
}

function AdminRecords({ records }) {
  const [expanded, setExpanded] = useState(false);
  const orderedRecords = useMemo(
    () => [...records].sort((left, right) => right.date.localeCompare(left.date)),
    [records],
  );
  const canCollapse = orderedRecords.length > 5;
  const visibleRecords = expanded ? orderedRecords : orderedRecords.slice(0, 5);

  if (!records.length) return <p className="admin-empty">还没有体重记录</p>;
  return (
    <div className="admin-records">
      <div className="admin-table-wrap admin-records-table">
        <table>
          <thead><tr><th>日期</th><th>体重</th><th>最后更新</th></tr></thead>
          <tbody>
            {visibleRecords.map((record) => (
              <tr key={`${record.date}-${record.updatedAt}`}>
                <td>{record.date}</td>
                <td>{formatKg(record.weightGrams)} kg</td>
                <td>{formatAdminTime(record.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canCollapse && (
        <div className="admin-records-footer">
          <button
            type="button"
            className="admin-records-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "收起至最近 5 条" : `展开全部 ${orderedRecords.length} 条`}
          </button>
        </div>
      )}
    </div>
  );
}

function AdminUserBody({ user }) {
  return (
    <div className="admin-user-body">
      <dl className="admin-meta">
        <div><dt>初始日期</dt><dd>{user.initialDate || "未设置"}</dd></div>
        <div><dt>初始体重</dt><dd>{user.initialWeightGrams ? `${formatKg(user.initialWeightGrams)} kg` : "未设置"}</dd></div>
        <div><dt>背景</dt><dd>{tFor("zh-CN", THEMES.find((theme) => theme.id === user.theme)?.labelKey) || user.theme}</dd></div>
        <div><dt>字体</dt><dd>{FONT_STYLES.find((font) => font.id === user.fontStyle)?.adminLabel || "黑体"}</dd></div>
        <div><dt>身高</dt><dd>{user.heightCm ? `${user.heightCm} cm` : "未填写"}</dd></div>
        <div><dt>估算体脂</dt><dd>{user.bodyFatPercent ? `${user.bodyFatPercent}%` : "未填写"}</dd></div>
        <div><dt>创建时间</dt><dd>{formatAdminTime(user.createdAt)}</dd></div>
      </dl>
      <AdminRecords records={user.records} />
    </div>
  );
}

function AdminUser({ user, archived = false }) {
  return (
    <details className={`admin-user ${archived ? "is-archived" : ""}`}>
      <summary>
        <span><strong>{user.displayName || "未设置昵称"}</strong><small>#{archived ? user.originalUserId : user.id}</small></span>
        <span className="admin-password"><small>密码</small><b>{user.passcode || "旧账户不可恢复"}</b></span>
        <span><strong>{user.records.length}</strong><small>条记录</small></span>
        {archived && <span><strong>{formatAdminTime(user.archivedAt)}</strong><small>注销时间</small></span>}
      </summary>
      <AdminUserBody user={user} />
    </details>
  );
}

function compareAdminValues(left, right) {
  if (left === right) return 0;
  if (left == null || left === "") return 1;
  if (right == null || right === "") return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "zh-CN", { numeric: true, sensitivity: "base" });
}

function AdminSortHeader({ label, sortKey, activeKey, direction, onSort }) {
  const active = sortKey === activeKey;
  const nextDirection = active && direction === "asc" ? "降序" : "升序";
  return (
    <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        className={`admin-sort-button ${active ? "is-active" : ""}`}
        aria-label={`按${label}${nextDirection}排序`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {active && <span className="admin-sort-direction" aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function AdminUserTable({ users }) {
  const [sort, setSort] = useState({ key: "records", direction: "desc" });
  const [expandedUserId, setExpandedUserId] = useState(null);
  const sortedUsers = useMemo(() => {
    const direction = sort.direction === "asc" ? 1 : -1;
    return users
      .map((user, index) => ({ user, index }))
      .sort((left, right) => {
        const leftValue = sort.key === "identity"
          ? `${left.user.displayName || "未设置昵称"} ${left.user.id}`
          : left.user.records.length;
        const rightValue = sort.key === "identity"
          ? `${right.user.displayName || "未设置昵称"} ${right.user.id}`
          : right.user.records.length;
        return compareAdminValues(leftValue, rightValue) * direction || left.index - right.index;
      })
      .map(({ user }) => user);
  }, [sort, users]);

  const changeSort = (key) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  };

  const toggleUser = (userId) => {
    setExpandedUserId((current) => current === userId ? null : userId);
  };

  if (!users.length) return <p className="admin-empty">暂无注册用户</p>;
  return (
    <div className="admin-table-wrap admin-user-table">
      <table>
        <thead>
          <tr>
            <AdminSortHeader label="昵称和 #ID" sortKey="identity" activeKey={sort.key} direction={sort.direction} onSort={changeSort} />
            <th>密码</th>
            <AdminSortHeader label="记录数" sortKey="records" activeKey={sort.key} direction={sort.direction} onSort={changeSort} />
          </tr>
        </thead>
        <tbody>
          {sortedUsers.map((user) => {
            const expanded = expandedUserId === user.id;
            const detailsId = `admin-user-${user.id}-details`;
            return (
              <Fragment key={user.id}>
                <tr className={`admin-user-table-row ${expanded ? "is-expanded" : ""}`} onClick={() => toggleUser(user.id)}>
                  <td>
                    <button
                      type="button"
                      className="admin-user-row-toggle"
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleUser(user.id);
                      }}
                    >
                      <span className="admin-user-name">{user.displayName || "未设置昵称"}</span>
                      <span className="admin-user-id">#{user.id}</span>
                    </button>
                  </td>
                  <td className="admin-password"><b>{user.passcode || "旧账户不可恢复"}</b></td>
                  <td><strong>{user.records.length}</strong></td>
                </tr>
                {expanded && (
                  <tr id={detailsId} className="admin-user-detail-row">
                    <td className="admin-user-detail-cell" colSpan="3"><AdminUserBody user={user} /></td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AdminDashboard({ data, onRefresh, onLogout, refreshing }) {
  const [visitSort, setVisitSort] = useState({ key: "occurredAt", direction: "desc" });
  const visitColumns = [
    { key: "occurredAt", label: "时间", value: (visit) => Date.parse(visit.occurredAt) || 0 },
    { key: "path", label: "页面", value: (visit) => visit.path },
    { key: "ipAddress", label: "原始 IP", value: (visit) => visit.ipAddress },
    { key: "location", label: "大致位置", value: formatVisitLocation },
    { key: "network", label: "网络", value: (visit) => visit.networkLabel || visit.network },
    { key: "userId", label: "账户", value: (visit) => visit.userId },
    { key: "userAgent", label: "设备", value: (visit) => visit.userAgent },
  ];
  const sortedVisits = useMemo(() => {
    const column = visitColumns.find((item) => item.key === visitSort.key) || visitColumns[0];
    const direction = visitSort.direction === "asc" ? 1 : -1;
    return data.recentVisits
      .map((visit, index) => ({ visit, index }))
      .sort((left, right) => compareAdminValues(column.value(left.visit), column.value(right.visit)) * direction || left.index - right.index)
      .map(({ visit }) => visit);
  }, [data.recentVisits, visitSort]);
  const changeVisitSort = (key) => {
    setVisitSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  };
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
        <div className="admin-header-actions">
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
          <AdminUserTable users={data.activeUsers} />
        </div>
      </section>

      <details className="admin-section admin-archive-section">
        <summary className="admin-section-title admin-archive-summary"><h2>注销归档</h2><span>{data.archivedUsers.length} 人</span></summary>
        <div className="admin-users admin-archive-content">
          {data.archivedUsers.length
            ? data.archivedUsers.map((user) => <AdminUser key={user.id} user={user} archived />)
            : <p className="admin-empty">还没有注销账户</p>}
        </div>
      </details>

      <section className="admin-section">
        <div className="admin-section-title"><h2>最近访问</h2><span>累计 {data.stats.totalVisits}</span></div>
        {data.recentVisits.length ? (
          <div className="admin-table-wrap admin-visits-table">
            <table>
              <thead>
                <tr>
                  {visitColumns.map((column) => (
                    <AdminSortHeader
                      key={column.key}
                      label={column.label}
                      sortKey={column.key}
                      activeKey={visitSort.key}
                      direction={visitSort.direction}
                      onSort={changeVisitSort}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedVisits.map((visit, index) => (
                  <tr key={`${visit.occurredAt}-${visit.visitorId}-${index}`}>
                    <td>{formatAdminTime(visit.occurredAt)}</td>
                    <td>{visit.path}</td>
                    <td>{visit.ipAddress || "旧记录未保存"}</td>
                    <td>{formatVisitLocation(visit)}</td>
                    <td>{visit.networkLabel || visit.network || "暂未识别"}</td>
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#ead8b5");
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
        <div className="admin-lock"><LockKey /></div>
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
  const [screen, setScreen] = useState("loading");
  const [showAccess, setShowAccess] = useState(false);
  const [accountData, setAccountData] = useState(null);
  const [accountPasscode, setAccountPasscode] = useState("");
  const [demoData, setDemoData] = useState(() => makeDemoData());
  useVisitTracking("/");

  useEffect(() => {
    let active = true;

    api("/api/me")
      .then((data) => {
        if (!active) return;
        setAccountData(data);
        setScreen("account");
      })
      .catch(() => {
        if (active) setScreen("demo");
      });

    return () => {
      active = false;
    };
  }, []);

  const resetToDemo = () => {
    setAccountData(null);
    setAccountPasscode("");
    setDemoData(makeDemoData());
    setScreen("demo");
  };

  const logout = async () => {
    try {
      await api("/api/sessions", { method: "DELETE" });
    } finally {
      resetToDemo();
    }
  };

  if (screen === "loading") {
    return (
      <main className="loading-screen" data-theme={demoData.account.theme} data-font={demoData.account.fontStyle}>
        <div className="loading-calendar" aria-hidden="true" />
        <p>正在打开你的日历...</p>
      </main>
    );
  }

  if (screen === "account" && accountData) {
    return <CalendarApp key="account" initialData={accountData} demo={false} accountPasscode={accountPasscode} onLogout={logout} onDeleted={resetToDemo} />;
  }

  return (
    <IconContext.Provider value={iconContextForFont(demoData.account.fontStyle)}>
      <div className="app-root" data-theme={demoData.account.theme} data-font={demoData.account.fontStyle}>
        <CalendarApp key={`demo-${demoData.account.theme}-${demoData.account.fontStyle}`} initialData={demoData} demo onOpenAccount={() => setShowAccess(true)} />
        <AnimatePresence>
          {showAccess && (
            <AccessPanel
              key="account-access"
              onClose={() => setShowAccess(false)}
              onSuccess={(data, passcode) => {
                setAccountData(data);
                setAccountPasscode(passcode);
                setShowAccess(false);
                setScreen("account");
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </IconContext.Provider>
  );
}

function PublicAboutPage() {
  useVisitTracking("/about");
  return <AboutPage standalone />;
}

function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(browserLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem("weight-calendar:language", language);
    } catch {
      // The interface still works when browser storage is disabled.
    }
    if (window.location.pathname.replace(/\/+$/, "") === "/data") return;
    const pagePath = window.location.pathname.replace(/\/+$/, "") || "/";
    const title = pagePath === "/about"
      ? `${tFor(language, "aboutPrivacy")} | ${tFor(language, "appName")}`
      : tFor(language, "seoTitle");
    const description = tFor(language, "seoDescription");
    const canonicalUrl = `https://wcal.mikeywa.site${pagePath === "/about" ? "/about" : "/"}`;
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", title);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", description);
    document.querySelector('meta[property="og:url"]')?.setAttribute("content", canonicalUrl);
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", canonicalUrl);
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage: setLanguageState,
    t: (key, values) => tFor(language, key, values),
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export default function App() {
  useInterfaceSounds();
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return (
    <IconContext.Provider value={ICON_CONTEXT_BY_FONT.regular}>
      <MotionConfig reducedMotion="user">
        <I18nProvider>
          {path === "/data" ? <AdminApp /> : path === "/about" ? <PublicAboutPage /> : <CalendarRoot />}
        </I18nProvider>
      </MotionConfig>
    </IconContext.Provider>
  );
}
