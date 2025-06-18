const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const { randomDelay } = require('./utils');
const { getProfileStats } = require('./qualification_utils'); // já com robusto
const { sendToChatGPTAssistant } = require('./openai_utils');
const { updateCsvRowByUsername } = require('./qualification_utils');




async function runQualification(browser, page) {
    console.log('➡️ Qualification bot started.');

    const filePath = path.join(__dirname, '..', 'data', 'leads_list.csv');
    if (!fs.existsSync(filePath)) {
        console.log('❌ leads_list.csv file not found!');
        return;
    }

    console.log('📋 Reading leads_list.csv...');

    const leads = [];

    // Read CSV and build array of objects
    await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (row) => {
                leads.push(row);
            })
            .on('end', () => {
                console.log(`✅ CSV read successfully. Total leads: ${leads.length}`);
                resolve();
            })
            .on('error', (error) => {
                console.log('Error reading CSV:', error);
                reject(error);
            });
    });

    // Define groups
    const processedQualified = leads.filter(lead =>
        lead.opportunity_processed?.toLowerCase() === 'yes' &&
        lead.qualified?.toLowerCase() === 'yes'
    );

    const processedNotQualified = leads.filter(lead =>
        lead.opportunity_processed?.toLowerCase() === 'yes' &&
        lead.qualified?.toLowerCase() !== 'yes'
    );

    const notProcessed = leads.filter(lead =>
        lead.opportunity_processed?.toLowerCase() !== 'yes'
    );

    // Print stats
    console.log('\n📊 LEAD STATS:');
    console.log(`- Total leads: ${leads.length}`);
    console.log(`- Processed & Qualified: ${processedQualified.length}`);
    console.log(`- Processed & Not Qualified: ${processedNotQualified.length}`);
    console.log(`- Not Processed: ${notProcessed.length}`);

    // Debug: show first 300 not processed leads
    console.log('\n🔍 First not processed leads:');
    notProcessed.slice(0, 300).forEach((lead, index) => {
        console.log(`#${index + 1} - @${lead.username} | Followers: ${lead.followers_count} | Posts: ${lead.posts_count}`);
    });

    console.log('\n🏁 Qualification bot (step 1) done.');

    // 👉 PROCESS FIRST 300 NOT PROCESSED LEADS
    const leadsToProcess = notProcessed.slice(0, 300);

    if (leadsToProcess.length === 0) {
        console.log('❌ No unprocessed leads found!');
        return;
    }

    for (const lead of leadsToProcess) {
        console.log('\n==============================');
        console.log(`Processing lead: @${lead.username}`);
        console.log('==============================\n');

        await processSingleProfile(page, lead);

        // Pequeno delay entre perfis (parecer humano)
        await randomDelay(15000, 30000);
    }

    console.log('\n🏁 Finished processing 300 leads.');
}

async function processSingleProfile(page, lead) {
    const handle = lead.username;
    const profileUrl = `https://www.instagram.com/${handle}/`;

    console.log(`\n➡️ Processing profile: @${handle}`);
    console.log(`🌐 Navigating to profile: ${profileUrl}`);

   const {
    messageButtonExists,
    followersCount,
    postsCount,
    fullBio,   // ⛔️ Não existe "bio" no retorno! Agora é "fullBio"
    bio_link,
    pageText
    //,hasMessages
} = await getProfileStats(page, profileUrl);

    await randomDelay(2000, 3000); // pequeno delay após leitura

    // 4️⃣ Keyword matching
    const positiveKeywords = ['ads', 'agency', 'coach', 'authority', 'brand', 'build', 'building', 'built', 'business', 'businesses', 'clients', 'coaching', 'company', 'figure', 'founder', 'grow', 'growth', 'help', 'helped', 'helping', 'marketing', 'million', 'niche', 'owner', 'profit', 'profitable', 'revenue', 'sales', 'training', 'funnel', 'traffic', 'money', 'ceo', 'b2b', 'trained', 'train', 'generated', 'lead', 'scale', 'scalable', 'exited', 'saas', 'mentor', 'consultant', 'high ticket', 'speaker', 'investor', 'tedx', 'forbes', 'entrepreneur', 'millionaire', 'millions', 'invest', 'exits'];
    const negativeKeywords = ['teen', 'music', 'rapper', 'rap', 'artist', 'influencer', 'crypto', 'bet', 'trader', 'adult', 'hot', 'escort', 'ecom', 'amazon', 'affiliate', 'ecommerce'];
    const minFollowers = 500;
    const minPosts = 20;

// 1️⃣ Combine os textos primeiro
const combinedText = `${handle} ${fullBio} ${pageText}`.toLowerCase();

// 2️⃣ Faça os matches
const positiveMatches = positiveKeywords.filter(kw => combinedText.includes(kw));
const negativeMatches = negativeKeywords.filter(kw => combinedText.includes(kw));

// 3️⃣ Agora PODE calcular se vai enviar pro GPT
const canSendToGPT = (
    negativeMatches.length === 0 &&
    messageButtonExists &&
    followersCount >= minFollowers &&
    postsCount >= minPosts
);

let chatGPTResult = null;
if (canSendToGPT) {
    console.log('\n🟢 Lead qualificado para análise no ChatGPT. Enviando...');

    chatGPTResult = await sendToChatGPTAssistant({
        handle,
        fullBio,
        bio_link_page_text: pageText
    });
    
    if (chatGPTResult) {
        console.log('\n🎯 RESULTADO DA ANÁLISE:');
        console.log(`Qualified: ${chatGPTResult.qualified}`);
        console.log(`Niche: ${chatGPTResult.niche}`);
        console.log(`Company Name: ${chatGPTResult.company_name}`);
        console.log(`Suggested Message: ${chatGPTResult.suggested_message}`);
    } else {
        console.log('⚠️ Não foi possível obter resposta do ChatGPT.');
    }

} else {
    console.log('\n🔴 Lead NÃO será enviado para o ChatGPT. Não passou nos critérios.');
}

   

    // 5️⃣ Final summary
    console.log('\n--- SUMMARY ---');
    console.log(`@${handle}`);
    console.log(`Message button: ${messageButtonExists ? 'YES' : 'NO'}`);
    //console.log(`Has messages: ${hasMessages}`);
    console.log(`Followers: ${followersCount}`);
    console.log(`Posts: ${postsCount}`);
    console.log(`Bio:\n${fullBio}`);
    console.log(`Link:\n${bio_link}`);
    console.log(`Page Text:\n${pageText}`);
    console.log(`Positive keywords: ${positiveMatches.length} (${positiveMatches.join(', ')})`);
    console.log(`Negative keywords: ${negativeMatches.length > 0 ? negativeMatches.join(', ') : 'None'}`);

    console.log('\n🏁 Profile quick check done.');


        await updateCsvRowByUsername(handle, {
        qualified: chatGPTResult?.qualified || 'no',
        opportunity_processed: 'yes', // 🔥 Adicionado
        followers_count: followersCount,
        posts_count: postsCount,
        bio: fullBio,
        positive_keywords_count: positiveMatches.length,
        negative_keywords_found: negativeMatches.length,
        bio_link: bio_link,
        bio_link_text: pageText,
        generated_message: chatGPTResult?.suggested_message || '',
        niche: chatGPTResult?.niche || '',
        company_name: chatGPTResult?.company_name || '',
        last_updated_at: new Date().toISOString() // 🕒
    });




    // 🔥 Aqui no futuro → salvar no CSV as colunas:
    // lead.followers_count = followersCount;
    // lead.posts_count = postsCount;
    // lead.bio = fullBio;
    // lead.positive_keywords_count = positiveMatches.length;
    // lead.negative_keywords_found = negativeMatches.join(', ');
    // lead.opportunity_processed = 'yes';
    // E fazer update do CSV → te ensino na próxima etapa!
}

module.exports = runQualification;
