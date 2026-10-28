-- 子課題（parent_id）と複数担当者（assignee_ids）
ALTER TABLE `issue` ADD `assignee_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- 担当者を複数持てるようにする。旧 assignee_id は残し（テーブルを作り直すと子テーブルの CASCADE を巻き込むため）、値だけ移す
UPDATE `issue` SET `assignee_ids` = json_array(`assignee_id`) WHERE `assignee_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `issue` ADD `parent_id` text REFERENCES issue(id) ON DELETE SET NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `issue_assignee_idx`;--> statement-breakpoint
CREATE INDEX `issue_parent_idx` ON `issue` (`parent_id`);