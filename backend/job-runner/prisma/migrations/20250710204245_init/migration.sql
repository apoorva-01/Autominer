-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slackUserId" TEXT NOT NULL,
    "slackTeamId" TEXT NOT NULL,
    "slackTeamName" TEXT NOT NULL,
    "pipedreamConnId" TEXT,
    "accessToken" TEXT,
    "scopes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_conversations" (
    "id" TEXT NOT NULL,
    "slackConnectionId" TEXT NOT NULL,
    "messageTs" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "messageText" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "threadTs" TEXT,
    "participants" TEXT[],
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_tasks" (
    "id" TEXT NOT NULL,
    "slackConversationId" TEXT NOT NULL,
    "taskDescription" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "estimatedRoi" TEXT NOT NULL,
    "suggestedTools" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_report_tasks" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "automationTaskId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "automation_report_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "slack_connections_userId_slackTeamId_key" ON "slack_connections"("userId", "slackTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "slack_conversations_slackConnectionId_messageTs_key" ON "slack_conversations"("slackConnectionId", "messageTs");

-- CreateIndex
CREATE UNIQUE INDEX "automation_report_tasks_reportId_automationTaskId_key" ON "automation_report_tasks"("reportId", "automationTaskId");

-- AddForeignKey
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_conversations" ADD CONSTRAINT "slack_conversations_slackConnectionId_fkey" FOREIGN KEY ("slackConnectionId") REFERENCES "slack_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_slackConversationId_fkey" FOREIGN KEY ("slackConversationId") REFERENCES "slack_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_reports" ADD CONSTRAINT "automation_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_report_tasks" ADD CONSTRAINT "automation_report_tasks_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "automation_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_report_tasks" ADD CONSTRAINT "automation_report_tasks_automationTaskId_fkey" FOREIGN KEY ("automationTaskId") REFERENCES "automation_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
