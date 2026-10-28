import { AppError } from './errors';

export type Role = 'admin' | 'member' | 'guest';

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
	| 'emoji:delete';

export interface Resource {
	reporterId?: string;
	authorId?: string;
	uploaderId?: string;
	creatorId?: string;
}

export function can(actor: Actor, action: Action, res: Resource = {}): boolean {
	if (actor.role === 'admin') return true;
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
	}
}

export function authorize(actor: Actor, action: Action, res?: Resource): void {
	if (!can(actor, action, res)) throw new AppError('forbidden', 'この操作を行う権限がありません');
}
