CREATE TABLE `notification` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`type` text NOT NULL,
	`comment_id` text,
	`from_status` text,
	`to_status` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_notification_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_notification_actor_id_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_notification_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notification_comment_id_comment_id_fk` FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_webhook` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_project_webhook_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `notification_user_read_idx` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `notification_user_created_idx` ON `notification` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `project_webhook_project_idx` ON `project_webhook` (`project_id`);