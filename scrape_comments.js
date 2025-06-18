const fs = require('fs');
const path = require('path');
const { randomDelay } = require('./utils');

async function scrapeComments(page, postUrl) {
    console.log('🚀 Abrindo post:', postUrl);

    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await randomDelay(3000, 5000);

    console.log('🔍 Detectando tipo de post (modal ou página full)...');

    let isModal = false;

    try {
        await page.waitForSelector('div[role="dialog"]', { timeout: 5000 });
        isModal = true;
        console.log('📱 Post aberto em modal (div[role="dialog"])');
    } catch {
        console.log('🖥️ Post aberto em página full (sem modal)');
    }

    // Seletores unificados
    let commentsContainerSelector = 'div.x5yr21d.xw2csxc.x1odjw0f.x1n2onr6';
    let commentBlocksSelector = 'div.x5yr21d.xw2csxc.x1odjw0f.x1n2onr6 > div.x78zum5.xdt5ytf.x1iyjqo2';

    if (isModal) {
        commentsContainerSelector = 'div[role="dialog"] ' + commentsContainerSelector;
        commentBlocksSelector = 'div[role="dialog"] ' + commentBlocksSelector;
    }

    console.log('🎯 Container selector:', commentsContainerSelector);
    console.log('🎯 Comment blocks selector:', commentBlocksSelector);

    try {
        await page.waitForSelector(commentsContainerSelector, { visible: true, timeout: 15000 });
        console.log('✅ Container de comentários encontrado');
    } catch (error) {
        console.log('❌ Container de comentários não encontrado:', error.message);
        return;
    }

    // Debug: verificar se elementos existem
    const containerExists = await page.$(commentsContainerSelector);
    console.log('📋 Container encontrado:', !!containerExists);

    const blocksCount = await page.$$eval(commentBlocksSelector, els => els.length);
    console.log('📊 Blocos de comentários iniciais encontrados:', blocksCount);

    console.log('📜 Iniciando scroll dos comentários...');

        // SCROLL OTIMIZADO com melhor detecção de fim

    let previousHeight = 0;

    let retries = 0;

    let scrollAttempts = 0;

    const maxScrollAttempts = 75;

    let consecutiveNoChanges = 0;

    while (
      retries < 6 &&
      scrollAttempts < maxScrollAttempts &&
      consecutiveNoChanges < 3
    ) {
      try {
        scrollAttempts++;

        // Verificar se ainda estamos na página correta

        const currentUrl = page.url();

        if (currentUrl.includes('/accounts/login')) {
          throw new Error('Redirecionado para login durante scroll');
        }

        // Obter altura atual do container

        const currentHeight = await page.$eval(
          commentsContainerSelector,
          el => el.scrollHeights
        );

        // Fazer scroll suave dentro do container

        await page.$eval(commentsContainerSelector, el => {
          el.scrollTo({
            top: el.scrollHeight,

            behavior: 'smooth',
          });
        });

        // Aguardar carregamento com delay variável

        await randomDelay(3000, 5000);

        // Procurar e clicar em botão "Ver mais comentários" com múltiplos seletores

        const moreButtonSelectors = [
          'div[role="dialog"] button._abl-',

          'article button._abl-',

          'button[class*="more"]',

          'span[role="button"]',

          'div[role="button"]',
        ];

        let buttonClicked = false;

        for (const selector of moreButtonSelectors) {
          try {
            const buttons = await page.$$(selector);

            for (const button of buttons) {
              const text = await page.evaluate(
                el => el.textContent.toLowerCase(),
                button
              );

              if (
                text.includes('ver mais') ||
                text.includes('view more') ||
                text.includes('load more') ||
                text.includes('show more')
              ) {
                const isVisible = await page.evaluate(el => {
                  const rect = el.getBoundingClientRect();

                  return rect.width > 0 && rect.height > 0;
                }, button);

                if (isVisible) {
                  await button.click();

                  console.log(
                    `Botão "Ver mais comentários" clicado (${selector})`
                  );

                  await randomDelay(4000, 6000);

                  buttonClicked = true;

                  retries = 0;

                  consecutiveNoChanges = 0;

                  break;
                }
              }
            }

            if (buttonClicked) break;
          } catch {
            /* continuar com próximo seletor */
          }
        }

        if (buttonClicked) {
          continue;
        }

        // Verificar se houve mudança na altura

        if (currentHeight === previousHeight) {
          retries++;

          consecutiveNoChanges++;

          console.log(
            `Tentativa ${retries}/6 - Sem novo conteúdo (Scroll ${scrollAttempts}/${maxScrollAttempts})`
          );

          // Tentar scroll mais agressivo se não houver mudanças

          if (consecutiveNoChanges >= 2) {
            await page.$eval(commentsContainerSelector, el => {
              el.scrollBy(0, 1000);
            });

            await randomDelay(2000, 3000);
          }
        } else {
          retries = 0;

          consecutiveNoChanges = 0;

          previousHeight = currentHeight;

          console.log(
            `Novo conteúdo carregado! Altura: ${currentHeight} (Scroll ${scrollAttempts}/${maxScrollAttempts})`
          );
        }
      } catch (error) {
        console.log('Erro durante scroll:', error.message);

        retries++;

        consecutiveNoChanges++;

        await randomDelay(3000, 5000);
      }
    }

    console.log('Scroll finalizado. Extraindo comentários...');
// Aguardar um pouco antes da extração
    await randomDelay(2000, 3000);
    // EXTRAÇÃO DE DADOS - Versão mais robusta
    let commentsData = [];
    console.log('Extraindo comentários da página full...');

    commentsData = await page.evaluate(() => {
        const comments = [];

        const containerSelectors = [
          'div.x5yr21d.xw2csxc.x1odjw0f.x1n2onr6',

          'article div[class*="comments"]',

          'section div[class*="comment"]',
        ];

        let commentContainer = null;

        for (const selector of containerSelectors) {
          commentContainer = document.querySelector(selector);

          if (commentContainer) break;
        }

        if (!commentContainer) {
          console.log('Container de comentários não encontrado na página full');

          return comments;
        }

        const commentBlocks = commentContainer.querySelectorAll(
          'div.x78zum5.xdt5ytf.x1iyjqo2, div[class*="comment"]'
        );

        console.log(
          `Container encontrado com ${commentBlocks.length} blocos de comentários`
        );

        commentBlocks.forEach((block, index) => {
          try {
            // Múltiplos seletores para username

            const usernameSelectors = [
              'a[href^="/"][role="link"]',

              'span._ap3a._aaco._aacw._aacx._aad7._aade',

              'a[href^="/"]',

              'h3 a',

              '.x1i10hfl[href^="/"]',
            ];

            let username = '';

            for (const selector of usernameSelectors) {
              const usernameElement = block.querySelector(selector);

              if (usernameElement) {
                if (usernameElement.href) {
                  const href = usernameElement.href;

                  const match = href.match(/instagram\.com\/([^\/\?]+)/);

                  username = match ? match[1] : '';
                } else {
                  username = usernameElement.textContent
                    .replace('@', '')
                    .trim();
                }

                if (username && username.length > 0 && username.length < 30) {
                  break;
                }
              }
            }

// Múltiplos seletores para texto
const textSelectors = [
  'div[class~="x1cy8zhl"] > span[dir="auto"]',
  'span[dir="auto"]',
  '.x193iq5w span',
  'div span:not([class*="_ap3a"])'
];

let comment_text = '';

for (const selector of textSelectors) {
  const elements = block.querySelectorAll(selector);
  for (const el of elements) {
    const text = el.textContent.trim();
    if (text && text !== username && !text.includes('@' + username)) {
      comment_text = text;
      break;
    }
  }
  if (comment_text) break;
}

if (username && username.length > 0) {
  comments.push({
    username: username.toLowerCase(),
    comment_text: comment_text || '',
    debug_index: index,
    debug_method: 'full_page',
  });
}
          } catch (e) {
            console.log(`Erro no bloco ${index}:`, e.message);
          }
        });

        console.log(`Comentários extraídos da página full: ${comments.length}`);

        return comments;
      });

      
    // Filtrar e validar dados

    const validComments = commentsData.filter(comment => {
      const isValidUsername =
        comment.username &&
        comment.username.length > 0 &&
        comment.username.length < 30 &&
        comment.username.match(/^[a-zA-Z0-9._]+$/);

      const isNotCopyText =
        comment.comment_text !== 'Copy' &&
        comment.comment_text !== 'copy' &&
        !comment.comment_text.toLowerCase().includes('verificado');

      return isValidUsername && isNotCopyText;
    });

    // Remover duplicatas

    const uniqueComments = [];

    const seenUsernames = new Set();

    validComments.forEach(comment => {
      if (!seenUsernames.has(comment.username)) {
        seenUsernames.add(comment.username);

        uniqueComments.push(comment);
      }
    });

    console.log(
      `Total de comentários únicos extraídos: ${uniqueComments.length}`
    );

    // Mostrar primeiros comentários para debug

    uniqueComments.slice(0, 10).forEach((comment, index) => {
      const truncatedText = comment.comment_text.substring(0, 50);

      console.log(
        `#${index + 1} - @${comment.username}: "${truncatedText}${
          comment.comment_text.length > 50 ? '...' : ''
        }"`
      );
    });

    if (uniqueComments.length === 0) {
      console.log('Nenhum comentário válido encontrado.');

      return [];
    }

    // Salvar em CSV

    await saveCommentsToCSV(uniqueComments);

    return uniqueComments;
}
// Remove unmatched closing brace here to fix 'try' expected error

async function saveCommentsToCSV(comments) {
  const filePath = path.join(__dirname, '..', 'data', 'leads_list.csv');

  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  // Ler usernames existentes

  let existingUsernames = new Set();

  if (fs.existsSync(filePath)) {
    try {
      const existingContent = fs.readFileSync(filePath, 'utf8');

      const lines = existingContent.split('\n').filter(line => line.trim());

      if (lines.length > 1) {
        lines.slice(1).forEach(line => {
          const username = line.split(',')[0].replace(/"/g, '').trim();

          if (username) {
            existingUsernames.add(username.toLowerCase());
          }
        });
      }

      console.log(
        `${existingUsernames.size} usernames já existentes no arquivo`
      );
    } catch (error) {
      console.log('Erro ao ler arquivo existente:', error.message);
    }
  }

  // Filtrar comentários novos

  const newComments = comments.filter(
    comment => !existingUsernames.has(comment.username.toLowerCase())
  );

  if (newComments.length === 0) {
    console.log('Nenhum comentário novo encontrado.');

    return;
  }

  // Criar conteúdo CSV

  const csvHeader = 'username,comment_text\n';

  const csvContent = newComments
    .map(c => `"${c.username}","${c.comment_text.replace(/"/g, '""')}"`)
    .join('\n');

  // Salvar arquivo

  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, csvHeader + csvContent);
    } else {
      fs.appendFileSync(filePath, '\n' + csvContent);
    }

    console.log(
      `${newComments.length} novos comentários adicionados ao arquivo: ${filePath}`
    );

    console.log(
      `Total de leads únicos agora: ${
        existingUsernames.size + newComments.length
      }`
    );
  } catch (error) {
    console.error('Erro ao salvar CSV:', error.message);

    throw error;
  }
}

module.exports = scrapeComments;
