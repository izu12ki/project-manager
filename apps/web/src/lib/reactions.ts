/** コメントに付けられる絵文字。並び順はピッカーの表示順 */
export const REACTION_EMOJIS = ['👍', '❤️', '😄', '🎉', '🙏', '👀', '🚀', '✅'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface ReactionGroup {
	emoji: string;
	users: { id: string; name: string }[];
}

/** 「A、B、C がリアクションしました」。多いときは末尾を「他 N 人」にまとめる */
export function reactorsLabel(users: { name: string }[], max = 10): string {
	const names = users.slice(0, max).map((u) => u.name);
	const rest = users.length - names.length;
	return `${names.join('、')}${rest > 0 ? ` 他 ${rest} 人` : ''}`;
}

/** 自分のリアクションを付け外しした後の一覧（楽観的更新用）。絵文字の並びは最初に付いた順を保つ */
export function toggleReactionIn(
	groups: ReactionGroup[],
	emoji: string,
	me: { id: string; name: string }
): ReactionGroup[] {
	const target = groups.find((g) => g.emoji === emoji);
	if (!target) return [...groups, { emoji, users: [me] }];
	const reacted = target.users.some((u) => u.id === me.id);
	return groups
		.map((g) =>
			g !== target
				? g
				: { emoji, users: reacted ? g.users.filter((u) => u.id !== me.id) : [...g.users, me] }
		)
		.filter((g) => g.users.length > 0);
}
