import { defineRelations, sql } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { PRIORITIES, STATUSES } from '../../labels';

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
		role: text({ enum: ['admin', 'member', 'guest'] })
			.notNull()
			.default('member'),
		disabledAt: integer('disabled_at', { mode: 'timestamp_ms' }),
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
		role: text({ enum: ['member', 'guest'] }).notNull(),
		projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
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
		status: text({ enum: STATUSES }).notNull().default('todo'),
		priority: text({ enum: PRIORITIES }).notNull().default('none'),
		assigneeId: text('assignee_id').references(() => user.id),
		reporterId: text('reporter_id')
			.notNull()
			.references(() => user.id),
		startDate: text('start_date'),
		dueDate: text('due_date'),
		categoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
		milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'set null' }),
		position: text().notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('issue_project_number_uq').on(t.projectId, t.number),
		index('issue_board_idx').on(t.projectId, t.status, t.position),
		index('issue_assignee_idx').on(t.assigneeId)
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

export const NOTIFICATION_TYPES = ['assigned', 'commented', 'status_changed', 'mentioned'] as const;
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
		issueId: text('issue_id')
			.notNull()
			.references(() => issue.id, { onDelete: 'cascade' }),
		type: text({ enum: NOTIFICATION_TYPES }).notNull(),
		commentId: text('comment_id').references(() => comment.id, { onDelete: 'cascade' }),
		fromStatus: text('from_status', { enum: STATUSES }),
		toStatus: text('to_status', { enum: STATUSES }),
		readAt: integer('read_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [
		index('notification_user_read_idx').on(t.userId, t.readAt),
		index('notification_user_created_idx').on(t.userId, t.createdAt)
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
