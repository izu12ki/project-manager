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
	| 'account:modify'
	| 'notification:read';

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
		// account:modify は表示名・パスワード・Slack 通知などの自分の設定。
		// notification:read は通知の既読化（閲覧者の共用アカウントでは既読にせず、次に見る人にも未読のまま残す）
		case 'account:modify':
		case 'notification:read':
			return true;
	}
}

/** パスワード再設定メールのリンク（better-auth が検証して /reset-password へ転送する） */
const RESET_PASSWORD_LINK = /^\/api\/auth\/reset-password\/[^/]+$/;

/**
 * better-auth の HTTP API（/api/auth/*）へのリクエストを通すか。
 * ログイン・ログアウト・パスワード変更などは、すべてアプリのフォームからサーバー側（auth.api.*）で呼ぶ。
 * HTTP で受け付けるのはパスワード再設定メールのリンクだけにする。
 * better-auth の一部の API は Cookie のキャッシュ（5 分）だけでセッションを認めるので、
 * 閲覧者の共用アカウントでログアウト後の古い Cookie を使い、表示名を変えたり、
 * セッション一覧（他の利用者の IP）を見たりできてしまう。それを入口で止める
 */
export function isAllowedAuthRequest(method: string, pathname: string): boolean {
	if (!pathname.startsWith('/api/auth/')) return true;
	return (method === 'GET' || method === 'HEAD') && RESET_PASSWORD_LINK.test(pathname);
}

export function authorize(actor: Actor, action: Action, res?: Resource): void {
	if (!can(actor, action, res)) throw new AppError('forbidden', 'この操作を行う権限がありません');
}
