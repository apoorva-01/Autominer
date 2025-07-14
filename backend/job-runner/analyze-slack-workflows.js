// analyze-slack-workflows.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { OpenAI } = require('openai');

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function extractMessages({ year, channelId, limit = 1000 }) {
  // Optionally filter by year and/or channel
  const where = {};
  if (year) {
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end = new Date(`${year + 1}-01-01T00:00:00Z`);
    where.createdAt = { gte: start, lt: end };
  }
  if (channelId) where.channelId = channelId;
  const messages = await prisma.slackConversation.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { messageText: true, channelName: true, userName: true, createdAt: true, channelId: true, messageTs: true }
  });
  return messages;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function analyzeBatch(messages) {
  const prompt = `You are an expert in workflow automation. Analyze the following real Slack messages.\n\nIdentify repeated tasks, patterns, or requests. For each, answer:\n- What is the repeated task or workflow?\n- How often does it occur?\n- Is it suitable for automation?\n- What are example messages?\n- Suggest clear automation instructions.\n\nMessages:\n${messages.map(m => `[${m.createdAt.toISOString()}] ${m.userName}: ${m.messageText}`).join('\n')}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a workflow automation analyst.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 1200,
    temperature: 0.2
  });
  return completion.choices[0].message.content;
}

async function main() {
  const year = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
  const channelId = process.argv[3] || undefined;
  const limit = 1000;
  console.log(`Extracting messages${year ? ' for year ' + year : ''}${channelId ? ' for channel ' + channelId : ''}...`);
  const messages = await extractMessages({ year, channelId, limit });
  if (!messages.length) {
    console.log('No messages found.');
    return;
  }
  const batchSize = 40; // Tune for token limits
  const batches = chunkArray(messages, batchSize);
  let allFindings = [];
  for (let i = 0; i < batches.length; i++) {
    console.log(`Analyzing batch ${i + 1} of ${batches.length}...`);
    const findings = await analyzeBatch(batches[i]);
    allFindings.push(findings);
  }
  // Print or save the report
  console.log('\n===== AUTOMATION DISCOVERY REPORT =====\n');
  allFindings.forEach((finding, idx) => {
    console.log(`--- Batch ${idx + 1} ---\n`);
    console.log(finding);
    console.log('\n');
  });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); }); 