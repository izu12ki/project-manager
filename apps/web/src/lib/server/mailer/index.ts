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
): Promise<void> {
	const res = await fetchFn(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(`mail API ${url} failed: ${res.status} ${await res.text()}`);
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
			send: (m) =>
				postJson(
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
				)
		};
	}
	return {
		send: (m) =>
			postJson(
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
			)
	};
}
