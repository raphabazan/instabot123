const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { randomDelay } = require('./utils');

const cookiesPath = path.join(__dirname, '..', 'data', 'cookies.json');

async function login() {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();

    if (fs.existsSync(cookiesPath)) {
        console.log('Carregando cookies salvos...');
        const cookies = JSON.parse(fs.readFileSync(cookiesPath));
        await page.setCookie(...cookies);
        console.log('Cookies carregados. Pulando login manual.');
        await randomDelay();

        // Agora, comportamento humano: ir para a página principal
        try {
            console.log('Navegando para a página principal...');
            await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await randomDelay(5000, 10000); // Espera entre 5 e 10 segundos, simulando comportamento humano
        } catch (error) {
            console.log('Aviso: Timeout ao carregar a página principal. Tentando recarregar...');
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
            await randomDelay(5000, 10000);
        }

        return { browser, page };
    }

    // Caso não tenha cookies, faz login manual
    console.log('Fazendo login manual...');
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle2' });

    await page.waitForSelector('input[name="username"]', { visible: true });

    await page.type('input[name="username"]', process.env.INSTAGRAM_USERNAME, { delay: 100 });
    await page.type('input[name="password"]', process.env.INSTAGRAM_PASSWORD, { delay: 100 });

    await page.click('button[type="submit"]');

    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await randomDelay();

    // Salva cookies após login bem-sucedido
    const cookies = await page.cookies();
    if (!fs.existsSync(path.dirname(cookiesPath))) {
        fs.mkdirSync(path.dirname(cookiesPath));
    }
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
    console.log('Cookies salvos.');

    // Comportamento humano: ir para a página principal depois do login
    try {
        console.log('Navegando para a página principal...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await randomDelay(5000, 10000);
    } catch (error) {
        console.log('Aviso: Timeout ao carregar a página principal. Tentando recarregar...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await randomDelay(5000, 10000);
    }

    return { browser, page };
}

module.exports = login;
