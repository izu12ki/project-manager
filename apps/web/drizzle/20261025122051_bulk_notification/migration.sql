-- issue_id を null 可にするため作り直す。project_id と count は既存の行では NULL になる
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notification` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`issue_id` text,
	`project_id` text,
	`type` text NOT NULL,
	`count` integer,
	`comment_id` text,
	`from_status` text,
	`to_status` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_notification_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_notification_actor_id_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_notification_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notification_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notification_comment_id_comment_id_fk` FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_notification`(`id`, `user_id`, `actor_id`, `issue_id`, `type`, `comment_id`, `from_status`, `to_status`, `read_at`, `created_at`) SELECT `id`, `user_id`, `actor_id`, `issue_id`, `type`, `comment_id`, `from_status`, `to_status`, `read_at`, `created_at` FROM `notification`;--> statement-breakpoint
DROP TABLE `notification`;--> statement-breakpoint
ALTER TABLE `__new_notification` RENAME TO `notification`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `notification_user_read_idx` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notification_user_created_idx` ON `notification` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_project_idx` ON `notification` (`project_id`);