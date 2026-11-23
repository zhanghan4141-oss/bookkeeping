-- CreateTable
CREATE TABLE `ExpensePlan` (
    `id` VARCHAR(191) NOT NULL,
    `ledgerId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `periodAmount` DECIMAL(12, 2) NOT NULL,
    `termCount` INTEGER NOT NULL DEFAULT 0,
    `frequency` VARCHAR(191) NOT NULL DEFAULT 'month',
    `startDate` DATE NOT NULL,
    `day` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExpensePlan_ledgerId_name_key`(`ledgerId`, `name`),
    INDEX `ExpensePlan_ledgerId_idx`(`ledgerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpensePlanPeriod` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `periodNo` INTEGER NOT NULL,
    `dueDate` DATE NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `paidDate` DATE NULL,
    `note` VARCHAR(191) NULL,

    UNIQUE INDEX `ExpensePlanPeriod_planId_periodNo_key`(`planId`, `periodNo`),
    INDEX `ExpensePlanPeriod_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `expensePlanId` VARCHAR(191) NULL;
ALTER TABLE `Transaction` ADD COLUMN `expensePlanPeriodId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Transaction_expensePlanId_idx` ON `Transaction`(`expensePlanId`);
CREATE INDEX `Transaction_expensePlanPeriodId_idx` ON `Transaction`(`expensePlanPeriodId`);

-- AddForeignKey
ALTER TABLE `ExpensePlan` ADD CONSTRAINT `ExpensePlan_ledgerId_fkey` FOREIGN KEY (`ledgerId`) REFERENCES `Ledger`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpensePlan` ADD CONSTRAINT `ExpensePlan_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpensePlanPeriod` ADD CONSTRAINT `ExpensePlanPeriod_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `ExpensePlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_expensePlanId_fkey` FOREIGN KEY (`expensePlanId`) REFERENCES `ExpensePlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_expensePlanPeriodId_fkey` FOREIGN KEY (`expensePlanPeriodId`) REFERENCES `ExpensePlanPeriod`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;