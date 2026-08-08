const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'cache', 'xonaflix_tv.json');
const CACHE_TTL = 30 * 60 * 1000;
const API_KEY = 'ff_ea4e1e98f822dddd9fee397f6ab9d4e55f49caf8e3f18e2f211e907a97123bb0';

let inMemoryChannels = null;
let lastFetchTime = 0;

function ensureCacheDir() {
  const dir = path.join(__dirname, 'cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCache() {
  try {
    ensureCacheDir();
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(data.channels) && data.channels.length > 0) {
        inMemoryChannels = data.channels;
        lastFetchTime = data.timestamp || 0;
        return inMemoryChannels;
      }
    }
  } catch (err) {}
  return null;
}

function saveCache(channels) {
  try {
    ensureCacheDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      timestamp: Date.now(),
      count: channels.length,
      channels: channels
    }, null, 2), 'utf8');
  } catch (err) {}
}

async function scrapeAllChannels(maxPages = 10) {
  const allChannels = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? 'https://xonaflix.fr/tv' : `https://xonaflix.fr/tv?page=${page}`;
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 6000
      });

      const $ = cheerio.load(res.data);
      let pageCount = 0;

      $('a[href*="/live-broadcast/"]').each((i, el) => {
        const link = $(el).attr('href');
        const slug = link.split('/live-broadcast/')[1];
        const title = $(el).find('h3').text().trim() || slug.toUpperCase();
        const country = $(el).find('p').text().trim() || 'France';
        const logo = $(el).find('img').attr('src') || '';

        let fullLogo = logo;
        if (logo && !logo.startsWith('http')) {
          fullLogo = logo.startsWith('/') ? `https://xonaflix.fr${logo}` : `https://xonaflix.fr/${logo}`;
        }

        if (slug && !allChannels.some(c => c.slug === slug)) {
          allChannels.push({
            id: slug,
            name: title,
            slug: slug,
            country: country,
            category: country === 'France' ? 'TNT & Câble France' : country,
            logo: fullLogo,
            streamUrl: `https://northlive.lol/api/v1/index.php?route=tv%2F${encodeURIComponent(slug)}%2Fplayer&api_key=${API_KEY}`,
            playerUrl: link
          });
          pageCount++;
        }
      });

      if (pageCount === 0) break;
    } catch (err) {
      break;
    }
  }

  if (allChannels.length > 0) {
    inMemoryChannels = allChannels;
    lastFetchTime = Date.now();
    saveCache(allChannels);
  }
  return allChannels;
}

async function getChannels() {
  if (inMemoryChannels && Date.now() - lastFetchTime < CACHE_TTL) {
    return inMemoryChannels;
  }
  const cached = loadCache();
  if (cached && Date.now() - lastFetchTime < CACHE_TTL) {
    return cached;
  }
  if (cached) {
    scrapeAllChannels(10).catch(() => {});
    return cached;
  }
  return await scrapeAllChannels(10);
}

module.exports = {
  getChannels,
  scrapeAllChannels
};
