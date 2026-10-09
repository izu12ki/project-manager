import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { AppError, handleAction } from './errors';

describe('handleAction', () => {
	it('validation は 400 の fail にする', async () => {
		const r: unknown = await handleAction(async () => {
			throw new AppError('validation', 'だめ', { title: ['必須'] });
		});
		expect(isActionFailure(r) && r.status).toBe(400);
		expect(isActionFailure(r) && r.data).toEqual({ message: 'だめ', fields: { title: ['必須'] } });
	});
	it('forbidden は 404 にする（存在を隠す）', async () => {
		try {
			await handleAction(async () => {
				throw new AppError('forbidden', 'x');
			});
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e) && e.status).toBe(404);
		}
	});
	it('AppError 以外はそのまま投げる', async () => {
		await expect(
			handleAction(async () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
	});
});
