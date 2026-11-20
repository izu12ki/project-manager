import { AppError } from './errors';

export type Role = 'admin' | 'member' | 'guest' | 'viewer';

export interface Actor {
	id: string;
	name: string;
	email: string;
	role: Role;
}

export type Action =
	| 'user:manage'
	| 'project:manage'
	| 'api:use'
	| 'issue:create'
	| 'issue:edit'
	| 'issue:changeStatus'
	| 'issue:assign'
	| 'issue:delete'
	| 'comment:create'
	| 'comment:modify'
	| 'attachment:create'
	| 'attachment:delete'
	| 'emoji:create'
	| 'emoji:delete'
	| 'account:modify';

export interface Resource {
	reporterId?: string;
	authorId?: string;
	uploaderId?: string;
	creatorId?: string;
}

export function can(actor: Actor, action: Action, res: Resource = {}): boolean {
	if (actor.role === 'admin') return true;
	// 閲覧者（公開デモなど）は何も書き込めない。自分のアカウント設定も変えられない
	if (actor.role === 'viewer') return false;
	const isMember = actor.role === 'member';
	switch (action) {
		case 'user:manage':
		case 'project:manage':
		case 'api:use':
			return false;
		// ゲストも参加しているプロジェクトの課題は作成・編集できる（削除はメンバー以上）
		case 'issue:create':
		case 'issue:edit':
		case 'issue:changeStatus':
		case 'issue:assign':
		case 'comment:create':
		case 'attachment:create':
			return true;
		// 課題の削除とカスタム絵文字の登録はメンバー以上（ゲストは絵文字をリアクションに使うだけ）
		case 'issue:delete':
		case 'emoji:create':
			return isMember;
		case 'comment:modify':
			return res.authorId === actor.id;
		case 'attachment:delete':
			return res.uploaderId === actor.id;
		case 'emoji:delete':
			return res.creatorId === actor.id;
		// 表示名・パスワード・Slack 通知などの自分の設定
		case 'account:modify':
			return true;
	}
}

/** 閲覧者でも呼べる better-auth の書き込み（ログイン・ログアウト） */
const AUTH_API_ALWAYS = new Set(['/api/auth/sign-in/email', '/api/auth/sign-out']);

/**
 * better-auth の API（/api/auth/*）を呼んでよいか。
 * パスワード変更・セッション失効などは can() を通らないので、閲覧者はここで止める
 * （公開デモの共用アカウントで、パスワードを変えて他の人を締め出せないようにする）
 */
export function canCallAuthApi(actor: Actor | null, method: string, pathname: string): boolean {
	if (!actor || !pathname.startsWith('/api/auth/')) return true;
	if (method === 'GET' || method === 'HEAD' || AUTH_API_ALWAYS.has(pathname)) return true;
	return can(actor, 'account:modify');
}

export function authorize(actor: Actor, action: Action, res?: Resource): void {
	if (!can(actor, action, res)) throw new AppError('forbidden', 'この操作を行う権限がありません');
}
