-- AlterTable
ALTER TABLE "slack_connections" ADD COLUMN     "userToken" TEXT;

-- CreateTable
CREATE TABLE "slack_channel_selections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slackConnectionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "channelType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_channel_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "slack_channel_selections_slackConnectionId_channelId_key" ON "slack_channel_selections"("slackConnectionId", "channelId");

-- AddForeignKey
ALTER TABLE "slack_channel_selections" ADD CONSTRAINT "slack_channel_selections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_channel_selections" ADD CONSTRAINT "slack_channel_selections_slackConnectionId_fkey" FOREIGN KEY ("slackConnectionId") REFERENCES "slack_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
