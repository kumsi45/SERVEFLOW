import { supabase } from '../../../core/database';
import type { OwnerReportsPeriodKey } from './ownerReportsReadModel';

export type MenuSalesRow = {
  rank: number; menuItemKey: string | null; name: string; category: string;
  quantity: number; itemLineSalesValue: number; salesSharePercent: number | null;
  archived: boolean; matchedToCurrentMenu: boolean;
};
export type MenuSalesReport = {
  currency: string; period: { key: OwnerReportsPeriodKey; currentStart: string; currentEnd: string; timezone: string; completeness: string };
  totalItemLineSalesValue: number; soldItems: MenuSalesRow[];
  noSalesItems: Array<{ menuItemKey: string; name: string; category: string; quantity: number; currentlyAvailable: boolean }>;
  legacyUnattributedItemCount: number; unmatchedItemLineCount: number; limitations: string[];
};
const fail = () => new Error('Some menu report information could not be loaded. Try again.');
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(); return value as Record<string, unknown>; };
const text = (value: unknown): string => { if (typeof value !== 'string') throw fail(); return value; };
const number = (value: unknown): number => { if (typeof value !== 'number' || !Number.isFinite(value)) throw fail(); return value; };
const boolean = (value: unknown): boolean => { if (typeof value !== 'boolean') throw fail(); return value; };
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw fail(); return value; };

export function parseMenuSalesReport(value: unknown): MenuSalesReport {
  const root = record(value); const period = record(root.period);
  if (root.contractVersion !== 'owner_menu_sales_v1' || !['today','yesterday','week','month','custom'].includes(text(period.key))) throw fail();
  for (const boundary of [period.currentStart, period.currentEnd]) if (!Number.isFinite(Date.parse(text(boundary)))) throw fail();
  return {
    currency: text(root.currency),
    period: { key: period.key as OwnerReportsPeriodKey, currentStart: text(period.currentStart), currentEnd: text(period.currentEnd), timezone: text(period.timezone), completeness: text(period.completeness) },
    totalItemLineSalesValue: number(root.totalItemLineSalesValue),
    soldItems: array(root.soldItems).map((value, index) => {
      const row = record(value); const rank = number(row.rank); if (rank !== index + 1) throw fail();
      return { rank, menuItemKey: row.menuItemKey === null ? null : text(row.menuItemKey), name: text(row.name), category: text(row.category), quantity: number(row.quantity), itemLineSalesValue: number(row.itemLineSalesValue), salesSharePercent: row.salesSharePercent === null ? null : number(row.salesSharePercent), archived: boolean(row.archived), matchedToCurrentMenu: boolean(row.matchedToCurrentMenu) };
    }),
    noSalesItems: array(root.noSalesItems).map(value => { const row = record(value); if (number(row.quantity) !== 0 || !boolean(row.currentlyAvailable)) throw fail(); return { menuItemKey: text(row.menuItemKey), name: text(row.name), category: text(row.category), quantity: 0, currentlyAvailable: true }; }),
    legacyUnattributedItemCount: number(root.legacyUnattributedItemCount), unmatchedItemLineCount: number(root.unmatchedItemLineCount), limitations: array(root.limitations).map(text),
  };
}

export async function loadOwnerMenuSalesReport(restaurantId: string, period: OwnerReportsPeriodKey, start: string | null, end: string | null): Promise<MenuSalesReport> {
  const { data, error } = await supabase.rpc('get_owner_menu_sales_report', { target_restaurant_id: restaurantId, requested_period: period, custom_start_date: start, custom_end_date: end });
  if (error) throw new Error('Could not load menu sales. Try again.');
  return parseMenuSalesReport(data);
}
