import type { Auth } from '$lib/server/auth';
import type { Actor } from '$lib/server/authz';
import type { BaseContext } from '$lib/server/context';

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
