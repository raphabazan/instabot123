const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const { Parser } = require('json2csv');
const { randomDelay } = require('./utils');

async function runDMSender(browser, page) {
    const filePath = path.join(__dirname, '..', 'data', 'leads_list.csv');

    if (!fs.existsSync(filePath)) {
        console.log('❌ leads_list.csv não encontrado.');
        return;
    }

    // Ler CSV
    const leads = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (row) => leads.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    // Filtrar leads qualificados e não enviados
    const leadsToSend = leads.filter(row => row.qualified === 'yes' && !row.message_sent);

    if (leadsToSend.length === 0) {
        console.log('⚠️ Nenhum lead qualificado disponível para envio. Rode o bot de qualificação antes.');
        return;
    }

    console.log(`✅ Leads disponíveis para envio: ${leadsToSend.length}`);

    // Perguntar quantas mensagens enviar
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.question(`Quantas mensagens deseja enviar? (Disponíveis: ${leadsToSend.length}): `, async (input) => {
        rl.close();
        const numToSend = parseInt(input, 10);

        if (isNaN(numToSend) || numToSend <= 0) {
            console.log('❌ Número inválido. Abortando envio.');
            return;
        }

        const selectedLeads = leadsToSend.slice(0, numToSend);
        let isFirstMessage = true; // Flag para controlar overlay

        for (let i = 0; i < selectedLeads.length; i++) {
            const lead = selectedLeads[i];
            console.log(`📩 Processando [${i + 1}/${numToSend}]: @${lead.username}`);

            const profileUrl = `https://www.instagram.com/${lead.username}/`;
            await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            await randomDelay(30000, 60000);

            try {
                // PRIMEIRO: Tentar seguir a pessoa
                console.log(`👤 Tentando seguir @${lead.username}...`);
                const followSuccess = await followUser(page);
                
                if (followSuccess) {
                    console.log('✅ Usuário seguido com sucesso!');
                    // Salvar informação de que seguiu
                    lead.followed = new Date().toISOString();
                } else {
                    console.log('⚠️ Não foi possível seguir o usuário (pode já estar seguindo ou perfil privado)');
                    lead.followed = 'no';
                }

                // Aguardar um pouco antes de enviar mensagem
                await randomDelay(5000, 8000);

                // SEGUNDO: Clicar em "Enviar mensagem"
                const messageButton = await findMessageButton(page);
                
                if (!messageButton) {
                    console.log('❌ Botão "mensagem" não encontrado.');
                    continue;
                }

                await messageButton.click();
                console.log('✉️ Botão "mensagem" clicado.');
                await randomDelay(10000, 12000);
                
                // Lidar com overlay apenas na primeira mensagem
                if (isFirstMessage) {
                    await handleNotificationOverlay(page);
                    isFirstMessage = false;
                }

                // Verificar se já existe uma mensagem anterior
                const messageAlreadySent = await checkExistingMessage(page);
                
                if (messageAlreadySent) {
                    console.log('🔁 Já existe uma mensagem enviada. Pulando.');
                    
                    // Marcar como não enviado (pois já foi enviado anteriormente)
                    lead.message_sent = 'no';
                    continue;
                }

                // Enviar mensagem
                const success = await sendMessage(page, lead.generated_message);
                
                if (success) {
                    console.log('✅ Mensagem enviada com sucesso.');
                    // Salvar data de envio
                    lead.message_sent = new Date().toISOString();
                    await randomDelay(360000, 420000);
                } else {
                    console.log('❌ Falha ao enviar mensagem.');
                    // Marcar como não enviado
                    await randomDelay(1700, 8000);
                }

            } catch (err) {
                console.error(`❌ Erro ao processar @${lead.username}:`, err.message);
                
                // Marcar como não enviado em caso de erro
                lead.message_sent = 'no';
                lead.followed = 'error';
                await randomDelay(1700, 8000);
                continue;
            }
        }

        // Salvar CSV atualizado
        const json2csv = new Parser({ fields: Object.keys(leads[0]) });
        const csv = json2csv.parse(leads);
        fs.writeFileSync(filePath, csv, 'utf8');

        console.log('💾 CSV atualizado com timestamps de envio e seguidas.');
        console.log('🏁 Envio de mensagens finalizado.');
    });
}

// NOVA FUNÇÃO: Seguir usuário
async function followUser(page) {
    try {
        console.log('🔍 Procurando botão de seguir...');
        
        // Aguardar um pouco para garantir que a página carregou
        await randomDelay(3000, 5000);

        // Diferentes seletores para o botão de seguir
        const followSelectors = [
            'button:has-text("Seguir")',
            'button:has-text("Follow")',
            'div[role="button"]:has-text("Seguir")',
            'div[role="button"]:has-text("Follow")',
            'button[type="button"]:has-text("Seguir")',
            'button[type="button"]:has-text("Follow")'
        ];

        // Tentar encontrar o botão usando seletores
        for (const selector of followSelectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    await element.click();
                    console.log('👥 Botão "Seguir" clicado!');
                    await randomDelay(2000, 3000);
                    return true;
                }
            } catch (e) {
                // Continuar tentando outros seletores
            }
        }

        // Método alternativo: procurar por todos os botões e verificar o texto
        const followClicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button, div[role="button"]');
            
            for (const button of buttons) {
                const text = (button.innerText || button.textContent || '').trim();
                
                // Verificar se é um botão de seguir
                if (text === 'Seguir' || text === 'Follow') {
                    // Verificar se não é um botão de "Seguindo" (já seguindo)
                    if (!text.includes('Seguindo') && !text.includes('Following')) {
                        console.log(`✅ Botão de seguir encontrado: "${text}"`);
                        button.click();
                        return true;
                    }
                }
            }
            
            return false;
        });

        if (followClicked) {
            console.log('✅ Usuário seguido via método alternativo!');
            await randomDelay(2000, 3000);
            return true;
        }

        // Verificar se já está seguindo
        const alreadyFollowing = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button, div[role="button"]');
            
            for (const button of buttons) {
                const text = (button.innerText || button.textContent || '').trim();
                
                if (text === 'Seguindo' || text === 'Following' || 
                    text === 'Solicitado' || text === 'Requested') {
                    return true;
                }
            }
            
            return false;
        });

        if (alreadyFollowing) {
            console.log('ℹ️ Já está seguindo este usuário ou solicitação já enviada.');
            return true; // Consideramos como sucesso
        }

        // Debug: listar botões encontrados
        console.log('🔍 Debug: Listando botões encontrados...');
        await page.evaluate(() => {
            const buttons = document.querySelectorAll('button, div[role="button"]');
            console.log(`Total de botões encontrados: ${buttons.length}`);
            
            buttons.forEach((button, index) => {
                const text = (button.innerText || button.textContent || '').trim();
                const classes = button.className || '';
                
                if (text && text.length < 50) { // Filtrar textos muito longos
                    console.log(`Botão ${index + 1}: "${text}" | Classes: "${classes}"`);
                }
            });
        });

        console.log('⚠️ Botão de seguir não encontrado.');
        return false;

    } catch (error) {
        console.log(`❌ Erro ao tentar seguir usuário: ${error.message}`);
        return false;
    }
}

// Função para encontrar o botão de mensagem
async function findMessageButton(page) {
    try {
        // Aguardar um pouco para a página carregar completamente
        await randomDelay(7000, 10000);

        // Procurar por diferentes possibilidades de botão de mensagem
        const selectors = [
            'button:has-text("Mensagem")',
            'button:has-text("Message")',
            'div[role="button"]:has-text("Mensagem")',
            'div[role="button"]:has-text("Message")',
            'a:has-text("Mensagem")',
            'a:has-text("Message")'
        ];

        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    return element;
                }
            } catch (e) {
                // Continuar tentando outros seletores
            }
        }

        // Método alternativo: procurar por todos os botões e verificar o texto
        const buttons = await page.$$('button, div[role="button"], a');
        
        for (const button of buttons) {
            try {
                const text = await page.evaluate(el => el.innerText?.toLowerCase() || '', button);
                if (text.includes('mensagem') || text.includes('message')) {
                    return button;
                }
            } catch (e) {
                // Continuar com o próximo botão
            }
        }

        return null;
    } catch (error) {
        console.log('⚠️ Erro ao procurar botão de mensagem:', error.message);
        return null;
    }
}

// Função melhorada para lidar com overlay de notificações
async function handleNotificationOverlay(page) {
    try {
        console.log('🔍 Procurando por overlay de notificações...');

        // Aguardar que possíveis overlays apareçam
        await randomDelay(3000, 5000);

        // MÉTODO 1: Buscar pelo texto exato "Agora não" (MAIS CONFIÁVEL)
        console.log('🎯 Método 1: Buscando pelo texto exato...');
        
        const agoraNaoClicked = await page.evaluate(() => {
            // Procurar por todos os botões na página
            const allButtons = document.querySelectorAll('button');
            
            for (const button of allButtons) {
                const buttonText = (button.textContent || button.innerText || '').trim();
                
                // Verificar se o texto é exatamente "Agora não"
                if (buttonText === 'Agora não') {
                    console.log(`✅ Botão "Agora não" encontrado: "${buttonText}"`);
                    button.click();
                    return true;
                }
            }
            
            // Também tentar variações em inglês
            for (const button of allButtons) {
                const buttonText = (button.textContent || button.innerText || '').trim();
                
                if (buttonText === 'Not Now' || buttonText === 'not now') {
                    console.log(`✅ Botão "Not Now" encontrado: "${buttonText}"`);
                    button.click();
                    return true;
                }
            }
            
            return false;
        });

        if (agoraNaoClicked) {
            console.log('✅ Overlay fechado com sucesso pelo texto exato!');
            await randomDelay(3000, 4000);
            return true;
        }

        // MÉTODO 2: Buscar dentro de dialogs específicos
        console.log('🎯 Método 2: Buscando dentro de dialogs...');
        
        const dialogClosed = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('div[role="dialog"]');
            
            for (const dialog of dialogs) {
                const buttons = dialog.querySelectorAll('button');
                
                for (const button of buttons) {
                    const buttonText = (button.textContent || button.innerText || '').trim();
                    
                    if (buttonText === 'Agora não' || buttonText === 'Not Now' || buttonText === 'not now') {
                        console.log(`✅ Botão encontrado dentro do dialog: "${buttonText}"`);
                        button.click();
                        return true;
                    }
                }
            }
            
            return false;
        });

        if (dialogClosed) {
            console.log('✅ Overlay fechado via dialog!');
            await randomDelay(3000, 4000);
            return true;
        }

        // MÉTODO 3: Buscar por aria-label ou atributos relacionados
        console.log('🎯 Método 3: Buscando por aria-label...');
        
        const ariaClicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button[aria-label], div[role="button"][aria-label]');
            
            for (const button of buttons) {
                const ariaLabel = button.getAttribute('aria-label') || '';
                const buttonText = (button.textContent || button.innerText || '').trim();
                
                // Verificar tanto o aria-label quanto o texto
                if (ariaLabel.includes('Agora não') || ariaLabel.includes('Not Now') || 
                    buttonText === 'Agora não' || buttonText === 'Not Now') {
                    console.log(`✅ Botão encontrado por aria-label: "${ariaLabel}" / texto: "${buttonText}"`);
                    button.click();
                    return true;
                }
            }
            
            return false;
        });

        if (ariaClicked) {
            console.log('✅ Overlay fechado via aria-label!');
            await randomDelay(3000, 4000);
            return true;
        }

        // MÉTODO 4: Buscar por posição relativa (se aparecer junto com "Ativar")
        console.log('🎯 Método 4: Buscando por contexto com "Ativar"...');
        
        const contextClicked = await page.evaluate(() => {
            const allButtons = document.querySelectorAll('button');
            let ativarButton = null;
            let agoraNaoButton = null;
            
            // Primeiro, encontrar o botão "Ativar"
            for (const button of allButtons) {
                const buttonText = (button.textContent || button.innerText || '').trim();
                if (buttonText === 'Ativar' || buttonText === 'Turn On' || buttonText === 'Allow') {
                    ativarButton = button;
                    break;
                }
            }
            
            // Se encontrou "Ativar", procurar "Agora não" próximo
            if (ativarButton) {
                const parent = ativarButton.closest('div[role="dialog"], div, section');
                if (parent) {
                    const nearbyButtons = parent.querySelectorAll('button');
                    for (const button of nearbyButtons) {
                        const buttonText = (button.textContent || button.innerText || '').trim();
                        if (buttonText === 'Agora não' || buttonText === 'Not Now') {
                            console.log(`✅ Botão "Agora não" encontrado próximo ao "Ativar"`);
                            button.click();
                            return true;
                        }
                    }
                }
            }
            
            return false;
        });

        if (contextClicked) {
            console.log('✅ Overlay fechado via contexto!');
            await randomDelay(3000, 4000);
            return true;
        }

        // MÉTODO 5: Debug - listar todos os botões visíveis
        console.log('🔍 Debug: Listando todos os botões visíveis...');
        await page.evaluate(() => {
            const allButtons = document.querySelectorAll('button');
            console.log(`Total de botões encontrados: ${allButtons.length}`);
            
            allButtons.forEach((button, index) => {
                const text = (button.textContent || button.innerText || '').trim();
                const ariaLabel = button.getAttribute('aria-label') || '';
                const classes = button.className || '';
                
                if (text || ariaLabel) {
                    console.log(`Botão ${index + 1}: Texto="${text}" | Aria-label="${ariaLabel}" | Classes="${classes}"`);
                }
            });
        });

        // ÚLTIMO RECURSO: tentar ESC
        console.log('⌨️ Último recurso: tentando ESC...');
        try {
            await page.keyboard.press('Escape');
            await randomDelay(2000, 3000);
        } catch (e) {
            console.log('⚠️ ESC não funcionou');
        }

        console.log('⚠️ Nenhum método conseguiu fechar o overlay.');
        return false;

    } catch (error) {
        console.log('⚠️ Erro ao lidar com overlay:', error.message);
        return false;
    }
}

// Função para verificar se já existe mensagem enviada
async function checkExistingMessage(page) {
    try {
        console.log('🔍 Verificando se já existe mensagem enviada...');
        
        // Aguardar um pouco para garantir que a página carregou
        await randomDelay(3000, 4000);

        // Verificar se existe o texto "Você enviou" ou similar
        const hasMessage = await page.evaluate(() => {
            // Procurar por diferentes variações do texto
            const textVariations = [
                'você enviou',
                'you sent', 
                'você disse',
                'you said',
                'enviado por você',
                'sent by you'
            ];

            const allElements = document.querySelectorAll('*');
            
            for (const element of allElements) {
                const text = (element.textContent || element.innerText || '').toLowerCase();
                
                for (const variation of textVariations) {
                    if (text.includes(variation)) {
                        console.log(`📩 Encontrado texto: "${variation}" - mensagem já enviada`);
                        return true;
                    }
                }
            }
            
            return false;
        });

        console.log(`✅ Mensagem já enviada? ${hasMessage ? 'SIM' : 'NÃO'}`);
        return hasMessage;

    } catch (error) {
        console.log(`❌ Erro ao verificar histórico de mensagens: ${error.message}`);
        return false; // Em caso de erro, assumir que não foi enviada
    }
}

// Função para enviar a mensagem
async function sendMessage(page, message) {
    try {
        console.log('📝 Enviando mensagem...');
        
        // Procurar pelo campo de texto (textarea ou input)
        let textField = null;
        
        const selectors = [
            'textarea[placeholder*="mensagem"]',
            'textarea[placeholder*="message"]', 
            'div[contenteditable="true"]',
            'textarea',
            'input[type="text"]'
        ];

        for (const selector of selectors) {
            try {
                const element = await page.$(selector);
                if (element) {
                    textField = element;
                    break;
                }
            } catch (e) {
                // Continuar tentando
            }
        }

        if (!textField) {
            console.log('❌ Campo de texto não encontrado.');
            return false;
        }

        // Limpar campo e digitar mensagem
        await textField.click();
        await randomDelay(1000, 2000);
        
        // Limpar qualquer texto existente
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Delete');
        
        await randomDelay(500, 1000);
        
        // Digitar a mensagem
        await textField.type(message, { delay: 100 });
        await randomDelay(2000, 3000);

        // Enviar mensagem (Enter)
        await page.keyboard.press('Enter');
        await randomDelay(3000, 5000);

        return true;

    } catch (error) {
        console.log(`❌ Erro ao enviar mensagem: ${error.message}`);
        return false;
    }
}

module.exports = runDMSender;