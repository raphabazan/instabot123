require('dotenv').config();
const loginInstagram = require('./src/login');
const scrapeComments = require('./src/scrape_comments');
const runQualification = require('./src/qualification_bot');
const { runLinkedInBot } = require('./src/linkedin_bot');
const runDMSender = require('./src/dm_sender_bot');
const { randomDelay } = require('./src/utils');

const readline = require('readline');

(async () => {
    console.log('🚀 Starting the bot...');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question(
        'Choose an option:\n' +
        '1️⃣ Instagram Scrape\n' +
        '2️⃣ Instagram Qualification\n' +
        '3️⃣ LinkedIn Scrape\n' +
        '4️⃣ Instagram DM Sender\n' +
        '👉 Your choice: ',
        async (answer) => {
            rl.close();

            if (answer === '1') {
                const { browser, page } = await loginInstagram();
                console.log('✅ Instagram Login successful.');

                const postUrls = [
                    
                    'https://www.instagram.com/p/DJHlmPkvifI/',
                    'https://www.instagram.com/p/DKcyh51zaVk/',
                    'https://www.instagram.com/p/DKxO91Mv38k'
                ];

                for (const postUrl of postUrls) {
                    console.log(`\n---- Scraping post: ${postUrl}`);
                    await scrapeComments(page, postUrl);
                    console.log('Waiting before next post...');
                    await randomDelay();
                }

                console.log('✅ Instagram scrape finished. Browser will remain open.');

            } else if (answer === '2') {
                const { browser, page } = await loginInstagram();
                console.log('✅ Instagram Login successful.');
                await runQualification(browser, page);

            } else if (answer === '3') {
                console.log('➡️ Starting LinkedIn Bot...');
                await runLinkedInBot();

            } else if (answer === '4') {
                const { browser, page } = await loginInstagram();
                console.log('➡️ Starting DM Sender Bot...');
                await runDMSender(browser, page);

            } else {
                console.log('❌ Invalid option. Please run again and choose 1, 2, 3 or 4.');
            }
        }
    );
})();
