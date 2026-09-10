import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../database/prisma.service';
import type { ReceivablesAgeingBucket, ResolvedReportPeriod } from '../billing-report.types';
import { type BillingReportQueryDto, ReceivablesBucket } from '../dto/billing-report-query.dto';

type DatabaseReceivableRow = {
  invoiceNumber: string;
  customer: string;
  customerNumber: string;
  customerId: string;
  dueDate: Date;
  daysOverdue: number;
  ageingBucket: ReceivablesAgeingBucket['key'];
  totalCents: number;
  paidCents: number;
  outstandingAmountCents: number;
  status: string;
  totalRows: number;
};

type DatabaseBucketRow = {
  ageingBucket: ReceivablesAgeingBucket['key'] | '__TOTAL__';
  customerCount: number;
  invoiceCount: number;
  outstandingAmountCents: bigint | number;
};

type DatabaseCountRow = { total: number };

@Injectable()
export class ReceivablesReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(query: BillingReportQueryDto, period: ResolvedReportPeriod) {
    const cte = this.receivablesCte(query, period);
    const bucketFilter = this.bucketFilter(query.ageingBucket);
    const offset = (query.page - 1) * query.pageSize;
    const [databaseRows, bucketRows, countRows] = await Promise.all([
      this.prisma.$queryRaw<DatabaseReceivableRow[]>(Prisma.sql`
        ${cte}
        SELECT
          r."invoiceNumber",
          r.customer,
          r."customerNumber",
          r."customerId",
          r."dueDate",
          r."daysOverdue",
          COALESCE(r."ageingBucket", '__TOTAL__') AS "ageingBucket",
          r."totalCents",
          r."paidCents",
          r."outstandingAmountCents",
          r.status,
          (COUNT(*) OVER())::int AS "totalRows"
        FROM aged_receivables r
        WHERE r."outstandingAmountCents" > 0 ${bucketFilter}
        ORDER BY r."daysOverdue" DESC, r."invoiceNumber" ASC
        LIMIT ${query.pageSize} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<DatabaseBucketRow[]>(Prisma.sql`
        ${cte}
        SELECT
          r."ageingBucket",
          COUNT(DISTINCT r."customerId")::int AS "customerCount",
          COUNT(*)::int AS "invoiceCount",
          SUM(r."outstandingAmountCents")::bigint AS "outstandingAmountCents"
        FROM aged_receivables r
        WHERE r."outstandingAmountCents" > 0
        GROUP BY GROUPING SETS ((r."ageingBucket"), ())
      `),
      this.prisma.$queryRaw<DatabaseCountRow[]>(Prisma.sql`
        ${cte}
        SELECT COUNT(*)::int AS total
        FROM aged_receivables r
        WHERE r."outstandingAmountCents" > 0 ${bucketFilter}
      `),
    ]);
    const data = databaseRows.map(({ totalRows: _totalRows, ...row }) => row);
    const total = countRows[0]?.total ?? 0;
    const buckets = this.allBuckets(bucketRows);
    const totals = bucketRows.find((row) => row.ageingBucket === '__TOTAL__');
    return {
      data,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
      buckets,
      totals: {
        customerCount: Number(totals?.customerCount ?? 0),
        invoiceCount: Number(totals?.invoiceCount ?? 0),
        outstandingAmountCents: Number(totals?.outstandingAmountCents ?? 0),
      },
      asAt: new Date(period.to.getTime() - 1).toISOString(),
      timezone: period.timezone,
    };
  }

  private receivablesCte(query: BillingReportQueryDto, period: ResolvedReportPeriod): Prisma.Sql {
    const where = [
      Prisma.sql`i.status::text IN ('ISSUED', 'PAID', 'OVERDUE')`,
      Prisma.sql`i."issueDate" < ${period.to}`,
    ];
    if (query.customerId) where.push(Prisma.sql`i."customerId" = ${query.customerId}::uuid`);
    if (query.invoiceStatus) where.push(Prisma.sql`i.status::text = ${query.invoiceStatus}`);
    if (query.planId)
      where.push(
        Prisma.sql`(i."purchasePlanId" = ${query.planId}::uuid OR s."planId" = ${query.planId}::uuid)`,
      );
    if (query.search) {
      const search = `%${query.search}%`;
      where.push(
        Prisma.sql`(i."invoiceNumber" ILIKE ${search} OR c."firstName" ILIKE ${search} OR c."lastName" ILIKE ${search} OR c.email ILIKE ${search})`,
      );
    }
    return Prisma.sql`
      WITH receivables AS (
        SELECT
          i.id,
          i."invoiceNumber",
          CONCAT(c."firstName", ' ', c."lastName") AS customer,
          c."customerNumber",
          i."customerId",
          i."dueDate",
          i."totalCents",
          i.status::text AS status,
          CASE
            WHEN i."paidAt" IS NOT NULL AND i."paidAt" < ${period.to}
              THEN i."totalCents"
            ELSE COALESCE(SUM(
              CASE
                WHEN p.status::text IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
                  AND p."paidAt" < ${period.to}
                THEN p."amountCents"
                ELSE 0
              END
            ), 0)
          END::int AS "paidCents"
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i."customerId"
        LEFT JOIN "Subscription" s ON s.id = i."subscriptionId"
        LEFT JOIN "Payment" p ON p."invoiceId" = i.id
        WHERE ${Prisma.join(where, ' AND ')}
        GROUP BY i.id, c."firstName", c."lastName", c."customerNumber"
      ), aged_receivables AS (
        SELECT
          r.*,
          GREATEST(r."totalCents" - r."paidCents", 0)::int AS "outstandingAmountCents",
          GREATEST(${period.toLocalDate}::date - r."dueDate"::date, 0)::int AS "daysOverdue",
          CASE
            WHEN ${period.toLocalDate}::date <= r."dueDate"::date THEN 'current'
            WHEN ${period.toLocalDate}::date - r."dueDate"::date <= 30 THEN '1-30'
            WHEN ${period.toLocalDate}::date - r."dueDate"::date <= 60 THEN '31-60'
            WHEN ${period.toLocalDate}::date - r."dueDate"::date <= 90 THEN '61-90'
            ELSE '90+'
          END AS "ageingBucket"
        FROM receivables r
      )
    `;
  }

  private bucketFilter(bucket?: ReceivablesBucket): Prisma.Sql {
    if (!bucket) return Prisma.empty;
    if (bucket === ReceivablesBucket.OVERDUE) return Prisma.sql`AND r."daysOverdue" > 0`;
    if (bucket === ReceivablesBucket.OVER_60) return Prisma.sql`AND r."daysOverdue" > 60`;
    return Prisma.sql`AND r."ageingBucket" = ${bucket}`;
  }

  private allBuckets(rows: DatabaseBucketRow[]): ReceivablesAgeingBucket[] {
    const definitions: Array<[ReceivablesAgeingBucket['key'], string]> = [
      ['current', 'Current'],
      ['1-30', '1–30 days overdue'],
      ['31-60', '31–60 days overdue'],
      ['61-90', '61–90 days overdue'],
      ['90+', '90+ days overdue'],
    ];
    return definitions.map(([key, label]) => {
      const row = rows.find((candidate) => candidate.ageingBucket === key);
      return {
        key,
        label,
        customerCount: Number(row?.customerCount ?? 0),
        invoiceCount: Number(row?.invoiceCount ?? 0),
        outstandingAmountCents: Number(row?.outstandingAmountCents ?? 0),
      };
    });
  }
}
