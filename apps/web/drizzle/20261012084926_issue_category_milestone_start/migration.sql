CREATE TABLE `category` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_category_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `milestone` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`release_date` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_milestone_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `issue` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `issue` ADD `category_id` text REFERENCES category(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `issue` ADD `milestone_id` text REFERENCES milestone(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `category_project_name_uq` ON `category` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `milestone_project_name_uq` ON `milestone` (`project_id`,`name`);