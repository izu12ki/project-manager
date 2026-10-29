import type { Auth } from '#lib/server/auth.ts';
import type { Actor } from '#lib/server/authz.ts';
import type { BaseContext } from '#lib/server/context.ts';

declare global {
	namespace App {
		interface Locals {
			auth: Auth;
			base: BaseContext;
			user: Actor | null;
		}
	}
}

export {};
