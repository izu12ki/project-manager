import { count, eq } from 'drizzle-orm';
import * as v from 'valibot';
import type { BaseContext } from '../context';
import type { DB } from '../db';
import { user } from '../db/schema';
import { AppError } from '../errors';
import { EmailSchema, NameSchema, parse, PasswordSchema } from '../validation';
import { credentialUserInserts } from './credentials';

export async function needsSetup(db: DB): Promise<boolean> {
	const [row] = await db.select({ n: count() }).from(user);
	return row.n === 0;
}

const SetupInput = v.object({ name: NameSchema, email: EmailSchema, password: PasswordSchema });

export async function createFirstAdmin(
	base: BaseContext,
	input: unknown
): Promise<{ email: string }> {
	const data = parse(SetupInput, input);
	const passwordHash = await base.hashPassword(data.password);
	const done = new AppError('conflict', 'セットアップは既に完了しています');
	if (!(await needsSetup(base.db))) throw done;
	const { id, statements } = credentialUserInserts(
		base.db,
		{ name: data.name, email: data.email, role: 'admin', passwordHash },
		{ onlyIfNoUsers: true }
	);
	await base.db.batch(statements);
	if ((await base.db.$count(user, eq(user.id, id))) === 0) throw done;
	return { email: data.email };
}
