import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildQrPrintDocument, QR_PRINT_CARD_CSS, QR_PRINT_FORMATS } from '../../src/modules/owner/services/ownerQrPrintPresentation';

const page = readFileSync('src/modules/owner/pages/OwnerDashboardPage.tsx','utf8');
const center = page.slice(page.indexOf('export function QrPrintCenter'),page.indexOf('function QrTablesPage'));
const card = (tableNumber:number) => ({tableNumber,image:'data:image/png;base64,fixture'});
const input = {restaurantName:'GRAND ROYAL',logoUrl:null,showServeFlow:true,format:'compact' as const,cards:[card(1)]};
describe('Phase 2C.1 print-card refinement',()=>{
  it('retains six-card default with exactly one Recommended control indicator',()=>{
    expect(center).toContain('useState<QrPrintFormat>("compact")');
    expect(QR_PRINT_FORMATS.compact.cardsPerPage).toBe(6);
    expect((center.match(/<em>Recommended<\/em>/g)||[])).toHaveLength(1);
    expect(Object.values(QR_PRINT_FORMATS).map(format=>format.label).join(' ')).not.toContain('Recommended');
    expect(QR_PRINT_FORMATS.single.label).toBe('Single table');
  });
  it.each([1,10,100])('formats numeric Table %i without reducing identity',number=>{
    expect(buildQrPrintDocument({...input,cards:[card(number)]})).toContain(`TABLE ${String(number).padStart(2,'0')}`);
  });
  it('preserves primary table typography and QR square/white quiet-zone protections',()=>{
    expect(QR_PRINT_CARD_CSS).toContain('--name-size:8pt;--table-size:16pt;--qr-size:54mm');
    expect(QR_PRINT_CARD_CSS).toContain('aspect-ratio:1');
    expect(QR_PRINT_CARD_CSS).toContain('background:#fff');
    expect(center).toContain('width: 1024, margin: 4');
    expect(center).toContain('dark: "#000000", light: "#ffffff"');
  });
  it.each(['GRAND ROYAL','Grand Royal Restaurant Café and Hospitality Conference Garden'])('retains bounded restaurant name %s',name=>{
    expect(buildQrPrintDocument({...input,restaurantName:name})).toContain(name);
    expect(QR_PRINT_CARD_CSS).toContain('text-overflow:ellipsis;white-space:nowrap');
  });
  it('shows usable optional logo separately from QR and removes failed images cleanly',()=>{
    expect(buildQrPrintDocument({...input,logoUrl:'https://example.invalid/logo.png'})).toContain('class="sf-print-logo"');
    expect(buildQrPrintDocument({...input,logoUrl:null})).not.toContain('<img class="sf-print-logo"');
    expect(buildQrPrintDocument({...input,logoUrl:'https://example.invalid/logo.png'})).toContain('onerror="this.remove()"');
    expect(center).toContain('disabled={!logoAvailable}');
    expect(center).toContain('checked={showLogo && logoAvailable}');
    expect(center).toContain('image.naturalWidth > 0');
    expect(center).toContain('No logo available');
    expect(center).toContain('Logo unavailable — could not load');
    expect(QR_PRINT_CARD_CSS).toContain('object-fit:contain;aspect-ratio:auto');
  });
  it('uses one scan instruction and optional subtle ServeFlow attribution per card',()=>{
    const html=buildQrPrintDocument(input);
    expect((html.match(/Scan to view menu &amp; order/g)||[])).toHaveLength(1);
    expect(html).toContain('Powered by ServeFlow');
    expect(buildQrPrintDocument({...input,showServeFlow:false})).not.toContain('Powered by ServeFlow');
    expect(center).toContain('Show ServeFlow branding');
    expect(center).toContain('{showServeFlow ? <small className="sf-print-attribution">');
  });
  it.each([['compact',6],['large',4],['single',1]] as const)('paginates %s with fixed A4 geometry and unbroken cards',(format,count)=>{
    const html=buildQrPrintDocument({...input,format,cards:Array.from({length:count+1},(_,i)=>card(i+1))});
    expect((html.match(/<main class="sf-print-page/g)||[])).toHaveLength(2);
    expect((html.match(/<article class="sf-print-card/g)||[])).toHaveLength(count+1);
    expect(html).toContain('@page{size:A4 portrait;margin:10mm}');
    expect(QR_PRINT_CARD_CSS).toContain('height:277mm');
    expect(QR_PRINT_CARD_CSS).toContain('page-break-inside:avoid');
  });
  it('escapes branding, includes only customer-facing material, and never mutates QR authority',()=>{
    const html=buildQrPrintDocument({...input,restaurantName:'Café <script>alert(1)</script> & Garden'});
    expect(html).toContain('Café &lt;script&gt;alert(1)&lt;/script&gt; &amp; Garden');
    expect(html).not.toMatch(/<button|<input|<nav|qr_token|qr_path|Occupied|Enabled|Disabled/);
    expect(center).not.toMatch(/supabase\.rpc|regenerate_restaurant|subscribe|setInterval/);
    expect(center).toContain('imageSourcesRef.current[row.table.id] !== row.orderingResolution.url');
    expect(QR_PRINT_CARD_CSS).not.toMatch(/gradient|box-shadow|url\(/);
  });
});
