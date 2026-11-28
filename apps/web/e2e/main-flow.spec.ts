import { execFileSync } from 'node:child_process';
import {
	expect,
	test,
	type BrowserContext,
	type Locator,
	type Page,
	type Request,
	type Response,
	type Route
} from '@playwright/test';

// 1x1 の透明 PNG
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);

const PW = 'password-1234';
// 接続先。既定は scripts/e2e-server.sh が起動する手元の wrangler dev。
// E2E_BASE_URL で別の環境（scripts/free-plan-check.sh の検証用 Worker）に向けられる
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const ORIGIN = new URL(BASE_URL).origin;
const HOME = new RegExp(`^${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/$`);

async function logout(page: Page) {
	await page.getByTestId('user-menu-trigger').click();
	await page.getByRole('button', { name: 'ログアウト' }).click();
	await expect(page).toHaveURL(/\/login/);
}

async function login(page: Page, email: string, password = PW) {
	await page.goto('/login');
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード').fill(password);
	await page.getByRole('button', { name: 'ログイン' }).click();
	await expect(page).toHaveURL(HOME);
}

/**
 * E2E のサーバーが使う D1 で SQL を流し、結果の行を返す。既定は手元の D1（scripts/e2e-server.sh の --persist-to）。
 * E2E_D1_ARGS で wrangler d1 execute に渡す引数を変えられる（検証用 Worker の D1 なら --remote --config …）
 */
const D1_ARGS = (process.env.E2E_D1_ARGS ?? '--local --persist-to .wrangler/e2e-state').split(' ');
function d1Local(sql: string): Record<string, unknown>[] {
	const out = execFileSync(
		'pnpm',
		[...['exec', 'wrangler', 'd1', 'execute', 'DB', ...D1_ARGS], ...['--json', '--command', sql]],
		{ encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }
	);
	return JSON.parse(out)[0].results;
}

/** いちばん新しいパスワード再設定のトークン。E2E のメールは送らずログに出すだけなので、D1 から読む */
function latestResetToken(): string {
	const [row] = d1Local(
		"SELECT identifier FROM verification WHERE identifier LIKE 'reset-password:%' ORDER BY created_at DESC LIMIT 1"
	);
	return String(row.identifier).slice('reset-password:'.length);
}

/** 遠い回線を真似て、一致した通信を ms だけ遅らせる。戻り値で元に戻す */
async function slowDown(page: Page, url: string | RegExp, ms: number) {
	const handler = async (route: Route) => {
		await new Promise((f) => setTimeout(f, ms));
		await route.continue();
	};
	await page.route(url, handler);
	return () => page.unroute(url, handler);
}

/**
 * 課題詳細で未読数を取り直す通信（GET）があれば、既読コマンドより先にサーバーで件数を読ませ、
 * 応答は既読コマンドの応答より後に返す。取り直しが送られなければ、既読コマンドは少し待ってから通す。
 * 戻り値は、遅らせた応答が画面に届くまで待ってから元に戻す
 */
async function answerUnreadCountLate(page: Page) {
	const sleep = (ms: number) => new Promise((f) => setTimeout(f, ms));
	let counted!: () => void;
	const countedFirst = new Promise<void>((f) => (counted = f));
	let read!: () => void;
	const readAnswered = new Promise<void>((f) => (read = f));
	let lateCount: Promise<void> | undefined;
	const count = async (route: Route) => {
		const from = (await route.request().headerValue('referer')) ?? '';
		if (!/\/projects\/[^/]+\/issues\/\d+/.test(from)) return route.continue();
		const response = await route.fetch();
		counted();
		lateCount = readAnswered.then(() => sleep(200)).then(() => route.fulfill({ response }));
		await lateCount;
	};
	const markRead = async (route: Route) => {
		await Promise.race([countedFirst, sleep(500)]);
		await route.fulfill({ response: await route.fetch() });
		read();
	};
	await page.route('**/getUnreadCount', count);
	await page.route('**/readIssueNotifications', markRead);
	return async () => {
		await readAnswered;
		await lateCount;
		// 届いた応答が画面に反映されるのを待つ
		await sleep(300);
		await page.unroute('**/getUnreadCount', count);
		await page.unroute('**/readIssueNotifications', markRead);
	};
}

/** スクリプトの読み込み前（ハイドレーション前）に入力しても、読み込み後に入力が消えずにログインできる */
async function loginBeforeHydration(page: Page, email: string) {
	const restore = await slowDown(page, '**/_app/immutable/**/*.js', 1000);
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await page.getByLabel('メールアドレス').fill(email);
	await page.getByLabel('パスワード').fill(PW);
	// 読み込み前に送ると鍵が付かないので、送信ボタンは押せない
	await expect(page.getByRole('button', { name: 'ログイン' })).toBeDisabled();
	await page.waitForLoadState('networkidle');
	await restore();
	await expect(page.getByLabel('メールアドレス')).toHaveValue(email);
	await expect(page.getByLabel('パスワード')).toHaveValue(PW);
	await page.getByRole('button', { name: 'ログイン' }).click();
	await expect(page).toHaveURL(HOME);
}

/**
 * 課題の取得が遅くても、待っている間に画面が止まらず（ページ遷移のアニメーションで固めない）、
 * 読み込み中のバーが出ること。open で課題のページへ移る。
 * 一度開いた課題の query はキャッシュに残ることがある（いつ消えるかは GC 次第）ので、呼ぶ前に再読み込みしておく
 */
async function expectProgressWhileIssueLoads(page: Page, open: () => Promise<void>) {
	const restore = await slowDown(
		page,
		/\/_app\/remote\/[^/]+\/get(IssueDetail|Comments|Changes|Attachments)\b/,
		1500
	);
	await open();
	// 遷移のコードを読み込む間などはアニメーションが始まっていないので、少し待ってから確かめる
	await page.waitForTimeout(400);
	await expect
		.poll(() =>
			page.evaluate(
				() => document.activeViewTransition === null && !!document.querySelector('.nav-progress')
			)
		)
		.toBe(true);
	// 遅らせている通信が終わってから戻す（途中で戻すと、待っていた通信の continue が失敗する）
	await expect(page.locator('.nav-progress')).toHaveCount(0);
	await restore();
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

/**
 * 確かめている操作が通っても見逃しうる問題を problems に集める（最後に空であることを確かめる）。
 * 依存の更新を CI だけで自動マージするので、画面の裏で壊れたものも落とす。
 * - CSP に止められた読み込み・実行。初期化スクリプトは CSP の対象外なので、ページの securitypolicyviolation を拾える
 * - ページで捕まえられなかった例外
 * - サーバーの 5xx 応答（ブラウザからのもの。page.request などの API 呼び出しは各手順で状態を確かめている）
 */
async function watchProblems(context: BrowserContext, problems: string[]) {
	await context.exposeBinding('reportCspViolation', (_source, v: string) =>
		problems.push(`CSP: ${v}`)
	);
	await context.addInitScript(() => {
		const w = window as unknown as { reportCspViolation: (v: string) => void };
		document.addEventListener('securitypolicyviolation', (e) => {
			w.reportCspViolation(`${e.effectiveDirective} ${e.blockedURI} (${e.documentURI})`);
		});
	});
	const watchPage = (p: Page) =>
		p.on('pageerror', (e) => problems.push(`例外: ${e.message} (${p.url()})`));
	context.pages().forEach(watchPage);
	context.on('page', watchPage);
	context.on('response', (r) => {
		if (r.status() >= 500) problems.push(`${r.status()}: ${r.request().method()} ${r.url()}`);
	});
}

/** 要素の中央を掴んで dx だけ横に動かす */
async function dragBy(page: Page, target: Locator, dx: number) {
	const b = await target.boundingBox();
	if (!b) throw new Error('drag target is not visible');
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
	await page.mouse.down();
	await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 8 });
	await page.mouse.up();
}

const ISSUE_QUERIES = ['getAttachments', 'getChanges', 'getComments', 'getIssueDetail'];

/**
 * 課題の詳細を開く操作で、本文・コメント・履歴・添付の 4 つの query を同時に取りにいくこと。
 * 1 つずつ待つと、往復が長い環境（日本から米国の拠点に入る場合など）では待ちが 4 倍になる
 */
async function expectIssueQueriesInParallel(page: Page, open: () => Promise<void>) {
	const events: string[] = [];
	const name = (url: string) => ISSUE_QUERIES.find((q) => new URL(url).pathname.endsWith(`/${q}`));
	const onRequest = (r: Request) => {
		const q = name(r.url());
		if (q) events.push(`request ${q}`);
	};
	const onResponse = (r: Response) => {
		const q = name(r.url());
		if (q) events.push(`response ${q}`);
	};
	page.on('request', onRequest);
	page.on('response', onResponse);
	await open();
	await expect
		.poll(() => events.filter((e) => e.startsWith('response')).length)
		.toBe(ISSUE_QUERIES.length);
	page.off('request', onRequest);
	page.off('response', onResponse);
	const firstResponse = events.findIndex((e) => e.startsWith('response'));
	expect(events.slice(0, firstResponse).sort()).toEqual(ISSUE_QUERIES.map((q) => `request ${q}`));
}

test('招待 → ゲスト起票 → 担当割り当て → カンバン移動 → コメント', async ({
	page,
	browser,
	playwright,
	baseURL
}) => {
	// 添付画像・カスタム絵文字・エディタなどの読み込みが CSP で止められず、例外や 5xx も出ないこと（最後に確かめる）
	const problems: string[] = [];
	await watchProblems(page.context(), problems);

	// 1. 初期セットアップ
	// CSP: スクリプトは自サイトと nonce 付きのものだけ。ほかのサイトのフレームには埋め込ませない
	const loginRes = await page.request.get('/login');
	const csp = loginRes.headers()['content-security-policy'];
	expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
	expect(csp).toContain("frame-ancestors 'none'");
	expect(loginRes.headers()['x-content-type-options']).toBe('nosniff');
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
	// ロールは権限が弱い順に並び、既定はメンバー
	const inviteRole = page.getByLabel('ロール', { exact: true });
	await expect(inviteRole.locator('option')).toHaveText(['閲覧者', 'ゲスト', 'メンバー', '管理者']);
	await expect(inviteRole).toHaveValue('member');
	await inviteRole.selectOption('member');
	await page.locator('#invite-project').click();
	await page.getByRole('checkbox', { name: 'ACME サイト改修' }).check();
	await expect(page.locator('#invite-project')).toHaveText('ACME サイト改修');
	await page.getByRole('button', { name: '招待する' }).click();
	const memberUrl = await page.getByLabel('招待リンク').inputValue();
	expect(memberUrl).toContain('/invite/');

	// 4. ゲスト招待（プロジェクト設定から）
	await page.goto('/projects/ACME/settings');
	// アイコン画像を設定すると、サイドバーで文字の代わりに出る。外すと文字に戻る
	const sidebarProject = page.locator('aside').getByRole('link', { name: /ACME サイト改修/ });
	await expect(sidebarProject).toContainText('ACME');
	const setIconImage = async () => {
		await page
			.getByLabel('画像', { exact: true })
			.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
		await page.getByRole('button', { name: '設定', exact: true }).click();
		await expect(sidebarProject.getByTestId('project-icon-image')).toBeVisible();
	};
	await setIconImage();
	const iconSrc = await sidebarProject.getByTestId('project-icon-image').getAttribute('src');
	expect((await page.request.get(iconSrc!)).headers()['content-type']).toBe('image/png');
	await page.getByRole('button', { name: '画像を外す' }).click();
	await expect(sidebarProject.getByTestId('project-icon-image')).toBeHidden();
	expect((await page.request.get(iconSrc!)).status()).toBe(404);
	await setIconImage();
	await page.getByLabel('メールアドレス', { exact: true }).fill('guest@example.com');
	await page.getByRole('button', { name: '招待する' }).click();
	const guestUrl = await page.getByLabel('招待リンク').inputValue();

	// 4b. カテゴリー・マイルストーンを定義
	const addIn = (label: string) =>
		page.locator('form', { has: page.getByLabel(label) }).getByRole('button', { name: '追加' });
	for (const name of ['フロントエンド', 'バックエンド']) {
		await page.getByLabel('カテゴリー名').fill(name);
		await addIn('カテゴリー名').click();
		await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
	}
	await page.getByLabel('マイルストーン名').fill('v1.0');
	await page.getByLabel('リリース日').fill('2026-11-30');
	await addIn('マイルストーン名').click();
	await expect(page.getByRole('listitem').filter({ hasText: 'v1.0' })).toBeVisible();
	await logout(page);
	// スクリプトなしで送られた（ブラウザで作る鍵が無い）ログインは、生のパスワードが正しくても受け付けない
	const noKey = await page.request.post('/login', {
		headers: { Origin: ORIGIN },
		form: { email: 'admin@example.com', password: PW }
	});
	expect(noKey.status()).toBe(400);
	expect(await noKey.text()).toContain('パスワードを受け取れませんでした');

	// 5. ゲストが登録して起票
	await acceptInvite(page, guestUrl, '顧客 太郎');
	// 参加者（ゲスト）にもアイコン画像が出る
	const homeIcon = page
		.getByRole('main')
		.getByRole('link', { name: /ACME サイト改修/ })
		.getByTestId('project-icon-image');
	await expect(homeIcon).toBeVisible();
	expect(await homeIcon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
	await page
		.getByRole('main')
		.getByRole('link', { name: /ACME サイト改修/ })
		.click();
	await page.getByRole('link', { name: '新規課題' }).click();
	await expect(page.getByLabel('種別').locator('option:checked')).toHaveText('タスク');
	await page.getByLabel('種別').selectOption({ label: 'バグ' });
	await page.getByLabel('タイトル').fill('ログインできない');
	// カテゴリーは複数選べる
	await page.locator('summary', { has: page.locator('#issue-category-value') }).click();
	await page.getByRole('checkbox', { name: 'フロントエンド' }).check();
	await page.getByRole('checkbox', { name: 'バックエンド' }).check();
	await page.keyboard.press('Escape');
	// 本文は見たまま編集。「Markdown ソースのまま編集」との往復で内容が二重にならない
	const body = page.getByRole('textbox', { name: '本文' });
	const bodySource = page.locator('textarea[name="description"]');
	const sourceToggle = page.getByRole('button', { name: 'Markdown ソースのまま編集' });
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
	// ソースで書いた引用と表は、見たまま編集に戻すと引用と表として表示される
	await sourceToggle.click();
	await bodySource.press('ControlOrMeta+End');
	await bodySource.pressSequentially(
		'\n\n> 引用文\n\n| 列1 | 列2 |\n| ---- | ---- |\n| データ1 | データ2 |'
	);
	await sourceToggle.click();
	await expect(body.locator('blockquote')).toHaveText('引用文');
	await expect(body.locator('table th')).toHaveText(['列1', '列2']);
	await expect(body.locator('table td')).toHaveText(['データ1', 'データ2']);
	await expect(page.getByRole('button', { name: '引用' })).toBeVisible();
	await page.getByRole('button', { name: '起票する' }).first().click();
	await expect(page.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(page.getByRole('main').getByText('ACME-1')).toBeVisible();
	await expect(page.locator('.markdown p', { hasText: 'abcd' })).toHaveText('abcd');
	await expect(page.locator('.markdown ul ul li', { hasText: '子' })).toBeVisible();
	await expect(page.locator('.markdown ul ul li strong')).toHaveText('強調');
	await expect(page.locator('.markdown blockquote')).toHaveText('引用文');
	await expect(page.locator('.markdown table td')).toHaveText(['データ1', 'データ2']);
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
		headers: { Origin: ORIGIN, Accept: 'application/json' },
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

	// 5c. 別のタブでログアウトした後、開いたままの画面でリンクを押すと、ログイン画面をページごと読み込み直す
	// （ページ内の遷移のままだと、ログイン中のサイドバーが残ったり、課題の詳細が 500 になったりした）
	async function logoutInAnotherTab() {
		const other = await page.context().newPage();
		await other.goto('/projects/ACME');
		await logout(other);
		await other.close();
	}
	// 画面のデータ（__data.json）を読む遷移: ボード → 一覧
	await page.goto('/projects/ACME/board');
	await logoutInAnotherTab();
	await page.getByRole('link', { name: '一覧' }).click();
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fprojects%2FACME$/);
	await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
	await expect(page.getByTestId('user-menu-trigger')).toBeHidden();
	// 画面の関数（remote functions）で読む遷移: 一覧 → 課題の詳細
	await login(page, 'admin@example.com');
	await page.goto('/projects/ACME');
	await logoutInAnotherTab();
	await page.getByRole('link', { name: 'ログインできない' }).click();
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fprojects%2FACME%2Fissues%2F1$/);
	await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
	await expect(page.getByTestId('user-menu-trigger')).toBeHidden();

	// 6. メンバーが登録し、ゲストを担当者にする
	await acceptInvite(page, memberUrl, '開発 花子');
	await page.goto('/projects/ACME/issues/1');
	await expect(page.locator('#issue-category-page-value')).toHaveText(
		'フロントエンド、バックエンド'
	);
	await expect(page.getByLabel('種別').locator('option:checked')).toHaveText('バグ');
	const assignee = page.locator('summary', { has: page.locator('#issue-assignee-page-value') });
	await assignee.click();
	await page.getByRole('checkbox', { name: '顧客 太郎' }).check();
	await page.getByLabel('マイルストーン').selectOption({ label: 'v1.0（11/30 リリース）' });
	await page.getByLabel('完了理由').selectOption({ label: '対応済み' });
	await page.getByRole('button', { name: '保存' }).click();
	await expect(page.getByText('保存しました')).toBeVisible();
	await page.reload();
	await expect(assignee).toContainText('顧客 太郎');
	await expect(page.getByLabel('完了理由').locator('option:checked')).toHaveText('対応済み');
	await expect(page.getByLabel('マイルストーン').locator('option:checked')).toHaveText(
		'v1.0（11/30 リリース）'
	);

	// 6b. メンバーが @ 補完でゲストをメンションしてコメント
	const mentionBox = page.getByRole('textbox', { name: 'コメントを追加' });
	const commentSource = page.locator('#new-comment');
	const postedComments = page.locator('article.comment:not(.pending)');
	await expect(mentionBox).toHaveAttribute('contenteditable', 'true');
	const commentCount = await postedComments.count();
	// 空のまま送ると、投稿せずにエディタで知らせる
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('form.new-comment').getByText('入力してください')).toBeVisible();
	await expect(mentionBox).toBeFocused();
	await expect(mentionBox).toHaveAttribute('aria-invalid', 'true');
	await page.keyboard.type('@顧客');
	await page
		.getByRole('listbox', { name: 'メンションする人' })
		.getByRole('option', { name: '顧客 太郎' })
		.click();
	await page.keyboard.type('確認お願いします');
	await expect(page.locator('form.new-comment').getByText('入力してください')).toBeHidden();
	await expect(commentSource).toHaveValue(
		/^@\[顧客 太郎\]\(user:[0-9a-f-]{36}\) 確認お願いします$/
	);
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('.markdown .mention', { hasText: '@顧客 太郎' })).toBeVisible();
	// 空で送ったときは投稿されていない（増えたのはこの 1 件だけ）
	await expect(postedComments).toHaveCount(commentCount + 1);
	// 投稿すると編集領域は空に戻る
	await expect(commentSource).toHaveValue('');
	await expect(mentionBox).toHaveText('');
	// 自分のコメントは見たまま編集で開き、直さずに更新しても内容は変わらない
	const myComment = postedComments.last();
	await myComment.getByRole('button', { name: 'コメントを編集' }).click();
	const editBox = myComment.getByRole('textbox', { name: 'コメントを編集' });
	await expect(editBox).toHaveAttribute('contenteditable', 'true');
	await expect(editBox.locator('.mention')).toHaveText('@顧客 太郎');
	await myComment.getByRole('button', { name: '更新' }).click();
	await expect(editBox).toBeHidden();
	await expect(myComment.locator('.markdown .mention')).toHaveText('@顧客 太郎');
	await expect(myComment.locator('.markdown')).toHaveText('@顧客 太郎 確認お願いします');
	// 絵文字でリアクションし、ホバーで誰が付けたかを出す。もう一度押すと外れる
	await myComment.getByLabel('リアクションを追加').first().click();
	// 画面は保存を待たずに先に表示を変えるので、再読み込みの前に保存の応答を待つ（遠い環境では再読み込みが送信を打ち切る）
	const reacted = page.waitForResponse((r) => r.url().includes('/reactToComment'));
	await myComment
		.getByRole('group', { name: 'リアクション' })
		.getByRole('button', { name: '🎉' })
		.click();
	await reacted;
	const party = myComment.locator('button.reaction', { hasText: '🎉' });
	await expect(party).toHaveAttribute('aria-pressed', 'true');
	await expect(party).toContainText('1');
	const tip = myComment.getByRole('tooltip');
	await expect(tip).toBeHidden();
	await party.hover();
	await expect(tip).toBeVisible();
	await expect(tip).toHaveText(/^\S.* が 🎉 でリアクションしました$/);
	// 付けたリアクションは保存されている
	await page.reload();
	await expect(party).toHaveAttribute('aria-pressed', 'true');
	await party.click();
	await expect(party).toBeHidden();
	// カスタム絵文字を登録し、リアクションに使う。名前はファイル名から補う
	const issueUrl = page.url();
	await page.goto('/emoji');
	await page
		.getByLabel('画像', { exact: true })
		.setInputFiles({ name: 'Ship It.png', mimeType: 'image/png', buffer: PNG });
	await expect(page.getByLabel('名前', { exact: true })).toHaveValue('ship_it');
	await page.getByRole('button', { name: '追加する' }).click();
	await expect(
		page.getByRole('list', { name: 'カスタム絵文字一覧' }).getByRole('img', { name: ':ship_it:' })
	).toBeVisible();
	await page.goto(issueUrl);
	await myComment.getByLabel('リアクションを追加').first().click();
	const shipped = page.waitForResponse((r) => r.url().includes('/reactToComment'));
	await myComment
		.getByRole('group', { name: 'リアクション' })
		.getByRole('button', { name: ':ship_it:' })
		.click();
	await shipped;
	const shipIt = myComment.locator('button.reaction[aria-label^=":ship_it:"]');
	await expect(shipIt).toHaveAttribute('aria-pressed', 'true');
	await expect(shipIt.locator('img')).toHaveAttribute('src', /^\/emoji\/[0-9a-f-]{36}$/);
	await page.reload();
	await expect(shipIt).toHaveAttribute('aria-pressed', 'true');

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
	// 見たまま編集でも、ドロップしたファイルはエディタに添付する（ブラウザがファイルを開かない）
	const descSource = page.locator('textarea[name="description"]');
	const dropAccepted = await mentionBody.evaluate((el, png) => {
		const data = new DataTransfer();
		const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
		data.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
		const r = el.getBoundingClientRect();
		const init = {
			dataTransfer: data,
			bubbles: true,
			cancelable: true,
			clientX: r.left + 20,
			clientY: r.top + 20
		};
		const over = new DragEvent('dragover', init);
		el.dispatchEvent(over);
		const drop = new DragEvent('drop', init);
		el.dispatchEvent(drop);
		return over.defaultPrevented && drop.defaultPrevented;
	}, PNG.toString('base64'));
	expect(dropAccepted).toBe(true);
	await expect(descSource).toHaveValue(
		/^!\[drop\.png\]\(\/projects\/ACME\/attachments\/[0-9a-f-]{36}\)$/
	);
	// アップロードが終わるまで送信させない。仮の要素は本文（textarea）に入らない
	let releaseDescUpload!: () => void;
	const descUploadHeld = new Promise<void>((r) => (releaseDescUpload = r));
	await page.route('**/projects/ACME/attachments', async (route) => {
		await descUploadHeld;
		await route.continue();
	});
	await page.getByTestId('attach-input').setInputFiles({
		name: 'spec.pdf',
		mimeType: 'application/pdf',
		buffer: Buffer.from('%PDF-1.4\n%%EOF\n')
	});
	await expect(mentionBody.locator('.upload-placeholder')).toHaveText('アップロード中: spec.pdf');
	await expect(page.getByRole('button', { name: 'Markdown ソースのまま編集' })).toBeDisabled();
	await expect(descSource).not.toHaveValue(/アップロード中/);
	await page.getByRole('button', { name: '起票する' }).first().click();
	await expect(page.getByText('アップロードが終わってから送信してください')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'トップページ改修' })).toBeHidden();
	releaseDescUpload();
	await expect(descSource).toHaveValue(
		/!\[drop\.png\]\(\/projects\/ACME\/attachments\/[0-9a-f-]{36}\)\\?\n\[spec\.pdf\]\(\/projects\/ACME\/attachments\/[0-9a-f-]{36}\)$/
	);
	await expect(mentionBody.locator('.upload-placeholder')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Markdown ソースのまま編集' })).toBeEnabled();
	await page.unroute('**/projects/ACME/attachments');
	await page.getByLabel('開始日').fill(jstDay(0));
	await page.getByLabel('期限日').fill(jstDay(2));
	// 手順 10 の「マイルストーン未設定」の絞り込みで 0 件になるよう v1.0 に入れる
	await page.getByLabel('マイルストーン').selectOption({ label: 'v1.0（11/30 リリース）' });
	await page.getByRole('button', { name: '起票する' }).first().click();
	await expect(page.getByRole('heading', { name: 'トップページ改修' })).toBeVisible();
	await expect(page.locator('.markdown img[alt="drop.png"]')).toBeVisible();
	await expect(
		page.getByRole('region', { name: '添付ファイル' }).getByRole('link', { name: 'spec.pdf' })
	).toBeVisible();

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
	// 日付のない ACME-1 はタイムラインに出さず、案内から課題一覧（日付なしの絞り込み）へ行ける
	await expect(page.getByTestId('bar-1')).toBeHidden();
	const unscheduledHint = page.getByText('開始日と期限日が未設定の課題が 1 件あります');
	await expect(unscheduledHint).toBeVisible();
	await page.getByRole('link', { name: '未設定の課題を一覧で見る' }).click();
	await expect(page).toHaveURL(/\/projects\/ACME\?dates=none$/);
	await expect(page.getByRole('link', { name: 'トップページ改修' })).toBeHidden();
	// 課題を開いて日付を入れると、タイムラインに出る
	const issue1Ready = page.waitForResponse((r) => r.url().includes('/readIssueNotifications'));
	await page.getByRole('link', { name: 'ログインできない' }).click();
	await issue1Ready;
	await page.getByLabel('開始日').fill(jstDay(1));
	await page.getByLabel('期限日').fill(jstDay(1));
	await page.getByRole('button', { name: '保存' }).click();
	await expect(page.getByText('保存しました')).toBeVisible();
	await page.goto('/projects/ACME/timeline');
	await expect(page.getByTestId('bar-1')).toHaveAttribute('data-start', jstDay(1));
	await expect(page.getByTestId('bar-1')).toHaveAttribute('data-due', jstDay(1));
	await expect(unscheduledHint).toBeHidden();
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
	await page.getByLabel('ステータス').selectOption('done');
	await expect(page.getByTestId('bar-1')).toBeHidden();
	await page.getByLabel('ステータス').selectOption('');
	await expect(page.getByTestId('bar-1')).toBeVisible();
	// 開始日を選ぶと、その日から表示する
	await page.getByLabel('開始日').fill(jstDay(1));
	await expect(page).toHaveURL(new RegExp(`from=${jstDay(1)}`));
	await expect(page.locator('.days [data-date]').first()).toHaveAttribute('data-date', jstDay(1));
	// ログアウトの後に「戻る」を押しても、ログイン中の画面をブラウザのキャッシュから出さず、ログイン画面にする
	await page.goto('/projects/ACME');
	await logout(page);
	await page.goBack();
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fprojects%2FACME$/);

	// 7. ゲストがカンバンで進行中へ移動
	await loginBeforeHydration(page, 'guest@example.com');

	// 7a. ゲストに「担当」と「メンション」の 2 件が届いている
	const badge = page.getByTestId('unread-badge');
	await expect(badge).toHaveText('2');
	await page.getByRole('link', { name: /通知/ }).click();
	await expect(page).toHaveURL(/\/notifications$/);
	await expect(page.getByRole('button', { name: /担当者に設定しました/ })).toBeVisible();
	// 課題詳細へ移ったときに未読数を別に取り直すと、既読にする前の件数が既読コマンドより後に届き、
	// バッジが戻ることがあった（CI で時々落ちた）。その順番を作っても既読コマンドの件数が残る
	const restoreUnreadCount = await answerUnreadCountLate(page);
	await page
		.getByRole('button', { name: /メンションしました: @顧客 太郎 確認お願いします/ })
		.click();
	await expect(page).toHaveURL(/\/projects\/ACME\/issues\/1#comment-[0-9a-f-]{36}$/);
	// 課題を開くと、その課題の通知はすべて既読になる
	await expect(badge).toBeHidden();
	await restoreUnreadCount();
	await expect(badge).toBeHidden();
	await page.goto('/projects/ACME/board');
	const movedCard = savedResponse(page);
	await dragTo(
		page,
		page.getByTestId('card-1'),
		page.getByTestId('column-in_progress').locator('ul')
	);
	await movedCard;
	await expect(page.getByTestId('column-in_progress').getByTestId('card-1')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('column-in_progress').getByTestId('card-1')).toBeVisible();
	// カードのクリックで右側のシートに詳細を出す（ページは遷移しない）。詳細の取得は同時に始める
	await expectIssueQueriesInParallel(page, () => page.getByTestId('card-1').click());
	const boardSheet = page.getByRole('complementary', { name: 'ACME-1' });
	await expect(boardSheet.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(page).toHaveURL(/\/projects\/ACME\/board$/);
	await page.keyboard.press('Escape');
	await expect(boardSheet).toBeHidden();

	// 7b. 自分の課題に、担当している課題がプロジェクトのステータス名で出る
	await page.getByRole('link', { name: '自分の課題' }).click();
	await expect(page).toHaveURL(/\/issues$/);
	const myRow = page.getByRole('row', { name: /ACME-1/ });
	await expect(myRow.getByRole('link', { name: 'ログインできない' })).toBeVisible();
	await expect(myRow).toContainText('進行中');
	await page.getByLabel('対象').selectOption({ label: '登録した課題' });
	await expect(page).toHaveURL(/role=reporter/);
	await expect(myRow).toBeVisible();

	// 8. ゲストがコメント（PDF を添付）。テキストの貼り付けは横取りしない
	// 「Markdown ソースのまま編集」（textarea）でも今までどおり添付・送信できる
	await page.goto('/projects/ACME/issues/1');
	const newComment = page.locator('form.new-comment');
	const commentToggle = newComment.getByRole('button', { name: 'Markdown ソースのまま編集' });
	await expect(newComment.getByRole('textbox', { name: 'コメントを追加' })).toHaveAttribute(
		'contenteditable',
		'true'
	);
	await commentToggle.click();
	await expect(commentToggle).toHaveAttribute('aria-pressed', 'true');
	const commentBox = page.locator('#new-comment');
	await expect(commentBox).toBeVisible();
	// 「Markdown ソースのまま編集」の textarea は内容に合わせて伸びる
	const emptyHeight = (await commentBox.boundingBox())!.height;
	await commentBox.fill('1\n2\n3\n4\n5\n6');
	await expect
		.poll(async () => (await commentBox.boundingBox())!.height)
		.toBeGreaterThan(emptyHeight);
	const grownHeight = (await commentBox.boundingBox())!.height;
	// 見たまま編集を挟んで戻しても（隠れている間は測れない）、表示したときに測り直す
	await commentToggle.click();
	await expect(commentBox).toBeHidden();
	await commentToggle.click();
	await expect(commentBox).toBeVisible();
	expect((await commentBox.boundingBox())!.height).toBe(grownHeight);
	await commentBox.fill('');
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
	await commentBox.fill('確認しました（ACME-2 と同じ件）\n');
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
	// 切り替えるとプレースホルダがエスケープされて結果を差し込めないので、終わるまで切り替えさせない
	await expect(commentToggle).toBeDisabled();
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.getByText('アップロードが終わってから送信してください')).toBeVisible();
	await expect(commentBox).toHaveValue(/アップロード中: spec\.pdf/);
	releaseUpload();
	await expect(commentBox).toHaveValue(/\[spec\.pdf\]\(\/projects\/ACME\/attachments\//);
	await expect(commentToggle).toBeEnabled();
	await page.unroute('**/projects/ACME/attachments');
	await page.getByRole('button', { name: 'コメントする' }).click();
	await expect(page.locator('.markdown').getByText('確認しました')).toBeVisible();
	// 本文の課題キーは、同じタブで開くその課題へのリンクになる
	const issueRef = page.locator('.markdown').getByRole('link', { name: 'ACME-2', exact: true });
	await expect(issueRef).toHaveAttribute('href', '/projects/ACME/issues/2');
	await expect(issueRef).not.toHaveAttribute('target');
	// モードは localStorage に残るので、後の手順のために見たまま編集へ戻す
	await commentToggle.click();
	await expect(commentToggle).toHaveAttribute('aria-pressed', 'false');
	const attachmentList = page.getByRole('region', { name: '添付ファイル' });
	await expect(attachmentList.getByRole('link', { name: 'spec.pdf' })).toBeVisible();

	// 8b. 自分の添付を削除できる
	await attachmentList.getByRole('button', { name: 'spec.pdf を削除' }).click();
	const deleteDialog = page.getByRole('alertdialog', { name: '添付ファイルの削除' });
	await expect(deleteDialog).toContainText('「spec.pdf」を削除してよろしいですか？');
	await deleteDialog.getByRole('button', { name: '添付ファイルを削除する' }).click();
	await expect(attachmentList.getByRole('link', { name: 'spec.pdf' })).toBeHidden();

	// 8c. ゲストは他の人が起票した課題もタイムラインで動かせる
	await page.goto('/projects/ACME/timeline');
	// パンくずの末尾は画面名（課題一覧ではない）
	await expect(
		page.getByRole('navigation', { name: 'パンくずリスト' }).getByText('タイムライン')
	).toBeVisible();
	await expect(page.getByTestId('bar-1').locator('[data-handle]')).toHaveCount(2);
	const guestBar2 = page.getByTestId('bar-2');
	await expect(guestBar2.locator('[data-handle]')).toHaveCount(2);
	// 保存が終わる前に再読み込みしない
	const guestSaved = savedResponse(page);
	await dragBy(page, guestBar2, 64);
	await guestSaved;
	await expect(guestBar2).toHaveAttribute('data-start', jstDay(4));
	await page.goto('/projects/ACME/timeline');
	await expect(page.getByTestId('bar-2')).toHaveAttribute('data-start', jstDay(4));

	// 8d. 課題名のクリックで右側のシートに詳細を出し、そこからコメントできる
	await page.getByTestId('open-1').click();
	const sheet = page.getByRole('complementary', { name: 'ACME-1' });
	await expect(sheet.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(page).toHaveURL(/\/projects\/ACME\/timeline$/);
	await expect(sheet.getByRole('link', { name: '課題詳細を新しいタブで開く' })).toHaveAttribute(
		'href',
		'/projects/ACME/issues/1'
	);
	const sheetComment = sheet.getByRole('textbox', { name: 'コメントを追加' });
	await expect(sheetComment).toHaveAttribute('contenteditable', 'true');
	await sheetComment.fill('シートからのコメント');
	await sheet.getByRole('button', { name: 'コメントする' }).click();
	await expect(sheet.getByText('シートからのコメント')).toBeVisible();
	// 編集ボタンは同じ位置で「編集をやめる」に切り替わる
	await sheet.getByRole('button', { name: 'タイトル・本文を編集' }).click();
	// 既存の本文がそのままエディタに読み込まれる
	await expect(sheet.getByRole('textbox', { name: '本文' })).toHaveAttribute(
		'contenteditable',
		'true'
	);
	await expect(sheet.getByRole('textbox', { name: '本文' }).locator('strong')).toHaveText('強調');
	await sheet.getByRole('button', { name: '編集をやめる' }).click();
	await expect(sheet.getByRole('textbox', { name: '本文' })).toBeHidden();
	await sheet.getByRole('button', { name: '閉じる' }).click();
	await expect(sheet).toBeHidden();
	// バーのクリックでも開く
	await page.getByTestId('bar-1').click();
	await expect(sheet).toBeVisible();
	await expect(page).toHaveURL(/\/projects\/ACME\/timeline$/);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();

	// 8e. シートで保存するのは変えた項目だけ。開いた後にほかで変わった項目を、表示していた古い値で戻さない
	// 動かすバーがシートに隠れないよう、ACME-2 の開始日から表示する
	await page.goto(`/projects/ACME/timeline?from=${jstDay(4)}`);
	await page.getByTestId('open-2').click();
	const sheet2 = page.getByRole('complementary', { name: 'ACME-2' });
	await sheet2.getByLabel('開始日').fill(jstDay(5));
	await sheet2.getByRole('button', { name: '保存' }).click();
	await expect(page.getByTestId('bar-2')).toHaveAttribute('data-start', jstDay(5));
	// 一度保存した項目も、その後タイムラインで動かした値を表示する
	const moved2 = savedResponse(page);
	await dragBy(page, page.getByTestId('bar-2'), -32);
	await moved2;
	await expect(sheet2.getByLabel('開始日')).toHaveValue(jstDay(4));
	// 別のタブで優先度を変えても、シートは古い優先度のまま
	const other = await page.context().newPage();
	// ハイドレーション前に選んだ値は描画で戻されるので、表示後に送る既読の通知を待ってから選ぶ
	const otherReady = other.waitForResponse((r) => r.url().includes('/readIssueNotifications'));
	await other.goto('/projects/ACME/issues/2');
	await otherReady;
	await other.getByLabel('優先度').selectOption({ label: '緊急' });
	await other.getByRole('button', { name: '保存' }).click();
	await expect(other.getByText('保存しました')).toBeVisible();
	await other.close();
	await sheet2.getByLabel('完了理由').selectOption({ label: '対応済み' });
	await sheet2.getByRole('button', { name: '保存' }).click();
	await expect(sheet2.getByLabel('優先度').locator('option:checked')).toHaveText('緊急');
	await page.goto('/projects/ACME/issues/2');
	await expect(page.getByLabel('優先度').locator('option:checked')).toHaveText('緊急');
	await expect(page.getByLabel('完了理由').locator('option:checked')).toHaveText('対応済み');
	await expect(page.getByLabel('開始日')).toHaveValue(jstDay(4));

	// 8f. 文字サイズ「特大」ではカレンダーを標準の 1.5 倍にし（1 日 = 48px）、ドラッグは拡大後の幅で日数に換算する
	await page.evaluate(() => localStorage.setItem('font-size', 'xlarge'));
	await page.goto(`/projects/ACME/timeline?from=${jstDay(4)}`);
	await expect
		.poll(async () => (await page.locator(`.days [data-date="${jstDay(4)}"]`).boundingBox())?.width)
		.toBe(48);
	const movedLarge = savedResponse(page);
	await dragBy(page, page.getByTestId('bar-2'), 144);
	await movedLarge;
	await expect(page.getByTestId('bar-2')).toHaveAttribute('data-start', jstDay(7));
	await page.evaluate(() => localStorage.removeItem('font-size'));

	// 9. 管理者がゲストを無効化（確認ダイアログ）
	// 無効化の前から開いていたゲストの画面（別のセッション）で、無効化の後に書き込ませない
	const guestPage = await browser.newPage({ baseURL });
	await watchProblems(guestPage.context(), problems);
	await login(guestPage, 'guest@example.com');
	await guestPage.goto('/projects/ACME/issues/1');
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
	// ログイン状態のキャッシュ（Cookie）が残っていても、書き込みはログイン画面に戻される
	await guestPage.getByRole('textbox', { name: 'コメントを追加' }).fill('無効化の後のコメント');
	await guestPage.getByRole('button', { name: 'コメントする' }).click();
	await expect(guestPage).toHaveURL(/\/login/);
	await guestPage.close();
	await page.goto('/projects/ACME/issues/1');
	await expect(page.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(page.getByText('無効化の後のコメント')).toHaveCount(0);
	// 10. 管理者が一覧・ボードを絞り込む
	await page.goto('/projects/ACME');
	const issueRow = page.getByRole('row', { name: /ログインできない/ });
	// 付いているカテゴリーはすべて出る
	await expect(issueRow.getByText('フロントエンド')).toBeVisible();
	await expect(issueRow.getByText('バックエンド')).toBeVisible();
	await expect(issueRow.getByText('v1.0')).toBeVisible();
	// タイトルの列が狭くても、カテゴリーは消えずに列の中に収まる
	await page.setViewportSize({ width: 900, height: 720 });
	const tagBoxes = await issueRow.locator('.tag').evaluateAll((tags) =>
		tags.map((t) => {
			const tag = t.getBoundingClientRect();
			const cell = t.closest('[role="cell"]')!.getBoundingClientRect();
			return { width: tag.width, inside: tag.left >= cell.left && tag.right <= cell.right };
		})
	);
	expect(tagBoxes).toHaveLength(2);
	for (const box of tagBoxes) {
		expect(box.inside).toBe(true);
		expect(box.width).toBeGreaterThanOrEqual(24);
	}
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.getByLabel('キーワード').fill('存在しない課題');
	await page.getByLabel('キーワード').press('Enter');
	await expect(page.getByText('条件に一致する課題はありません')).toBeVisible();
	await page.getByLabel('キーワード').fill('acme-1');
	await page.getByLabel('キーワード').press('Enter');
	await expect(issueRow).toBeVisible();
	// 2 つ目に付けたカテゴリーで絞り込んでも出る
	await page.getByLabel('カテゴリー').selectOption({ label: 'バックエンド' });
	await expect(page).toHaveURL(/category=/);
	await expect(issueRow).toBeVisible();
	await page.getByLabel('マイルストーン').selectOption({ label: '未設定' });
	await expect(page).toHaveURL(/milestone=none/);
	await expect(page.getByText('条件に一致する課題はありません')).toBeVisible();

	// 一覧を開いたときは「完了以外」で絞る。「すべて」を選ぶと URL に残る
	await page.goto('/projects/ACME');
	await expect(page.getByRole('radio', { name: '完了以外' })).toBeChecked();
	await page.locator('label.status-chip', { hasText: 'すべて' }).click();
	await expect(page).toHaveURL(/[?&]status=all(&|$)/);
	await expect(page.getByRole('radio', { name: 'すべて' })).toBeChecked();

	// 列見出しで並べ替える。開始日が空の課題は末尾。並べ替えと絞り込みは、どちらを変えても他方が残る
	await page.goto('/projects/ACME');
	const sortHeader = (name: string) => page.getByRole('columnheader', { name, exact: true });
	const sortLink = (name: string) => page.getByRole('link', { name, exact: true });
	await expect(sortHeader('キー')).toHaveAttribute('aria-sort', 'descending');
	await expect(issueRow.getByRole('cell').nth(8)).toHaveText(/^\d{4}\/\d{2}\/\d{2}$/);
	await expect(issueRow.getByRole('cell').nth(9)).toHaveText(/^\d{4}\/\d{2}\/\d{2}$/);
	await sortLink('開始日').click();
	await expect(page).toHaveURL(/\?sort=start&order=asc$/);
	await expect(sortHeader('開始日')).toHaveAttribute('aria-sort', 'ascending');
	await expect(sortHeader('キー')).toHaveAttribute('aria-sort', 'none');
	const startCells = await page
		.getByRole('table', { name: '課題一覧' })
		.getByRole('row')
		.evaluateAll((rows) =>
			rows.slice(1).map((r) => r.querySelectorAll('[role="cell"]')[6].textContent!.trim())
		);
	expect(startCells[0]).not.toBe('—');
	const firstBlank = startCells.indexOf('—');
	if (firstBlank !== -1) expect(new Set(startCells.slice(firstBlank))).toEqual(new Set(['—']));
	await sortLink('開始日').click();
	await expect(page).toHaveURL(/\?sort=start&order=desc$/);
	await expect(sortHeader('開始日')).toHaveAttribute('aria-sort', 'descending');
	await page.getByLabel('キーワード').fill('acme-1');
	await page.getByLabel('キーワード').press('Enter');
	await expect(page).toHaveURL(
		(url) => url.searchParams.get('q') === 'acme-1' && url.search.endsWith('&sort=start&order=desc')
	);
	await expect(issueRow).toBeVisible();
	await sortLink('更新日').click();
	await expect(page).toHaveURL(
		(url) =>
			url.searchParams.get('q') === 'acme-1' && url.search.endsWith('&sort=updated&order=desc')
	);
	await expect(sortHeader('更新日')).toHaveAttribute('aria-sort', 'descending');
	await expect(issueRow).toBeVisible();
	// キーの降順（既定の並び）に戻すと、URL から並びが消える
	await sortLink('キー').click();
	await expect(page).toHaveURL(
		(url) => url.searchParams.get('q') === 'acme-1' && !/sort=|order=/.test(url.search)
	);
	await expect(sortHeader('キー')).toHaveAttribute('aria-sort', 'descending');

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

	// 11b. 管理者が課題から子課題を起票し、親子が相互に表示される
	await page.goto('/projects/ACME/issues/1');
	await page.getByRole('link', { name: '子課題を追加' }).click();
	await expect(page.getByLabel('親課題')).toHaveValue('1');
	await page.getByLabel('タイトル').fill('ログイン画面の文言修正');
	// 二度押ししても 1 件だけ起票する（下の「0 / 1 完了」で確かめる）
	await page.getByRole('button', { name: '起票する' }).first().dblclick();
	await expect(page).toHaveURL(/\/projects\/ACME\/issues\/\d+$/);
	await expect(page.getByRole('link', { name: /ACME-1/ })).toBeVisible();
	// 子課題から親課題へ移る。取得が遅くても、待つ間は読み込み中のバーが見える
	await page.reload();
	await expectProgressWhileIssueLoads(page, () =>
		page.getByRole('link', { name: /ACME-1/ }).click()
	);
	await expect(page).toHaveURL(/\/projects\/ACME\/issues\/1$/);
	const children = page.getByRole('region', { name: '子課題' });
	await expect(children.getByRole('link', { name: 'ログイン画面の文言修正' })).toBeVisible();
	await expect(children.getByText('0 / 1 完了')).toBeVisible();

	// 12. 個人設定の Slack 通知（E2E 環境はトークン未設定）
	await page.goto('/account');
	await expect(
		page.getByText('と同じメールアドレスの Slack アカウントに、DM で通知が届きます')
	).toBeVisible();
	await expect(page.getByRole('switch', { name: 'Slack 通知' })).toBeDisabled();
	await expect(page.getByText('Slack 連携は未設定です（管理者に連絡してください）')).toBeVisible();

	// 12b. 閲覧者（公開デモの共用アカウント向け）。見るだけで、何も書き込めない
	await page.goto('/projects/ACME/settings');
	await page.getByLabel('メールアドレス', { exact: true }).fill('viewer@example.com');
	const guestRole = page.getByLabel('ロール', { exact: true });
	await expect(guestRole.locator('option')).toHaveText(['閲覧者', 'ゲスト']);
	await expect(guestRole).toHaveValue('guest');
	await guestRole.selectOption('viewer');
	await page.getByRole('button', { name: '招待する' }).click();
	const viewerUrl = await page.getByLabel('招待リンク').inputValue();
	const viewerPage = await browser.newPage({ baseURL });
	await watchProblems(viewerPage.context(), problems);
	await acceptInvite(viewerPage, viewerUrl, '閲覧 花子');
	// 一覧・課題は見られるが、起票・コメント・子課題の追加・属性の変更の入口がない
	await viewerPage.goto('/projects/ACME');
	await expect(viewerPage.getByRole('row', { name: /ログインできない/ })).toBeVisible();
	await expect(viewerPage.getByRole('link', { name: '新規課題' })).toHaveCount(0);
	await viewerPage.goto('/projects/ACME/issues/1');
	await expect(viewerPage.getByRole('heading', { name: 'ログインできない' })).toBeVisible();
	await expect(viewerPage.getByRole('textbox', { name: 'コメントを追加' })).toHaveCount(0);
	await expect(viewerPage.getByRole('link', { name: '子課題を追加' })).toHaveCount(0);
	await expect(viewerPage.getByLabel('ステータス')).toBeDisabled();
	// URL を直接開いても起票画面は出ない
	expect((await viewerPage.goto('/projects/ACME/issues/new'))?.status()).toBe(404);
	// アカウント設定も変えられない（共用のパスワードを変えて他の人を締め出させない）
	await viewerPage.goto('/account');
	await expect(viewerPage.getByText('このアカウントは閲覧専用のため')).toBeVisible();
	await expect(viewerPage.getByRole('heading', { name: 'パスワード変更' })).toHaveCount(0);
	await expect(viewerPage.getByRole('heading', { name: 'API キー' })).toHaveCount(0);
	// 通知は見られるが既読にはできないので、「すべて既読にする」は出さない
	await viewerPage.goto('/notifications');
	await expect(viewerPage.getByRole('heading', { name: '通知' })).toBeVisible();
	await expect(viewerPage.getByRole('button', { name: 'すべて既読にする' })).toHaveCount(0);
	const origin = { Origin: ORIGIN };
	const viaAction = await viewerPage.request.post('/account?/changePassword', {
		headers: origin,
		form: { currentPasswordKey: 'a'.repeat(64), newPasswordKey: 'b'.repeat(64) }
	});
	expect(viaAction.status()).toBe(404);
	// better-auth の HTTP API は、パスワード再設定メールのリンク以外を受け付けない
	for (const path of [
		'/api/auth/change-password',
		'/api/auth/revoke-sessions',
		'/api/auth/update-user'
	]) {
		const r = await viewerPage.request.post(path, {
			headers: origin,
			data: { currentPassword: PW, newPassword: 'changed-password-1', name: '書き換え' }
		});
		expect(r.status(), path).toBe(404);
	}
	// 共用アカウントのセッション一覧（他の利用者の IP）も見せない
	expect((await viewerPage.request.get('/api/auth/list-sessions')).status()).toBe(404);
	// 画面に出ない書き込みを直接送っても拒否する
	const viewerUpload = await viewerPage.request.post('/projects/ACME/attachments', {
		headers: { ...origin, Accept: 'application/json' },
		multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: PNG } }
	});
	expect(viewerUpload.ok()).toBe(false);
	// ログアウト後に古い Cookie（5 分のキャッシュ）を使い回しても、表示名を変えられない
	const staleCookies = await viewerPage.context().cookies();
	await logout(viewerPage);
	await viewerPage.close();
	const stale = await browser.newContext({ baseURL });
	await stale.addCookies(staleCookies);
	const renamed = await stale.request.post('/api/auth/update-user', {
		headers: origin,
		data: { name: '書き換え' }
	});
	expect(renamed.status()).toBe(404);
	await stale.close();
	// パスワード再設定メールのリンクは better-auth に届く（不正なトークンはエラー付きで転送される）
	const resetLink = await page.request.get(
		'/api/auth/reset-password/invalid-token?callbackURL=%2Freset-password',
		{ maxRedirects: 0 }
	);
	expect(resetLink.status()).toBe(302);
	expect(resetLink.headers()['location']).toContain('INVALID_TOKEN');
	// パスワードは変わっていない
	const viewerAgain = await browser.newPage({ baseURL });
	await watchProblems(viewerAgain.context(), problems);
	await login(viewerAgain, 'viewer@example.com');
	await viewerAgain.close();
	// 閲覧者も担当者の候補（絞り込みの選択肢）に出る
	await page.goto('/projects/ACME');
	await expect(page.getByLabel('担当者').locator('option', { hasText: '閲覧 花子' })).toHaveCount(
		1
	);

	// 13. 見たまま編集で開いて中身を変えずに保存しても、本文の Markdown は 1 文字も変わらない
	// 書き出すと形が変わる書き方（番号の振り直し・Setext 見出し・参照リンク）を含める
	const rawBody = '* a\n* b\n\n1) x\n1) y\n\nSetext\n===\n\n[x][l]\n\n[l]: https://example.com';
	await page.goto('/projects/ACME/issues/new');
	await page.getByLabel('タイトル').fill('書き方を保つ');
	const newToggle = page.getByRole('button', { name: 'Markdown ソースのまま編集' });
	await expect(page.getByRole('textbox', { name: '本文' })).toHaveAttribute(
		'contenteditable',
		'true'
	);
	await newToggle.click();
	await page.locator('textarea[name="description"]').fill(rawBody);
	await newToggle.click();
	await expect(newToggle).toHaveAttribute('aria-pressed', 'false');
	await page.getByRole('button', { name: '起票する' }).first().click();
	await expect(page.getByRole('heading', { name: '書き方を保つ' })).toBeVisible();
	const editBody = async () => {
		await page.getByRole('button', { name: 'タイトル・本文を編集' }).click();
		const box = page.getByRole('textbox', { name: '本文' });
		await expect(box).toHaveAttribute('contenteditable', 'true');
		return box;
	};
	const rawBox = page.locator('textarea#issue-description');
	// 起票時点で変わっていないことを先に確かめる
	await editBody();
	await expect(rawBox).toHaveValue(rawBody);
	await page.getByRole('button', { name: '編集をやめる' }).click();
	await (await editBody()).click();
	// 1 文字入れて消す（書き出しは元と同じになるので、元の文字列のまま送る）
	await page.keyboard.type('z');
	await page.keyboard.press('Backspace');
	await page.getByRole('button', { name: '保存', exact: true }).click();
	await expect(page.getByText('保存しました')).toBeVisible();
	await page.reload();
	await editBody();
	await expect(rawBox).toHaveValue(rawBody);
	await page.getByRole('button', { name: '編集をやめる' }).click();

	// 14. 1 行が長い本文（コードブロック・段落）は折り返し、右の欄に重ならず横スクロールも出ない
	await page.setViewportSize({ width: 1280, height: 900 });
	const long = 'x'.repeat(400);
	await page.goto('/projects/ACME/issues/new');
	await page.getByLabel('タイトル').fill('長い行');
	await expect(page.getByRole('textbox', { name: '本文' })).toHaveAttribute(
		'contenteditable',
		'true'
	);
	await newToggle.click();
	await page
		.locator('textarea[name="description"]')
		.fill(`${long}\n\n\`\`\`\n${long} ${'word '.repeat(80)}\n\`\`\``);
	await newToggle.click();
	await page.getByRole('button', { name: '起票する' }).first().click();
	await expect(page.getByRole('heading', { name: '長い行' })).toBeVisible();
	const bodyCard = page.locator('.card.body');
	const side = page.locator('aside.side');
	const cardBox = (await bodyCard.boundingBox())!;
	const sideBox = (await side.boundingBox())!;
	expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(sideBox.x);
	const codeScrolls = await bodyCard
		.locator('pre')
		.evaluate((el) => el.scrollWidth > el.clientWidth);
	expect(codeScrolls).toBe(false);
	expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

	// 15. 管理者の招待とロール変更（確認ダイアログ・自分の行は変更不可）
	await page.context().clearCookies();
	await login(page, 'admin@example.com');
	await page.goto('/admin/users');
	await page.getByLabel('メールアドレス').fill('admin2@example.com');
	await page.getByLabel('ロール', { exact: true }).selectOption({ label: '管理者' });
	await page.locator('#invite-project').click();
	await page.getByRole('checkbox', { name: 'ACME サイト改修' }).check();
	await page.getByRole('button', { name: '招待する' }).click();
	const admin2Url = await page.getByLabel('招待リンク').inputValue();
	await logout(page);
	await acceptInvite(page, admin2Url, '副管理者');
	await logout(page);
	await login(page, 'admin@example.com');
	await page.goto('/admin/users');
	const roleSelect = page.getByLabel('副管理者 さんのロール');
	// 一覧のロール変更も、招待と同じ順
	await expect(roleSelect.locator('option')).toHaveText(['閲覧者', 'ゲスト', 'メンバー', '管理者']);
	await expect(roleSelect).toHaveValue('admin');
	await expect(roleSelect.locator('option:checked')).toHaveText('管理者');
	// 自分の行には select が無い
	await expect(page.getByLabel('管理者 さんのロール', { exact: true })).toHaveCount(0);
	// キャンセルすると変更されない
	await roleSelect.selectOption('member');
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toContainText(
		'副管理者さんのロールを「メンバー」に変更します。このユーザーはログアウトされ、再ログインが必要になります。'
	);
	await dialog.getByRole('button', { name: 'キャンセル' }).click();
	await expect(roleSelect).toHaveValue('admin');
	// 確定すると変更される
	await roleSelect.selectOption('member');
	await dialog.getByRole('button', { name: '変更する' }).click();
	await expect(
		page.getByText('ロールを変更しました。対象のユーザーはログアウトされました')
	).toBeVisible();
	await expect(roleSelect).toHaveValue('member');
	await expect(roleSelect.locator('option:checked')).toHaveText('メンバー');

	// 16. Backlog のユーザー CSV からまとめて招待（アンダースコア入り・長いキーのプロジェクトへ）
	for (const [key, name] of [
		['DEMO', 'デモ'],
		['WEB_APP', 'ウェブアプリ'],
		['LONG_PROJECT_KEY_01', '長いキーのプロジェクト']
	]) {
		await page.goto('/admin/projects/new');
		await page.getByLabel('キー').fill(key.toLowerCase());
		await page.getByLabel('プロジェクト名').fill(name);
		await page.getByRole('button', { name: '作成' }).click();
		await expect(page).toHaveURL(new RegExp(`/projects/${key}$`));
	}
	await page.goto('/admin/users');
	await page.getByLabel('ユーザー CSV').setInputFiles('src/lib/testdata/backlog/users.csv');
	await expect(page.getByText('まだ存在しないプロジェクトがあります')).toBeVisible();
	await expect(page.getByTestId('missing-keys')).toHaveText('MISSING_KEY');
	const preview = page.getByRole('table', { name: '取り込む内容' });
	// hasText の文字列は大文字小文字を区別しない。別名の行も同じアドレス（小文字化後）なので名前で絞る
	const rowOf = (text: string) =>
		preview.getByRole('row').filter({ hasText: text, hasNotText: '別名' });
	await expect(rowOf('鈴木 花子')).toContainText('デモ、長いキーのプロジェクト');
	await expect(rowOf('渡辺 直子')).toContainText('Backlog で有効でない');
	await expect(rowOf('開発 花子')).toContainText('参加を追加');
	await expect(rowOf('伊藤 健')).toContainText('参加できるプロジェクトがない');
	await page.getByLabel('佐藤 次郎 さんの招待ロール').selectOption('guest');
	await expect(page.getByRole('button', { name: '取り込む（7 人）' })).toBeVisible();
	// 見出しのチェックで、取り込める人をすべて外す・すべて選ぶ
	const all = page.getByRole('checkbox', { name: '取り込める人をすべて選ぶ' });
	await expect(all).toBeChecked();
	await all.uncheck();
	await expect(page.getByRole('button', { name: '取り込む（0 人）' })).toBeDisabled();
	await all.check();
	await expect(page.getByRole('button', { name: '取り込む（7 人）' })).toBeVisible();
	await page.getByRole('checkbox', { name: '架空商事 小林 を取り込む' }).uncheck();
	await expect(all).toHaveJSProperty('indeterminate', true);
	// 実行ボタンの上に、取り込まない理由の内訳と「参加できるプロジェクトがない」の説明が出る
	const summary = page.getByTestId('import-summary');
	await expect(summary).toContainText(
		'招待 5 人、参加の追加 1 人。取り込まない人 4 人（Backlog で有効でない 1、CSV 内でメールアドレスが重複 1、参加できるプロジェクトがない 1、チェックを外した 1）'
	);
	await expect(summary).toContainText('招待ロールが管理者でなければ招待できません');
	await page.getByRole('button', { name: '取り込む（6 人）' }).click();
	await expect(
		page.getByText(
			'招待 5 人、参加の追加 1 人、取り込まなかった人 4 人（Backlog で有効でない 1、CSV 内でメールアドレスが重複 1、参加できるプロジェクトがない 1、チェックを外した 1）'
		)
	).toBeVisible();
	// 選んだロールで招待され、チェックを外した人は招待されていない
	const invites = page.locator('.invite');
	await expect(invites.filter({ hasText: 'jiro.sato@example.com' })).toContainText('ゲスト');
	await expect(invites.filter({ hasText: 'kobayashi@example.com' })).toHaveCount(0);
	// 招待を受ける画面に Backlog のハンドルネームが入っている
	const suzuki = page.locator('.invite', { hasText: 'hanako.suzuki@example.com' });
	await suzuki.getByRole('button', { name: 'リンクを再発行' }).click();
	const suzukiUrl = await page.getByLabel('招待リンク').inputValue();
	await logout(page);
	await page.goto(suzukiUrl);
	await expect(page.getByLabel('名前')).toHaveValue('鈴木 花子');
	await page.getByLabel('パスワード').fill(PW);
	await page.getByRole('button', { name: '登録する' }).click();
	await expect(page).toHaveURL(HOME);
	// サイドバーにも同じリンクがあるので、ホームの一覧に絞る
	await expect(
		page.getByRole('main').getByRole('link', { name: '長いキーのプロジェクト' })
	).toBeVisible();
	await page.goto('/projects/LONG_PROJECT_KEY_01');
	await expect(page.getByRole('heading', { name: '長いキーのプロジェクト' })).toBeVisible();
	// キーが長くても、課題一覧のキーは 1 行に収まり、隣のタイトルの列に重ならない
	await page.goto('/projects/LONG_PROJECT_KEY_01/issues/new');
	await page.getByLabel('タイトル').fill('長いキーの課題');
	await page.getByRole('button', { name: '起票する' }).first().click();
	await expect(page).toHaveURL(/\/projects\/LONG_PROJECT_KEY_01\/issues\/1$/);
	await page.goto('/projects/LONG_PROJECT_KEY_01');
	const longKeyCells = page.getByRole('row', { name: /長いキーの課題/ }).getByRole('cell');
	await expect(longKeyCells.first()).toHaveText('LONG_PROJECT_KEY_01-1');
	const keyLayout = await longKeyCells.evaluateAll(([key, title]) => {
		const text = document.createRange();
		text.selectNodeContents(key);
		return {
			lines: text.getClientRects().length,
			right: text.getBoundingClientRect().right,
			titleLeft: title.getBoundingClientRect().left
		};
	});
	expect(keyLayout.lines).toBe(1);
	expect(keyLayout.right).toBeLessThanOrEqual(keyLayout.titleLeft);
	await logout(page);
	await login(page, 'admin@example.com');

	// 17. Backlog の課題 CSV を取り込む（通知なし。人の対応付け・親子・新しいステータスなど）
	// この時点で DEMO には鈴木 花子・開発 花子が参加し、山田 太郎・髙田 一郎①は招待中、架空商事 小林はいない
	await page.goto('/projects/DEMO/settings');
	await page.getByLabel('課題 CSV').setInputFiles('src/lib/testdata/backlog/issues.csv');
	await expect(page.getByTestId('issue-import-summary')).toHaveText(
		'課題 6 件（#1〜#6）とコメント 5 件を取り込みます'
	);
	await expect(page.getByTestId('issue-import-created')).toContainText('ステータス: 保留');
	await expect(page.getByTestId('issue-import-created')).toContainText(
		'カテゴリー: 機能A、確定度 60%、機能B'
	);
	await expect(page.getByTestId('issue-import-row-errors')).toContainText(
		'8 行目（DEMO-7）: 件名がありません'
	);
	const people = page.getByRole('table', { name: '人の対応付け' });
	// 各行の選択肢に全ユーザーの名前が入るので、1 列目の名前で行を探す
	const personRow = (name: string) =>
		people.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
	// 全角空白の違いは無視して、開発 花子を自動で選ぶ
	await expect(page.getByLabel('開発\u3000花子 の対応先')).toHaveValue(/.+/);
	await expect(personRow('開発\u3000花子')).toContainText('名前が一致');
	await expect(personRow('山田 太郎')).toContainText('招待中（未承諾）');
	await expect(personRow('架空商事 小林')).toContainText('該当なし');
	await expect(page.getByText('未承諾の招待がある人がいます')).toBeVisible();
	// 新しく作るマイルストーンのリリース予定日を入れる（CSV に日付はない）
	await expect(page.getByTestId('issue-import-milestones')).toContainText('v1.0');
	const releaseDate = page.getByLabel('v1.0 のリリース予定日');
	await releaseDate.fill('2026-12-15');
	// 書き方を切り替えて計画を作り直しても、入れた日付は残る。
	// 作り直している間は選択が無効になるので、有効に戻るのを待ってから見る
	const notation = page.getByLabel('本文とコメントの書き方');
	const notationBefore = await notation.inputValue();
	await notation.selectOption(notationBefore === 'markdown' ? 'backlog' : 'markdown');
	await expect(notation).toBeEnabled();
	await expect(releaseDate).toHaveValue('2026-12-15');
	await notation.selectOption(notationBefore);
	await expect(notation).toBeEnabled();
	await expect(releaseDate).toHaveValue('2026-12-15');
	await page.getByRole('button', { name: '取り込む（6 件）' }).click();
	const imported = page.getByTestId('issue-import-result');
	await expect(imported).toContainText(
		'課題 6 件（#1〜#6）とコメント 5 件を取り込みました。取り込まなかった行 1 件'
	);
	// 同じ画面のステータス・カテゴリーの一覧にも、作ったものがすぐ出る
	const settingsCard = (title: string) =>
		page.locator('.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
	await expect(settingsCard('ステータス')).toContainText('保留');
	await expect(settingsCard('カテゴリー')).toContainText('確定度 60%');
	await expect(settingsCard('マイルストーン')).toContainText('2026/12/15 リリース');
	await imported.getByRole('link', { name: '課題一覧を見る' }).click();
	await expect(page).toHaveURL(/\/projects\/DEMO$/);
	await expect(page.getByRole('link', { name: 'ログイン API', exact: true })).toBeVisible();
	await page.goto('/projects/DEMO/issues/2');
	await expect(page.getByText('Backlog から移行: DEMO-2')).toBeVisible();
	await expect(page.getByText('担当者（Backlog）: 山田 太郎')).toBeVisible();
	await expect(page.getByText('（Backlog: 架空商事 小林）')).toBeVisible();
	// 不明なユーザーはユーザー一覧に出ない
	await page.goto('/admin/users');
	await expect(page.getByRole('heading', { name: 'ユーザー一覧' })).toBeVisible();
	await expect(page.getByText('不明なユーザー')).toHaveCount(0);
	// 同じ CSV は二重に取り込めない
	await page.goto('/projects/DEMO/settings');
	await page.getByLabel('課題 CSV').setInputFiles('src/lib/testdata/backlog/issues.csv');
	await expect(page.getByText('既に取り込んだ課題があります')).toBeVisible();
	await expect(page.getByRole('button', { name: '取り込む（6 件）' })).toBeDisabled();
	// Backlog 記法の本文・コメントは見つけて、Markdown に変換して取り込む
	await page.getByLabel('課題 CSV').setInputFiles('src/lib/testdata/backlog/issues-notation.csv');
	await expect(page.getByTestId('issue-import-notation')).toContainText(
		'Markdown に変換して取り込みます: NOTE-1'
	);
	await expect(page.getByLabel('本文とコメントの書き方')).toHaveValue('backlog');
	await page.getByRole('button', { name: '取り込む（1 件）' }).click();
	await expect(page.getByTestId('issue-import-result')).toContainText('課題 1 件（#7）');
	await page.goto('/projects/DEMO/issues/7');
	await expect(page.getByRole('heading', { name: '手順', level: 2 })).toBeVisible();
	await expect(page.locator('.markdown strong', { hasText: '重要' })).toBeVisible();
	await expect(page.locator('.markdown del', { hasText: '古い案' })).toBeVisible();
	await expect(page.locator('.markdown pre')).toContainText("x = ''y''");

	// 9. /account で API キーを作成・無効化できる（管理者・メンバー・ゲスト。閲覧者には欄が出ない）
	await page.goto('/account');
	const apiKeyCard = page.locator('.card', {
		has: page.getByRole('heading', { name: 'API キー' })
	});
	await apiKeyCard.getByLabel('名前').fill('e2e');
	await apiKeyCard.getByRole('button', { name: '作成' }).click();
	const tokenBox = page.getByTestId('api-key-token');
	await expect(tokenBox).toHaveValue(/^pm_/);
	await expect(apiKeyCard).toContainText('この画面を離れると二度と表示されません');
	// 作成したキーで /api/v1 を呼べる（Cookie は使わず Bearer のみ）
	const request = await playwright.request.newContext({ baseURL });
	const apiToken = await tokenBox.inputValue();
	const bearer = { Authorization: `Bearer ${apiToken}` };
	const meRes = await request.get('/api/v1/me', { headers: bearer });
	expect(meRes.status()).toBe(200);
	expect(await meRes.json()).toMatchObject({ role: 'admin' });
	const projectRes = await request.get('/api/v1/projects/ACME', { headers: bearer });
	expect(projectRes.status()).toBe(200);
	expect((await projectRes.json()).key).toBe('ACME');
	expect((await request.get('/api/v1/me')).status()).toBe(401);
	// ログイン済みの Cookie セッションでは API を呼べない
	expect((await page.request.get('/api/v1/me')).status()).toBe(401);
	await request.dispose();
	const keyList = apiKeyCard.getByRole('list', { name: 'API キー一覧' });
	await expect(keyList).toContainText('e2e');
	await expect(keyList).toContainText('未使用');
	await page.reload();
	await expect(page.getByTestId('api-key-token')).toHaveCount(0);
	await expect(keyList).toContainText('e2e');
	await page.getByRole('button', { name: 'e2e を無効化' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: '無効化する' }).click();
	await expect(page.getByText('API キーを無効化しました')).toBeVisible();
	await expect(keyList).toHaveCount(0);
	await logout(page);
	await login(page, 'member@example.com');
	await page.goto('/account');
	await expect(page.getByRole('heading', { name: 'パスワード変更' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'API キー' })).toBeVisible();

	// 14. パスワードを変更すると、新しいパスワードでログインできる
	await page.getByLabel('現在のパスワード').fill(PW);
	await page.getByLabel('新しいパスワード').fill('changed-password-1');
	await page
		.locator('form', { has: page.getByRole('heading', { name: 'パスワード変更' }) })
		.getByRole('button', { name: '保存' })
		.click();
	await expect(page.getByText('パスワードを変更しました')).toBeVisible();
	await logout(page);
	await login(page, 'member@example.com', 'changed-password-1');

	// 15. パスワード再設定のメールのリンクから、新しいパスワードにできる
	await logout(page);
	await page.goto('/forgot-password');
	await page.getByLabel('メールアドレス').fill('member@example.com');
	await page.getByRole('button', { name: '再設定メールを送信' }).click();
	await expect(page.getByText('再設定用のリンクを送信しました')).toBeVisible();
	await page.goto(`/reset-password?token=${latestResetToken()}`);
	await expect(page.getByLabel('メールアドレス')).toHaveValue('member@example.com');
	await page.getByLabel('パスワード', { exact: true }).fill('reset-password-1');
	await page.getByRole('button', { name: 'パスワードを再設定' }).click();
	await expect(page).toHaveURL(/\/login$/);
	await login(page, 'member@example.com', 'reset-password-1');

	// 16. パスワード変更で現在のパスワードを 5 回間違えると、しばらく試せない（盗んだセッションでの総当たり対策）
	const changeWith = (currentPasswordKey: string) =>
		page.request.post('/account?/changePassword', {
			headers: { Origin: ORIGIN },
			form: { currentPasswordKey, newPasswordKey: 'b'.repeat(64) }
		});
	for (let i = 0; i < 4; i++) {
		const wrong = await changeWith('a'.repeat(64));
		expect(wrong.status()).toBe(400);
		expect(await wrong.text()).toContain('現在のパスワードが違います');
	}
	// 5 回目の間違いで、ロックしたことと解けるまでの時間を伝える。ロック中は正しくても試せない
	for (let i = 0; i < 2; i++) {
		const locked = await changeWith('a'.repeat(64));
		expect(locked.status()).toBe(429);
		expect(await locked.text()).toMatch(
			/現在のパスワードを5回間違えたため、パスワードの変更を一時的にロックしています。\d+分後に/
		);
	}

	expect(problems).toEqual([]);
});
