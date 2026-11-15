ALTER TABLE `issue` ADD `backlog_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `issue_project_backlog_key_uq` ON `issue` (`project_id`,`backlog_key`);