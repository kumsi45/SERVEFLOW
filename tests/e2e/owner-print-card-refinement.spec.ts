import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const widths = [[360,800],[390,844],[430,932],[768,1024],[820,1180],[1024,768],[1280,800],[1440,900]];
for (const [width,height] of widths) test(`refined print cards ${width}x${height}`, async ({page}) => {
  await page.setViewportSize({width,height});
  await page.goto('/tests/e2e/fixtures/owner-print-center.html?name=long');
  await expect(page.getByRole('button',{name:'Print / Save as PDF'})).toBeEnabled();
  await expect(page.getByRole('checkbox',{name:'Show logo',exact:true})).toBeChecked();
  await expect(page.getByText('Recommended',{exact:true})).toHaveCount(1);
  await expect(page.getByRole('radio').first()).toBeChecked();
  await expect(page.locator('.sf-print-card')).toHaveCount(6);
  await expect(page.locator('.sf-print-logo')).toHaveCount(6);
  await expect(page.locator('.sf-print-table').last()).toHaveText('TABLE 100');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const geometry = await page.locator('.sf-print-card').evaluateAll(cards=>cards.map(card=>{
    const box=card.getBoundingClientRect();
    const qr=card.querySelector('.sf-print-qr')!.getBoundingClientRect();
    const children=[...card.children].map(child=>child.getBoundingClientRect());
    return {square:Math.abs(qr.width-qr.height)<1,contained:children.every(child=>child.left>=box.left-1 && child.right<=box.right+1 && child.top>=box.top-1 && child.bottom<=box.bottom+1)};
  }));
  expect(geometry.every(card=>card.square && card.contained)).toBe(true);
  await page.getByRole('checkbox',{name:'Show logo',exact:true}).uncheck();
  await expect(page.locator('.sf-print-logo')).toHaveCount(0);
  await page.getByRole('checkbox',{name:'Show ServeFlow branding',exact:true}).uncheck();
  await expect(page.locator('.sf-print-attribution')).toHaveCount(0);
  await page.getByRole('button',{name:'Clear',exact:true}).click();
  await expect(page.getByRole('button',{name:'Print / Save as PDF'})).toBeDisabled();
  await page.getByRole('button',{name:'Select all',exact:true}).click();
  await expect(page.getByRole('button',{name:'Print / Save as PDF'})).toBeEnabled();
  await page.getByRole('button',{name:'Print / Save as PDF'}).scrollIntoViewIfNeeded();
  const action=await page.getByRole('button',{name:'Print / Save as PDF'}).boundingBox();
  expect(action!.y+action!.height).toBeLessThanOrEqual(height);
});

for (const logo of ['missing','broken']) test(`logo ${logo} leaves clean printable cards`,async ({page})=>{
  await page.goto(`/tests/e2e/fixtures/owner-print-center.html?logo=${logo}`);
  await expect(page.getByRole('checkbox',{name:'Show logo',exact:true})).toBeDisabled();
  await expect(page.getByRole('checkbox',{name:'Show logo',exact:true})).not.toBeChecked();
  await expect(page.locator('.od-print-toggles [role=status]')).toContainText(logo==='missing' ? 'No logo available' : 'Logo unavailable');
  await expect(page.locator('.sf-print-logo')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Print / Save as PDF'})).toBeEnabled();
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Print / Save as PDF'}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState();
  await expect(popup.locator('.sf-print-logo')).toHaveCount(0);
});

test('branding off matches preview and customer print window',async ({page})=>{
  await page.goto('/tests/e2e/fixtures/owner-print-center.html');
  await expect(page.getByRole('checkbox',{name:'Show logo',exact:true})).toBeChecked();
  await page.getByRole('checkbox',{name:'Show logo',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Show ServeFlow branding',exact:true}).uncheck();
  await expect(page.locator('.sf-print-logo,.sf-print-attribution')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Print / Save as PDF'})).toBeEnabled();
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Print / Save as PDF'}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState();
  await expect(popup.locator('.sf-print-card')).toHaveCount(6);
  await expect(popup.locator('.sf-print-logo,.sf-print-attribution')).toHaveCount(0);
});

for (const [format,count,pages] of [['6 per page',6,1],['4 per page',4,1],['Single table',1,1],['6 per page',7,2]] as const) test(`A4 PDF ${format} ${count} cards`,async ({page},testInfo)=>{
  await page.goto(`/tests/e2e/fixtures/owner-print-center.html?count=${count}&name=long`);
  await expect(page.getByRole('checkbox',{name:'Show logo',exact:true})).toBeChecked();
  await page.getByRole('radio',{name:new RegExp(format)}).check();
  await expect(page.getByRole('button',{name:'Print / Save as PDF'})).toBeEnabled();
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Print / Save as PDF'}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState();
  await popup.emulateMedia({media:'print'});
  await expect(popup.locator('.sf-print-card')).toHaveCount(count);
  await expect(popup.locator('.sf-print-page')).toHaveCount(pages);
  expect(await popup.locator('.sf-print-page').evaluateAll(elements=>elements.map(element=>element.querySelectorAll('.sf-print-card').length))).toEqual(count===7 ? [6,1] : [count]);
  await expect(popup.locator('.sf-print-logo')).toHaveCount(count);
  await expect(popup.locator('.sf-print-attribution')).toHaveCount(count);
  await expect(popup.locator('.sf-print-instruction')).toHaveCount(count);
  await expect(popup.locator('button,input,nav,aside')).toHaveCount(0);
  expect(await popup.locator('body').innerText()).not.toMatch(/https?:|qr_token|qr_path|Enabled|Disabled|Occupied|QR Ready|Print Center|00000000/);
  const geometry=await popup.locator('.sf-print-card').evaluateAll(cards=>cards.map(card=>{
    const bounds=card.getBoundingClientRect();
    return [...card.children].every(child=>{const r=child.getBoundingClientRect();return r.left>=bounds.left-1 && r.right<=bounds.right+1 && r.top>=bounds.top-1 && r.bottom<=bounds.bottom+1;});
  }));
  expect(geometry.every(Boolean)).toBe(true);
  const pdf=await popup.pdf({path:testInfo.outputPath('qr-cards-a4.pdf'),preferCSSPageSize:true,printBackground:true});
  const raw=pdf.toString('latin1');
  expect((raw.match(/\/Type \/Page\b/g)||[]).length).toBe(pages);
  const mediaBox=raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  expect(Number(mediaBox?.[1])).toBeCloseTo(595.28,0);
  expect(Number(mediaBox?.[2])).toBeCloseTo(841.89,0);
  await popup.screenshot({path:testInfo.outputPath('qr-cards-print-layout.png'),fullPage:true});
  writeFileSync(testInfo.outputPath('qr-cards-customer.html'),await popup.content());
});
