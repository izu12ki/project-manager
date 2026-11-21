import { describe, expect, it, vi } from 'vitest';
import { createMailer, isReservedAddress, parseFrom } from './index';

const msg = { to: 'to@x.com', subject: 'S', text: 'T' };

function okFetch() {
	return vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch & {
		mock: { calls: [string, RequestInit][] };
	};
}

describe('createMailer', () => {
	it('cloudflare: send_email バインディングで送り、送信元は名前とアドレスに分ける', async () => {
		const send = vi.fn(async () => ({ messageId: 'm' }));
		const f = okFetch();
		await createMailer(
			{ MAIL_PROVIDER: 'cloudflare', MAIL_FROM: 'PM <a@x.com>', EMAIL: { send } },
			f
		).send({ ...msg, html: '<p>T</p>' });
		expect(send).toHaveBeenCalledWith({
			from: { name: 'PM', email: 'a@x.com' },
			to: 'to@x.com',
			subject: 'S',
			text: 'T',
			html: '<p>T</p>'
		});
		expect(f).not.toHaveBeenCalled();
	});

	it('cloudflare: API キーは不要で、バインディングが無ければ作成時に例外', () => {
		expect(() => createMailer({ MAIL_PROVIDER: 'cloudflare', MAIL_FROM: 'a@x.com' })).toThrow(
			'EMAIL'
		);
	});

	it('cloudflare: 送信の失敗は例外にする', async () => {
		const send = vi.fn(async () => {
			throw new Error('E_SENDER_NOT_VERIFIED');
		});
		await expect(
			createMailer({ MAIL_PROVIDER: 'cloudflare', MAIL_FROM: 'a@x.com', EMAIL: { send } }).send(msg)
		).rejects.toThrow('E_SENDER_NOT_VERIFIED');
	});

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
			to: ['to@x.com'],
			subject: 'S',
			text_body: 'T'
		});
	});

	it('smtp2go: 200 でも宛先ごとの失敗（data.failed）が返れば例外にする', async () => {
		const f = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ data: { succeeded: 0, failed: 1, failures: ['to@x.com'] } }),
					{ status: 200 }
				)
		) as unknown as typeof fetch;
		await expect(
			createMailer({ MAIL_PROVIDER: 'smtp2go', MAIL_API_KEY: 'k', MAIL_FROM: 'a@x.com' }, f).send(
				msg
			)
		).rejects.toThrow('to@x.com');
	});

	it('予約ドメイン（example.com など）宛ては送らない（デモの架空ユーザーでバウンスさせない）', async () => {
		const f = okFetch();
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const mailer = createMailer(
			{ MAIL_PROVIDER: 'smtp2go', MAIL_API_KEY: 'k', MAIL_FROM: 'a@x.com' },
			f
		);
		await mailer.send({ ...msg, to: 'demo@example.com' });
		expect(f).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith(expect.stringContaining('demo@example.com'));
		log.mockRestore();
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
			to: ['to@x.com'],
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

	it('console 以外で送信元が無ければ、smtp2go・resend で API キーが無ければ作成時に例外', () => {
		expect(() => createMailer({ MAIL_PROVIDER: 'cloudflare' })).toThrow('MAIL_FROM');
		expect(() => createMailer({ MAIL_PROVIDER: 'smtp2go', MAIL_FROM: 'a@x.com' })).toThrow(
			'MAIL_API_KEY'
		);
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

describe('isReservedAddress', () => {
	it('RFC 2606・6761 の予約ドメインとそのサブドメインだけ true', () => {
		for (const to of [
			'a@example.com',
			'a@EXAMPLE.ORG',
			'a@mail.example.net',
			'a@foo.example',
			'a@shop.test',
			'unknown-user@invalid',
			'a@localhost'
		]) {
			expect(isReservedAddress(to), to).toBe(true);
		}
		for (const to of ['a@x.com', 'a@notexample.com', 'a@example.co.jp', 'a@test.dev']) {
			expect(isReservedAddress(to), to).toBe(false);
		}
	});
});

describe('parseFrom', () => {
	it('"名前 <addr>" は名前とアドレスに分け、アドレスだけならそのまま', () => {
		expect(parseFrom('Project Manager <noreply@example.com>')).toEqual({
			name: 'Project Manager',
			email: 'noreply@example.com'
		});
		expect(parseFrom('"PM" <a@x.com>')).toEqual({ name: 'PM', email: 'a@x.com' });
		expect(parseFrom('<a@x.com>')).toBe('a@x.com');
		expect(parseFrom(' a@x.com ')).toBe('a@x.com');
	});
});
