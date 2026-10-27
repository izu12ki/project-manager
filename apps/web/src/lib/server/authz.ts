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
	| 'attachment:delete';

export interface Resource {
	reporterId?: string;
	authorId?: string;
	uploaderId?: string;
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
		case 'issue:delete':
			return isMember;
		case 'comment:modify':
			return res.authorId === actor.id;
		case 'attachment:delete':
			return res.uploaderId === actor.id;
	}
}

export function authorize(actor: Actor, action: Action, res?: Resource): void {
	if (!can(actor, action, res)) throw new AppError('forbidden', 'この操作を行う権限がありません');
}
