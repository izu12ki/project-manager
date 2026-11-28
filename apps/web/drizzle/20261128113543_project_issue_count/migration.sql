CREATE TABLE `project_issue_count` (
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`n` integer NOT NULL,
	CONSTRAINT `project_issue_count_pk` PRIMARY KEY(`project_id`, `status`),
	CONSTRAINT `fk_project_issue_count_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- project_issue_count は issue からトリガーで作る（db/schema.ts の projectIssueCount）
CREATE TRIGGER `project_issue_count_insert` AFTER INSERT ON `issue` WHEN new.`deleted_at` IS NULL BEGIN
	INSERT INTO `project_issue_count` (`project_id`, `status`, `n`) VALUES (new.`project_id`, new.`status`, 1)
		ON CONFLICT (`project_id`, `status`) DO UPDATE SET `n` = `n` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `project_issue_count_update` AFTER UPDATE OF `status`, `deleted_at`, `project_id` ON `issue`
	WHEN old.`status` IS NOT new.`status` OR old.`project_id` IS NOT new.`project_id`
		OR (old.`deleted_at` IS NULL) IS NOT (new.`deleted_at` IS NULL)
BEGIN
	UPDATE `project_issue_count` SET `n` = `n` - 1
		WHERE old.`deleted_at` IS NULL AND `project_id` = old.`project_id` AND `status` = old.`status`;
	INSERT INTO `project_issue_count` (`project_id`, `status`, `n`)
		SELECT new.`project_id`, new.`status`, 1 WHERE new.`deleted_at` IS NULL
		ON CONFLICT (`project_id`, `status`) DO UPDATE SET `n` = `n` + 1;
END;--> statement-breakpoint
CREATE TRIGGER `project_issue_count_delete` AFTER DELETE ON `issue` WHEN old.`deleted_at` IS NULL BEGIN
	UPDATE `project_issue_count` SET `n` = `n` - 1
		WHERE `project_id` = old.`project_id` AND `status` = old.`status`;
END;--> statement-breakpoint
INSERT INTO `project_issue_count` (`project_id`, `status`, `n`)
	SELECT `project_id`, `status`, count(*) FROM `issue` WHERE `deleted_at` IS NULL GROUP BY `project_id`, `status`;
