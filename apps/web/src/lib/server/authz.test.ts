import { describe, expect, it } from 'vitest';
import { can, canCallAuthApi, type Action, type Actor } from './authz';

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

describe('canCallAuthApi', () => {
	it.each([
		['POST', '/api/auth/change-password'],
		['POST', '/api/auth/update-user'],
		['POST', '/api/auth/revoke-sessions'],
		['POST', '/api/auth/revoke-other-sessions'],
		['POST', '/api/auth/change-email']
	])('閲覧者は %s %s を呼べない', (method, path) => {
		expect(canCallAuthApi(viewer, method, path)).toBe(false);
	});

	it.each([
		['POST', '/api/auth/sign-in/email'],
		['POST', '/api/auth/sign-out'],
		['GET', '/api/auth/get-session'],
		['HEAD', '/api/auth/get-session']
	])('閲覧者もログイン・ログアウト・読み取り（%s %s）はできる', (method, path) => {
		expect(canCallAuthApi(viewer, method, path)).toBe(true);
	});

	it('ほかのロールと未ログインは制限しない', () => {
		expect(canCallAuthApi(member, 'POST', '/api/auth/change-password')).toBe(true);
		expect(canCallAuthApi(guest, 'POST', '/api/auth/revoke-sessions')).toBe(true);
		expect(canCallAuthApi(null, 'POST', '/api/auth/sign-in/email')).toBe(true);
	});

	it('/api/auth/ 以外のパスは対象外', () => {
		expect(canCallAuthApi(viewer, 'POST', '/projects/ACME/attachments')).toBe(true);
	});
});
