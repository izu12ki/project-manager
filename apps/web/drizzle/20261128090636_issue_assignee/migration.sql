CREATE TABLE `issue_assignee` (
	`user_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`done` integer NOT NULL,
	CONSTRAINT `issue_assignee_pk` PRIMARY KEY(`user_id`, `done`, `issue_id`),
	CONSTRAINT `fk_issue_assignee_issue_id_issue_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issue`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `issue_reporter_idx` ON `issue` (`reporter_id`);--> statement-breakpoint
CREATE INDEX `issue_assignee_issue_idx` ON `issue_assignee` (`issue_id`);--> statement-breakpoint
-- issue_assignee は assignee_ids と status からトリガーで作る（db/schema.ts の issueAssignee）
CREATE TRIGGER `issue_assignee_insert` AFTER INSERT ON `issue` BEGIN
	INSERT INTO `issue_assignee` (`user_id`, `issue_id`, `done`)
		SELECT DISTINCT `value`, new.`id`, new.`status` = 'done' FROM json_each(new.`assignee_ids`);
END;--> statement-breakpoint
CREATE TRIGGER `issue_assignee_update` AFTER UPDATE OF `assignee_ids`, `status` ON `issue`
	WHEN old.`assignee_ids` IS NOT new.`assignee_ids` OR (old.`status` = 'done') IS NOT (new.`status` = 'done')
BEGIN
	DELETE FROM `issue_assignee` WHERE `issue_id` = new.`id`;
	INSERT INTO `issue_assignee` (`user_id`, `issue_id`, `done`)
		SELECT DISTINCT `value`, new.`id`, new.`status` = 'done' FROM json_each(new.`assignee_ids`);
END;--> statement-breakpoint
INSERT INTO `issue_assignee` (`user_id`, `issue_id`, `done`)
	SELECT DISTINCT j.`value`, i.`id`, i.`status` = 'done' FROM `issue` AS i, json_each(i.`assignee_ids`) AS j;
