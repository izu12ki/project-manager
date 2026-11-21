export interface MailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export interface Mailer {
	send(msg: MailMessage): Promise<void>;
}

export interface MailEnv {
	MAIL_PROVIDER: 'cloudflare' | 'smtp2go' | 'resend' | 'console';
	MAIL_API_KEY?: string;
	MAIL_FROM?: string;
	/** Cloudflare Email Sending の send_email バインディング（MAIL_PROVIDER が cloudflare のとき使う） */
	EMAIL?: Pick<SendEmail, 'send'>;
}

async function postJson(
	fetchFn: typeof fetch,
	url: string,
	headers: Record<string, string>,
	body: unknown
): Promise<Response> {
	const res = await fetchFn(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`mail API ${url} failed: ${res.status} ${await res.text()}`);
	return res;
}

/** 届かないと決まっているドメイン（RFC 2606・6761）。サブドメインも含む */
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;

/** 予約ドメイン宛てか。デモやテストの架空ユーザー（example.com など）に送ってバウンスさせないために使う */
export function isReservedAddress(to: string): boolean {
	return RESERVED_DOMAIN.test(to.slice(to.lastIndexOf('@') + 1).trim());
}

/** "名前 <addr>" をバインディングの形 { name, email } にする。名前が無ければアドレスだけ */
export function parseFrom(from: string): string | EmailAddress {
	const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
	if (!m) return from.trim();
	return m[1] ? { name: m[1], email: m[2].trim() } : m[2].trim();
}

export function createMailer(env: MailEnv, fetchFn: typeof fetch = fetch): Mailer {
	if (env.MAIL_PROVIDER === 'console') {
		return {
			async send(m) {
				console.log(`[mail] to=${m.to} subject=${m.subject}\n${m.text}`);
			}
		};
	}
	const mailer = providerMailer(env, fetchFn);
	return {
		async send(m) {
			if (isReservedAddress(m.to)) {
				console.log(`[mail] skipped: ${m.to} is a reserved domain (subject=${m.subject})`);
				return;
			}
			await mailer.send(m);
		}
	};
}

function providerMailer(env: MailEnv, fetchFn: typeof fetch): Mailer {
	const { MAIL_API_KEY: key, MAIL_FROM: from } = env;
	if (!from) throw new Error('MAIL_FROM is required when MAIL_PROVIDER is not console');

	if (env.MAIL_PROVIDER === 'cloudflare') {
		const binding = env.EMAIL;
		if (!binding)
			throw new Error('the send_email binding EMAIL is required when MAIL_PROVIDER is cloudflare');
		const sender = parseFrom(from);
		return {
			async send(m) {
				await binding.send({
					from: sender,
					to: m.to,
					subject: m.subject,
					text: m.text,
					...(m.html ? { html: m.html } : {})
				});
			}
		};
	}
	if (!key) throw new Error('MAIL_API_KEY is required when MAIL_PROVIDER is smtp2go or resend');

	if (env.MAIL_PROVIDER === 'smtp2go') {
		return {
			async send(m) {
				const res = await postJson(
					fetchFn,
					'https://api.smtp2go.com/v3/email/send',
					{ 'X-Smtp2go-Api-Key': key },
					{
						sender: from,
						to: [m.to],
						subject: m.subject,
						text_body: m.text,
						...(m.html ? { html_body: m.html } : {})
					}
				);
				// 200 でも宛先ごとの失敗は data.failed / data.failures で返る
				const body = (await res.json().catch(() => null)) as {
					data?: { failed?: number; failures?: unknown };
				} | null;
				if (body?.data?.failed) {
					throw new Error(`mail API smtp2go failed: ${JSON.stringify(body.data.failures)}`);
				}
			}
		};
	}
	return {
		send: async (m) => {
			await postJson(
				fetchFn,
				'https://api.resend.com/emails',
				{ Authorization: `Bearer ${key}` },
				{
					from,
					to: [m.to],
					subject: m.subject,
					text: m.text,
					...(m.html ? { html: m.html } : {})
				}
			);
		}
	};
}
