import { expect, test } from '@playwright/test';

test('first PVE journey opens, advances, persists, and can reopen the tutorial', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '私人房间' })).toBeVisible();
  await page.getByRole('button', { name: '快速战 1 名角色' }).last().click();
  await page.getByRole('button', { name: '开始人机对战' }).click();

  const guide = page.getByRole('complementary', { name: 'PVE 新手教学' });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { name: '认识你的手牌' })).toBeVisible();
  await page.getByRole('button', { name: '退出对局' }).click();
  await expect(page.getByRole('dialog', { name: '退出当前对局？' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await guide.getByRole('button', { name: /下一步/ }).click();
  await expect(guide.getByRole('heading', { name: '组成合法牌组' })).toBeVisible();
  await guide.getByRole('button', { name: '跳过教学' }).click();
  await expect(guide).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pokewar:pve-tutorial:v1')))
    .toBe('skipped');

  await expect(page.getByRole('region', { name: '当前战斗展示' })).toBeVisible();
  await page.getByRole('button', { name: '打开战斗历史' }).click();
  await expect(page.getByRole('dialog', { name: '战斗历史' })).toBeVisible();
  await page.getByRole('button', { name: '关闭战斗历史' }).click();

  await page.getByRole('button', { name: '打开游戏规则' }).click();
  await page.getByRole('button', { name: '重新打开 PVE 新手教学' }).click();
  await expect(guide).toBeVisible();
});

test('desktop table keeps the hand and play controls inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '私人房间' })).toBeVisible();
  await page.getByRole('button', { name: '快速战 1 名角色' }).last().click();
  await page.getByRole('button', { name: '开始人机对战' }).click();
  const guide = page.getByRole('complementary', { name: 'PVE 新手教学' });
  if (await guide.isVisible()) await guide.getByRole('button', { name: '暂时关闭教学' }).click();

  const hand = page.getByLabel(/你的手牌，共/);
  const play = page.getByRole('button', { name: '确认出牌' });
  await expect(hand).toBeVisible();
  await expect(play).toBeVisible();
  const geometry = await page.evaluate(() => {
    const handElement = document.querySelector<HTMLElement>('.hand-tray');
    const playElement = [...document.querySelectorAll<HTMLElement>('button')].find(
      (element) => element.textContent.trim() === '确认出牌',
    );
    const battleElement = document.querySelector<HTMLElement>('.battle-stage');
    const trayElement = document.querySelector<HTMLElement>('.self-tray');
    if (!handElement || !playElement || !battleElement || !trayElement)
      throw new Error('LAYOUT_MISSING');
    return {
      viewportHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      handBottom: handElement.getBoundingClientRect().bottom,
      playBottom: playElement.getBoundingClientRect().bottom,
      battleBottom: battleElement.getBoundingClientRect().bottom,
      trayTop: trayElement.getBoundingClientRect().top,
    };
  });
  expect(geometry.handBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.playBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.battleBottom).toBeLessThanOrEqual(geometry.trayTop);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.viewportHeight);
});

test('temporary close lasts for reloads in the current tab without marking completion', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '私人房间' })).toBeVisible();
  await page.getByRole('button', { name: '快速战 1 名角色' }).last().click();
  await page.getByRole('button', { name: '开始人机对战' }).click();
  const guide = page.getByRole('complementary', { name: 'PVE 新手教学' });
  await guide.getByRole('button', { name: '暂时关闭教学' }).click();
  await expect(guide).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('pokewar:pve-tutorial-dismissed')))
    .toBe('closed');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pokewar:pve-tutorial:v1')))
    .toBeNull();

  await page.reload();
  await expect(page.getByRole('heading', { name: '私人房间' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'PVE 新手教学' })).toBeHidden();
});
