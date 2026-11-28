import { defineRelations, sql } from 'drizzle-orm';
import {
	type AnySQLiteColumn,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { COLORS, PRIORITIES, RESOLUTIONS, type IssueChangeItem } from '../../labels';

const now = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;
const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now);
const updatedAt = () =>
	integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(now)
		.$onUpdate(() => new Date());

// ---- better-auth（キー名は better-auth のフィールド名と一致させること） ----

export const user = sqliteTable(
	'user',
	{
		id: text().primaryKey(),
		name: text().notNull(),
		email: text().notNull(),
		emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
		image: text(),
		role: text({ enum: ['admin', 'member', 'guest', 'viewer'] })
			.notNull()
			.default('member'),
		disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
		/** 担当者に設定されたとき・メンションされたときに、メールでも知らせるか（アカウント設定で変える） */
		emailNotifications: integer('email_notifications', { mode: 'boolean' }).notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('user_email_uq').on(t.email)]
);

export const session = sqliteTable(
	'session',
	{
		id: text().primaryKey(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		token: text().notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [uniqueIndex('session_token_uq').on(t.token), index('session_user_id_idx').on(t.userId)]
);

export const account = sqliteTable(
	'account',
	{
		id: text().primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
		scope: text(),
		password: text(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('account_user_id_idx').on(t.userId)]
);

export const verification = sqliteTable(
	'verification',
	{
		id: text().primaryKey(),
		identifier: text().notNull(),
		value: text().notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('verification_identifier_idx').on(t.identifier)]
);

export const rateLimit = sqliteTable(
	'rate_limit',
	{
		id: text().primaryKey(),
		key: text().notNull(),
		count: integer().notNull(),
		lastRequest: integer('last_request').notNull()
	},
	(t) => [uniqueIndex('rate_limit_key_uq').on(t.key)]
);

// ---- アプリ ----

export const project = sqliteTable(
	'project',
	{
		id: text().primaryKey(),
		key: text().notNull(),
		name: text().notNull(),
		description: text().notNull().default(''),
		/** アイコンに出す文字（絵文字など）。null はキーの頭文字 */
		icon: text(),
		/** アイコン画像。設定すると文字の代わりに出す。R2 のキーは project-icon/{id} */
		iconImageId: text('icon_image_id'),
		iconImageType: text('icon_image_type'),
		/** null はキーから自動で選ぶ */
		color: text({ enum: COLORS }),
		nextIssueNumber: integer('next_issue_number').notNull().default(1),
		archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('project_key_uq').on(t.key)]
);

export const projectMember = sqliteTable(
	'project_member',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.projectId, t.userId] }),
		index('project_member_user_idx').on(t.userId)
	]
);

export const invitation = sqliteTable(
	'invitation',
	{
		id: text().primaryKey(),
		email: text().notNull(),
		role: text({ enum: ['admin', 'member', 'guest', 'viewer'] }).notNull(),
		/** 招待を受ける画面の名前欄に最初から入れる名前（Backlog のハンドルネームなど） */
		name: text(),
		tokenHash: text('token_hash').notNull(),
		invitedBy: text('invited_by')
			.notNull()
			.references(() => user.id),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('invitation_token_hash_uq').on(t.tokenHash),
		index('invitation_email_idx').on(t.email)
	]
);

/** 招待を受け入れたときに参加するプロジェクト */
export const invitationProject = sqliteTable(
	'invitation_project',
	{
		invitationId: text('invitation_id')
			.notNull()
			.references(() => invitation.id, { onDelete: 'cascade' }),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.invitationId, t.projectId] }),
		index('invitation_project_project_idx').on(t.projectId)
	]
);

/** 個人の API キー（閲覧者以外が作れる）。平文は保存せず sha256 のみ持つ */
export const apiKey = sqliteTable(
	'api_key',
	{
		id: text().primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text().notNull(),
		tokenHash: text('token_hash').notNull(),
		prefix: text().notNull(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
		revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [
		index('api_key_user_idx').on(t.userId),
		uniqueIndex('api_key_token_hash_uq').on(t.tokenHash)
	]
);

/** プロジェクトごとのステータス。issue.status は key を持つ */
export const issueStatus = sqliteTable(
	'issue_status',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		/** 既定のものは 'todo' などの固定値、追加したものは UUID */
		key: text().notNull(),
		name: text().notNull(),
		color: text({ enum: COLORS }).notNull().default('gray'),
		position: integer().notNull(),
		createdAt: createdAt()
	},
	(t) => [primaryKey({ columns: [t.projectId, t.key] })]
);

export const issueType = sqliteTable(
	'issue_type',
	{
		id: text().primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		name: text().notNull(),
		color: text({ enum: COLORS }).notNull().default('gray'),
		/** 起票時に本文へ入れるテンプレート（Markdown） */
		template: text().notNull().default(''),
		position: integer().notNull(),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('issue_type_project_name_uq').on(t.projectId, t.name)]
);

export const category = sqliteTable(
	'category',
	{
		id: text().primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		name: text().notNull(),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('category_project_name_uq').on(t.projectId, t.name)]
);

export const milestone = sqliteTable(
	'milestone',
	{
		id: text().primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		name: text().notNull(),
		/** リリース予定日 'YYYY-MM-DD'（任意） */
		releaseDate: text('release_date'),
		/** 完了にした日時。完了したものは課題の選択肢に出さない */
		completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('milestone_project_name_uq').on(t.projectId, t.name)]
);

export const issue = sqliteTable(
	'issue',
	{
		id: text().primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		number: integer().notNull(),
		title: text().notNull(),
		description: text().notNull().default(''),
		typeId: text('type_id').references(() => issueType.id, { onDelete: 'set null' }),
		status: text().notNull().default('todo'),
		/** 完了理由 */
		resolution: text({ enum: RESOLUTIONS }),
		priority: text({ enum: PRIORITIES }).notNull().default('none'),
		/** 担当者の user.id（設定した順）。担当者なしは [] */
		assigneeIds: text('assignee_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
		/**
		 * 旧・単一の担当者。assignee_ids へ移した後は読み書きしない。
		 * 列を消すにはテーブルの作り直しが要り、子テーブルの ON DELETE CASCADE を巻き込む恐れがあるため残している
		 */
		legacyAssigneeId: text('assignee_id').references(() => user.id),
		/** 親課題。子課題は 1 階層まで（子課題の子課題は作れない） */
		parentId: text('parent_id').references((): AnySQLiteColumn => issue.id, {
			onDelete: 'set null'
		}),
		reporterId: text('reporter_id')
			.notNull()
			.references(() => user.id),
		startDate: text('start_date'),
		dueDate: text('due_date'),
		/** 付いているカテゴリーの category.id（プロジェクトのカテゴリー順）。なしは [] */
		categoryIds: text('category_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
		/**
		 * 旧・単一のカテゴリー。category_ids へ移した後は読み書きしない。
		 * 列を消すにはテーブルの作り直しが要り、子テーブルの ON DELETE CASCADE を巻き込む恐れがあるため残している
		 */
		legacyCategoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
		milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'set null' }),
		/** Backlog から取り込んだ課題の元のキー（PROJ-531）。二重取り込みの防止と、分けて取り込んだときの親子に使う */
		backlogKey: text('backlog_key'),
		position: text().notNull(),
		/** 削除した日時。削除した課題は一覧から外し、削除履歴として閲覧だけできる */
		deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
		deletedBy: text('deleted_by').references(() => user.id),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('issue_project_number_uq').on(t.projectId, t.number),
		index('issue_board_idx').on(t.projectId, t.status, t.position),
		// タイムライン: 未完了の課題と、表示の開始日以降に終わる完了した課題だけを読む（services/issues.ts の timelineQueries）
		index('issue_timeline_idx').on(
			t.projectId,
			t.status,
			sql`coalesce(${t.dueDate}, ${t.startDate})`
		),
		index('issue_parent_idx').on(t.parentId),
		// 自分の課題の「登録した課題」（services/my-issues.ts）
		index('issue_reporter_idx').on(t.reporterId),
		// 課題一覧の「削除した課題」（services/issues.ts の deletedIssuesQuery）。削除した課題だけの索引なので、ふだんの書き込みでは増えない
		index('issue_deleted_idx')
			.on(t.projectId, t.deletedAt)
			.where(sql`${t.deletedAt} is not null`),
		uniqueIndex('issue_project_backlog_key_uq').on(t.projectId, t.backlogKey)
	]
);

/**
 * 課題の担当者（issue.assignee_ids を 1 人 1 行に開いたもの）。自分の課題（services/my-issues.ts）を、
 * プロジェクトの課題をすべて読まずに引くための索引で、アプリからは書かない。
 * issue の INSERT・UPDATE のトリガー（drizzle/20261128*_issue_assignee/migration.sql）が assignee_ids と
 * 完了かどうかに合わせて書き直す。issue テーブルを作り直すとトリガーが消えるので、作り直すマイグレーションでは
 * トリガーも作り直すこと（db/issue-assignee.test.ts が確かめる）。
 * user_id には外部キーを付けない（assignee_ids には消えたユーザーの ID が残りうる）
 */
export const issueAssignee = sqliteTable(
	'issue_assignee',
	{
		userId: text('user_id').notNull(),
		issueId: text('issue_id')
			.notNull()
			.references(() => issue.id, { onDelete: 'cascade' }),
		/** 課題が完了か（status = 'done'）。完了以外だけを読めるよう主キーに入れる */
		done: integer({ mode: 'boolean' }).notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.done, t.issueId] }),
		index('issue_assignee_issue_idx').on(t.issueId)
	]
);

export const comment = sqliteTable(
	'comment',
	{
		id: text().primaryKey(),
		issueId: text('issue_id')
			.notNull()
			.references(() => issue.id, { onDelete: 'cascade' }),
		authorId: text('author_id')
			.notNull()
			.references(() => user.id),
		body: text().notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('comment_issue_idx').on(t.issueId)]
);

/** コメントへの絵文字リアクション。1 人が同じ絵文字を付けられるのは 1 回 */
export const commentReaction = sqliteTable(
	'comment_reaction',
	{
		commentId: text('comment_id')
			.notNull()
			.references(() => comment.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		emoji: text().notNull(),
		createdAt: createdAt()
	},
	(t) => [primaryKey({ columns: [t.commentId, t.userId, t.emoji] })]
);

/** ワークスペース共通のカスタム絵文字。リアクションには「:name:」で保存する */
export const customEmoji = sqliteTable(
	'custom_emoji',
	{
		id: text().primaryKey(),
		name: text().notNull(),
		creatorId: text('creator_id')
			.notNull()
			.references(() => user.id),
		contentType: text('content_type').notNull(),
		r2Key: text('r2_key').notNull(),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('custom_emoji_name_uq').on(t.name)]
);

/** 課題の編集履歴。1 回の保存で 1 行 */
export const issueChange = sqliteTable(
	'issue_change',
	{
		id: text().primaryKey(),
		issueId: text('issue_id')
			.notNull()
			.references(() => issue.id, { onDelete: 'cascade' }),
		actorId: text('actor_id')
			.notNull()
			.references(() => user.id),
		changes: text({ mode: 'json' }).$type<IssueChangeItem[]>().notNull(),
		createdAt: createdAt()
	},
	(t) => [index('issue_change_issue_idx').on(t.issueId)]
);

// issueId が null の行は「仮置き」（起票・コメント投稿前にアップロードしたもの）
export const attachment = sqliteTable(
	'attachment',
	{
		id: text().primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		issueId: text('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
		commentId: text('comment_id').references(() => comment.id, { onDelete: 'set null' }),
		uploaderId: text('uploader_id')
			.notNull()
			.references(() => user.id),
		filename: text().notNull(),
		contentType: text('content_type').notNull(),
		size: integer().notNull(),
		r2Key: text('r2_key').notNull(),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('attachment_r2_key_uq').on(t.r2Key),
		index('attachment_issue_idx').on(t.issueId),
		index('attachment_uploader_idx').on(t.uploaderId, t.issueId)
	]
);

export const NOTIFICATION_TYPES = [
	'assigned',
	'commented',
	'status_changed',
	'mentioned',
	/** 一括 API のまとめ通知。issueId は null で、projectId と count を持つ */
	'bulk_assigned',
	'bulk_mentioned',
	'bulk_updated'
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notification = sqliteTable(
	'notification',
	{
		id: text().primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		actorId: text('actor_id')
			.notNull()
			.references(() => user.id),
		/** まとめ通知では null */
		issueId: text('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
		/** まとめ通知の対象プロジェクト。課題ごとの通知では null */
		projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
		type: text({ enum: NOTIFICATION_TYPES }).notNull(),
		/** まとめ通知の課題数 */
		count: integer(),
		commentId: text('comment_id').references(() => comment.id, { onDelete: 'cascade' }),
		fromStatus: text('from_status'),
		toStatus: text('to_status'),
		readAt: integer('read_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [
		index('notification_user_read_idx').on(t.userId, t.readAt),
		index('notification_user_created_idx').on(t.userId, t.createdAt),
		index('notification_project_idx').on(t.projectId)
	]
);

export const INTEGRATION_PROVIDERS = ['slack'] as const;
export type IntegrationProviderId = (typeof INTEGRATION_PROVIDERS)[number];

/** 個人の外部連携。行があればオン */
export const userIntegration = sqliteTable(
	'user_integration',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		provider: text({ enum: INTEGRATION_PROVIDERS }).notNull(),
		/** 連携先でのユーザー ID（Slack は U…） */
		externalId: text('external_id').notNull(),
		createdAt: createdAt()
	},
	(t) => [primaryKey({ columns: [t.userId, t.provider] })]
);

// better-auth の Drizzle アダプタ（relations-v2）が使う。アプリ側のクエリはコア API（select/join）で書く。
export const relations = defineRelations(
	{ user, session, account, verification, rateLimit },
	(r) => ({
		user: { sessions: r.many.session(), accounts: r.many.account() },
		session: { user: r.one.user({ from: r.session.userId, to: r.user.id }) },
		account: { user: r.one.user({ from: r.account.userId, to: r.user.id }) }
	})
);
