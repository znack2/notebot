Readme.md

bot
@my_reminder1987_bot

test - 
https://api.telegram.org/bot{TOKEN}/getWebhookInfo
https://api.telegram.org/bot{TOKEN}/getMe

https://notebot-production-17f2.up.railway.app/health


save here
https://github.com/znack2/notes_repo/blob/main/2026-04-17.md


/health check 


check 
	ping tools:
	UptimeRobot
	Better Stack Uptime
	Cron-job.org

	other servers:
	Render
	Fly.io
	Koyeb
	Northflank


INSTRUCTION:
1. generate 2 tokens in github  and replace for local .env and for server separately 
2. change in the server https://railway.com/project/148575dc-f875-4eba-8775-060642978b57/service/
3. push local github curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook -d "url=https://notebot-notebot.up.railway.app/webhook"
4. change setwebhook each time for new code in server curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook -d "url=/<MYSERVER>/webhook