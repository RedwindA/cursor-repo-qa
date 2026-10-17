// 时间、数字格式化

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${String(s % 60).padStart(2, "0")} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

/** 运行中计时：0:42 */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

const dateFmt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const shortDateFmt = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });

export function fmtDateTime(ts: number): string {
  return dateFmt.format(ts);
}

export function fmtTime(ts: number): string {
  return timeFmt.format(ts);
}

/** GitHub 风格的相对时间：刚刚 / 5 分钟前 / 昨天 / 3 天前 / 2025/3/1 */
export function fmtRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 30) return `${day} 天前`;
  const d = new Date(ts);
  return d.getFullYear() === new Date(now).getFullYear() ? shortDateFmt.format(d) : dateFmt.format(d).split(" ")[0];
}
