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

    // Função para carregar CSV
    const loadLeads = () => {
        return new Promise((resolve, reject) => {
            const leads = [];
            fs.createReadStream(filePath)
                .pipe(csvParser())
                .on('data', (row) => leads.push(row))
                .on('end', () => resolve(leads))
                .on('error', reject);
        });
    };

    // Função para salvar CSV
    const saveLeads = (leads) => {
        try {
            const json2csv = new Parser({ fields: Object.keys(leads[0]) });
            const csv = json2csv.parse(leads);
            fs.writeFileSync(filePath, csv, 'utf8');
            console.log('💾 CSV atualizado!');
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar CSV:', error.message);
            return false;
        }
    };

    // Carregar leads inicial
    let leads = await loadLeads();

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
            
            try {
                await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                await randomDelay(30000, 60000);

                // PRIMEIRO: Tentar seguir a pessoa
                console.log(`👤 Tentando seguir @${lead.username}...`);
                const followSuccess = await followUser(page);
                
                // Recarregar leads do arquivo para ter dados atualizados
                leads = await loadLeads();
                const leadIndex = leads.findIndex(l => l.username === lead.username);
                
                if (leadIndex === -1) {
                    console.log('❌ Lead não encontrado no CSV. Pulando...');
                    continue;
                }

                if (followSuccess) {
                    console.log('✅ Usuário seguido com sucesso!');
                    leads[leadIndex].followed = new Date().toISOString();
                } else {
                    console.log('⚠️ Não foi possível seguir o usuário');
                    leads[leadIndex].followed = 'no';
                }

                // **SALVAR APÓS SEGUIR**
                saveLeads(leads);
                await randomDelay(5000, 8000);

                // SEGUNDO: Clicar em "Enviar mensagem"
                const messageButton = await findMessageButton(page);
                
                if (!messageButton) {
                    console.log('❌ Botão "mensagem" não encontrado.');
                    leads[leadIndex].message_sent = 'button_not_found';
                    saveLeads(leads);
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
                    leads[leadIndex].message_sent = 'already_sent';
                    saveLeads(leads);
                    continue;
                }

                // Enviar mensagem
                const success = await sendMessage(page, lead.generated_message);
                
                // Recarregar leads novamente antes de salvar
                leads = await loadLeads();
                const updatedLeadIndex = leads.findIndex(l => l.username === lead.username);
                
                if (success) {
                    console.log('✅ Mensagem enviada com sucesso.');
                    leads[updatedLeadIndex].message_sent = new Date().toISOString();
                    
                    // **SALVAR APÓS ENVIO BEM-SUCEDIDO**
                    saveLeads(leads);
                    await randomDelay(360000, 420000);
                } else {
                    console.log('❌ Falha ao enviar mensagem.');
                    leads[updatedLeadIndex].message_sent = 'failed';
                    
                    // **SALVAR APÓS FALHA**
                    saveLeads(leads);
                    await randomDelay(1700, 8000);
                }

            } catch (err) {
                console.error(`❌ Erro ao processar @${lead.username}:`, err.message);
                
                // Recarregar leads e marcar erro
                leads = await loadLeads();
                const errorLeadIndex = leads.findIndex(l => l.username === lead.username);
                
                if (errorLeadIndex !== -1) {
                    leads[errorLeadIndex].message_sent = 'error';
                    leads[errorLeadIndex].followed = 'error';
                    leads[errorLeadIndex].error_details = err.message;
                    
                    // **SALVAR APÓS ERRO**
                    saveLeads(leads);
                }
                
                await randomDelay(1700, 8000);
                continue;
            }
        }

        console.log('🏁 Envio de mensagens finalizado.');
        console.log('💾 Todos os dados foram salvos incrementalmente durante o processo.');
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

        // MÉTODO 1: Buscar pelo texto exato "Agora não"
        const agoraNaoClicked = await page.evaluate(() => {
            const allButtons = document.querySelectorAll('button');
            
            for (const button of allButtons) {
                const buttonText = (button.textContent || button.innerText || '').trim();
                
                if (buttonText === 'Agora não' || buttonText === 'Not Now' || buttonText === 'not now') {
                    console.log(`✅ Botão encontrado: "${buttonText}"`);
                    button.click();
                    return true;
                }
            }
            
            return false;
        });

        if (agoraNaoClicked) {
            console.log('✅ Overlay fechado com sucesso!');
            await randomDelay(3000, 4000);
            return true;
        }

        // MÉTODO 2: Buscar dentro de dialogs específicos
        const dialogClosed = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('div[role="dialog"]');
            
            for (const dialog of dialogs) {
                const buttons = dialog.querySelectorAll('button');
                
                for (const button of buttons) {
                    const buttonText = (button.textContent || button.innerText || '').trim();
                    
                    if (buttonText === 'Agora não' || buttonText === 'Not Now' || buttonText === 'not now') {
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

        // Último recurso: ESC
        console.log('⌨️ Tentando ESC...');
        try {
            await page.keyboard.press('Escape');
            await randomDelay(2000, 3000);
        } catch (e) {
            console.log('⚠️ ESC não funcionou');
        }

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
        return false;
    }
}

// Função para enviar a mensagem
async function sendMessage(page, message) {
    try {
        console.log('📝 Enviando mensagem...');
        
        // Procurar pelo campo de texto
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
