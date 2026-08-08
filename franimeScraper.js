const axios = require('axios');
const fs = require('fs');
const path = require('path');

const FRANIME_CACHE_DIR = path.join(__dirname, 'cache', 'franime');
const FRANIME_CACHE_FILE = path.join(FRANIME_CACHE_DIR, 'animes.json');

let globAnimesCache = null;
let globAnimesCacheTime = 0;
const CACHE_DURATION = 1 * 60 * 60 * 1000;

if (!fs.existsSync(FRANIME_CACHE_DIR)) {
  try {
    fs.mkdirSync(FRANIME_CACHE_DIR, { recursive: true });
  } catch (e) {}
}

try {
  if (fs.existsSync(FRANIME_CACHE_FILE)) {
    const fileData = JSON.parse(fs.readFileSync(FRANIME_CACHE_FILE, 'utf8'));
    globAnimesCache = fileData.items || null;
    globAnimesCacheTime = fileData.timestamp || 0;
  }
} catch (e) {}

let isFetchingFranime = false;

async function triggerFranimeFetch(force = false) {
  if (isFetchingFranime) return;
  const now = Date.now();
  if (!force && globAnimesCache && (now - globAnimesCacheTime < CACHE_DURATION)) {
    return;
  }
  isFetchingFranime = true;

  axios.get('https://api.franime.fr/api/animes/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://franime.fr/',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    timeout: 25000
  }).then(response => {
    if (Array.isArray(response.data)) {
      globAnimesCache = response.data;
      globAnimesCacheTime = Date.now();
      try {
        fs.writeFileSync(FRANIME_CACHE_FILE, JSON.stringify({ items: response.data, timestamp: Date.now() }), 'utf8');
      } catch (err) {}
    }
    isFetchingFranime = false;
  }).catch(err => {
    isFetchingFranime = false;
  });
}

setTimeout(() => {
  triggerFranimeFetch();
}, 4000).unref();

async function getAllAnimes() {
  const now = Date.now();
  if (!globAnimesCache) {
    try {
      const response = await axios.get('https://api.franime.fr/api/animes/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://franime.fr/',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 25000
      });
      if (Array.isArray(response.data)) {
        globAnimesCache = response.data;
        globAnimesCacheTime = now;
        try {
          fs.writeFileSync(FRANIME_CACHE_FILE, JSON.stringify({ items: response.data, timestamp: now }), 'utf8');
        } catch (e) {}
      }
    } catch (error) {}
  } else {
    triggerFranimeFetch();
  }
  return globAnimesCache || [];
}

async function search(query) {
  try {
    const list = await getAllAnimes();
    const cleanQuery = (query || '').toLowerCase().trim();
    
    let matched = list;
    if (cleanQuery) {
      const queryWords = cleanQuery.split(/[^a-z0-9]+/).filter(w => w.length >= 2);
      const queryCollapsed = cleanQuery.replace(/[^a-z0-9]/g, '');

      matched = list.filter(a => {
        const title = (a.title || '').toLowerCase();
        const titleO = (a.titleO || '').toLowerCase();
        const titleEn = (a.titles && a.titles.en_jp ? a.titles.en_jp.toLowerCase() : '');
        const titleJa = (a.titles && a.titles.ja_jp ? a.titles.ja_jp.toLowerCase() : '');

        const collapsedTitle = title.replace(/[^a-z0-9]/g, '');
        const collapsedTitleO = titleO.replace(/[^a-z0-9]/g, '');

        if (String(a.id) === cleanQuery) return true;

        if (queryWords.length > 0) {
          const matchesAllWords = queryWords.every(word =>
            title.includes(word) ||
            titleO.includes(word) ||
            titleEn.includes(word) ||
            titleJa.includes(word)
          );
          if (matchesAllWords) return true;
        }

        if (queryCollapsed.length >= 3) {
          if (collapsedTitle.includes(queryCollapsed) || collapsedTitleO.includes(queryCollapsed)) {
            return true;
          }
        }

        const titleWords = title.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
        if (titleWords.length >= 2 && titleWords.every(w => queryCollapsed.includes(w))) {
          return true;
        }

        const titleOWords = titleO.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
        if (titleOWords.length >= 2 && titleOWords.every(w => queryCollapsed.includes(w))) {
          return true;
        }

        return false;
      });
    }

    return matched.map(a => ({
      id: a.id,
      url: `https://franime.fr/anime/${a.id}`,
      name: a.title,
      image: a.affiche || a.affiche_small || '',
      alternative_names: [a.titleO || '', a.titles && a.titles.en_jp || ''].filter(Boolean),
      alternative_names_string: a.titleO || '',
      raw: a
    }));
  } catch (error) {
    return [];
  }
}

async function getAnimeDetails(animeId, rawAnime = null) {
  try {
    let anime = rawAnime;
    if (!anime) {
      const list = await getAllAnimes();
      anime = list.find(a => a.id === parseInt(animeId));
    }
    if (!anime) return null;

    const seasonsData = {};

    for (let sIdx = 0; sIdx < anime.saisons.length; sIdx++) {
      const season = anime.saisons[sIdx];
      const seasonName = season.title || `Saison ${sIdx + 1}`;

      const episodesData = [];
      for (let eIdx = 0; eIdx < season.episodes.length; eIdx++) {
        const ep = season.episodes[eIdx];
        const streaming_links = [];

        if (ep.lang && ep.lang.vo && Array.isArray(ep.lang.vo.lecteurs)) {
          const playersUrls = [];
          for (let pIdx = 0; pIdx < ep.lang.vo.lecteurs.length; pIdx++) {
            const playerUrl = `https://api.franime.fr/api/anime/${anime.id}/${sIdx}/${eIdx}/vo/${pIdx}`;
            playersUrls.push(playerUrl);
          }
          if (playersUrls.length > 0) {
            streaming_links.push({
              language: 'vostfr',
              players: playersUrls
            });
          }
        }

        if (ep.lang && ep.lang.vf && Array.isArray(ep.lang.vf.lecteurs)) {
          const playersUrls = [];
          for (let pIdx = 0; pIdx < ep.lang.vf.lecteurs.length; pIdx++) {
            const playerUrl = `https://api.franime.fr/api/anime/${anime.id}/${sIdx}/${eIdx}/vf/${pIdx}`;
            playersUrls.push(playerUrl);
          }
          if (playersUrls.length > 0) {
            streaming_links.push({
              language: 'vf',
              players: playersUrls
            });
          }
        }

        episodesData.push({
          name: ep.title || `Épisode ${eIdx + 1}`,
          serie_name: anime.title,
          season_name: seasonName,
          index: eIdx + 1,
          streaming_links
        });
      }

      seasonsData[seasonName] = {
        timestamp: Date.now(),
        episodes: episodesData
      };
    }

    return {
      image: anime.affiche || '',
      seasons: seasonsData
    };
  } catch (error) {
    return null;
  }
}

function decryptWatchUrl(watchUrl) {
  try {
    const parsed = new URL(watchUrl);
    for (const [key, val] of parsed.searchParams.entries()) {
      try {
        const b64Decoded = Buffer.from(decodeURIComponent(val), 'base64').toString('utf-8');
        let cleanStr = '';
        if (/^[0-9a-fA-F\s{}|`]+$/.test(b64Decoded)) {
          cleanStr = Buffer.from(b64Decoded, 'hex').toString('utf-8');
        } else {
          cleanStr = b64Decoded;
        }

        if (cleanStr.length < 8) continue;

        const kXor = cleanStr.charCodeAt(0) ^ 'h'.charCodeAt(0);
        const expectedPrefix = 'ttps://';
        let isValid = true;
        for (let i = 0; i < expectedPrefix.length; i++) {
          const charCode = cleanStr.charCodeAt(i + 1) ^ kXor;
          if (String.fromCharCode(charCode) !== expectedPrefix[i]) {
            isValid = false;
            break;
          }
        }

        if (isValid) {
          let decrypted = '';
          for (let i = 0; i < cleanStr.length; i++) {
            decrypted += String.fromCharCode(cleanStr.charCodeAt(i) ^ kXor);
          }
          return decrypted;
        }
      } catch (e) {}
    }
  } catch (err) {}
  return null;
}

async function resolvePlayerUrl(apiUrl) {
  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://franime.fr/',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 10000
    });

    const watchUrl = response.data;
    if (watchUrl && watchUrl.includes('watch2')) {
      const decrypted = decryptWatchUrl(watchUrl);
      if (decrypted) {
        return decrypted;
      }
    }
    return watchUrl;
  } catch (error) {
    return apiUrl;
  }
}

async function exists(title) {
  try {
    const list = await getAllAnimes();
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleanTitle) return false;
    return list.some(a => {
      const t = (a.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const tO = (a.titleO || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return t === cleanTitle || tO === cleanTitle || t.includes(cleanTitle) || cleanTitle.includes(t);
    });
  } catch {
    return false;
  }
}

module.exports = {
  search,
  getAnimeDetails,
  resolvePlayerUrl,
  exists,
  getAllAnimes
};
