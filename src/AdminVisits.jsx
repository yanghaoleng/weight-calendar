import { Fragment, useEffect, useMemo, useState } from "react";
import { formatKg } from "./lib/calendar.js";

const PAGE_LABELS = { calendar: "体重日历", settings: "设置", "ai-analysis": "AI 健康建议", "cloud-sync": "云端同步", donation: "打赏作者", about: "关于与隐私" };
const pageLabel = (key) => PAGE_LABELS[key] || key || "未知页面";

const RANGES = [
  { key: "7", label: "最近 7 天" },
  { key: "30", label: "最近一个月" },
  { key: "all", label: "有史以来" },
];

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

const CN_CITY_NAMES = {
  beijing: "北京", shanghai: "上海", guangzhou: "广州", shenzhen: "深圳",
  chengdu: "成都", chongqing: "重庆", hangzhou: "杭州", wuhan: "武汉",
  xian: "西安", nanjing: "南京", suzhou: "苏州", tianjin: "天津",
  changsha: "长沙", zhengzhou: "郑州", qingdao: "青岛", dalian: "大连",
  xiamen: "厦门", fuzhou: "福州", kunming: "昆明", guiyang: "贵阳",
  nanning: "南宁", harbin: "哈尔滨", shenyang: "沈阳", changchun: "长春",
  shijiazhuang: "石家庄", taiyuan: "太原", hefei: "合肥", nanchang: "南昌",
  jinan: "济南", lanzhou: "兰州", xining: "西宁", yinchuan: "银川",
  urumqi: "乌鲁木齐", huhehaote: "呼和浩特", lasa: "拉萨",
  "hong kong": "香港", macau: "澳门", taipei: "台北",
  ningbo: "宁波", wuxi: "无锡", foshan: "佛山", dongguan: "东莞",
  zhuhai: "珠海", haikou: "海口", sanya: "三亚",
};

function formatVisitLocation(visit) {
  const countryCode = String(visit.countryCode || "").trim().toUpperCase();
  const flag = /^[A-Z]{2}$/.test(countryCode)
    ? [...countryCode].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("")
    : "";
  let country = visit.country;
  let city = visit.city;
  if (countryCode === "CN") {
    country = "中国";
    if (city) {
      const normalizedCity = String(city).trim().toLowerCase();
      if (CN_CITY_NAMES[normalizedCity]) city = CN_CITY_NAMES[normalizedCity];
    }
  }
  const parts = [flag, country, city]
    .filter(Boolean)
    .filter((part, index, values) => values.indexOf(part) === index);
  return parts.join(" ") || "暂未识别";
}

async function adminFetch(path, options) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  if (!response.ok) {
    let message = "请求失败";
    try {
      message = (await response.json()).error || message;
    } catch {
      /* 保持默认消息 */
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function identityLabel(visitor) {
  if (visitor.kind === "account") {
    const remark = String(visitor.remarkName || "").trim();
    const nickname = String(visitor.displayName || "").trim();
    return `${nickname || "未设置昵称"} · ${remark || `#${visitor.userId}`}`;
  }
  return `访客 ${visitor.visitorHash || ""}`;
}

function formatRelativeActivity(value) {
  const time = Date.parse(value || "");
  if (Number.isNaN(time)) return "暂无活动";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 172800) return "昨天";
  if (seconds < 259200) return "前天";
  return formatAdminTime(value);
}

function VisitChart({ daily, activeDay, onHover, onSelect, onClear }) {
  const width = 640;
  const height = 200;
  const padLeft = 44;
  const padRight = 14;
  const padTop = 18;
  const padBottom = 30;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const maxVisits = Math.max(4, ...daily.map((item) => item.visits));
  const niceMax = Math.max(4, Math.ceil((maxVisits * 1.15) / 4) * 4);
  const x = (index) => padLeft + (daily.length === 1 ? plotWidth / 2 : (index / (daily.length - 1)) * plotWidth);
  const y = (visits) => padTop + plotHeight - (visits / niceMax) * plotHeight;
  const points = daily.map((item, index) => `${x(index)},${y(item.visits)}`).join(" ");
  const labelEvery = daily.length <= 7 ? 1 : Math.ceil(daily.length / 8);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="admin-visits-svg" role="img" aria-label="每日访问量折线图" preserveAspectRatio="xMidYMid meet">
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const gridY = padTop + plotHeight - ratio * plotHeight;
        return (
          <g key={ratio}>
            <line x1={padLeft} x2={width - padRight} y1={gridY} y2={gridY} className="admin-visits-grid" />
            <text x={padLeft - 8} y={gridY + 4} className="admin-visits-y" textAnchor="end">{Math.round(niceMax * ratio)}</text>
          </g>
        );
      })}
      {daily.length > 1 && <polyline points={points} className="admin-visits-line" />}
      {daily.map((item, index) => {
        const cx = x(index);
        const cy = y(item.visits);
        const active = activeDay === item.date;
        const hitWidth = Math.max(26, plotWidth / daily.length);
        return (
          <g key={item.date}>
            <rect
              x={cx - hitWidth / 2}
              y={padTop}
              width={hitWidth}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => onHover(item.date)}
              onMouseLeave={() => onHover(null)}
              onClick={(event) => {
                event.stopPropagation();
                if (active) onClear(); else onSelect(item.date);
              }}
            />
            <circle
              cx={cx}
              cy={cy}
              r={active ? 5 : 3.5}
              className={active ? "admin-visits-dot is-active" : "admin-visits-dot"}
              pointerEvents="none"
            />
          </g>
        );
      })}
      {daily.map((item, index) =>
        (index % labelEvery === 0 || index === daily.length - 1) ? (
          <text key={item.date} x={x(index)} y={height - 8} className="admin-visits-x" textAnchor="middle">{item.date.slice(5)}</text>
        ) : null
      )}
    </svg>
  );
}

function VisitUserRow({ visitor, onDetail }) {
  const hasDetail = visitor.kind === "account";
  return (
    <button type="button" className="admin-visit-user" onClick={() => hasDetail && onDetail(visitor)} disabled={!hasDetail}>
      <div className="admin-visit-user-main">
        <strong>{identityLabel(visitor)}</strong>
        <small>{visitor.visitCount} 次访问</small>
      </div>
      <time dateTime={visitor.lastAt}>{formatRelativeActivity(visitor.lastAt)}</time>
    </button>
  );
}

function AdminRecordsSimple({ records }) {
  if (!records || !records.length) return null;
  const ordered = [...records].sort((left, right) => right.date.localeCompare(left.date));
  return (
    <div className="admin-table-wrap admin-records-table">
      <table>
        <thead><tr><th>日期</th><th>体重</th><th>最后更新</th></tr></thead>
        <tbody>
          {ordered.map((record) => (
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

function AdminRemarkEditor({ user, kind, onSaved }) {
  const [value, setValue] = useState(user.remarkName || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = value.trim() !== (user.remarkName || "");
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      await adminFetch("/api/admin/user-remark", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: kind, id: user.id, remarkName: value.trim() || null }),
      });
      onSaved(value.trim() || null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="admin-remark-editor">
      <dt>备注名</dt>
      <dd>
        <input
          type="text"
          value={value}
          placeholder="留空则显示昵称或用户 ID"
          maxLength={20}
          aria-label="备注名"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void save(); }}
        />
        <button type="button" className="admin-secondary" onClick={() => void save()} disabled={saving || !dirty}>{saving ? "保存中" : "保存"}</button>
        {error && <span className="admin-remark-error" role="alert">{error}</span>}
      </dd>
    </div>
  );
}

function AdminUserDetail({ detail, activeUsers, localUsers, onBack, onRemarkSaved }) {
  const [journey, setJourney] = useState(null);
  const [journeyError, setJourneyError] = useState(false);
  const subjectKey = detail.key;

  useEffect(() => {
    let active = true;
    setJourney(null);
    setJourneyError(false);
    adminFetch(`/api/admin/analytics/user?subject=${encodeURIComponent(subjectKey)}&limit=500`)
      .then((data) => { if (active) setJourney(data); })
      .catch(() => { if (active) setJourneyError(true); });
    return () => { active = false; };
  }, [subjectKey]);

  const profile = detail.kind === "account"
    ? activeUsers.find((user) => user.id === detail.userId)
      || localUsers.find((user) => user.id === detail.userId)
    : null;
  const profileKind = profile
    ? activeUsers.some((user) => user.id === profile.id) ? "account" : "local"
    : null;

  const visits = useMemo(() => {
    if (!journey) return [];
    const events = [...(journey.events || [])]
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id - b.id);
    const groups = [];
    let current = null;
    for (const event of events) {
      if (event.eventType === "page_view") {
        current = { time: event.occurredAt, pageKey: event.pageKey, steps: [] };
        groups.push(current);
      } else if (event.eventType === "click" && current) {
        current.steps.push(event);
      }
    }
    return groups;
  }, [journey]);

  return (
    <section className="admin-section admin-visits-detail">
      <div className="admin-section-title">
        <h2>用户详情</h2>
        <button type="button" className="admin-secondary" onClick={onBack}>← 返回访问统计</button>
      </div>
      <div className="admin-visits-detail-head">
        <div className="admin-visits-detail-identity">
          <strong>{identityLabel(detail)}</strong>
          <small>{detail.kind === "account" ? "注册用户" : "访客"}</small>
        </div>
        <div className="admin-visits-detail-loc">
          <span>{formatVisitLocation(detail)}</span>
          <span>{detail.ipAddress || "旧记录未保存"}</span>
          <span>{detail.networkLabel || detail.network || "暂未识别"}</span>
        </div>
      </div>
      {profile && (
        <div className="admin-visits-detail-profile">
          <h3>体重日历资料</h3>
          <dl className="admin-meta">
            <AdminRemarkEditor
              user={profile}
              kind={profileKind}
              onSaved={(remarkName) => onRemarkSaved && onRemarkSaved(profileKind, profile.id, remarkName)}
            />
            <div><dt>初始日期</dt><dd>{profile.initialDate || "未设置"}</dd></div>
            <div><dt>初始体重</dt><dd>{profile.initialWeightGrams ? `${formatKg(profile.initialWeightGrams)} kg` : "未设置"}</dd></div>
            <div><dt>身高</dt><dd>{profile.heightCm ? `${profile.heightCm} cm` : "未填写"}</dd></div>
            <div><dt>估算体脂</dt><dd>{profile.bodyFatPercent ? `${profile.bodyFatPercent}%` : "未填写"}</dd></div>
            <div><dt>体重记录</dt><dd>{profile.records?.length || 0} 条</dd></div>
          </dl>
          <AdminRecordsSimple records={profile.records || []} />
        </div>
      )}
      <div className="admin-visits-detail-journey">
        <h3>访问与体验路径</h3>
        <p className="admin-security-note">每次页面浏览为一次访问，其后到下一次浏览前的功能点击构成该次体验路径。</p>
        {journeyError
          ? <p className="admin-empty">路径读取失败，请刷新重试</p>
          : !journey
            ? <p className="admin-empty">读取中…</p>
            : !visits.length
              ? <p className="admin-empty">暂无页面浏览记录</p>
              : visits.map((visit, index) => (
                <div key={`${visit.time}-${index}`} className="admin-uv-row">
                  <div className="admin-uv-meta">
                    <time>{formatAdminTime(visit.time)}</time>
                    <span>{pageLabel(visit.pageKey)}</span>
                  </div>
                  <div className="admin-uv-path">
                    {visit.steps.length
                      ? visit.steps.map((step, stepIndex) => (
                        <Fragment key={step.id}>
                          {stepIndex > 0 && <span className="admin-uv-arrow" aria-hidden="true">→</span>}
                          <span className="admin-uv-step" title={`${pageLabel(step.pageKey)} · ${formatAdminTime(step.occurredAt)}`}>{step.elementLabel || step.elementKey}</span>
                        </Fragment>
                      ))
                      : <span className="admin-uv-empty">无功能点击</span>}
                  </div>
                </div>
              ))}
      </div>
    </section>
  );
}

export default function AdminVisits({ activeUsers = [], localUsers = [], onRemarkSaved }) {
  const [range, setRange] = useState("7");
  const [daily, setDaily] = useState(null);
  const [dailyError, setDailyError] = useState(false);
  const [hoverDay, setHoverDay] = useState(null);
  const [pinnedDay, setPinnedDay] = useState(null);
  const [visitors, setVisitors] = useState(null);
  const [visitorsError, setVisitorsError] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let active = true;
    setDaily(null);
    setDailyError(false);
    adminFetch(`/api/admin/analytics/visits?range=${range}`)
      .then((data) => { if (active) setDaily(data.daily || []); })
      .catch(() => { if (active) setDailyError(true); });
    return () => { active = false; };
  }, [range]);

  const activeDay = pinnedDay || hoverDay;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setPinnedDay(null);
        setHoverDay(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let active = true;
    setVisitors(null);
    setVisitorsError(false);
    if (!activeDay) return undefined;
    adminFetch(`/api/admin/analytics/visits?day=${encodeURIComponent(activeDay)}`)
      .then((data) => { if (active) setVisitors(data.visitors || []); })
      .catch(() => { if (active) setVisitorsError(true); });
    return () => { active = false; };
  }, [activeDay]);

  if (detail) {
    return (
      <AdminUserDetail
        detail={detail}
        activeUsers={activeUsers}
        localUsers={localUsers}
        onBack={() => setDetail(null)}
        onRemarkSaved={onRemarkSaved}
      />
    );
  }

  return (
    <section
      className="admin-section admin-visits-section"
      onClick={(event) => {
        if (!pinnedDay && !hoverDay) return;
        if (event.target.closest(
          ".admin-visits-svg, .admin-visits-tabs, .admin-visits-unpin, .admin-visit-user-list, .admin-secondary"
        )) return;
        setPinnedDay(null);
        setHoverDay(null);
      }}
    >
      <div className="admin-section-title">
        <h2>访问统计</h2>
        <span>按天统计页面访问量</span>
      </div>
      <div className="admin-visits-tabs" role="tablist" aria-label="访问统计时间范围">
        {RANGES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={range === item.key}
            className={range === item.key ? "is-active" : ""}
            onClick={() => {
              setRange(item.key);
              setPinnedDay(null);
              setHoverDay(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="admin-visits-layout">
        <div className="admin-visits-chart-wrap">
          {dailyError
            ? <p className="admin-empty">读取失败，请刷新重试</p>
            : !daily
              ? <p className="admin-empty">读取中…</p>
              : <VisitChart daily={daily} activeDay={activeDay} onHover={setHoverDay} onSelect={setPinnedDay} onClear={() => setPinnedDay(null)} />}
          {daily && <p className="admin-visits-chart-note">悬停圆点实时查看该天用户；点击固定当天焦点后可悬停用户查看详情，按 Esc 或点击空白处解除固定。</p>}
        </div>
        <aside className="admin-visits-side">
          <div className="admin-visits-side-head">
            <h4>{activeDay ? `${activeDay} 访问用户` : "选择日期查看用户"}</h4>
            {pinnedDay && <button type="button" className="admin-secondary admin-visits-unpin" onClick={() => setPinnedDay(null)}>取消固定</button>}
          </div>
          {!activeDay
            ? <p className="admin-empty">悬停或点击折线图上的圆点，查看当天访问过的用户。</p>
            : visitorsError
              ? <p className="admin-empty">读取失败，请刷新重试</p>
              : !visitors
                ? <p className="admin-empty">读取中…</p>
                : !visitors.length
                  ? <p className="admin-empty">当天暂无访问</p>
                  : <div className="admin-visit-user-list">
                    {visitors.map((visitor) => <VisitUserRow key={visitor.key} visitor={visitor} onDetail={setDetail} />)}
                  </div>}
        </aside>
      </div>
    </section>
  );
}
