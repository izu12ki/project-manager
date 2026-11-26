// Backlog のユーザー CSV の読み込み。ブラウザとサーバーの両方で使う（$lib/server を import しない）。
import { columnIndex, parseCsv } from '#lib/csv.ts';
import type { ROLE_LABEL } from '#lib/labels.ts';
import { MAIL_PLAN_RESTRICTED } from '#lib/mail.ts';

export type ImportRole = keyof typeof ROLE_LABEL;

export const MAX_CSV_USERS = 1000;
export const MAX_IMPORT_USERS = 100;
/**
 * 1 回のリクエストで送る取り込み対象（招待・参加の追加）の人数。画面はこの人数ずつ分けて送る。
 * Workers の無料プランは 1 リクエストで D1 への問い合わせが 50 回、外部への送信（招待メール）が 50 回まで。
 * 招待は 1 人あたり問い合わせ 4 回なので、確認・参加の追加・セッション確認の分を足しても 50 回に収まる人数にする
 */
export const IMPORT_CHUNK = 8;

export interface BacklogUserRow {
	/** ヘッダーを 1 とした行番号 */
	rowNumber: number;
	name: string;
	email: string;
	backlogRole: string;
	status: string;
	projectKeys: string[];
}

const KEY_COLUMN = '参加中のプロジェクトキー（アーカイブ済みを除く）';
const COLUMNS = ['ハンドルネーム', 'メールアドレス', '権限', '状態', KEY_COLUMN] as const;

export function readBacklogUsers(
	text: string
): { ok: true; rows: BacklogUserRow[] } | { ok: false; message: string } {
	const [header, ...lines] = parseCsv(text);
	const index = columnIndex(header ?? [], COLUMNS);
	if (!index) {
		return {
			ok: false,
			message:
				'Backlog のユーザー CSV ではないようです（「ハンドルネーム」「メールアドレス」「権限」「状態」「参加中のプロジェクトキー（アーカイブ済みを除く）」の列が必要です）'
		};
	}
	// 表計算ソフトで保存し直すと、末尾に ",,,,," だけの行が付くことがある
	const body = lines.filter((cells) => cells.some((c) => c.trim() !== ''));
	if (body.length === 0) return { ok: false, message: 'CSV にユーザーがいません' };
	if (body.length > MAX_CSV_USERS) {
		return { ok: false, message: '一度に読み込めるのは1000人までです' };
	}
	const rows = body.map((cells, i): BacklogUserRow => {
		const cell = (name: (typeof COLUMNS)[number]) => (cells[index[name]] ?? '').trim();
		const keys = cell(KEY_COLUMN)
			.split(',')
			.map((k) => k.trim().toUpperCase())
			.filter((k) => k !== '');
		return {
			rowNumber: i + 2,
			name: cell('ハンドルネーム'),
			email: cell('メールアドレス'),
			backlogRole: cell('権限'),
			status: cell('状態'),
			projectKeys: [...new Set(keys)]
		};
	});
	return { ok: true, rows };
}

export function roleFromBacklog(label: string): ImportRole {
	if (label === '管理者') return 'admin';
	if (label === '一般ユーザー' || label === 'レポーター') return 'member';
	return 'guest';
}

export function inviteAllowed(role: ImportRole, projectCount: number): boolean {
	return role === 'admin' || projectCount > 0;
}

export type UserImportSkip =
	| 'inactive'
	| 'invalid_email'
	| 'duplicate'
	| 'pending_invitation'
	| 'disabled_user'
	| 'already_joined'
	| 'no_projects'
	| 'unselected';

export const SKIP_LABEL: Record<UserImportSkip, string> = {
	inactive: 'Backlog で有効でない',
	invalid_email: 'メールアドレスの形式が正しくない',
	duplicate: 'CSV 内でメールアドレスが重複',
	pending_invitation: '招待中（未承諾）',
	disabled_user: 'このツールで無効になっている',
	already_joined: '参加済み',
	no_projects: '参加できるプロジェクトがない',
	unselected: 'チェックを外した'
};

/** 結果に名前を出す人。name は CSV のハンドルネーム（空のことがある） */
export interface ImportPerson {
	name: string;
	email: string;
}

export interface UserImportResult {
	invited: number;
	joined: number;
	skipped: Partial<Record<UserImportSkip, number>>;
	/** 招待を作れなかった人（確認画面の後に登録された人など）。CSV を読み込み直すと今の扱いがわかる */
	inviteFailed: ImportPerson[];
	/** 招待はできたが、招待メールを送れなかった人 */
	mailFailed: ImportPerson[];
	/** 送れなかった理由に、Cloudflare Email Sending の無料プランの宛先の制限があった */
	mailRestricted?: boolean;
}

const people = (xs: ImportPerson[]) =>
	xs.map((p) => (p.name ? `${p.name}（${p.email}）` : p.email)).join('、');

/** 理由別の人数を SKIP_LABEL の定義順に「（参加済み 1、…）」の形にする。理由がなければ空文字 */
function skipDetail(skipped: UserImportResult['skipped']): { total: number; detail: string } {
	const reasons = (Object.keys(SKIP_LABEL) as UserImportSkip[])
		.filter((k) => (skipped[k] ?? 0) > 0)
		.map((k) => ({ label: SKIP_LABEL[k], count: skipped[k] ?? 0 }));
	const total = reasons.reduce((sum, x) => sum + x.count, 0);
	const detail = reasons.length
		? `（${reasons.map((x) => `${x.label} ${x.count}`).join('、')}）`
		: '';
	return { total, detail };
}

/** 確認画面で、取り込む人数と取り込まない理由の内訳を出す */
export function formatImportPreview(p: {
	invite: number;
	join: number;
	skipped: UserImportResult['skipped'];
}): string {
	const { total, detail } = skipDetail(p.skipped);
	if (p.invite + p.join === 0) return `取り込む人がいません${detail}`;
	const head = `招待 ${p.invite} 人、参加の追加 ${p.join} 人`;
	return total > 0 ? `${head}。取り込まない人 ${total} 人${detail}` : head;
}

export function formatImportResult(r: UserImportResult): string {
	const { total, detail } = skipDetail(r.skipped);
	const invite =
		r.inviteFailed.length > 0
			? `。招待できなかった人 ${r.inviteFailed.length} 人: ${people(r.inviteFailed)}。CSV を読み込み直して確認してください`
			: '';
	const mail =
		r.mailFailed.length > 0
			? `。招待メールを送れなかった人 ${r.mailFailed.length} 人: ${people(r.mailFailed)}。${r.mailRestricted ? `${MAIL_PLAN_RESTRICTED}。` : ''}招待中の一覧の「リンクを再発行」でリンクを渡してください`
			: '';
	return `招待 ${r.invited} 人、参加の追加 ${r.joined} 人、取り込まなかった人 ${total} 人${detail}${invite}${mail}`;
}

/** 分けて送った取り込みの結果を 1 つにまとめる（人数と理由別の数は足し、失敗した人は並べる） */
export function mergeImportResults(parts: UserImportResult[]): UserImportResult {
	const skipped: UserImportResult['skipped'] = {};
	for (const p of parts) {
		for (const [reason, n] of Object.entries(p.skipped) as [UserImportSkip, number][]) {
			skipped[reason] = (skipped[reason] ?? 0) + n;
		}
	}
	return {
		invited: parts.reduce((sum, p) => sum + p.invited, 0),
		joined: parts.reduce((sum, p) => sum + p.joined, 0),
		skipped,
		inviteFailed: parts.flatMap((p) => p.inviteFailed),
		mailFailed: parts.flatMap((p) => p.mailFailed),
		...(parts.some((p) => p.mailRestricted) ? { mailRestricted: true } : {})
	};
}

/**
 * 取り込む行を IMPORT_CHUNK 人ずつ順に送る。1 回送り終えるたびに onProgress に送り終えた人数を渡す。
 * 途中で失敗したら、それまでに送り終えた回の結果と人数を返す（失敗した回の人は、一部だけ済んでいる可能性がある）
 */
export async function sendImportChunks<T>(
	targets: readonly T[],
	send: (rows: T[]) => Promise<UserImportResult>,
	onProgress: (sent: number) => void = () => {}
): Promise<
	| { ok: true; results: UserImportResult[] }
	| { ok: false; results: UserImportResult[]; sent: number; error: unknown }
> {
	const results: UserImportResult[] = [];
	let sent = 0;
	while (sent < targets.length) {
		const rows = targets.slice(sent, sent + IMPORT_CHUNK);
		try {
			results.push(await send(rows));
		} catch (error) {
			return { ok: false, results, sent, error };
		}
		sent += rows.length;
		onProgress(sent);
	}
	return { ok: true, results };
}

/** 途中で失敗したときの文言。cause は失敗の理由、total は送る予定だった人数、sent は送り終えた人数 */
export function formatImportFailure(cause: string, total: number, sent: number): string {
	const rest =
		sent === 0
			? '招待や参加の追加は済んでいないか、一部だけ済んでいる可能性があります'
			: `${total} 人のうち ${sent} 人までは済みました。${sent + 1} 人目からは、済んでいないか一部だけ済んでいる可能性があります`;
	return `${cause}。${rest}。CSV を読み込み直して確認してください`;
}
