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
        console.log('🎬 Iniciando envio de vídeo...');
        
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

        // PRIMEIRA TENTATIVA: Drag & Drop
        console.log('🎯 Tentativa 1: Drag & Drop');
        const dragDropSuccess = await tryDragAndDrop(page, videoPath, videoFile);
        
        if (dragDropSuccess) {
            console.log('✅ Vídeo enviado com sucesso via Drag & Drop!');
            return true;
        }

        // SEGUNDA TENTATIVA: Upload tradicional
        console.log('🔄 Tentativa 2: Upload tradicional');
        const uploadSuccess = await tryTraditionalUpload(page, videoPath, videoFile);
        
        if (uploadSuccess) {
            console.log('✅ Vídeo enviado com sucesso via Upload tradicional!');
            return true;
        }

        console.log('❌ Todas as tentativas de envio falharam.');
        return false;
        
    } catch (error) {
        console.log(`❌ Erro geral ao enviar vídeo: ${error.message}`);
        return false;
    }
}

// MÉTODO 1: Drag & Drop (original melhorado)
async function tryDragAndDrop(page, videoPath, videoFile) {
    try {
        console.log('🎬 Tentando Drag & Drop...');
        
        await randomDelay(2000, 4000);

        // Encontrar a área de drop
        const dropZone = await page.evaluate(() => {
            const selectors = [
                'textarea[placeholder*="mensagem"]',
                'textarea[placeholder*="message"]', 
                'div[contenteditable="true"]',
                '[data-testid*="compose"]',
                '.compose-box',
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

        // Simular movimento do mouse
        await page.mouse.move(dropZone.x - 100, dropZone.y - 100);
        await randomDelay(500, 1000);
        await page.mouse.move(dropZone.x, dropZone.y);
        await randomDelay(200, 500);

        // Executar a simulação de drag & drop
        const dropResult = await page.evaluate((fileData, fileName, fileType, dropZone) => {
            return new Promise((resolve) => {
                try {
                    const uint8Array = new Uint8Array(fileData.data);
                    const file = new File([uint8Array], fileName, { 
                        type: fileType,
                        lastModified: Date.now() - Math.floor(Math.random() * 86400000)
                    });

                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);

                    const dropElement = document.querySelector(dropZone.selector);
                    if (!dropElement) {
                        resolve({ success: false, error: 'Drop element not found' });
                        return;
                    }

                    // Simular eventos de drag & drop
                    const events = [
                        new DragEvent('dragenter', {
                            dataTransfer: dataTransfer,
                            bubbles: true,
                            cancelable: true
                        }),
                        new DragEvent('dragover', {
                            dataTransfer: dataTransfer,
                            bubbles: true,
                            cancelable: true
                        }),
                        new DragEvent('drop', {
                            dataTransfer: dataTransfer,
                            bubbles: true,
                            cancelable: true
                        })
                    ];

                    let eventIndex = 0;
                    
                    function dispatchNextEvent() {
                        if (eventIndex < events.length) {
                            const event = events[eventIndex];
                            
                            if (event.type === 'dragover') {
                                event.preventDefault();
                            }
                            
                            dropElement.dispatchEvent(event);
                            eventIndex++;
                            setTimeout(dispatchNextEvent, 100 + Math.random() * 200);
                        } else {
                            // Fallback adicional
                            document.body.dispatchEvent(new DragEvent('drop', {
                                dataTransfer: dataTransfer,
                                bubbles: true,
                                cancelable: true
                            }));
                            
                            resolve({ success: true, fileName: fileName });
                        }
                    }
                    
                    dispatchNextEvent();
                    
                } catch (error) {
                    resolve({ success: false, error: error.message });
                }
            });
        }, fileBuffer, fileName, fileType, dropZone);

        if (!dropResult.success) {
            console.log(`❌ Falha no drag & drop: ${dropResult.error}`);
            return false;
        }

        // Aguardar processamento
        await randomDelay(8000, 12000);

        // Verificar se foi processado e tentar enviar
        return await tryToSendProcessedVideo(page);
        
    } catch (error) {
        console.log(`❌ Erro no drag & drop: ${error.message}`);
        return false;
    }
}

// MÉTODO 2: Upload tradicional
async function tryTraditionalUpload(page, videoPath, videoFile) {
    try {
        console.log('📤 Tentando upload tradicional...');
        
        await randomDelay(3000, 5000);

        // Verificar se o input de arquivo está presente
        const fileInputReady = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input[type="file"]');
            for (const input of inputs) {
                const accept = input.getAttribute('accept') || '';
                if (accept.includes('video') || accept.includes('*') || accept === '') {
                    return true;
                }
            }
            return false;
        });

        if (!fileInputReady) {
            console.log('❌ Interface de upload não está pronta.');
            return false;
        }

        console.log('⏳ Simulando tempo de escolha do arquivo...');
        await randomDelay(4000, 7000);

        // Encontrar o input de arquivo
        const fileInput = await page.$('input[type="file"]');
        if (!fileInput) {
            console.log('❌ Input de arquivo não encontrado.');
            return false;
        }

        // Fazer upload do arquivo
        await fileInput.uploadFile(videoPath);
        console.log('📤 Arquivo enviado para upload.');

        // Aguardar processamento
        await randomDelay(8000, 15000);

        // Tentar enviar
        return await tryToSendProcessedVideo(page);
        
    } catch (error) {
        console.log(`❌ Erro no upload tradicional: ${error.message}`);
        return false;
    }
}

// Função auxiliar para tentar enviar vídeo processado
async function tryToSendProcessedVideo(page) {
    try {
        // Verificar se o vídeo foi processado
        let videoProcessed = false;
        
        for (let i = 0; i < 5; i++) {
            videoProcessed = await page.evaluate(() => {
                const videoIndicators = [
                    'video',
                    'img[src*="blob"]',
                    '[data-testid*="video"]',
                    '.video-preview',
                    '[aria-label*="video"]',
                    '[aria-label*="vídeo"]',
                    '.media-preview'
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

        // TENTATIVA 1: Enviar com Enter
        console.log('🔄 Tentando enviar com Enter...');
        
        const textField = await findTextField(page);
        if (textField) {
            await textField.click();
            await randomDelay(1000, 2000);
            
            // Limpar campo
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA');
            await page.keyboard.up('Control');
            await page.keyboard.press('Delete');
            await randomDelay(500, 1000);
            
            // Pressionar Enter
            await page.keyboard.press('Enter');
            await randomDelay(3000, 5000);
            
            // Verificar se foi enviado
            const sentCheck1 = await checkIfMessageSent(page);
            if (sentCheck1) {
                return true;
            }
        }

        // TENTATIVA 2: Procurar botão de enviar
        console.log('🔄 Tentando encontrar botão de enviar...');
        
        const sendButton = await page.evaluate(() => {
            const selectors = [
                'button[aria-label*="send"]',
                'button[aria-label*="enviar"]',
                'button[data-testid*="send"]',
                'button[title*="send"]',
                'button[title*="enviar"]',
                '.send-button',
                'button:has([data-icon="send"])',
                'button:has(svg[data-testid="send"])'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    const rect = element.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        return { found: true, selector };
                    }
                }
            }
            return { found: false };
        });

        if (sendButton.found) {
            await page.click(sendButton.selector);
            console.log('📤 Botão de enviar clicado.');
            await randomDelay(3000, 5000);
            
            const sentCheck2 = await checkIfMessageSent(page);
            if (sentCheck2) {
                return true;
            }
        }

        // TENTATIVA 3: Ctrl+Enter
        console.log('🔄 Tentando Ctrl+Enter...');
        const textField2 = await findTextField(page);
        if (textField2) {
            await textField2.click();
            await randomDelay(500, 1000);
            
            await page.keyboard.down('Control');
            await page.keyboard.press('Enter');
            await page.keyboard.up('Control');
            await randomDelay(3000, 5000);
            
            const sentCheck3 = await checkIfMessageSent(page);
            if (sentCheck3) {
                return true;
            }
        }

        console.log('❌ Não foi possível enviar o vídeo processado.');
        return false;
        
    } catch (error) {
        console.log(`❌ Erro ao tentar enviar vídeo processado: ${error.message}`);
        return false;
    }
}

// Função auxiliar para encontrar campo de texto
async function findTextField(page) {
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
                const isVisible = await element.boundingBox();
                if (isVisible) {
                    return element;
                }
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

// Função auxiliar para verificar se mensagem foi enviada
async function checkIfMessageSent(page) {
    return await page.evaluate(() => {
        // Procurar indicadores de que a mensagem foi enviada
        const sentIndicators = [
            '.message-sent',
            '.message-out',
            '[data-testid*="msg-container"]',
            '.chat-message',
            '.message'
        ];
        
        for (const selector of sentIndicators) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                // Verificar se há uma mensagem recente (últimos 10 segundos)
                const now = Date.now();
                for (const element of elements) {
                    const timestamp = element.getAttribute('data-timestamp') || 
                                    element.querySelector('[data-timestamp]')?.getAttribute('data-timestamp');
                    if (timestamp && (now - parseInt(timestamp)) < 10000) {
                        return true;
                    }
                }
                // Se não conseguir verificar timestamp, assume que a última mensagem é recente
                return elements.length > 0;
            }
        }
        return false;
    });
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
