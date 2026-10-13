import { expect, test, type Locator, type Page } from '@playwright/test';

// 1x1 の透明 PNG
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);

const PW = 'password-1234';
const HOME = /localhost:4173\/$/;

async function logout(page: Page) {
	await page.getByTestId('user-menu-trigger').click();
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
	await expect(page.getByTestId('user-menu-trigger')).toContainText(name);
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
	await expect(page.getByRole('heading', { name: 'ユーザーを招待' })).toBeVisible();
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

	// 4b. カテゴリー・マイルストーンを定義
	const addIn = (label: string) =>
		page.locator('form', { has: page.getByLabel(label) }).getByRole('button', { name: '追加' });
	await page.getByLabel('カテゴリー名').fill('フロントエンド');
	await addIn('カテゴリー名').click();
	await expect(page.getByRole('listitem').filter({ hasText: 'フロントエンド' })).toBeVisible();
	await page.getByLabel('マイルストーン名').fill('v1.0');
	await page.getByLabel('リリース日').fill('2026-11-30');
	await addIn('マイルストーン名').click();
	await expect(page.getByRole('listitem').filter({ hasText: 'v1.0' })).toBeVisible();
	await logout(page);

	// 5. ゲストが登録して起票
	await acceptInvite(page, guestUrl, '顧客 太郎');
	await page
		.getByRole('main')
		.getByRole('link', { name: /ACME サイト改修/ })
		.click();
	await page.getByRole('link', { name: '新規課題' }).click();
	await page.getByLabel('タイトル').fill('ログインできない');
	await page.getByLabel('カテゴリー').selectOption({ label: 'フロントエンド' });
	await page
		.getByTestId('attach-input')
		.setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG });
	await expect(page.getByLabel('本文')).toHaveValue(
		/!\[screen\.png\]\(\/projects\/ACME\/attachments\/[0-9a-f-]{36}\)/
	);
	await page.getByRole('button', { name: '起票する' }).first().click();
	await expect(page.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(page.getByRole('main').getByText('ACME-1')).toBeVisible();
	const shot = page.locator('.markdown img[alt="screen.png"]');
	await expect(shot).toBeVisible();
	expect(await shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
	await expect(
		page.getByRole('region', { name: '添付ファイル' }).getByRole('link', { name: 'screen.png' })
	).toBeVisible();

	// 5b. 添付 API: アップロード → 配信ヘッダ（HTML は必ずダウンロード）→ 存在しない ID は 404
	const up = await page.request.post('/projects/ACME/attachments', {
		headers: { Origin: 'http://localhost:4173', Accept: 'application/json' },
		multipart: {
			file: {
				name: '仕様書.html',
				mimeType: 'text/html',
				buffer: Buffer.from('<script>alert(1)</script>')
			}
		}
	});
	expect(up.status()).toBe(201);
	const uploaded = await up.json();
	expect(uploaded).toMatchObject({ filename: '仕様書.html', isImage: false });
	const dl = await page.request.get(uploaded.url);
	expect(dl.status()).toBe(200);
	expect(dl.headers()['content-type']).toBe('application/octet-stream');
	expect(dl.headers()['content-disposition']).toBe(
		`attachment; filename*=UTF-8''${encodeURIComponent('仕様書.html')}`
	);
	expect(dl.headers()['x-content-type-options']).toBe('nosniff');
	expect(await dl.text()).toBe('<script>alert(1)</script>');
	const missing = await page.request.get(
		'/projects/ACME/attachments/00000000-0000-7000-8000-000000000000'
	);
	expect(missing.status()).toBe(404);
	await logout(page);

	// 6. メンバーが登録し、ゲストを担当者にする
	await acceptInvite(page, memberUrl, '開発 花子');
	await page.goto('/projects/ACME/issues/1');
	await expect(page.getByLabel('カテゴリー').locator('option:checked')).toHaveText(
		'フロントエンド'
	);
	await page.getByLabel('担当者').selectOption({ label: '顧客 太郎' });
	await page.getByLabel('マイルストーン').selectOption({ label: 'v1.0（11/30 リリース）' });
	await page.getByRole('button', { name: '保存' }).click();
	await expect(page.getByText('保存しました')).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('担当者').locator('option:checked')).toHaveText('顧客 太郎');
	await expect(page.getByLabel('マイルストーン').locator('option:checked')).toHaveText(
		'v1.0（11/30 リリース）'
	);
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

	// 8. ゲストがコメント（PDF を添付）。テキストの貼り付けは横取りしない
	await page.goto('/projects/ACME/issues/1');
	const commentBox = page.getByLabel('コメントを追加');
	const textPastePrevented = await commentBox.evaluate((el) => {
		const data = new DataTransfer();
		data.setData('text/plain', 'hello');
		const ev = new ClipboardEvent('paste', {
			clipboardData: data,
			bubbles: true,
			cancelable: true
		});
		el.dispatchEvent(ev);
		return ev.defaultPrevented;
	});
	expect(textPastePrevented).toBe(false);
	await commentBox.fill('確認しました\n');
	await page
		.locator('form.new-comment')
		.getByTestId('attach-input')
		.setInputFiles({
			name: 'spec.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('%PDF-1.4\n%%EOF\n')
		});
	await expect(commentBox).toHaveValue(/\[spec\.pdf\]\(\/projects\/ACME\/attachments\//);
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('.markdown').getByText('確認しました')).toBeVisible();
	const attachmentList = page.getByRole('region', { name: '添付ファイル' });
	await expect(attachmentList.getByRole('link', { name: 'spec.pdf' })).toBeVisible();

	// 8b. 自分の添付を削除できる
	await attachmentList.getByRole('button', { name: 'spec.pdf を削除' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: '削除する' }).click();
	await expect(attachmentList.getByRole('link', { name: 'spec.pdf' })).toBeHidden();

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
	// 10. 管理者が一覧・ボードを絞り込む
	await page.goto('/projects/ACME');
	const issueRow = page.getByRole('row', { name: /ログインできない/ });
	await expect(issueRow.getByText('フロントエンド')).toBeVisible();
	await expect(issueRow.getByText('v1.0')).toBeVisible();
	await page.getByLabel('キーワード').fill('存在しない課題');
	await page.getByLabel('キーワード').press('Enter');
	await expect(page.getByText('条件に一致する課題はありません')).toBeVisible();
	await page.getByLabel('キーワード').fill('acme-1');
	await page.getByLabel('キーワード').press('Enter');
	await expect(issueRow).toBeVisible();
	await page.getByLabel('マイルストーン').selectOption({ label: '未設定' });
	await expect(page).toHaveURL(/milestone=none/);
	await expect(page.getByText('条件に一致する課題はありません')).toBeVisible();

	await page.goto('/projects/ACME/board');
	await page.getByLabel('マイルストーン').selectOption({ label: '未設定' });
	await expect(page).toHaveURL(/milestone=none/);
	await expect(page.getByTestId('card-1')).toBeHidden();
	await page.getByLabel('マイルストーン').selectOption({ label: 'v1.0（11/30 リリース）' });
	await expect(page.getByTestId('column-in_progress').getByTestId('card-1')).toBeVisible();

	// 11. 管理者がカテゴリー名を変更し、マイルストーンを完了にする
	await page.goto('/projects/ACME/settings');
	await page.locator('summary', { hasText: 'フロントエンド' }).click();
	await page.getByLabel('フロントエンド の名称').fill('UI');
	await page
		.locator('form', { has: page.getByLabel('フロントエンド の名称') })
		.getByRole('button', { name: '保存' })
		.click();
	await expect(page.locator('summary', { hasText: 'UI' })).toBeVisible();
	await page
		.getByRole('listitem')
		.filter({ hasText: 'v1.0' })
		.getByRole('button', { name: '完了にする' })
		.click();
	await expect(
		page
			.getByRole('listitem')
			.filter({ hasText: 'v1.0' })
			.getByText(/^完了 · /)
	).toBeVisible();

	// 完了したマイルストーンは起票時の選択肢に出ない
	await page.goto('/projects/ACME/issues/new');
	await expect(
		page.getByLabel('マイルストーン').locator('option', { hasText: 'v1.0' })
	).toHaveCount(0);
});
