-- AlterTable
ALTER TABLE `ReminderSetting` ADD COLUMN `pushEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `remindTime` VARCHAR(191) NOT NULL DEFAULT '08:00';
