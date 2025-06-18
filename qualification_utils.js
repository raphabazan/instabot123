const { randomDelay } = require('./utils');
const fs = require('fs');
const path = require('path');
const { parse } = require('json2csv');
const csvParser = require('csv-parser');

// 🟢 Função para extrair BIO robusta (versão com fallback progressivo)
// 🟢 Função para extrair BIO robusta (com filtro para não pegar footer do Instagram)
async function getBioRobusto(page) {
    let category = '';
    let bioText = '';
    await randomDelay(7000, 10000);

    const footerKeywords = [
        'meta', 'sobre', 'blog', 'carreiras', 'ajuda', 'api', 'privacidade', 'termos',
        'localizações', 'instagram lite', 'threads', 'upload de contatos', 'verified',
        'português', '©'
    ];

    try {
        // ✅ Tenta clicar em botão "mais" de forma robusta
        const clicked = await page.evaluate(() => {
            const keywords = ['mais', 'ver mais', 'more', 'see more'];
            const elements = Array.from(document.querySelectorAll('span, button, div[role="button"]'));

            for (const el of elements) {
                const text = el.innerText?.toLowerCase()?.trim();
                if (text && keywords.includes(text)) {
                    el.click();
                    return true;
                }
            }
            return false;
        });

        if (clicked) {
            console.log('🔘 Botão "mais" clicado com sucesso. Esperando carregamento...');
            await randomDelay(2000, 3000);
        }
    } catch (err) {
        console.log(`⚠️ Erro ao tentar clicar no botão "mais": ${err.message}`);
    }

    try {
        category = await page.$eval('div._ap3a._aaco._aacu._aacy._aad6._aade', el => el.innerText.trim());
    } catch {
        category = '';
    }

    try {
        let spans = await page.$$eval('section div._aa_c span[dir="auto"]', elements =>
            elements.map(el => el.innerText.trim()).filter(text => text.length > 0)
        );

        if (spans.length === 0) {
            spans = await page.$$eval('section div span[dir="auto"]', elements =>
                elements.map(el => el.innerText.trim()).filter(text => text.length > 0)
            );
        }

        if (spans.length === 0) {
            spans = await page.$$eval('section span[dir="auto"]', elements =>
                elements.map(el => el.innerText.trim()).filter(text => text.length > 0)
            );
        }

        const uniqueSpans = Array.from(new Set(spans));
        const filteredSpans = uniqueSpans.filter(text => {
            const lowerText = text.toLowerCase();
            return !footerKeywords.some(keyword => lowerText.includes(keyword));
        });

        bioText = filteredSpans.join(' | ');
    } catch {
        bioText = '';
    }

    let fullBio = '';
    if (category) fullBio += `[${category}] `;
    if (bioText) fullBio += bioText;

    return fullBio.trim();
}

// 🟢 Função para checar "Enviar mensagem"
async function getMessageButtonRobusto(page) {
    try {
        const buttonTexts = await page.$$eval('button, div[role="button"]', elements =>
            elements.map(el => el.innerText.trim().toLowerCase())
        );

        const found = buttonTexts.some(text =>
            text === 'enviar mensagem' || text === 'message'
        );

        return found;
    } catch {
        return false;
    }
}

// 🟢 Função SIMPLIFICADA para checar se já foi enviada mensagem
/*async function checkIfMessageAlreadySent(page) {
    console.log('👉 Checking if message was already sent...');

    try {
        // 1️⃣ Aguardar a página carregar
        await page.waitForSelector('main', { timeout: 10000 });
        await randomDelay(2000, 3000);

        // 2️⃣ Buscar e clicar no botão "Enviar mensagem"
        let messageButton = null;

        // Busca pelo botão com seletor CSS simples
        messageButton = await page.evaluateHandle(() => {
            const buttons = document.querySelectorAll('button, div[role="button"]');
            for (const btn of buttons) {
                const text = btn.innerText?.toLowerCase().trim();
                if (text === 'enviar mensagem' || text === 'message') {
                    return btn;
                }
            }
            return null;
        });

        if (!messageButton || await messageButton.evaluate(el => el === null)) {
            console.log('❌ Could not find "Enviar mensagem" button');
            return false;
        }

        // 3️⃣ Clicar no botão
        console.log('✅ Clicking "Enviar mensagem"...');
        await messageButton.click();
        
        // 4️⃣ Aguardar a janela de mensagem abrir
        const dialogAppeared = await page.waitForSelector(
            'div[role="dialog"]', 
            { timeout: 10000 }
        ).catch(() => null);
        
        if (!dialogAppeared) {
            console.log('❌ Message dialog did not appear');
            return false;
        }
        
        console.log('✅ Message dialog opened');
        await randomDelay(3000, 4000);

        // 5️⃣ VERIFICAÇÃO SIMPLES: Procurar pelo texto "Você enviou"
        const hasMessages = await page.evaluate(() => {
            // Procura por qualquer elemento que contenha o texto "Você enviou" ou "You sent"
            const allElements = document.querySelectorAll('*');
            
            for (const element of allElements) {
                const text = element.textContent || element.innerText || '';
                if (text.includes('Você enviou') || text.includes('You sent')) {
                    console.log('📩 Found "Você enviou" - message was already sent');
                    return true;
                }
            }
            
            return false;
        });

        console.log(`✅ Message already sent? ${hasMessages ? 'YES' : 'NO'}`);

        // 6️⃣ Fechar a janela
        try {
            await page.keyboard.press('Escape');
            await randomDelay(1500, 2000);
            console.log('✅ Closed dialog with ESC key');
        } catch (e) {
            console.log('⚠️ Could not close dialog:', e.message);
        }

        return hasMessages;

    } catch (error) {
        console.log(`❌ Error checking message history: ${error.message}`);
        return false;
    }
} */

// 🟢 Função para converter número do Instagram (corrigida)
function convertInstagramNumber(str) {
    if (!str) return 0;

    str = str.trim().toLowerCase();

    // Substituir "." por nada e "," por "."
    str = str.replace(/\./g, '').replace(/,/g, '.').replace(/\s/g, '');

    if (str.includes('mil')) {
        const num = parseFloat(str.replace('mil', ''));
        return Math.round(num * 1000);
    }
    if (str.includes('k')) {
        const num = parseFloat(str.replace('k', ''));
        return Math.round(num * 1000);
    }
    if (str.includes('m')) {
        const num = parseFloat(str.replace('m', ''));
        return Math.round(num * 1000000);
    }

    // fallback — número puro (ex: "1.520" → "1520")
    const num = parseInt(str.replace(/[^\d]/g, ''));
    return isNaN(num) ? 0 : num;
}

// 🟢 Função para extrair bio link (VERSÃO MELHORADA)
async function getBioLinkRobusto(page) {
    let bio_link = '';
    let bio_link_text = '';

    try {
        console.log('🔍 Iniciando busca por bio link...');

        // ESTRATÉGIA 1: Buscar por todos os links externos na seção da bio
        try {
            const externalLinks = await page.$eval('section a[href]', links => {
                return links
                    .filter(link => {
                        const href = link.href || '';
                        // Lista de domínios para filtrar/ignorar
                        const blockedDomains = [
                            'instagram.com',
                            'facebook.com', 
                            'threads.com',
                            'meta.com',
                            'fb.me',
                            'ig.me'
                        ];
                        
                        // Filtra apenas links externos válidos
                        return href.startsWith('http') && 
                               !blockedDomains.some(domain => href.includes(domain));
                    })
                    .map(link => ({
                        href: link.href,
                        text: link.innerText?.trim() || link.textContent?.trim() || '',
                        outerHTML: link.outerHTML
                    }));
            });

            if (externalLinks.length > 0) {
                console.log(`✅ Encontrados ${externalLinks.length} links externos`);
                bio_link = externalLinks[0].href;
                bio_link_text = externalLinks[0].text;

                // Decodifica se for link redirecionado do Instagram
                if (bio_link.includes('l.instagram.com')) {
                    const url = new URL(bio_link);
                    const realUrl = url.searchParams.get('u');
                    if (realUrl) {
                        bio_link = decodeURIComponent(realUrl);
                        console.log(`🔄 Link decodificado: ${bio_link}`);
                    }
                }
            }
        } catch (e) {
            console.log('⚠️ Estratégia 1 falhou:', e.message);
        }

        // ESTRATÉGIA 2: Se não encontrou, buscar por elementos que contenham o ícone de link
        if (!bio_link) {
            try {
                const linkData = await page.evaluate(() => {
                    // Busca por SVGs com aria-label de link
                    const linkIcons = document.querySelectorAll('svg[aria-label*="link" i], svg[aria-label*="ícone" i]');
                    
                    for (const icon of linkIcons) {
                        // Procura o elemento pai que pode conter o link
                        let parent = icon.closest('div');
                        let attempts = 0;
                        
                        while (parent && attempts < 5) {
                            // Procura por links dentro do pai
                            const link = parent.querySelector('a[href]');
                            if (link && link.href) {
                                // Lista de domínios bloqueados
                                const blockedDomains = [
                                    'instagram.com',
                                    'facebook.com', 
                                    'threads.com',
                                    'meta.com',
                                    'fb.me',
                                    'ig.me'
                                ];
                                
                                // Verifica se o link não é de domínio bloqueado
                                const isBlocked = blockedDomains.some(domain => link.href.includes(domain));
                                
                                if (!isBlocked) {
                                    return {
                                        href: link.href,
                                        text: link.innerText?.trim() || link.textContent?.trim() || ''
                                    };
                                }
                            }
                            
                            // Procura por texto que pode ser um link
                            const textContent = parent.innerText || parent.textContent || '';
                            if (textContent.includes('.com') || textContent.includes('.br') || textContent.includes('http')) {
                                // Extrai possível URL do texto
                                const urlMatch = textContent.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s]*)/);
                                if (urlMatch) {
                                    let foundUrl = urlMatch[0];
                                    if (!foundUrl.startsWith('http')) {
                                        foundUrl = 'https://' + foundUrl;
                                    }
                                    return {
                                        href: foundUrl,
                                        text: textContent.trim()
                                    };
                                }
                            }
                            
                            parent = parent.parentElement;
                            attempts++;
                        }
                    }
                    return null;
                });

                if (linkData) {
                    bio_link = linkData.href;
                    bio_link_text = linkData.text;
                    console.log(`✅ Link encontrado via ícone: ${bio_link}`);
                    
                    // Decodifica se necessário
                    if (bio_link.includes('l.instagram.com')) {
                        const url = new URL(bio_link);
                        const realUrl = url.searchParams.get('u');
                        if (realUrl) {
                            bio_link = decodeURIComponent(realUrl);
                        }
                    }
                }
            } catch (e) {
                console.log('⚠️ Estratégia 2 falhou:', e.message);
            }
        }

        // ESTRATÉGIA 3: Busca mais ampla por padrões de URL na bio
        if (!bio_link) {
            try {
                const textContent = await page.$eval('section', section => {
                    return section.innerText || section.textContent || '';
                });

                // Procura por padrões de URL no texto
                const urlPatterns = [
                    /https?:\/\/[^\s]+/g,
                    /[a-zA-Z0-9.-]+\.com[^\s]*/g,
                    /[a-zA-Z0-9.-]+\.br[^\s]*/g,
                    /[a-zA-Z0-9.-]+\.net[^\s]*/g,
                    /[a-zA-Z0-9.-]+\.org[^\s]*/g
                ];

                // Lista de domínios bloqueados para filtrar
                const blockedDomains = [
                    'instagram.com',
                    'facebook.com', 
                    'threads.com',
                    'meta.com',
                    'fb.me',
                    'ig.me'
                ];

                for (const pattern of urlPatterns) {
                    const matches = textContent.match(pattern);
                    if (matches) {
                        // Filtra URLs que não sejam de domínios bloqueados
                        const validUrl = matches.find(url => 
                            !blockedDomains.some(domain => url.includes(domain))
                        );
                        
                        if (validUrl) {
                            let foundUrl = validUrl;
                            // Remove caracteres extras no final
                            foundUrl = foundUrl.replace(/[^\w\/.-]$/, '');
                            
                            if (!foundUrl.startsWith('http')) {
                                foundUrl = 'https://' + foundUrl;
                            }
                            
                            bio_link = foundUrl;
                            bio_link_text = validUrl;
                            console.log(`✅ Link encontrado via regex: ${bio_link}`);
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log('⚠️ Estratégia 3 falhou:', e.message);
            }
        }

        // ESTRATÉGIA 4: Busca por elementos clicáveis que podem ser links
        if (!bio_link) {
            try {
                const clickableData = await page.evaluate(() => {
                    const clickables = document.querySelectorAll('section [role="button"], section button, section div[tabindex]');
                    
                    for (const element of clickables) {
                        const text = element.innerText || element.textContent || '';
                        if (text.includes('.com') || text.includes('.br') || text.includes('http')) {
                            // Verifica se tem um link associado
                            const link = element.querySelector('a') || element.closest('a');
                            if (link && link.href) {
                                // Lista de domínios bloqueados
                                const blockedDomains = [
                                    'instagram.com',
                                    'facebook.com', 
                                    'threads.com',
                                    'meta.com',
                                    'fb.me',
                                    'ig.me'
                                ];
                                
                                const isBlocked = blockedDomains.some(domain => link.href.includes(domain));
                                
                                if (!isBlocked) {
                                    return {
                                        href: link.href,
                                        text: text.trim()
                                    };
                                }
                            }
                            
                            // Se não tem link mas tem texto que parece URL
                            const urlMatch = text.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s]*)/);
                            if (urlMatch) {
                                let foundUrl = urlMatch[0];
                                if (!foundUrl.startsWith('http')) {
                                    foundUrl = 'https://' + foundUrl;
                                }
                                return {
                                    href: foundUrl,
                                    text: text.trim()
                                };
                            }
                        }
                    }
                    return null;
                });

                if (clickableData) {
                    bio_link = clickableData.href;
                    bio_link_text = clickableData.text;
                    console.log(`✅ Link encontrado via elemento clicável: ${bio_link}`);
                }
            } catch (e) {
                console.log('⚠️ Estratégia 4 falhou:', e.message);
            }
        }

        // Limpeza final do texto
        if (bio_link_text) {
            // Remove textos extras como "e mais X"
            bio_link_text = bio_link_text.split(' e mais ')[0].split(' and ')[0].trim();
            
            // Se o texto ainda contém lixo, tenta extrair só o domínio
            if (bio_link && bio_link_text.length > 50) {
                try {
                    const urlObj = new URL(bio_link);
                    bio_link_text = urlObj.hostname + urlObj.pathname;
                } catch (e) {
                    // Mantém o texto original se não conseguir parsear
                }
            }
        }

        console.log(`🔗 Bio Link Final: ${bio_link}`);
        console.log(`📝 Bio Link Text: ${bio_link_text}`);

    } catch (err) {
        console.log('❌ Erro geral na extração do bio link:', err.message);
    }

    return {
        bio_link: bio_link || '',
        bio_link_text: bio_link_text || ''
    };
}


// 🟢 Função para extrair todo o texto de uma página (como Ctrl+A)
async function extractPageText(page, url) {
    let pageText = '';
    
    try {
        console.log(`🔗 Acessando bio link: ${url}`);
        
        // Navega para o link
        const response = await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });
        
        // Verifica se a página carregou com sucesso
        if (!response || response.status() !== 200) {
            console.log(`⚠️ Erro ao carregar página: Status ${response?.status()}`);
            return '';
        }
        
        // Aguarda um pouco para a página carregar completamente
        await randomDelay(10000, 10000);
        
        // Extrai todo o texto visível da página
        pageText = await page.evaluate(() => {
            // Remove scripts, styles e elementos ocultos
            const elementsToRemove = document.querySelectorAll('script, style, noscript, [style*="display: none"], [style*="visibility: hidden"]');
            elementsToRemove.forEach(el => el.remove());
            
            // Pega todo o texto do body
            const bodyText = document.body ? document.body.innerText : document.documentElement.innerText;
            
            // Limpa o texto: remove quebras excessivas e espaços extras
            return bodyText
                .replace(/\s+/g, ' ') // substitui múltiplos espaços por um só
                .replace(/\n\s*\n/g, '\n') // remove quebras de linha excessivas
                .trim();
        });
        
        console.log(`✅ Texto extraído: ${pageText.length} caracteres`);
        
        // Limita o texto para não ficar muito grande (primeiros 2000 caracteres)
        if (pageText.length > 2000) {
            pageText = pageText.substring(0, 2000) + '...';
            console.log(`✂️ Texto truncado para 2000 caracteres`);
        }
        
    } catch (error) {
        console.log(`❌ Erro ao extrair texto da página ${url}:`, error.message);
        pageText = '';
    }
    
    return pageText;
}

// 🟢 Função principal getProfileStats (ATUALIZADA com extração de texto do link)
async function getProfileStats(page, profileUrl) {
    console.log(`🌐 Navigating to profile: ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await randomDelay(7000, 10000);

    // 🔍 Message button
    const messageButtonExists = await getMessageButtonRobusto(page);
    await randomDelay(3000, 5000);
    //const hasMessages = await checkIfMessageAlreadySent(page);

    // 🔍 Followers & Posts
    let followersCount = 0;
    let postsCount = 0;

    try {
        const stats = await page.$$eval('ul li', items => {
            return items.map(item => {
                const text = item.innerText.toLowerCase();
                const number = item.querySelector('span')?.innerText || '';
                return { text, number };
            });
        });

        for (const stat of stats) {
            if (stat.text.includes('seguidores') || stat.text.includes('followers')) {
                followersCount = convertInstagramNumber(stat.number);
            }
            if (stat.text.includes('publicações') || stat.text.includes('posts')) {
                postsCount = convertInstagramNumber(stat.number);
            }
        }
    } catch {
        console.log('⚠️ Could not extract followers or posts.');
    }

    // 🔍 Get bio information
    const fullBio = await getBioRobusto(page);

    // 🔍 Get bio link information
    const { bio_link, bio_link_text } = await getBioLinkRobusto(page);

    // 🔍 NOVA FUNCIONALIDADE: Extrair texto da página do bio link
    let bio_link_page_text = '';
    if (bio_link && bio_link.startsWith('http')) {
        try {
            console.log(`\n🔗 Bio link encontrado: ${bio_link}`);
            console.log(`📖 Extraindo texto da página...`);
            
            bio_link_page_text = await extractPageText(page, bio_link);
            
            if (bio_link_page_text) {
                console.log(`✅ Texto extraído com sucesso: ${bio_link_page_text.substring(0, 100)}...`);
            } else {
                console.log(`⚠️ Nenhum texto foi extraído da página`);
            }
            
            // Retorna para o perfil do Instagram após extrair o texto
            console.log(`🔙 Retornando para o perfil do Instagram...`);
            await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await randomDelay(3000, 4000);
            
        } catch (error) {
            console.log(`❌ Erro ao processar bio link: ${error.message}`);
            bio_link_page_text = '';
        }
    } else {
        console.log(`ℹ️ Nenhum bio link válido encontrado para extrair texto`);
    }
    // ✅ Regras para mandar para o ChatGPT
    

    // ✅ Retorno final (ATUALIZADO com o novo campo)
    return {
        messageButtonExists,
        followersCount,
        postsCount,
        fullBio,
        bio_link,
        bio_link_text,
        bio_link_page_text
        //,hasMessages 
    };
}

async function updateCsvRowByUsername(username, updatedData) {
    const filePath = path.join(__dirname, '..', 'data', 'leads_list.csv');
    const leads = [];

    // Lê os dados existentes
    await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (row) => leads.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    // Atualiza o lead com mesmo username
    const updatedLeads = leads.map(lead => {
        if (lead.username === username) {
            return {
                ...lead,
                ...updatedData,
                opportunity_processed: 'yes',
                last_updated_at: new Date().toISOString()
            };
        }
        return lead;
    });

    // Salva de volta no CSV
    const csv = parse(updatedLeads, { fields: Object.keys(updatedLeads[0]) });
    fs.writeFileSync(filePath, csv, 'utf8');
}
// 🔄 Exportar tudo
module.exports = {
    getProfileStats,
    getBioRobusto,
    getMessageButtonRobusto,
    getBioLinkRobusto,
    extractPageText,
    updateCsvRowByUsername

    //,checkIfMessageAlreadySent
};