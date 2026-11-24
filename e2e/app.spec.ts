import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const projectRef = 'xxfwhpluvndvsawlxwte';
const user = {
  id: '10000000-0000-0000-0000-000000000001',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'e2e@example.test',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
};
const initialUpdatedAt = '2026-11-24T10:00:00.000Z';

function makeSession() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: user.id, role: 'authenticated', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.e2e-signature`;
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'e2e-refresh-token',
    user,
  };
}

async function prepareContext(context: BrowserContext) {
  await context.addInitScript(({ key, session }) => {
    localStorage.setItem(key, JSON.stringify(session));
  }, { key: `sb-${projectRef}-auth-token`, session: makeSession() });
}

async function mockBackend(page: Page, server: { updatedAt: string }) {
  await page.route('**/rest/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path.endsWith('/daily_entry') && request.method() === 'GET') {
      const date = (url.searchParams.get('entry_date') ?? 'eq.2026-11-24').replace('eq.', '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '20000000-0000-0000-0000-000000000001',
          entry_date: date,
          sleep_hours: null,
          sleep_notes: '',
          events_context: '',
          behavior_notes: '',
          status: 'draft',
          updated_at: server.updatedAt,
        }),
      });
      return;
    }

    if (path.endsWith('/indicator_score') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }

    if (path.endsWith('/rpc/save_entry_draft') && request.method() === 'POST') {
      const payload = request.postDataJSON() as { p_expected_updated_at?: string };
      if (payload.p_expected_updated_at !== server.updatedAt) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'P0001',
            message: 'Conflito: registro alterado em outra sessão ou não encontrado',
            details: null,
            hint: null,
          }),
        });
        return;
      }
      server.updatedAt = new Date(Date.parse(server.updatedAt) + 1000).toISOString();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(server.updatedAt),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });
}

async function openAuthenticatedPage(browser: Browser, server: { updatedAt: string }, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, timezoneId: 'America/Recife' });
  await prepareContext(context);
  const page = await context.newPage();
  await mockBackend(page, server);
  await page.goto('/');
  await expect(page.locator('.daily-header')).toBeVisible();
  return { context, page };
}

test.describe('Entrelinhas — fluxos reais no navegador', () => {
  test('preserva alterações offline e sincroniza ao recuperar a conexão', async ({ browser }) => {
    const server = { updatedAt: initialUpdatedAt };
    const { context, page } = await openAuthenticatedPage(browser, server);

    await page.getByRole('button', { name: 'Começar registro' }).first().click();
    const firstIndicator = page.locator('fieldset.score').first();
    await expect(firstIndicator).toBeVisible();

    await context.setOffline(true);
    await firstIndicator.getByRole('button', { name: '5 de 10' }).click();

    await expect(page.getByText('Alterações pendentes')).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('entrelinhas-offline', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const value = await new Promise<any>((resolve, reject) => {
        const tx = db.transaction('pending-drafts', 'readonly');
        const request = tx.objectStore('pending-drafts').get('20000000-0000-0000-0000-000000000001');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return value?.fields?.scores ? Object.values(value.fields.scores).filter(v => v === 5).length : 0;
    })).toBe(1);

    await context.setOffline(false);
    await expect(page.getByText('Alterações salvas')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('entrelinhas-offline', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const value = await new Promise(resolve => {
        const tx = db.transaction('pending-drafts', 'readonly');
        const request = tx.objectStore('pending-drafts').get('20000000-0000-0000-0000-000000000001');
        request.onsuccess = () => resolve(request.result ?? null);
      });
      db.close();
      return value;
    })).toBeNull();
    await context.close();
  });

  test('duas sessões não sobrescrevem silenciosamente a versão mais recente', async ({ browser }) => {
    const server = { updatedAt: initialUpdatedAt };
    const first = await openAuthenticatedPage(browser, server);
    const second = await openAuthenticatedPage(browser, server);

    await first.page.getByRole('button', { name: 'Começar registro' }).first().click();
    await second.page.getByRole('button', { name: 'Começar registro' }).first().click();

    await first.page.locator('fieldset.score').first().getByRole('button', { name: '5 de 10' }).click();
    await expect(first.page.getByText('Alterações salvas')).toBeVisible({ timeout: 10_000 });

    await second.page.locator('fieldset.score').first().getByRole('button', { name: '6 de 10' }).click();
    await expect(second.page.getByText(/alterado em outro lugar/i)).toBeVisible({ timeout: 10_000 });
    await expect(second.page.getByRole('button', { name: 'Descartar cópia local e recarregar' })).toBeVisible();

    await first.context.close();
    await second.context.close();
  });

  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    test(`não cria rolagem horizontal em ${viewport.width}px`, async ({ browser }) => {
      const { context, page } = await openAuthenticatedPage(browser, { updatedAt: initialUpdatedAt }, viewport);
      const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
      expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
      await context.close();
    });
  }
});
