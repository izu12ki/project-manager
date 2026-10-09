import { describe, expect, it, vi } from 'vitest';
import { createMailer } from './index';

const msg = { to: 'to@example.com', subject: 'S', text: 'T' };

function okFetch() {
	return vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch & {
		mock: { calls: [string, RequestInit][] };
	};
}

describe('createMailer', () => {
	it('smtp2go: API キーをヘッダに載せて JSON を POST する', async () => {
		const f = okFetch();
		await createMailer(
			{ MAIL_PROVIDER: 'smtp2go', MAIL_API_KEY: 'k', MAIL_FROM: 'PM <a@x.com>' },
			f
		).send(msg);
		const [url, init] = f.mock.calls[0];
		expect(url).toBe('https://api.smtp2go.com/v3/email/send');
		expect((init.headers as Record<string, string>)['X-Smtp2go-Api-Key']).toBe('k');
		expect(JSON.parse(init.body as string)).toEqual({
			sender: 'PM <a@x.com>',
			to: ['to@example.com'],
			subject: 'S',
			text_body: 'T'
		});
	});

	it('resend: Bearer トークンで JSON を POST する', async () => {
		const f = okFetch();
		await createMailer(
			{ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_FROM: 'a@x.com' },
			f
		).send(msg);
		const [url, init] = f.mock.calls[0];
		expect(url).toBe('https://api.resend.com/emails');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
		expect(JSON.parse(init.body as string)).toEqual({
			from: 'a@x.com',
			to: ['to@example.com'],
			subject: 'S',
			text: 'T'
		});
	});

	it('API がエラーを返したら例外にする', async () => {
		const f = vi.fn(async () => new Response('bad', { status: 401 })) as unknown as typeof fetch;
		await expect(
			createMailer({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k', MAIL_FROM: 'a@x.com' }, f).send(
				msg
			)
		).rejects.toThrow('401');
	});

	it('console 以外で API キーか送信元が無ければ作成時に例外', () => {
		expect(() => createMailer({ MAIL_PROVIDER: 'smtp2go' })).toThrow('MAIL_API_KEY');
	});

	it('console は fetch しない', async () => {
		const f = okFetch();
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await createMailer({ MAIL_PROVIDER: 'console' }, f).send(msg);
		expect(f).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});
});
