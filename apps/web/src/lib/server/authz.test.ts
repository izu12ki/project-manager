import { describe, expect, it } from 'vitest';
import { can, isAllowedAuthRequest, type Action, type Actor } from './authz';

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
	['notification:read', {}, true, true, true, false],
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

describe('isAllowedAuthRequest', () => {
	// アプリは better-auth をサーバー側（auth.api.*）からだけ呼ぶ。HTTP で通すのは再設定メールのリンクだけ
	it.each([
		['GET', '/api/auth/reset-password/abc123'],
		['HEAD', '/api/auth/reset-password/abc123']
	])('%s %s（パスワード再設定メールのリンク）は通す', (method, path) => {
		expect(isAllowedAuthRequest(method, path)).toBe(true);
	});

	it.each([
		// ログアウト後の古い Cookie（5 分のキャッシュ）でも表示名を変えられないこと
		['POST', '/api/auth/update-user'],
		['POST', '/api/auth/change-password'],
		['POST', '/api/auth/change-email'],
		['POST', '/api/auth/revoke-sessions'],
		['POST', '/api/auth/revoke-other-sessions'],
		['POST', '/api/auth/sign-in/email'],
		['POST', '/api/auth/sign-out'],
		['POST', '/api/auth/reset-password'],
		['POST', '/api/auth/request-password-reset'],
		// 共用アカウントのセッション一覧（他の利用者の IP）を見せない
		['GET', '/api/auth/list-sessions'],
		['GET', '/api/auth/get-session'],
		['GET', '/api/auth/reset-password/abc/extra'],
		['GET', '/api/auth/reset-password/'],
		['OPTIONS', '/api/auth/update-user']
	])('%s %s は拒否する', (method, path) => {
		expect(isAllowedAuthRequest(method, path)).toBe(false);
	});

	it('/api/auth/ 以外のパスは対象外', () => {
		expect(isAllowedAuthRequest('POST', '/projects/ACME/attachments')).toBe(true);
		expect(isAllowedAuthRequest('POST', '/api/v1/projects/ACME/issues')).toBe(true);
	});
});
