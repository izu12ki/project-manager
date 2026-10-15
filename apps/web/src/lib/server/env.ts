import * as v from 'valibot';

const EnvSchema = v.object({
	TURSO_DATABASE_URL: v.pipe(v.string(), v.minLength(1)),
	TURSO_AUTH_TOKEN: v.optional(v.string()),
	BETTER_AUTH_SECRET: v.pipe(v.string(), v.minLength(32)),
	BETTER_AUTH_URL: v.pipe(
		v.string(),
		v.url(),
		v.transform((s) => s.replace(/\/+$/, ''))
	),
	MAIL_PROVIDER: v.optional(v.picklist(['smtp2go', 'resend', 'console']), 'console'),
	MAIL_API_KEY: v.optional(v.string()),
	SLACK_BOT_TOKEN: v.optional(v.string()),
	MAIL_FROM: v.optional(v.string())
});

export type AppEnv = v.InferOutput<typeof EnvSchema>;

export function readEnv(raw: unknown): AppEnv {
	const r = v.safeParse(EnvSchema, raw);
	if (r.success) return r.output;
	const names = r.issues.map((i) => v.getDotPath(i)).join(', ');
	throw new Error(`Invalid environment variables: ${names}. See .dev.vars.example / docs.`);
}
