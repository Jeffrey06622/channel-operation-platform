export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function fmtMoney(n: number): string {
  if (n === 0) return '¥0';
  return '¥' + Math.round(n).toLocaleString('zh-CN');
}

export function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

export function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN');
}
