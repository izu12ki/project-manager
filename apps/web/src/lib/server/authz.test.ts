import { describe, expect, it } from 'vitest';
import { can, type Action, type Actor } from './authz';

const admin: Actor = { id: 'a', name: 'A', email: 'a@x', role: 'admin' };
const member: Actor = { id: 'm', name: 'M', email: 'm@x', role: 'member' };
const guest: Actor = { id: 'g', name: 'G', email: 'g@x', role: 'guest' };

// [action, resource, admin, member, guest]
const table: [Action, Parameters<typeof can>[2], boolean, boolean, boolean][] = [
	['user:manage', {}, true, false, false],
	['project:manage', {}, true, false, false],
	['webhook:manage', {}, true, false, false],
	['issue:create', {}, true, true, true],
	['comment:create', {}, true, true, true],
	['issue:edit', { reporterId: 'x' }, true, true, false],
	['issue:edit', { reporterId: 'g' }, true, true, true],
	['issue:changeStatus', { assigneeId: null }, true, true, false],
	['issue:changeStatus', { assigneeId: 'x' }, true, true, false],
	['issue:changeStatus', { assigneeId: 'g' }, true, true, true],
	['issue:assign', {}, true, true, false],
	['issue:delete', {}, true, true, false],
	['comment:modify', { authorId: 'x' }, true, false, false],
	['comment:modify', { authorId: 'm' }, true, true, false],
	['comment:modify', { authorId: 'g' }, true, false, true],
	['attachment:create', {}, true, true, true],
	['attachment:delete', { uploaderId: 'x' }, true, false, false],
	['attachment:delete', { uploaderId: 'm' }, true, true, false],
	['attachment:delete', { uploaderId: 'g' }, true, false, true]
];

describe('can', () => {
	it.each(table)('%s %j → admin=%s member=%s guest=%s', (action, res, a, m, g) => {
		expect(can(admin, action, res)).toBe(a);
		expect(can(member, action, res)).toBe(m);
		expect(can(guest, action, res)).toBe(g);
	});
});
