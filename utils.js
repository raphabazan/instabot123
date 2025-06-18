// utils.js - Utilitários para comportamento humano

/**
 * Delay aleatório mais humano
 */
async function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    
    // Adicionar micro-variações para parecer mais natural
    const microVariation = Math.random() * 100;
    const finalDelay = delay + microVariation;
    
    return new Promise(resolve => setTimeout(resolve, finalDelay));
}

module.exports = {
    randomDelay }