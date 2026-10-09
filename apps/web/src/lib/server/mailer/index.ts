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
	MAIL_PROVIDER: 'smtp2go' | 'resend' | 'console';
	MAIL_API_KEY?: string;
	MAIL_FROM?: string;
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

export function createMailer(env: MailEnv, fetchFn: typeof fetch = fetch): Mailer {
	if (env.MAIL_PROVIDER === 'console') {
		return {
			async send(m) {
				console.log(`[mail] to=${m.to} subject=${m.subject}\n${m.text}`);
			}
		};
	}
	const { MAIL_API_KEY: key, MAIL_FROM: from } = env;
	if (!key || !from)
		throw new Error('MAIL_API_KEY and MAIL_FROM are required when MAIL_PROVIDER is not console');

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
