import { expect, test, type Locator, type Page } from '@playwright/test';

const PW = 'password-1234';
const HOME = /localhost:4173\/$/;

async function logout(page: Page) {
	await page.getByRole('button', { name: 'ログアウト' }).click();
	await expect(page).toHaveURL(/\/login/);
}

async function login(page: Page, email: string) {
	await page.goto('/login');
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード').fill(PW);
	await page.getByRole('button', { name: 'ログイン' }).click();
	await expect(page).toHaveURL(HOME);
}

async function acceptInvite(page: Page, url: string, name: string) {
	await page.goto(url);
	await page.getByLabel('名前').fill(name);
	await page.getByLabel('パスワード').fill(PW);
	await page.getByRole('button', { name: '登録する' }).click();
	await expect(page).toHaveURL(HOME);
	await expect(page.getByRole('link', { name })).toBeVisible();
}

async function dragTo(page: Page, source: Locator, target: Locator) {
	const s = await source.boundingBox();
	const t = await target.boundingBox();
	if (!s || !t) throw new Error('drag source or target is not visible');
	await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
	await page.mouse.down();
	await page.mouse.move(s.x + s.width / 2 + 10, s.y + s.height / 2 + 10, { steps: 5 });
	await page.mouse.move(t.x + t.width / 2, t.y + 30, { steps: 20 });
	await page.mouse.up();
}

test('招待 → ゲスト起票 → 担当割り当て → カンバン移動 → コメント', async ({ page }) => {
	// 1. 初期セットアップ
	await page.goto('/login');
	await expect(page).toHaveURL(/\/setup/);
	await page.getByLabel('名前').fill('管理者');
	await page.getByLabel('メールアドレス').fill('admin@example.com');
	await page.getByLabel('パスワード').fill(PW);
	await page.getByRole('button', { name: 'セットアップを完了' }).click();
	await expect(page.getByRole('heading', { name: 'プロジェクト' })).toBeVisible();

	// 2. プロジェクト作成
	await page.getByRole('link', { name: '新規プロジェクト' }).click();
	await page.getByLabel('キー').fill('ACME');
	await page.getByLabel('プロジェクト名').fill('ACME サイト改修');
	await page.getByRole('button', { name: '作成' }).click();
	await expect(page.getByRole('heading', { name: 'ACME サイト改修' })).toBeVisible();

	// 3. メンバー招待
	await page.goto('/admin/users');
	await expect(page.getByRole('heading', { name: '招待', exact: true })).toBeVisible();
	await page.getByLabel('メールアドレス').fill('member@example.com');
	await page.getByLabel('ロール').selectOption('member');
	await page.getByLabel('参加プロジェクト').selectOption({ label: 'ACME サイト改修' });
	await page.getByRole('button', { name: '招待する' }).click();
	const memberUrl = await page.getByLabel('招待リンク').inputValue();
	expect(memberUrl).toContain('/invite/');

	// 4. ゲスト招待（プロジェクト設定から）
	await page.goto('/projects/ACME/settings');
	await page.getByLabel('ゲストのメールアドレス').fill('guest@example.com');
	await page.getByRole('button', { name: 'ゲストを招待' }).click();
	const guestUrl = await page.getByLabel('招待リンク').inputValue();
	await logout(page);

	// 5. ゲストが登録して起票
	await acceptInvite(page, guestUrl, '顧客 太郎');
	await page
		.getByRole('main')
		.getByRole('link', { name: /ACME サイト改修/ })
		.click();
	await page.getByRole('link', { name: '新規課題' }).click();
	await page.getByLabel('タイトル').fill('ログインできない');
	await page.getByRole('button', { name: '起票する' }).click();
	await expect(page.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(page.getByText('ACME-1')).toBeVisible();
	await logout(page);

	// 6. メンバーが登録し、ゲストを担当者にする
	await acceptInvite(page, memberUrl, '開発 花子');
	await page.goto('/projects/ACME/issues/1');
	await page.getByLabel('担当者').selectOption({ label: '顧客 太郎' });
	await page.getByRole('button', { name: '保存' }).click();
	await expect(page.getByText('保存しました')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('担当者').locator('option:checked')).toHaveText('顧客 太郎');
	await logout(page);

	// 7. ゲストがカンバンで進行中へ移動
	await login(page, 'guest@example.com');
	await page.goto('/projects/ACME/board');
	await dragTo(
		page,
		page.getByTestId('card-1'),
		page.getByTestId('column-in_progress').locator('ul')
	);
	await expect(page.getByTestId('column-in_progress').getByTestId('card-1')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('column-in_progress').getByTestId('card-1')).toBeVisible();

	// 8. ゲストがコメント
	await page.goto('/projects/ACME/issues/1');
	await page.getByLabel('コメントを追加').fill('確認しました');
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('.markdown').getByText('確認しました')).toBeVisible();

	// 9. 管理者がゲストを無効化（確認ダイアログ）
	await logout(page);
	await login(page, 'admin@example.com');
	await page.goto('/admin/users');
	const row = page.getByRole('row', { name: /顧客 太郎/ });
	await row.getByRole('button', { name: '無効化' }).click();
	await expect(page.getByRole('alertdialog')).toBeVisible();
	await page.getByRole('button', { name: '無効化する' }).click();
	await expect(page.getByRole('alertdialog')).toBeHidden();
	await expect(row.getByText('無効', { exact: true })).toBeVisible();
	await expect(row.getByRole('button', { name: '有効化' })).toBeVisible();
});
