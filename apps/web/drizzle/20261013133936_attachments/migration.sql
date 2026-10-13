CREATE TABLE `attachment` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`issue_id` text,
	`comment_id` text,
	`uploader_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_attachment_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_attachment_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_attachment_comment_id_comment_id_fk` FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_attachment_uploader_id_user_id_fk` FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_r2_key_uq` ON `attachment` (`r2_key`);--> statement-breakpoint
CREATE INDEX `attachment_issue_idx` ON `attachment` (`issue_id`);--> statement-breakpoint
CREATE INDEX `attachment_uploader_idx` ON `attachment` (`uploader_id`,`issue_id`);