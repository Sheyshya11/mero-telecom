import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../../config/configuration';
import type { ResolvedReportPeriod } from '../billing-report.types';
import {
  type BillingReportQueryDto,
  ReportingPeriodPreset,
  RevenueGroupBy,
} from '../dto/billing-report-query.dto';

export const DEFAULT_BUSINESS_TIMEZONE = 'Australia/Adelaide';

@Injectable()
export class ReportPeriodService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  resolve(query: BillingReportQueryDto, now = new Date()): ResolvedReportPeriod {
    const timezone =
      query.timezone?.trim() ||
      this.config.get('billingReporting', { infer: true })?.timezone ||
      DEFAULT_BUSINESS_TIMEZONE;
    this.assertTimezone(timezone);
    const today = this.localDate(now, timezone);
    const preset =
      query.preset ??
      (query.from || query.to ? ReportingPeriodPreset.CUSTOM : ReportingPeriodPreset.THIS_MONTH);
    const dates = this.presetDates(preset, today, query);
    const from = this.localMidnightUtc(dates.from, timezone);
    const to = this.localMidnightUtc(this.addDays(dates.to, 1), timezone);
    if (to <= from)
      throw new BadRequestException('Report end date must be on or after the start date.');
    if (to.getTime() - from.getTime() > 367 * 86_400_000)
      throw new BadRequestException('Report ranges cannot exceed 366 local calendar days.');
    const localDayCount =
      Math.round(
        (this.localMidnightForCalculation(dates.to).getTime() -
          this.localMidnightForCalculation(dates.from).getTime()) /
          86_400_000,
      ) + 1;
    const previousToLocal = this.addDays(dates.from, -1);
    const previousFromLocal = this.addDays(previousToLocal, -(localDayCount - 1));
    return {
      from,
      to,
      previousFrom: this.localMidnightUtc(previousFromLocal, timezone),
      previousTo: from,
      timezone,
      generatedAt: now,
      fromLocalDate: dates.from,
      toLocalDate: dates.to,
    };
  }

  metadata(period: ResolvedReportPeriod) {
    return {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      timezone: period.timezone,
      generatedAt: period.generatedAt.toISOString(),
    };
  }

  defaultGroupBy(period: ResolvedReportPeriod): RevenueGroupBy {
    const days = (period.to.getTime() - period.from.getTime()) / 86_400_000;
    return days <= 31
      ? RevenueGroupBy.DAY
      : days <= 120
        ? RevenueGroupBy.WEEK
        : RevenueGroupBy.MONTH;
  }

  bucket(date: Date, groupBy: RevenueGroupBy, timezone: string): string {
    const local = this.localDate(date, timezone);
    if (groupBy === RevenueGroupBy.MONTH) return local.slice(0, 7);
    if (groupBy === RevenueGroupBy.WEEK) {
      const weekday = Number(
        new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone })
          .formatToParts(date)
          .find((part) => part.type === 'weekday')?.value === 'Sun'
          ? 7
          : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
              new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(
                date,
              ),
            ) + 1,
      );
      return this.addDays(local, -(weekday - 1));
    }
    return local;
  }

  localDate(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  addDays(value: string, days: number): string {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  }

  localMidnightForCalculation(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  private presetDates(
    preset: ReportingPeriodPreset,
    today: string,
    query: BillingReportQueryDto,
  ): { from: string; to: string } {
    const [year, month] = today.split('-').map(Number);
    switch (preset) {
      case ReportingPeriodPreset.TODAY:
        return { from: today, to: today };
      case ReportingPeriodPreset.YESTERDAY: {
        const yesterday = this.addDays(today, -1);
        return { from: yesterday, to: yesterday };
      }
      case ReportingPeriodPreset.LAST_7_DAYS:
        return { from: this.addDays(today, -6), to: today };
      case ReportingPeriodPreset.THIS_MONTH:
        return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: today };
      case ReportingPeriodPreset.LAST_MONTH: {
        const start = new Date(Date.UTC(year, month - 2, 1));
        const end = new Date(Date.UTC(year, month - 1, 0));
        return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
      }
      case ReportingPeriodPreset.THIS_QUARTER: {
        const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
        return { from: `${year}-${String(quarterMonth).padStart(2, '0')}-01`, to: today };
      }
      case ReportingPeriodPreset.THIS_FINANCIAL_YEAR:
        return { from: `${month >= 7 ? year : year - 1}-07-01`, to: today };
      case ReportingPeriodPreset.CUSTOM:
        if (
          !query.from ||
          !query.to ||
          !/^\d{4}-\d{2}-\d{2}$/.test(query.from) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(query.to)
        )
          throw new BadRequestException('Custom reports require valid from and to calendar dates.');
        return { from: query.from, to: query.to };
    }
  }

  private assertTimezone(timezone: string): void {
    try {
      new Intl.DateTimeFormat('en-AU', { timeZone: timezone }).format(new Date());
    } catch {
      throw new BadRequestException('The reporting timezone is invalid.');
    }
  }

  private localMidnightUtc(value: string, timezone: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    const desired = Date.UTC(year, month - 1, day);
    let candidate = desired;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date(candidate));
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((item) => item.type === type)?.value);
      const represented = Date.UTC(
        part('year'),
        part('month') - 1,
        part('day'),
        part('hour'),
        part('minute'),
        part('second'),
      );
      candidate += desired - represented;
    }
    return new Date(candidate);
  }
}
