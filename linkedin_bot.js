const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { randomDelay } = require('./utils');

const userDataDir = path.join(__dirname, '..', 'linkedin_profile'); // persistência

async function runLinkedInBot() {
    console.log('🚀 LinkedIn Bot starting...');

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized'],
        userDataDir
    });

    const page = await browser.newPage();

    await page.goto('https://www.linkedin.com', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });

    const currentUrl = page.url();

    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
        console.log('🔐 Please login to LinkedIn manually in this window...');
        console.log('👉 Waiting 60 seconds for manual login...');
        await randomDelay(60000, 60000);
        console.log('✅ Login done. Session persisted.');
    } else {
        console.log('✅ Already logged in (session persisted).');
    }

    // ==== A PARTIR DAQUI — vamos abrir um POST específico ====
    await randomDelay(5000, 12000);
    const postUrl = 'https://www.linkedin.com/posts/justinwelsh_my-daily-routine-is-unbeatable-i-wake-activity-7339257226160734208-aVWE'; // coloque o seu link do post aqui

    console.log(`\n➡️ Navigating to post: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await randomDelay(5000, 7000);

    console.log('\n🔄 Starting scroll and load more loop...');

    let previousHeight = 0;
    let retries = 0;
    const maxRetries = 3;

    while (true) {
        try {
            // Scroll para o final da página
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });

            await randomDelay(3000, 5000);

            // Tenta clicar no botão "Load more comments"
            const loadMoreButton = await page.$('button.comments-comments-list__load-more-comments-button--cr');

            if (loadMoreButton) {
                console.log('🔘 Clicking "Load more comments"...');
                await loadMoreButton.click();
                await randomDelay(4000, 6000);
                retries = 0;
            } else {
                const currentHeight = await page.evaluate(() => document.body.scrollHeight);

                if (currentHeight === previousHeight) {
                    retries++;
                    console.log(`⏳ No new content. Retry ${retries}/${maxRetries}...`);

                    if (retries >= maxRetries) {
                        console.log('✅ No more comments to load.');
                        break;
                    }
                } else {
                    previousHeight = currentHeight;
                    retries = 0;
                    console.log('✅ New content loaded!');
                }

                await randomDelay(3000, 5000);
            }
        } catch (error) {
            console.log('⚠️ Error during scroll loop:', error.message);
            retries++;
            if (retries >= maxRetries) {
                console.log('Stopping due to repeated errors.');
                break;
            }
            await randomDelay(5000, 7000);
        }
    }

    // ==== EXTRAÇÃO ====
    console.log('\n🔍 Extracting comments...');

    const commentsData = await page.evaluate(() => {
        const comments = [];

        const articles = document.querySelectorAll('article.comments-comment-entity');

        articles.forEach(article => {
            try {
                // Link do perfil
                const profileLinkEl = article.querySelector('a.comments-comment-meta__description-container');
                const profileLink = profileLinkEl ? profileLinkEl.href.trim() : '';

                // Nome "limpo"
                let profileName = profileLinkEl ? profileLinkEl.getAttribute('aria-label')?.trim() : '';

                // → Limpeza do nome (tirar "View:" e tudo depois de "•")
                if (profileName) {
                    profileName = profileName.replace(/^View:\s*/, ''); // remove "View:"
                    profileName = profileName.split('•')[0].trim(); // pega só antes do "•"
                }

                // Headline
                const headlineEl = article.querySelector('div.comments-comment-meta__description-subtitle');
                const headline = headlineEl ? headlineEl.innerText.trim() : '';

                comments.push({
                    name: profileName,
                    profile_link: profileLink,
                    headline
                });
            } catch (e) {
                // Ignorar erros no comentário
            }
        });

        return comments;
    });

    // ✅ Remove duplicates by profile_link
    const uniqueCommentsMap = new Map();

    commentsData.forEach(comment => {
        if (comment.profile_link && !uniqueCommentsMap.has(comment.profile_link)) {
            uniqueCommentsMap.set(comment.profile_link, comment);
        }
    });

    const uniqueComments = Array.from(uniqueCommentsMap.values());

    console.log(`✅ Unique comments after deduplication: ${uniqueComments.length}`);

    // ==== CLASSIFICAÇÃO E ORDENAÇÃO ====
    console.log('🎯 Classifying and sorting leads by qualification score...');
    
    const classifiedComments = classifyAndSortData(uniqueComments);
    
    console.log(`✅ Comments classified and sorted by qualification score!`);
    
    // Mostrar os top 5 para verificação
    console.log('\n🏆 Top 5 qualified leads:');
    classifiedComments.slice(0, 5).forEach((comment, index) => {
        console.log(`${index + 1}. ${comment.name} (Score: ${comment.qualification_score}) - ${comment.headline}`);
    });

    // ==== SALVAR EM CSV ====
    console.log('\n💾 Saving classified data to linkedin_comments_qualified.csv...');

    const csvHeader = 'name,profile_link,headline,qualification_score\n';
    const csvRows = classifiedComments.map(comment =>
        `"${comment.name}","${comment.profile_link}","${comment.headline.replace(/"/g, '""')}",${comment.qualification_score}`
    );

    const csvContent = csvHeader + csvRows.join('\n');

    const outputPath = path.join(__dirname, '..', 'data', 'linkedin_comments_qualified.csv');

    // Criar diretório se não existir
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, csvContent);

    console.log(`✅ Saved ${classifiedComments.length} classified comments to: ${outputPath}`);
    console.log(`📊 Data sorted by qualification score (highest to lowest)`);

    console.log('\n🏁 LinkedIn Bot finished. Browser will remain open.');
}

function getQualificationScore(headline) {
    if (!headline) return 0;
    
    const headlineLower = headline.toLowerCase();
    let score = 0;

    // Perfil Ideal (maior pontuação)
    const idealKeywords = [
        "coach", "coaching", "consultant", "consulting", "mentor", "mentoring", 
        "strategist", "strategy", "adviser", "guiding", "training", 
        "transformation", "specialist"
    ];
    if (idealKeywords.some(keyword => headlineLower.includes(keyword))) {
        score += 100;
    }

    // Alta qualificação
    const highQualKeywords = [
        "ceo", "founder", "director", "entrepreneur", "leadership", "business"
    ];
    if (highQualKeywords.some(keyword => headlineLower.includes(keyword))) {
        score += 80;
    }

    // Média-alta qualificação
    const mediumHighKeywords = [
        "wellbeing", "life", "mindset", "personal development", "health"
    ];
    if (mediumHighKeywords.some(keyword => headlineLower.includes(keyword))) {
        score += 70;
    }

    // Profissionais autônomos de alto ticket
    const highTicketKeywords = [
        "help", "transform", "scale", "high-ticket", "predictable", "revenue architect",
        "growth consultant", "business transformation"
    ];
    if (highTicketKeywords.some(keyword => headlineLower.includes(keyword))) {
        score += 90;
    }

    // Penalizações
    const marketingSalesKeywords = [
        "sales", "marketing", "leads", "growth", "seo", "ppc", "ads", 
        "advertising", "e-commerce", "social media", "branding", "brand", 
        "revenue", "go-to-market", "gtm"
    ];
    if (marketingSalesKeywords.some(keyword => headlineLower.includes(keyword))) {
        score -= 50;
    }

    const financeKeywords = [
        "finance", "investment", "mortgage", "wealth", "portfolio manager", "economist"
    ];
    if (financeKeywords.some(keyword => headlineLower.includes(keyword))) {
        score -= 30;
    }

    const contentKeywords = [
        "writer", "content", "storytelling", "ghostwriter", "creator", "author"
    ];
    if (contentKeywords.some(keyword => headlineLower.includes(keyword))) {
        score -= 20;
    }

    const techKeywords = [
        "software", "engineer", "ai", "ux", "ui", "tech", "technology", 
        "cyber", "network", "developer"
    ];
    if (techKeywords.some(keyword => headlineLower.includes(keyword))) {
        score -= 40;
    }

    // Bônus para donos de negócio próprio
    const ownBusinessKeywords = ["business", "own", "my company", "my business"];
    const thirdPartyKeywords = ["for clients", "for companies", "for agencies"];
    
    if (ownBusinessKeywords.some(keyword => headlineLower.includes(keyword)) &&
        !thirdPartyKeywords.some(keyword => headlineLower.includes(keyword))) {
        score += 20;
    }

    return score;
}

// Função para classificar e reordenar dados coletados
function classifyAndSortData(data) {
    // Adiciona pontuação de qualificação para cada item
    const dataWithScores = data.map(item => ({
        ...item,
        qualification_score: getQualificationScore(item.headline || '')
    }));

    // Ordena por pontuação (maior para menor)
    return dataWithScores.sort((a, b) => b.qualification_score - a.qualification_score);
}

module.exports = {
    getQualificationScore,
    runLinkedInBot,
    classifyAndSortData
};