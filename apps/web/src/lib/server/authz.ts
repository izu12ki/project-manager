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
	| 'webhook:manage'
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
	assigneeId?: string | null;
	authorId?: string;
	uploaderId?: string;
}

export function can(actor: Actor, action: Action, res: Resource = {}): boolean {
	if (actor.role === 'admin') return true;
	const isMember = actor.role === 'member';
	switch (action) {
		case 'user:manage':
		case 'project:manage':
		case 'webhook:manage':
			return false;
		case 'issue:create':
		case 'comment:create':
		case 'attachment:create':
			return true;
		case 'issue:assign':
		case 'issue:delete':
			return isMember;
		case 'issue:edit':
			return isMember || res.reporterId === actor.id;
		case 'issue:changeStatus':
			return isMember || (res.assigneeId != null && res.assigneeId === actor.id);
		case 'comment:modify':
			return res.authorId === actor.id;
		case 'attachment:delete':
			return res.uploaderId === actor.id;
	}
}

export function authorize(actor: Actor, action: Action, res?: Resource): void {
	if (!can(actor, action, res)) throw new AppError('forbidden', 'この操作を行う権限がありません');
}
