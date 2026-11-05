declare module 'lunar-javascript' {
  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    static fromDate(date: Date): Solar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    toYmd(): string;
    getLunar(): Lunar;
  }
  export class Lunar {
    static fromYmd(year: number, month: number, day: number): Lunar;
    getYear(): number;
    getMonth(): number; // 负数表示闰月
    getDay(): number;
    getSolar(): Solar;
  }
  export class LunarMonth {
    static fromYm(year: number, month: number): LunarMonth;
    getYear(): number;
    getMonth(): number;
    getDayCount(): number;
    next(months: number): LunarMonth;
  }
}
