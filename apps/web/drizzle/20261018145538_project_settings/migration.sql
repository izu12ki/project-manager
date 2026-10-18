CREATE TABLE `invitation_project` (
	`invitation_id` text NOT NULL,
	`project_id` text NOT NULL,
	CONSTRAINT `invitation_project_pk` PRIMARY KEY(`invitation_id`, `project_id`),
	CONSTRAINT `fk_invitation_project_invitation_id_invitation_id_fk` FOREIGN KEY (`invitation_id`) REFERENCES `invitation`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invitation_project_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `issue_status` (
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `issue_status_pk` PRIMARY KEY(`project_id`, `key`),
	CONSTRAINT `fk_issue_status_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `issue_type` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'gray' NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_issue_type_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `issue` ADD `type_id` text REFERENCES issue_type(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `issue` ADD `resolution` text;--> statement-breakpoint
ALTER TABLE `issue` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `issue` ADD `deleted_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `project` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `project` ADD `color` text;--> statement-breakpoint
-- 招待先プロジェクトを退避する（invitation を作り直すと invitation_project は連鎖削除されるため）
CREATE TABLE `__invitation_project_tmp` AS SELECT `id` AS `invitation_id`, `project_id` FROM `invitation` WHERE `project_id` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invitation` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_invitation_invited_by_user_id_fk` FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_invitation`(`id`, `email`, `role`, `token_hash`, `invited_by`, `expires_at`, `accepted_at`, `created_at`) SELECT `id`, `email`, `role`, `token_hash`, `invited_by`, `expires_at`, `accepted_at`, `created_at` FROM `invitation`;--> statement-breakpoint
DROP TABLE `invitation`;--> statement-breakpoint
ALTER TABLE `__new_invitation` RENAME TO `invitation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_hash_uq` ON `invitation` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE INDEX `invitation_project_project_idx` ON `invitation_project` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_type_project_name_uq` ON `issue_type` (`project_id`,`name`);--> statement-breakpoint
INSERT INTO `invitation_project` (`invitation_id`, `project_id`) SELECT `invitation_id`, `project_id` FROM `__invitation_project_tmp`;--> statement-breakpoint
DROP TABLE `__invitation_project_tmp`;--> statement-breakpoint
-- 既存プロジェクトに既定のステータスと課題種別を用意する
INSERT INTO `issue_status` (`project_id`, `key`, `name`, `color`, `position`) SELECT `id`, 'todo', '未着手', 'gray', 0 FROM `project`;--> statement-breakpoint
INSERT INTO `issue_status` (`project_id`, `key`, `name`, `color`, `position`) SELECT `id`, 'in_progress', '進行中', 'blue', 1 FROM `project`;--> statement-breakpoint
INSERT INTO `issue_status` (`project_id`, `key`, `name`, `color`, `position`) SELECT `id`, 'in_review', 'レビュー', 'amber', 2 FROM `project`;--> statement-breakpoint
INSERT INTO `issue_status` (`project_id`, `key`, `name`, `color`, `position`) SELECT `id`, 'done', '完了', 'green', 3 FROM `project`;--> statement-breakpoint
INSERT INTO `issue_type` (`id`, `project_id`, `name`, `color`, `position`) SELECT lower(hex(randomblob(16))), `id`, 'タスク', 'blue', 0 FROM `project`;--> statement-breakpoint
INSERT INTO `issue_type` (`id`, `project_id`, `name`, `color`, `position`) SELECT lower(hex(randomblob(16))), `id`, 'バグ', 'pink', 1 FROM `project`;--> statement-breakpoint
INSERT INTO `issue_type` (`id`, `project_id`, `name`, `color`, `position`) SELECT lower(hex(randomblob(16))), `id`, '要望', 'teal', 2 FROM `project`;--> statement-breakpoint
INSERT INTO `issue_type` (`id`, `project_id`, `name`, `color`, `position`) SELECT lower(hex(randomblob(16))), `id`, 'その他', 'gray', 3 FROM `project`;--> statement-breakpoint
UPDATE `issue` SET `type_id` = (SELECT `t`.`id` FROM `issue_type` `t` WHERE `t`.`project_id` = `issue`.`project_id` AND `t`.`name` = 'タスク');