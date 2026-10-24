CREATE TABLE `issue_change` (
	`id` text PRIMARY KEY,
	`issue_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`changes` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_issue_change_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_issue_change_actor_id_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
ALTER TABLE `issue_type` ADD `template` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `issue_change_issue_idx` ON `issue_change` (`issue_id`);