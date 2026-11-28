import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test('peralihan tema beranimasi, tersimpan, dapat dipakai keyboard dan menghormati reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await loginAsAdmin(page);const toggle=page.getByRole('button',{name:'Ganti tema'});
  await expect(toggle).toBeEnabled();await toggle.focus();await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);await expect(toggle).toHaveAttribute('aria-pressed','true');
  const icon=toggle.locator('.theme-toggle-icon').first();
  expect(await icon.evaluate((el)=>getComputedStyle(el).transitionProperty)).toContain('transform');
  expect(await icon.evaluate((el)=>getComputedStyle(el).transitionDuration)).toContain('0.2s');
  await expect(page.locator('html')).not.toHaveClass(/\btheme-changing\b/,{timeout:3000});
  await page.reload();await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.emulateMedia({reducedMotion:'reduce'});await toggle.click();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);await expect(toggle).toHaveAttribute('aria-pressed','false');
  expect(await icon.evaluate((el)=>getComputedStyle(el).transitionProperty)).toBe('none');
  await page.reload();await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
});
