import { describe, expect, it } from 'vitest';
import { can, type Action, type Actor } from './authz';

const admin: Actor = { id: 'a', name: 'A', email: 'a@x', role: 'admin' };
const member: Actor = { id: 'm', name: 'M', email: 'm@x', role: 'member' };
const guest: Actor = { id: 'g', name: 'G', email: 'g@x', role: 'guest' };
const viewer: Actor = { id: 'v', name: 'V', email: 'v@x', role: 'viewer' };

// [action, resource, admin, member, guest, viewer]
const table: [Action, Parameters<typeof can>[2], boolean, boolean, boolean, boolean][] = [
	['user:manage', {}, true, false, false, false],
	['project:manage', {}, true, false, false, false],
	['api:use', {}, true, false, false, false],
	['issue:create', {}, true, true, true, false],
	['comment:create', {}, true, true, true, false],
	['issue:edit', { reporterId: 'x' }, true, true, true, false],
	['issue:edit', { reporterId: 'g' }, true, true, true, false],
	['issue:changeStatus', {}, true, true, true, false],
	['issue:changeStatus', { reporterId: 'x' }, true, true, true, false],
	['issue:assign', {}, true, true, true, false],
	['issue:delete', {}, true, true, false, false],
	['comment:modify', { authorId: 'x' }, true, false, false, false],
	['comment:modify', { authorId: 'm' }, true, true, false, false],
	['comment:modify', { authorId: 'g' }, true, false, true, false],
	['attachment:create', {}, true, true, true, false],
	['attachment:delete', { uploaderId: 'x' }, true, false, false, false],
	['attachment:delete', { uploaderId: 'm' }, true, true, false, false],
	['attachment:delete', { uploaderId: 'g' }, true, false, true, false],
	['account:modify', {}, true, true, true, false],
	['comment:modify', { authorId: 'v' }, true, false, false, false],
	['attachment:delete', { uploaderId: 'v' }, true, false, false, false],
	['emoji:delete', { creatorId: 'v' }, true, false, false, false]
];

describe('can', () => {
	it.each(table)('%s %j → admin=%s member=%s guest=%s viewer=%s', (action, res, a, m, g, v) => {
		expect(can(admin, action, res)).toBe(a);
		expect(can(member, action, res)).toBe(m);
		expect(can(guest, action, res)).toBe(g);
		expect(can(viewer, action, res)).toBe(v);
	});
});
