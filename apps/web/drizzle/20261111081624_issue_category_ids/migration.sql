ALTER TABLE `issue` ADD `category_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- カテゴリーを複数持てるようにする。旧 category_id は残し（テーブルを作り直すと子テーブルの CASCADE を巻き込むため）、値だけ移す
UPDATE `issue` SET `category_ids` = json_array(`category_id`) WHERE `category_id` IS NOT NULL;
