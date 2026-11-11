// Backlog のユーザー CSV の読み込み。ブラウザとサーバーの両方で使う（$lib/server を import しない）。
import { columnIndex, parseCsv } from '#lib/csv.ts';
import type { ROLE_LABEL } from '#lib/labels.ts';

export type ImportRole = keyof typeof ROLE_LABEL;

export const MAX_CSV_USERS = 1000;
export const MAX_IMPORT_USERS = 100;

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
	const [header, ...body] = parseCsv(text);
	const index = columnIndex(header ?? [], COLUMNS);
	if (!index) {
		return {
			ok: false,
			message:
				'Backlog のユーザー CSV ではないようです（「ハンドルネーム」「メールアドレス」「権限」「状態」「参加中のプロジェクトキー（アーカイブ済みを除く）」の列が必要です）'
		};
	}
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

export interface UserImportResult {
	invited: number;
	joined: number;
	skipped: Partial<Record<UserImportSkip, number>>;
}

export function formatImportResult(r: UserImportResult): string {
	const reasons = (Object.keys(SKIP_LABEL) as UserImportSkip[])
		.filter((k) => (r.skipped[k] ?? 0) > 0)
		.map((k) => ({ label: SKIP_LABEL[k], count: r.skipped[k] ?? 0 }));
	const total = reasons.reduce((sum, x) => sum + x.count, 0);
	const detail = reasons.length
		? `（${reasons.map((x) => `${x.label} ${x.count}`).join('、')}）`
		: '';
	return `招待 ${r.invited} 人、参加の追加 ${r.joined} 人、取り込まなかった人 ${total} 人${detail}`;
}
