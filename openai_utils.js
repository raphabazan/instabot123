const axios = require('axios');
require('dotenv').config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const BASE_URL = 'https://api.openai.com/v1';

// Headers padrão para todas as requisições
const getHeaders = () => ({
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2'
});

/**
 * Cria uma nova thread
 */
async function createThread() {
    try {
        console.log('🧵 Creating new thread...');
        
        const response = await axios.post(`${BASE_URL}/threads`, {
            metadata: {
                created_at: new Date().toISOString(),
                purpose: 'lead_qualification'
            }
        }, {
            headers: getHeaders()
        });

        console.log(`✅ Thread created: ${response.data.id}`);
        return response.data.id;
    } catch (error) {
        console.error('❌ Error creating thread:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Adiciona uma mensagem à thread
 */
async function addMessageToThread(threadId, message) {
    try {
        console.log('💬 Adding message to thread...');
        
        const response = await axios.post(`${BASE_URL}/threads/${threadId}/messages`, {
            role: 'user',
            content: message
        }, {
            headers: getHeaders()
        });

        console.log('✅ Message added to thread');
        return response.data;
    } catch (error) {
        console.error('❌ Error adding message to thread:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Cria e executa um run
 */
async function createRun(threadId) {
    try {
        console.log('🏃 Creating run...');
        
        const response = await axios.post(`${BASE_URL}/threads/${threadId}/runs`, {
            assistant_id: ASSISTANT_ID
        }, {
            headers: getHeaders()
        });

        console.log(`✅ Run created: ${response.data.id} (Status: ${response.data.status})`);
        return response.data.id;
    } catch (error) {
        console.error('❌ Error creating run:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Verifica o status do run
 */
async function checkRunStatus(threadId, runId) {
    try {
        const response = await axios.get(`${BASE_URL}/threads/${threadId}/runs/${runId}`, {
            headers: getHeaders()
        });

        return response.data.status;
    } catch (error) {
        console.error('❌ Error checking run status:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Aguarda o run completar
 */
async function waitForRunCompletion(threadId, runId, maxWaitTime = 60000) {
    const startTime = Date.now();
    const checkInterval = 2000; // 2 segundos

    console.log('⏳ Waiting for run to complete...');

    while (Date.now() - startTime < maxWaitTime) {
        const status = await checkRunStatus(threadId, runId);
        console.log(`⏱️ Run status: ${status}`);

        if (status === 'completed') {
            console.log('✅ Run completed successfully!');
            return true;
        }

        if (status === 'failed' || status === 'cancelled' || status === 'expired') {
            console.log(`❌ Run failed with status: ${status}`);
            return false;
        }

        // Aguarda antes da próxima verificação
        await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.log('⏰ Run timeout - taking too long to complete');
    return false;
}

/**
 * Busca as mensagens da thread
 */
async function getMessages(threadId, limit = 10) {
    try {
        const response = await axios.get(`${BASE_URL}/threads/${threadId}/messages`, {
            headers: getHeaders(),
            params: {
                limit: limit,
                order: 'desc'
            }
        });

        return response.data.data;
    } catch (error) {
        console.error('❌ Error getting messages:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Função principal para enviar dados para o ChatGPT Assistant
 */
async function sendToChatGPTAssistant({ handle, fullBio, bio_link_page_text }) {
    try {
        console.log(`\n🤖 Sending @${handle} to ChatGPT Assistant for analysis...`);

        // Valida se temos as credenciais necessárias
        if (!OPENAI_API_KEY || !ASSISTANT_ID) {
            console.error('❌ Missing OpenAI credentials. Check your .env file.');
            return null;
        }

        // 1. Criar thread
        const threadId = await createThread();

        // 2. Preparar mensagem para o assistant
        const message = `
Analyze this Instagram profile for lead qualification:

**Handle:** @${handle}

**Bio:**
${fullBio || 'No bio available'}

**Bio Link Page Content:**
${bio_link_page_text || 'No bio link content available'}

Please analyze this profile and respond with a JSON object containing:
- qualified: true/false (is this a potential high-ticket coaching/consulting lead?)
- niche: string (what's their business niche/industry?)
- company_name: string (business/company name if identifiable)
- suggested_message: string (personalized outreach message if qualified)

Focus on identifying coaches, consultants, agencies, and high-ticket service providers.
Avoid crypto traders, betting, adult content, or low-value services.
`.trim();

        // 3. Adicionar mensagem à thread
        await addMessageToThread(threadId, message);

        // 4. Criar e executar run
        const runId = await createRun(threadId);

        // 5. Aguardar conclusão
        const completed = await waitForRunCompletion(threadId, runId);

        if (!completed) {
            console.log('❌ Run did not complete successfully');
            return null;
        }

        // 6. Buscar resposta
        const messages = await getMessages(threadId, 5);
        
        // A primeira mensagem (mais recente) deve ser a resposta do assistant
        const assistantMessage = messages.find(msg => msg.role === 'assistant');
        
        if (!assistantMessage) {
            console.log('❌ No assistant response found');
            return null;
        }

        const responseText = assistantMessage.content[0]?.text?.value;
        
        if (!responseText) {
            console.log('❌ Empty response from assistant');
            return null;
        }

        console.log('📝 Raw assistant response:', responseText);

        // 7. Tentar parsear JSON da resposta
        try {
            // Procurar por JSON na resposta (pode ter texto extra)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                console.log('✅ Successfully parsed assistant response');
                return result;
            } else {
                console.log('⚠️ No JSON found in response, returning raw text');
                return {
                    qualified: false,
                    niche: 'unknown',
                    company_name: 'unknown',
                    suggested_message: responseText
                };
            }
        } catch (parseError) {
            console.log('⚠️ Failed to parse JSON response:', parseError.message);
            return {
                qualified: false,
                niche: 'unknown',
                company_name: 'unknown',
                suggested_message: responseText
            };
        }

    } catch (error) {
        console.error('❌ Error in sendToChatGPTAssistant:', error.message);
        return null;
    }
}

/**
 * Testa a conexão com a OpenAI API
 */
async function testConnection() {
    try {
        console.log('🔍 Testing OpenAI API connection...');
        
        // Testa listar modelos
        const response = await axios.get(`${BASE_URL}/models`, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ OpenAI API connection successful');
        return true;
    } catch (error) {
        console.error('❌ OpenAI API connection failed:', error.response?.data || error.message);
        return false;
    }
}

/**
 * Busca informações do assistant
 */
async function getAssistantInfo() {
    try {
        console.log('🤖 Getting assistant info...');
        
        const response = await axios.get(`${BASE_URL}/assistants/${ASSISTANT_ID}`, {
            headers: getHeaders()
        });

        console.log('✅ Assistant info retrieved');
        console.log(`Assistant Name: ${response.data.name}`);
        console.log(`Assistant Model: ${response.data.model}`);
        
        return response.data;
    } catch (error) {
        console.error('❌ Error getting assistant info:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = {
    sendToChatGPTAssistant,
    testConnection,
    getAssistantInfo,
    createThread,
    addMessageToThread,
    createRun,
    waitForRunCompletion,
    getMessages
};