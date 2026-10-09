import { uuidv7 } from 'uuidv7';
import type { Role } from '../authz';
import type { Tx } from '../db';
import { account, user } from '../db/schema';

/** better-auth の signUpEmail と同じ形で user と credential account を作る。トランザクション内で呼ぶこと。 */
export async function insertCredentialUser(
	tx: Tx,
	input: { name: string; email: string; role: Role; passwordHash: string }
): Promise<string> {
	const id = uuidv7();
	await tx.insert(user).values({
		id,
		name: input.name,
		email: input.email,
		role: input.role,
		emailVerified: true
	});
	await tx.insert(account).values({
		id: uuidv7(),
		accountId: id,
		providerId: 'credential',
		userId: id,
		password: input.passwordHash
	});
	return id;
}
