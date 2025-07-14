-- CreateTable
CREATE TABLE "slack_scraping_jobs" (
    "id" TEXT NOT NULL,
    "slackConnectionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "channelType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "messagesScraped" INTEGER NOT NULL DEFAULT 0,
    "totalMessages" INTEGER,
    "lastMessageTs" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_scraping_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slack_scraping_jobs_slackConnectionId_channelId_key" ON "slack_scraping_jobs"("slackConnectionId", "channelId");

-- AddForeignKey
ALTER TABLE "slack_scraping_jobs" ADD CONSTRAINT "slack_scraping_jobs_slackConnectionId_fkey" FOREIGN KEY ("slackConnectionId") REFERENCES "slack_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
