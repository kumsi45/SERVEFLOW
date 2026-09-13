import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getOccupiedOwnerTableIds } from '../../src/modules/owner/services/ownerTablesReadModel';

const sql = readFileSync('supabase/migrations/261_public_qr_session_lookup_occupancy_side_effect_free.sql', 'utf8')
  .replace(/--[^\n]*/g, '');
const service = readFileSync('src/modules/public-qr-ordering/services/publicQrOrderService.ts', 'utf8');
describe('occupancy-side-effect-free public QR session lookup migration', () => {
  it('replaces only the exact existing four-argument helper', () => {
    expect(sql.match(/create or replace function/gi)).toHaveLength(1);
    expect(sql).toMatch(/get_public_qr_order_session_p76_base\(\s*target_restaurant_slug text,\s*table_number text,\s*qr_token text,\s*browser_session_token text/);
    expect(sql).not.toMatch(/\b(grant|revoke|alter|drop)\b/i);
    expect(sql).toContain("to_regprocedure('public.get_public_qr_order_session_p76_base(text,text,text,text)') is null");
  });
  it('has no occupancy writes, lock, expiry refresh or release calls', () => {
    expect(sql).not.toMatch(/\b(insert|update|delete)\b|advisory|for update|expire_stale|auto_release/i);
  });
  it('retains QR capability validation and tenant-scoped exact table identity', () => {
    expect(sql).toContain('tables.restaurant_id = target_restaurant_id');
    expect(sql).toContain('tables.qr_token = target_qr_token');
    expect(sql).toContain('tables.active = true');
    expect(sql).toContain('orders.table_id = target_table.id');
    expect(sql).toContain('orders.restaurant_id = target_restaurant_id');
  });
  it('returns truthful null, never a fabricated session', () => {
    expect(sql).toMatch(/if active_order.id is null then\s*return null;/);
    expect(sql).not.toMatch(/gen_random_uuid|returning/);
    expect(service).toMatch(/function normalizeSession[\s\S]*?if \(!value \|\| typeof value !== "object"\) \{\s*return null;/);
  });
  it('retains response fields and browser ownership rejection', () => {
    for (const key of ['order_id','status','dining_session_status','dining_session_expires_at','total_price','table_number','customer_name','payment_method','created_at','payment_verified_at','items','invoices']) {
      expect(sql).toContain(`'${key}'`);
    }
    expect(sql).toContain('active_order.browser_session_token is distinct from normalized_browser_session_token');
    expect(sql).toContain('This table currently has an active dining session.');
  });
});

describe('Owner occupancy remains canonical rather than scan or enablement authority', () => {
  const order = { restaurant_id:'tenant-a',table_id:'table-a',status:'pending_payment',dining_session_status:'open',table_released_at:null };
  it('scans without orders do not occupy', () => expect(getOccupiedOwnerTableIds([], 'tenant-a').size).toBe(0));
  it('real open unreleased order occupies independently of administrative state', () => {
    for (const active of [true,false]) {
      const candidate = {...order,active};
      expect(getOccupiedOwnerTableIds([candidate], 'tenant-a').has('table-a')).toBe(true);
    }
  });
  it('payment and service labels alone do not release an open session', () => {
    for (const status of ['paid','served','completed']) expect(getOccupiedOwnerTableIds([{...order,status}], 'tenant-a').has('table-a')).toBe(true);
  });
  it('canonical release removes occupancy and preserves tenant isolation', () => {
    expect(getOccupiedOwnerTableIds([{...order,dining_session_status:'closed',table_released_at:'2026-09-13'}], 'tenant-a').size).toBe(0);
    expect(getOccupiedOwnerTableIds([order], 'tenant-b').size).toBe(0);
  });
});
