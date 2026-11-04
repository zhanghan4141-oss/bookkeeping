declare module 'lunar-javascript' {
  export class Lunar {
    getYear(): number;
    getMonth(): number; // 负数表示闰月
    getDay(): number;
    getYearInChinese(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
  }
  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    static fromDate(date: Date): Solar;
    getLunar(): Lunar;
  }
}
