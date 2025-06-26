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
            // Coletar TODAS as colunas possíveis de todos os registros
            const allFields = new Set();
            
            leads.forEach(lead => {
                Object.keys(lead).forEach(key => allFields.add(key));
            });
            
            // Converter Set para Array e garantir ordem lógica
            const fieldsArray = Array.from(allFields);
            
            // Colocar colunas importantes no início (se existirem)
            const priorityFields = ['username', 'qualified', 'message_sent', 'followed', 'generated_message'];
            const orderedFields = [];
            
            // Adicionar campos prioritários primeiro
            priorityFields.forEach(field => {
                if (fieldsArray.includes(field)) {
                    orderedFields.push(field);
                }
            });
            
            // Adicionar campos restantes
            fieldsArray.forEach(field => {
                if (!orderedFields.includes(field)) {
                    orderedFields.push(field);
                }
            });
            
            console.log(`📋 Salvando CSV com ${orderedFields.length} colunas: ${orderedFields.join(', ')}`);
            
            const json2csv = new Parser({ fields: orderedFields });
            const csv = json2csv.parse(leads);
            fs.writeFileSync(filePath, csv, 'utf8');
            console.log('💾 CSV atualizado com todas as colunas!');
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar CSV:', error.message);
            console.error('Debug - Estrutura do primeiro lead:', Object.keys(leads[0] || {}));
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

    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Primeira pergunta: quantidade de mensagens
    rl.question(`Quantas mensagens deseja enviar? (Disponíveis: ${leadsToSend.length}): `, async (input) => {
        const numToSend = parseInt(input, 10);

        if (isNaN(numToSend) || numToSend <= 0) {
            console.log('❌ Número inválido. Abortando envio.');
            rl.close();
            return;
        }

        // Segunda pergunta: tipo de envio
        rl.question('Deseja enviar:\n1 - Somente mensagem\n2 - Mensagem + vídeo\nEscolha (1 ou 2): ', async (choice) => {
            rl.close();
            
            const sendWithVideo = choice === '2';
            
            if (choice !== '1' && choice !== '2') {
                console.log('❌ Opção inválida. Abortando envio.');
                return;
            }

            console.log(`📝 Modo selecionado: ${sendWithVideo ? 'Mensagem + Vídeo' : 'Somente Mensagem'}`);

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

                    // Garantir que as colunas existam
                    if (!leads[leadIndex].hasOwnProperty('followed')) {
                        leads[leadIndex].followed = '';
                    }
                    if (!leads[leadIndex].hasOwnProperty('message_sent')) {
                        leads[leadIndex].message_sent = '';
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
                        // Garantir que a coluna existe antes de atualizar
                        if (!leads[leadIndex].hasOwnProperty('message_sent')) {
                            leads[leadIndex].message_sent = '';
                        }
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
                        // Garantir que a coluna existe antes de atualizar
                        if (!leads[leadIndex].hasOwnProperty('message_sent')) {
                            leads[leadIndex].message_sent = '';
                        }
                        leads[leadIndex].message_sent = 'already_sent';
                        saveLeads(leads);
                        continue;
                    }

                    // Preparar mensagem baseada na opção escolhida
                    let messageToSend;
                    
                   if (sendWithVideo) {
                        console.log('📹 Preparando mensagem para envio com vídeo...');
                        console.log('📝 Mensagem original:', lead.generated_message);
                        
                        // Extrair primeira parte até o primeiro ponto final
                        let firstSentence = '';
                        
                        if (lead.generated_message.includes('.')) {
                            // Se tem ponto, pegar tudo até o primeiro ponto (incluindo o ponto)
                            firstSentence = lead.generated_message.split('.')[0] + '.';
                        } else if (lead.generated_message.includes('!')) {
                            // Se não tem ponto mas tem exclamação, usar ela
                            firstSentence = lead.generated_message.split('!')[0] + '!';
                        } else if (lead.generated_message.includes('?')) {
                            // Se não tem ponto nem exclamação mas tem interrogação, usar ela
                            firstSentence = lead.generated_message.split('?')[0] + '?';
                        } else {
                            // Se não tem nenhuma pontuação, usar a mensagem inteira
                            firstSentence = lead.generated_message;
                        }
                        
                        // Remover espaços extras
                        firstSentence = firstSentence.trim();
                        
                        // Construir mensagem final
                        messageToSend = firstSentence + ' I am on the run all the time so am sending a quick video to say hi!';
                        
                        console.log('📝 Primeira sentença extraída:', firstSentence);
                        console.log('📝 Mensagem final para vídeo:', messageToSend);
                        
                    } else {
                        console.log('💬 Usando mensagem completa (sem vídeo)');
                        messageToSend = lead.generated_message;
                    }

                    // Debug adicional para verificar se sendWithVideo está sendo passado corretamente
                    console.log('🔍 DEBUG - sendWithVideo:', sendWithVideo);
                    console.log('🔍 DEBUG - generated_message:', lead.generated_message);
                    console.log('🔍 DEBUG - messageToSend final:', messageToSend);

                    // Enviar mensagem
                    const success = await sendMessage(page, messageToSend);
                    
                    if (!success) {
                        console.log('❌ Falha ao enviar mensagem.');
                        leads[leadIndex].message_sent = 'failed';
                        saveLeads(leads);
                        await randomDelay(1700, 8000);
                        continue;
                    }

                    console.log('✅ Mensagem enviada com sucesso.');
                    
                    // Se escolheu enviar com vídeo, enviar o vídeo agora
                    if (sendWithVideo) {
                        console.log('🎬 Enviando vídeo...');
                        await randomDelay(3000, 5000);
                        
                        const videoSuccess = await sendVideo(page);
                        
                        if (videoSuccess) {
                            console.log('✅ Vídeo enviado com sucesso!');
                        } else {
                            console.log('⚠️ Falha ao enviar vídeo, mas mensagem foi enviada.');
                        }
                    }

                    // Recarregar leads novamente antes de salvar
                    leads = await loadLeads();
                    const updatedLeadIndex = leads.findIndex(l => l.username === lead.username);
                    
                    if (updatedLeadIndex === -1) {
                        console.log('❌ Lead não encontrado para atualização final.');
                        continue;
                    }

                    // Garantir que as colunas existam
                    if (!leads[updatedLeadIndex].hasOwnProperty('message_sent')) {
                        leads[updatedLeadIndex].message_sent = '';
                    }
                    
                    leads[updatedLeadIndex].message_sent = new Date().toISOString();
                    
                    // **SALVAR APÓS ENVIO BEM-SUCEDIDO**
                    saveLeads(leads);
                    await randomDelay(360000, 420000);

                } catch (err) {
                    console.error(`❌ Erro ao processar @${lead.username}:`, err.message);
                    
                    // Recarregar leads e marcar erro
                    leads = await loadLeads();
                    const errorLeadIndex = leads.findIndex(l => l.username === lead.username);
                    
                    if (errorLeadIndex !== -1) {
                        // Garantir que as colunas existam
                        if (!leads[errorLeadIndex].hasOwnProperty('message_sent')) {
                            leads[errorLeadIndex].message_sent = '';
                        }
                        if (!leads[errorLeadIndex].hasOwnProperty('followed')) {
                            leads[errorLeadIndex].followed = '';
                        }
                        if (!leads[errorLeadIndex].hasOwnProperty('error_details')) {
                            leads[errorLeadIndex].error_details = '';
                        }
                        
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
    });
}

async function sendVideo(page) {
    try {
        console.log('🎬 Iniciando envio de vídeo com Drag & Drop...');
        
        // Procurar por arquivos de vídeo na pasta taiz
        const videoDir = path.join(__dirname, '..', 'taiz');
        
        if (!fs.existsSync(videoDir)) {
            console.log('❌ Pasta "taiz" não encontrada.');
            return false;
        }

        const videoFiles = fs.readdirSync(videoDir).filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext);
        });

        if (videoFiles.length === 0) {
            console.log('❌ Nenhum arquivo de vídeo encontrado na pasta "taiz".');
            return false;
        }

        // Escolher um vídeo aleatório
        const randomIndex = Math.floor(Math.random() * videoFiles.length);
        const videoFile = videoFiles[randomIndex];
        const videoPath = path.join(videoDir, videoFile);
        
        console.log(`📁 Usando vídeo: ${videoFile}`);

        // Aguardar um pouco antes de começar
        await randomDelay(2000, 4000);

        // Encontrar a área de drop (geralmente o campo de texto ou área de composição)
        const dropZone = await page.evaluate(() => {
            // Seletores específicos para área de drop
            const selectors = [
                'textarea[placeholder*="mensagem"]',
                'textarea[placeholder*="message"]', 
                'div[contenteditable="true"]',
                'textarea',
                'input[type="text"]'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    const rect = element.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        return {
                            selector: selector,
                            x: rect.left + rect.width / 2,
                            y: rect.top + rect.height / 2,
                            width: rect.width,
                            height: rect.height
                        };
                    }
                }
            }
            
            // Fallback: usar o body como drop zone
            const body = document.body;
            const rect = body.getBoundingClientRect();
            return {
                selector: 'body',
                x: rect.width / 2,
                y: rect.height / 2,
                width: rect.width,
                height: rect.height
            };
        });

        console.log(`🎯 Área de drop encontrada: ${dropZone.selector}`);

        // Ler o arquivo como buffer
        const fileBuffer = fs.readFileSync(videoPath);
        const fileName = path.basename(videoPath);
        const fileType = `video/${path.extname(videoPath).slice(1)}`;

        console.log('📤 Iniciando simulação de Drag & Drop...');

        // Simular movimento do mouse para a área de drop (comportamento humano)
        await page.mouse.move(dropZone.x - 100, dropZone.y - 100);
        await randomDelay(500, 1000);
        await page.mouse.move(dropZone.x, dropZone.y);
        await randomDelay(200, 500);

        // Executar a simulação de drag & drop
        const dropResult = await page.evaluate((fileData, fileName, fileType, dropZone) => {
            return new Promise((resolve) => {
                try {
                    // Converter buffer para Uint8Array
                    const uint8Array = new Uint8Array(fileData.data);
                    
                    // Criar o arquivo
                    const file = new File([uint8Array], fileName, { 
                        type: fileType,
                        lastModified: Date.now() - Math.floor(Math.random() * 86400000) // Random dentro de 24h
                    });

                    // Criar DataTransfer com o arquivo
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);

                    // Encontrar o elemento de drop
                    const dropElement = document.querySelector(dropZone.selector);
                    if (!dropElement) {
                        resolve({ success: false, error: 'Drop element not found' });
                        return;
                    }

                    console.log('🎯 Elemento de drop encontrado:', dropElement.tagName);

                    // Simular sequência completa de eventos de drag & drop
                    const events = [
                        // Eventos de drag enter
                        new DragEvent('dragenter', {
                            dataTransfer: dataTransfer,
                            bubbles: true,
                            cancelable: true
                        }),
                        
                        // Eventos de drag over (múltiplos para simular movimento)
                        new DragEvent('dragover', {
                            dataTransfer: dataTransfer,
                            bubbles: true,
                            cancelable: true
                        }),
                        
                        // Evento de drop final
                        new DragEvent('drop', {
                            dataTransfer: dataTransfer,
                            bubbles: true,
                            cancelable: true
                        })
                    ];

                    // Disparar eventos com delay entre eles
                    let eventIndex = 0;
                    
                    function dispatchNextEvent() {
                        if (eventIndex < events.length) {
                            const event = events[eventIndex];
                            console.log(`🎬 Disparando evento: ${event.type}`);
                            
                            // Prevenir comportamento padrão para dragover
                            if (event.type === 'dragover') {
                                event.preventDefault();
                            }
                            
                            const result = dropElement.dispatchEvent(event);
                            console.log(`✅ Evento ${event.type} disparado, resultado:`, result);
                            
                            eventIndex++;
                            
                            // Delay entre eventos para parecer mais natural
                            setTimeout(dispatchNextEvent, 100 + Math.random() * 200);
                        } else {
                            // Tentar também no body e document como fallback
                            document.body.dispatchEvent(new DragEvent('drop', {
                                dataTransfer: dataTransfer,
                                bubbles: true,
                                cancelable: true
                            }));
                            
                            console.log('✅ Sequência de drag & drop concluída');
                            resolve({ success: true, fileName: fileName });
                        }
                    }
                    
                    // Iniciar a sequência
                    dispatchNextEvent();
                    
                } catch (error) {
                    console.error('❌ Erro na simulação de drag & drop:', error);
                    resolve({ success: false, error: error.message });
                }
            });
        }, fileBuffer, fileName, fileType, dropZone);

        if (!dropResult.success) {
            console.log(`❌ Falha no drag & drop: ${dropResult.error}`);
            return false;
        }

        console.log(`✅ Drag & drop executado com sucesso para: ${dropResult.fileName}`);

        // Aguardar processamento do arquivo - TEMPO AUMENTADO
        console.log('⏳ Aguardando processamento do arquivo...');
        await randomDelay(8000, 12000); // Aumentado de 3-6s para 8-12s

        // Aguardar mais processamento e verificar se o vídeo apareceu na interface
        console.log('⏳ Verificando se vídeo foi processado...');
        let videoProcessed = false;
        
        for (let i = 0; i < 5; i++) {
            videoProcessed = await page.evaluate(() => {
                // Procurar por elementos que indicam que um vídeo foi anexado
                const videoIndicators = [
                    'video',
                    'img[src*="blob"]',
                    '[data-testid*="video"]',
                    '.video-preview',
                    '[aria-label*="video"]',
                    '[aria-label*="vídeo"]'
                ];
                
                for (const selector of videoIndicators) {
                    if (document.querySelector(selector)) {
                        return true;
                    }
                }
                
                return false;
            });
            
            if (videoProcessed) {
                console.log('✅ Vídeo detectado na interface!');
                break;
            }
            
            console.log(`⏳ Tentativa ${i + 1}/5 - Aguardando vídeo aparecer...`);
            await randomDelay(3000, 5000);
        }

        // MUDANÇA: Primeiro tentar enviar com Enter, depois buscar botão
        console.log('🔄 Tentando enviar com Enter primeiro...');
        
        try {
    let textField = null;

    const selectors = [
        'textarea[placeholder*="mensagem"]',
        'textarea[placeholder*="message"]', 
        'div[contenteditable="true"]',
        'textarea',
        'input[type="text"]'
    ];

    // Encontrar o campo de texto
    for (const selector of selectors) {
        try {
            const element = await page.$(selector);
            if (element) {
                // Verificar se o elemento está visível
                const isVisible = await element.boundingBox();
                if (isVisible) {
                    textField = element;
                    break;
                }
            }
        } catch (e) {
            // Continuar tentando
        }
    }

    if (!textField) {
        console.log('❌ Campo de texto não encontrado.');
        return false;
    }

    // Clicar no campo de texto
    await textField.click();
    await randomDelay(1000, 2000);
    
    // Limpar qualquer texto existente
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
    
    await randomDelay(500, 1000);
    
    // Pressionar Enter
    await page.keyboard.press('Enter');
    await randomDelay(3000, 5000);

    return true;

} catch (error) {
    console.log(`❌ Erro ao enviar mensagem: ${error.message}`);
    return false;
}
}
   catch (error) {
    console.log(`❌ Erro ao enviar video: ${error.message}`);
    return false;
} 
}

// NOVA FUNÇÃO: Seguir usuário
async function followUser(page) {
    try {
        console.log('🔍 Procurando botão de seguir...');
        
        // Aguardar um pouco para garantir que a página carregou
        await randomDelay(3000, 5000);

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
                        return false; //COLOQUE TRUE AQUI
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
