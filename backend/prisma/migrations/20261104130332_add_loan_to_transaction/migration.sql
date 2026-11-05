-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `loanId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Transaction_loanId_idx` ON `Transaction`(`loanId`);

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `Loan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
