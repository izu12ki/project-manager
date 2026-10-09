import { count } from 'drizzle-orm';
import * as v from 'valibot';
import type { BaseContext } from '../context';
import type { DB } from '../db';
import { user } from '../db/schema';
import { AppError } from '../errors';
import { EmailSchema, NameSchema, parse, PasswordSchema } from '../validation';
import { insertCredentialUser } from './credentials';

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
	await base.db.transaction(async (tx) => {
		const [row] = await tx.select({ n: count() }).from(user);
		if (row.n > 0) throw new AppError('conflict', 'セットアップは既に完了しています');
		await insertCredentialUser(tx, {
			name: data.name,
			email: data.email,
			role: 'admin',
			passwordHash
		});
	});
	return { email: data.email };
}
