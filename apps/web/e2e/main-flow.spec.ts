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

/** 今日（日本時間）から offset 日後の 'YYYY-MM-DD' */
const jstDay = (offset: number) =>
	new Date(Date.now() + offset * 86_400_000).toLocaleDateString('sv-SE', {
		timeZone: 'Asia/Tokyo'
	});

/** リモート関数（command）への POST 応答。ドラッグより先に仕掛けて保存の完了を待つ */
const savedResponse = (page: Page) =>
	page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('/_app/remote') && r.ok()
	);

/** 要素の中央を掴んで dx だけ横に動かす */
async function dragBy(page: Page, target: Locator, dx: number) {
	const b = await target.boundingBox();
	if (!b) throw new Error('drag target is not visible');
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 8 });
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
	// 本文は見たまま編集。「Markdown で編集」との往復で内容が二重にならない
	const body = page.getByRole('textbox', { name: '本文' });
	const bodySource = page.locator('textarea[name="description"]');
	const sourceToggle = page.getByRole('button', { name: 'Markdown で編集' });
	// エディタの読み込みが終わるまでは textarea が「本文」になる
	await expect(body).toHaveAttribute('contenteditable', 'true');
	// タイトルから Tab で本文の編集領域に入れる
	await page.getByLabel('タイトル').focus();
	await page.keyboard.press('Tab');
	await expect(body).toBeFocused();
	await page.keyboard.type('abc');
	await sourceToggle.click();
	await expect(sourceToggle).toHaveAttribute('aria-pressed', 'true');
	await expect(bodySource).toBeVisible();
	await expect(bodySource).toHaveValue('abc');
	await bodySource.press('End');
	await bodySource.pressSequentially('d');
	await sourceToggle.click();
	await expect(sourceToggle).toHaveAttribute('aria-pressed', 'false');
	await expect(bodySource).toBeHidden();
	await expect(body).toHaveText('abcd');
	// ネストした箇条書き（Tab）と太字ボタン
	// 戻したときはエディタの末尾にキャレットがある
	await expect(body).toBeFocused();
	await page.keyboard.press('Enter');
	await page.keyboard.type('- 親');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.type('子');
	await page.getByRole('button', { name: '太字' }).click();
	await expect(page.getByRole('button', { name: '太字' })).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.type('強調');
	await page
		.getByTestId('attach-input')
		.setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG });
	await expect(bodySource).toHaveValue(
		/!\[screen\.png\]\(\/projects\/ACME\/attachments\/[0-9a-f-]{36}\)/
	);
	await page.getByRole('button', { name: '起票する' }).first().click();
	await expect(page.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(page.getByRole('main').getByText('ACME-1')).toBeVisible();
	await expect(page.locator('.markdown p', { hasText: 'abcd' })).toHaveText('abcd');
	await expect(page.locator('.markdown ul ul li', { hasText: '子' })).toBeVisible();
	await expect(page.locator('.markdown ul ul li strong')).toHaveText('強調');
	const shot = page.locator('.markdown img[alt="screen.png"]');
	await expect(shot).toBeVisible();
	expect(await shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
	await shot.click();
	const lightbox = page.getByRole('dialog', { name: '画像の拡大表示' });
	await expect(lightbox.locator('img[alt="screen.png"]')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(lightbox).toBeHidden();
	await expect(page.getByRole('region', { name: '添付ファイル' })).toContainText(
		'添付ファイル数: 1'
	);
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

	// 6b. メンバーが @ 補完でゲストをメンションしてコメント
	const mentionBox = page.getByLabel('コメントを追加');
	await mentionBox.click();
	await mentionBox.pressSequentially('@顧客');
	await page
		.getByRole('listbox', { name: 'メンションする人' })
		.getByRole('option', { name: '顧客 太郎' })
		.click();
	await mentionBox.pressSequentially('確認お願いします');
	await expect(mentionBox).toHaveValue(/^@\[顧客 太郎\]\(user:[0-9a-f-]{36}\) 確認お願いします$/);
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('.markdown .mention', { hasText: '@顧客 太郎' })).toBeVisible();

	// 6c. メンバーがタイムラインで日付を調整する
	await page.goto('/projects/ACME/issues/new');
	await page.getByLabel('タイトル').fill('トップページ改修');
	// 見たまま編集でも @ 補完でメンションできる
	const mentionBody = page.getByRole('textbox', { name: '本文' });
	await expect(mentionBody).toHaveAttribute('contenteditable', 'true');
	await page.getByLabel('タイトル').focus();
	await page.keyboard.press('Tab');
	await expect(mentionBody).toBeFocused();
	await page.keyboard.type('@顧客');
	await page
		.getByRole('listbox', { name: 'メンションする人' })
		.getByRole('option', { name: '顧客 太郎' })
		.click();
	await page.keyboard.type('お願いします');
	await expect(mentionBody.locator('.mention')).toHaveText('@顧客 太郎');
	await expect(page.locator('textarea[name="description"]')).toHaveValue(
		/^@\[顧客 太郎\]\(user:[0-9a-f-]{36}\) お願いします$/
	);
	// 通知の件数を変えないよう、確認できたら本文を消してから起票する
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.press('Backspace');
	await expect(page.locator('textarea[name="description"]')).toHaveValue('');
	await page.getByLabel('開始日').fill(jstDay(0));
	await page.getByLabel('期限日').fill(jstDay(2));
	// 手順 10 の「マイルストーン未設定」の絞り込みで 0 件になるよう v1.0 に入れる
	await page.getByLabel('マイルストーン').selectOption({ label: 'v1.0（11/30 リリース）' });
	await page.getByRole('button', { name: '起票する' }).first().click();
	await expect(page.getByRole('heading', { name: 'トップページ改修' })).toBeVisible();

	// 課題詳細にはプロジェクトのタブがないので、一覧から入る
	await page.goto('/projects/ACME');
	await page.getByRole('link', { name: 'タイムライン' }).click();
	await expect(page).toHaveURL(/\/projects\/ACME\/timeline$/);
	const bar2 = page.getByTestId('bar-2');
	await expect(bar2).toHaveAttribute('data-start', jstDay(0));
	// バーを右へ 2 日（1 日 = 32px）。ドラッグ後に課題詳細へ遷移しない
	const saved2 = savedResponse(page);
	await dragBy(page, bar2, 64);
	await saved2;
	await expect(bar2).toHaveAttribute('data-start', jstDay(2));
	await expect(bar2).toHaveAttribute('data-due', jstDay(4));
	await expect(page).toHaveURL(/\/projects\/ACME\/timeline$/);
	// 未スケジュールの ACME-1 を明日の列へ置く
	const chip1 = page.getByTestId('chip-1');
	const tomorrow = page.locator(`[data-date="${jstDay(1)}"]`);
	const saved1 = savedResponse(page);
	await dragTo(page, chip1, tomorrow);
	await saved1;
	await expect(page.getByTestId('bar-1')).toHaveAttribute('data-start', jstDay(1));
	await expect(page.getByTestId('bar-1')).toHaveAttribute('data-due', jstDay(1));
	await expect(chip1).toBeHidden();
	// 保存されている
	await page.reload();
	await expect(page.getByTestId('bar-2')).toHaveAttribute('data-start', jstDay(2));
	await expect(page.getByTestId('bar-2')).toHaveAttribute('data-due', jstDay(4));
	await expect(page.getByTestId('bar-1')).toHaveAttribute('data-start', jstDay(1));
	// グループ切替（なし）
	await page.getByLabel('グルーピング').selectOption('none');
	await expect(page).toHaveURL(/group=none/);
	await expect(page.getByTestId('bar-2')).toBeVisible();
	// 絞り込み: 未完了の ACME-1 は「完了」で消え、「すべて」で戻る
	await page.getByLabel('状態').selectOption('done');
	await expect(page.getByTestId('bar-1')).toBeHidden();
	await page.getByLabel('状態').selectOption('');
	await expect(page.getByTestId('bar-1')).toBeVisible();
	// 開始日を選ぶと、その日から表示する
	await page.getByLabel('開始日').fill(jstDay(1));
	await expect(page).toHaveURL(new RegExp(`from=${jstDay(1)}`));
	await expect(page.locator('.days [data-date]').first()).toHaveAttribute('data-date', jstDay(1));
	await logout(page);

	// 7. ゲストがカンバンで進行中へ移動
	await login(page, 'guest@example.com');

	// 7a. ゲストに「担当」と「メンション」の 2 件が届いている
	const badge = page.getByTestId('unread-badge');
	await expect(badge).toHaveText('2');
	await page.getByRole('link', { name: /通知/ }).click();
	await expect(page).toHaveURL(/\/notifications$/);
	await expect(page.getByRole('button', { name: /担当者に設定しました/ })).toBeVisible();
	await page
		.getByRole('button', { name: /メンションしました: @顧客 太郎 確認お願いします/ })
		.click();
	await expect(page).toHaveURL(/\/projects\/ACME\/issues\/1#comment-[0-9a-f-]{36}$/);
	// 課題を開くと、その課題の通知はすべて既読になる
	await expect(badge).toBeHidden();
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
	// アップロードが終わるまで送信させない（プレースホルダのまま保存されるのを防ぐ）
	let releaseUpload!: () => void;
	const uploadHeld = new Promise<void>((r) => (releaseUpload = r));
	await page.route('**/projects/ACME/attachments', async (route) => {
		await uploadHeld;
		await route.continue();
	});
	await page
		.locator('form.new-comment')
		.getByTestId('attach-input')
		.setInputFiles({
			name: 'spec.pdf',
			mimeType: 'application/pdf',
			buffer: Buffer.from('%PDF-1.4\n%%EOF\n')
		});
	await expect(commentBox).toHaveValue(/アップロード中: spec\.pdf/);
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.getByText('アップロードが終わってから送信してください')).toBeVisible();
	await expect(commentBox).toHaveValue(/アップロード中: spec\.pdf/);
	releaseUpload();
	await expect(commentBox).toHaveValue(/\[spec\.pdf\]\(\/projects\/ACME\/attachments\//);
	await page.unroute('**/projects/ACME/attachments');
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('.markdown').getByText('確認しました')).toBeVisible();
	const attachmentList = page.getByRole('region', { name: '添付ファイル' });
	await expect(attachmentList.getByRole('link', { name: 'spec.pdf' })).toBeVisible();

	// 8b. 自分の添付を削除できる
	await attachmentList.getByRole('button', { name: 'spec.pdf を削除' }).click();
	const deleteDialog = page.getByRole('alertdialog', { name: '添付ファイルの削除' });
	await expect(deleteDialog).toContainText('「spec.pdf」を削除してよろしいですか？');
	await deleteDialog.getByRole('button', { name: '添付ファイルを削除する' }).click();
	await expect(attachmentList.getByRole('link', { name: 'spec.pdf' })).toBeHidden();

	// 8c. ゲストは自分が起票した課題だけタイムラインで動かせる
	await page.goto('/projects/ACME/timeline');
	await expect(page.getByTestId('bar-1').locator('[data-handle]')).toHaveCount(2);
	const guestBar2 = page.getByTestId('bar-2');
	await expect(guestBar2.locator('[data-handle]')).toHaveCount(0);
	await dragBy(page, guestBar2, 64);
	await page.goto('/projects/ACME/timeline');
	await expect(page.getByTestId('bar-2')).toHaveAttribute('data-start', jstDay(2));

	// 8d. 課題名のクリックで右側のシートに詳細を出し、そこからコメントできる
	await page.getByTestId('open-1').click();
	const sheet = page.getByRole('complementary', { name: 'ACME-1' });
	await expect(sheet.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(page).toHaveURL(/\/projects\/ACME\/timeline$/);
	await expect(sheet.getByRole('link', { name: '課題詳細を新しいタブで開く' })).toHaveAttribute(
		'href',
		'/projects/ACME/issues/1'
	);
	await sheet.getByLabel('コメントを追加').fill('シートからのコメント');
	await sheet.getByRole('button', { name: 'コメントする' }).click();
	await expect(sheet.getByText('シートからのコメント')).toBeVisible();
	// 編集ボタンは同じ位置で「編集をやめる」に切り替わる
	await sheet.getByRole('button', { name: 'タイトル・本文を編集' }).click();
	await expect(sheet.getByLabel('本文')).toBeVisible();
	await sheet.getByRole('button', { name: '編集をやめる' }).click();
	await expect(sheet.getByLabel('本文')).toBeHidden();
	await sheet.getByRole('button', { name: '閉じる' }).click();
	await expect(sheet).toBeHidden();
	// バーのクリックでも開く
	await page.getByTestId('bar-1').click();
	await expect(sheet).toBeVisible();
	await expect(page).toHaveURL(/\/projects\/ACME\/timeline$/);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();

	// 9. 管理者がゲストを無効化（確認ダイアログ）
	await logout(page);
	await login(page, 'admin@example.com');
	await page.goto('/admin/users');
	const row = page.getByRole('row', { name: /顧客 太郎/ });
	await row.getByRole('button', { name: '無効化' }).click();
	const disableDialog = page.getByRole('alertdialog', { name: 'ユーザーの無効化' });
	await expect(disableDialog).toBeVisible();
	// ×で閉じられる
	await disableDialog.getByRole('button', { name: '閉じる' }).click();
	await expect(disableDialog).toBeHidden();
	await row.getByRole('button', { name: '無効化' }).click();
	await disableDialog.getByRole('button', { name: '無効化する' }).click();
	await expect(disableDialog).toBeHidden();
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

	// 12. 個人設定の Slack 通知（E2E 環境はトークン未設定）
	await page.goto('/account');
	await expect(
		page.getByText('と同じメールアドレスの Slack アカウントに、DM で通知が届きます')
	).toBeVisible();
	await expect(page.getByRole('switch', { name: 'Slack 通知' })).toBeDisabled();
	await expect(page.getByText('Slack 連携は未設定です（管理者に連絡してください）')).toBeVisible();
});
