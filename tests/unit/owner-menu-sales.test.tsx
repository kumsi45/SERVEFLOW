import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
vi.mock('../../src/core/database', () => ({ supabase: { rpc: vi.fn() } }));
import { supabase } from '../../src/core/database';
import { parseMenuSalesReport, loadOwnerMenuSalesReport } from '../../src/modules/owner/services/ownerMenuSalesReport';
import { MenuSalesRows, OwnerMenuSalesReport, menuSalesTitle } from '../../src/modules/owner/pages/OwnerMenuSalesReport';

const fixture = () => ({ contractVersion: 'owner_menu_sales_v1', currency: 'ETB', period: { key: 'today', currentStart: '2026-09-22T21:00:00Z', currentEnd: '2026-09-23T10:00:00Z', timezone: 'Africa/Nairobi', completeness: 'in_progress' }, totalItemLineSalesValue: 120,
  soldItems: Array.from({ length: 12 }, (_, i) => ({ rank: i+1, menuItemKey: `item-${i}`, name: `Dish ${i+1}`, category: 'Food', quantity: 1, itemLineSalesValue: 10, salesSharePercent: 8.33, archived: false, matchedToCurrentMenu: true })),
  noSalesItems: [{ menuItemKey: 'zero', name: 'No-sale dish', category: 'Food', quantity: 0, currentlyAvailable: true }], legacyUnattributedItemCount: 0, unmatchedItemLineCount: 0, limitations: [] });

describe('Complete menu sales', () => {
  it('renders every backend rank, quantity, value, share and separate zero-sale items', () => {
    const html = renderToStaticMarkup(<MenuSalesRows report={parseMenuSalesReport(fixture())} />);
    for (const value of ['Dish 12', '#12', '1 sold', '10 ETB', '8.33', 'Sales Value', 'Quantity Sold', 'Share', 'No Sales Today', '0 sold']) expect(html).toContain(value);
    expect(html).not.toContain('Unit Price');
  });
  it('rejects missing values and malformed ranks instead of fabricating zero', () => {
    const bad = fixture(); delete (bad.soldItems[0] as Partial<typeof bad.soldItems[0]>).quantity;
    expect(() => parseMenuSalesReport(bad)).toThrow('could not be loaded');
    const badRank = fixture(); badRank.soldItems[1].rank = 1;
    expect(() => parseMenuSalesReport(badRank)).toThrow();
  });
  it('preserves zero versus unavailable share and historical limitations', () => {
    const data = parseMenuSalesReport(fixture()); data.soldItems[0].salesSharePercent = null; data.soldItems[0].itemLineSalesValue = 0;
    data.legacyUnattributedItemCount = 1; data.unmatchedItemLineCount = 1;
    const html = renderToStaticMarkup(<MenuSalesRows report={data} />);
    expect(html).toContain('Share unavailable'); expect(html).toContain('0 ETB'); expect(html).toContain('cannot be assigned'); expect(html).toContain('could not be matched');
  });
  it('loads only through the RPC and forwards server period arguments unchanged', async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: fixture(), error: null } as never);
    await loadOwnerMenuSalesReport('tenant', 'custom', '2026-09-01', '2026-09-10');
    expect(supabase.rpc).toHaveBeenLastCalledWith('get_owner_menu_sales_report', { target_restaurant_id: 'tenant', requested_period: 'custom', custom_start_date: '2026-09-01', custom_end_date: '2026-09-10' });
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ error: { message: 'internal SQL detail' } } as never);
    await expect(loadOwnerMenuSalesReport('tenant', 'today', null, null)).rejects.toThrow('Could not load menu sales. Try again.');
  });
  it('does not load detail during render and offers all period headings', () => {
    vi.mocked(supabase.rpc).mockClear();
    const html = renderToStaticMarkup(<OwnerMenuSalesReport restaurantId="tenant" period="week" start={null} end={null} preview={<p>Summary</p>} />);
    expect(supabase.rpc).not.toHaveBeenCalled(); expect(html).toContain('View full menu report'); expect(html).toContain("This Week&#x27;s Menu Sales");
    expect(menuSalesTitle('yesterday')).toBe("Yesterday's Menu Sales"); expect(menuSalesTitle('month')).toBe("This Month's Menu Sales"); expect(menuSalesTitle('custom')).toBe('Menu Sales');
  });
  it('keeps mobile rows, request guard and errors confined to menu detail', () => {
    const css=readFileSync('src/modules/owner/styles/ownerReports.css','utf8');
    const component=readFileSync('src/modules/owner/pages/OwnerMenuSalesReport.tsx','utf8');
    expect(css).toContain('grid-template-columns:36px minmax(0,1fr)');
    expect(component).toContain('request === generation.current'); expect(component).toContain('if (busy.current) return'); expect(component).toContain('role="alert"'); expect(component).toContain('role="status"');
    expect(readFileSync('src/modules/owner/services/ownerMenuSalesReport.ts','utf8')).not.toContain('.from(');
  });
});
