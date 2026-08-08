const express = require('express');
const router = express.Router();
const fsp = require('fs').promises;
const path = require('path');
const writeFileAtomic = async (filePath, data, encoding = 'utf-8') => {
  try {
    const tmpPath = `${filePath}.${Math.random().toString(36).substring(2)}.tmp`;
    await fsp.writeFile(tmpPath, data, encoding);
    await fsp.rename(tmpPath, filePath);
  } catch (err) {
    await fsp.writeFile(filePath, data, encoding).catch(() => {});
  }
};
const voirAnimeScraper = require('./voirAnimeScraper');
const franimeScraper = require('./franimeScraper');

const { ANIME_SAMA_CACHE_DIR, generateCacheKey } = require('../utils/cacheManager');
const { memoryCache } = require('../config/redis');

let deps = {
  ANIME_SAMA_URL: '',
  axiosAnimeSama: null,
  axiosAnimeSamaRequest: async () => { throw new Error('animeSama not configured'); },
  getFromCacheNoExpiration: async () => null,
  saveToCache: async () => false,
  normalizeAnimeSamaUrls: (data) => data,
  mergeStreamingLinks: () => [],
  cleanupOldCacheFiles: async () => {},
  migrateOldCacheFiles: async () => {},
  limitConcurrency10: async (fn) => fn()
};

function configure(injected) {
  Object.assign(deps, injected);
  deps.normalizeAnimeSamaUrls = normalizeAnimeSamaUrls;
}

const normalizeAnimeSamaUrls = (data) => {
  if (!data) return data;
  const currentDomain = (deps.ANIME_SAMA_URL || '').replace(/\/$/, '');

  const isValidPlayerUrl = (url) => {
    if (typeof url !== 'string' || url.length === 0) return false;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
    if (!url.includes('.')) return false;
    const invalidPatterns = ['_self', 'containerSamedi', '\u00e9lite', 'Sectes', 'prouesses', 'discord.gg', 'smoothpre', 'smooth-player'];
    if (invalidPatterns.some(pattern => url.includes(pattern))) return false;
    return true;
  };

    const replaceUrls = (obj, key = null) => {
    if (typeof obj === 'string') {
      let cleanedUrl = obj.replace(/https:\/\/proxy\.movix\.(blog|club|site)\/proxy\//gi, '');
      return cleanedUrl.replace(/https?:\/\/anime-sama\.[a-z]+/gi, currentDomain);
    }
    if (Array.isArray(obj)) {
      if (key === 'players') {
        return obj.map(item => replaceUrls(item)).filter(item => {
          if (item && typeof item === 'object' && item.link) return true;
          return isValidPlayerUrl(item);
        });
      }
      if (key === 'streaming_links') {
        return obj.map(item => replaceUrls(item)).filter(item => item && item.players && item.players.length > 0);
      }
      return obj.map(item => replaceUrls(item));
    }
    if (obj && typeof obj === 'object') {
      const newObj = {};
      for (const [k, value] of Object.entries(obj)) {
        newObj[k] = replaceUrls(value, k);
      }
      return newObj;
    }
    return obj;
  };

  return replaceUrls(data);
};

const zipVarlen = (...arrays) => {
  const maxLength = Math.max(...arrays.map(arr => arr.length));
  const result = [];

  for (let i = 0; i < maxLength; i++) {
    result.push(arrays.map(arr => i < arr.length ? arr[i] : []));
  }

  return result;
};

const splitAndStrip = (str, delimiter) => {
  return str.split(delimiter).map(item => item.trim()).filter(item => item);
};

const removeQuotes = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/^["'](.*)["']$/, '$1');
};

const safeFilename = (str) => {
  return str.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
};

const LANG = {
  VOSTFR: 'VOSTFR',
  VF: 'VF',
  VOST_ENG: 'VOSTEng',
  VOST_SPA: 'VOSTSpa',
  VJ: 'VJ'
};

const LANG_ID = {
  VOSTFR: 'vostfr',
  VF: 'vf',
  VOST_ENG: 'vosteng',
  VOST_SPA: 'vostspa',
  VJ: 'vj'
};

const flags = {
  'VOSTFR': '\ud83c\uddef\ud83c\uddf5',
  'VF': '\ud83c\uddeb\ud83c\uddf7',
  'VOSTEng': '\ud83c\uddec\ud83c\udde7',
  'VOSTSpa': '\ud83c\uddea\ud83c\uddf8',
  'VJ': '\ud83c\uddef\ud83c\uddf5'
};

const id2lang = {
  'vostfr': LANG.VOSTFR,
  'vf': LANG.VF,
  'vosteng': LANG.VOST_ENG,
  'vostspa': LANG.VOST_SPA,
  'vj': LANG.VJ
};

const lang2ids = {
  [LANG.VOSTFR]: [LANG_ID.VOSTFR],
  [LANG.VF]: [LANG_ID.VF],
  [LANG.VOST_ENG]: [LANG_ID.VOST_ENG],
  [LANG.VOST_SPA]: [LANG_ID.VOST_SPA],
  [LANG.VJ]: [LANG_ID.VJ]
};

const langIds = ['vostfr', 'vf'];

const isValidPlayerUrl = (url) => {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  if (!url.includes('.')) return false;
  const invalidPatterns = ['_self', 'containerSamedi', '\u00e9lite', 'Sectes', 'prouesses', 'discord.gg'];
  if (invalidPatterns.some(pattern => url.includes(pattern))) return false;
  return true;
};

const sortPlayersByQuality = (playersArray) => {
  if (!Array.isArray(playersArray)) return [];
  const hostPriority = [
    'voe.sx', 'voe.to', 'voe.com',
    'uqload.com', 'uqload.co', 'uqload.to', 'uqload.org',
    'vidmoly.to', 'vidmoly.net',
    'sendvid.com',
    'fembed.net', 'fembed.com', 'feurl',
    'vidoza.net', 'vidoza.org',
    'myvi.tv', 'myvi.ru',
    'sibnet.ru',
    'ok.ru'
  ];
  
  const sorted = [...playersArray].sort((a, b) => {
    const urlA = (typeof a === 'string' ? a : a.url || a.src || '').toLowerCase();
    const urlB = (typeof b === 'string' ? b : b.url || b.src || '').toLowerCase();
    
    let indexA = hostPriority.findIndex(host => urlA.includes(host));
    let indexB = hostPriority.findIndex(host => urlB.includes(host));
    
    if (indexA === -1) indexA = 99;
    if (indexB === -1) indexB = 99;
    
    return indexA - indexB;
  });

  const hasHD = sorted.some(p => {
    const url = (typeof p === 'string' ? p : p.url || p.src || '').toLowerCase();
    return url.includes('voe.') || url.includes('uqload.') || url.includes('vidmoly.');
  });

  if (hasHD) {
    return sorted.filter(p => {
      const url = (typeof p === 'string' ? p : p.url || p.src || '').toLowerCase();
      return !url.includes('sibnet.ru') && !url.includes('ok.ru');
    });
  }

  return sorted;
};

class Players {
  constructor(availables = []) {
    this.availables = availables;
    this._best = null;
    this.index = 1;
  }

  get best() {
    if (!this._best) {
      this.setBest();
    }
    return this._best;
  }

  setBest(prefers = [], bans = []) {
    if (!this.availables.length) {
      return;
    }

    for (const prefer of prefers) {
      for (const player of this.availables) {
        if (player.includes(prefer)) {
          this._best = player;
          return;
        }
      }
    }

    for (let i = this.index; i < this.availables.length + this.index; i++) {
      const candidate = this.availables[i % this.availables.length];
      if (bans.every(ban => !candidate.includes(ban))) {
        this._best = candidate;
        return;
      }
    }

    if (!this._best) {
      console.warn(`WARNING: No suitable player found. Defaulting to ${this.availables[0]}`);
      this._best = this.availables[0];
    }
  }
}

class Languages {
  constructor(players, preferLanguages = []) {
    this.players = players;
    this.preferLanguages = preferLanguages;

    Object.keys(this.players).forEach(langId => {
      if (!this.players[langId].availables.length) {
        delete this.players[langId];
      }
    });

    if (Object.keys(this.players).length === 0) {
      console.warn('WARNING: No player available');
    }

    this.availables = {};
    for (const langId in this.players) {
      const lang = id2lang[langId];
      if (!this.availables[lang]) {
        this.availables[lang] = [];
      }
      this.availables[lang].push(this.players[langId]);
    }
  }

  get best() {
    for (const preferLanguage of this.preferLanguages) {
      if (this.availables[preferLanguage]) {
        for (const player of this.availables[preferLanguage]) {
          if (player.availables.length) {
            return player.best;
          }
        }
      }
    }

    for (const language in this.availables) {
      for (const player of this.availables[language]) {
        if (player.availables.length) {
          console.warn(`WARNING: Language preference not respected. Defaulting to ${language}`);
          return player.best;
        }
      }
    }

    return null;
  }

  setBest(...args) {
    for (const langId in this.players) {
      this.players[langId].setBest(...args);
    }
  }
}

class Episode {
  constructor(languages, serieName = "", seasonName = "", episodeName = "", index = 1) {
    this.languages = languages;
    this.serieName = serieName;
    this.seasonName = seasonName;
    this.episodeName = episodeName;
    this._index = index;

    this.name = this.episodeName;
    this.fancyName = this.name;

    for (const lang in this.languages.availables) {
      this.fancyName += ` ${flags[lang]}`;
    }

    this.index = this._index;

    const seasonNumberMatch = seasonName.match(/\d+/);
    this.seasonNumber = seasonNumberMatch ? parseInt(seasonNumberMatch[0]) : 0;

    this.longName = `${this.seasonName} - ${this.episodeName}`;
    this.shortName = `${this.serieName} S${this.seasonNumber.toString().padStart(2, '0')}E${this.index.toString().padStart(2, '0')}`;
  }

  get index() {
    return this._index;
  }

  set index(value) {
    this._index = value;
    for (const langId in this.languages.players) {
      this.languages.players[langId].index = this._index;
    }
  }

  toString() {
    return this.fancyName;
  }
}

class Season {
  constructor(url, name = "", serieName = "", client = null) {
    const normalizedUrl = url.endsWith('/') ? url : url + '/';
    this.pages = langIds.map(lang => normalizedUrl + lang + "/");
    this.siteUrl = url.split('/').slice(0, 3).join('/') + '/';

    this.name = name || url.split('/').slice(-2)[0];
    this.serieName = serieName || url.split('/').slice(-3)[0];

    this.client = client || deps.axiosAnimeSama;
  }

  async _getPlayersLinksFrom(page) {
    try {
      const episodesUrl = page + 'episodes.js';
      const episodesJsResponse = await deps.axiosAnimeSamaRequest({
        method: 'get',
        url: episodesUrl,
        timeout: 10000
      });

      if (episodesJsResponse.status !== 200) {
        return [];
      }

      const episodesJs = episodesJsResponse.data;

      if (typeof episodesJs === 'string' && (
        episodesJs.includes('<!doctype html>') ||
        episodesJs.includes('<!DOCTYPE html>') ||
        episodesJs.includes('<html') ||
        episodesJs.includes('Page introuvable') ||
        episodesJs.includes('Acces Introuvable')
      )) {
        return [];
      }

      if (typeof episodesJs !== 'string' || !episodesJs.includes('[')) {
        return [];
      }

      const playersList = episodesJs.split('[').slice(1);
      const playersListLinks = playersList.map(player => {
        const matches = player.match(/'(.+?)'/g);
        if (!matches) return [];

        const allLinks = matches.map(link => {
          let cleanLink = link.replace(/'/g, '');
          const proxyPrefix = 'https://proxy.liyao.space/------';
          if (cleanLink.startsWith(proxyPrefix)) {
            const stripped = cleanLink.substring(proxyPrefix.length);
            cleanLink = stripped.startsWith('http') ? stripped : cleanLink;
          }
          return cleanLink;
        });

        const validLinks = allLinks.filter(isValidPlayerUrl);
        return validLinks;
      });

      return zipVarlen(...playersListLinks);
    } catch (error) {
      if (!error.response || error.response.status !== 404) {
      }
      return [];
    }
  }

  async episodes(existingEpisodes = null) {
    const episodesPagesPromises = this.pages.map(page => this._getPlayersLinksFrom(page));
    const episodesPages = await Promise.all(episodesPagesPromises);
    const episodesInSeason = Math.max(...episodesPages.map(ep => ep.length));

    const padding = episodesInSeason.toString().length;
    const episodeNames = Array.from({ length: episodesInSeason }, (_, i) =>
      `Episode ${(i + 1).toString().padStart(padding, '0')}`
    );

    const episodeObjs = episodeNames.map((name, index) => {
      const playersLinks = episodesPages.map(pages => pages[index] || []);

      const languages = new Languages(
        Object.fromEntries(
          langIds.map((langId, i) => [langId, new Players(sortPlayersByQuality(playersLinks[i]))])
        )
      );
      return new Episode(languages, this.serieName, this.name, name, index + 1);
    });

    if (!existingEpisodes) {
      return episodeObjs.map(ep => ({
        name: ep.name,
        serie_name: ep.serieName,
        season_name: ep.seasonName,
        index: ep.index,
        streaming_links: Object.entries(ep.languages.players).map(([langId, players]) => ({
          language: langId,
          players: (Array.isArray(players.availables) ? players.availables : []).filter(isValidPlayerUrl)
        })).filter(link => link.players.length > 0)
      }));
    }

    return episodeObjs.map((ep, idx) => {
      const oldEp = existingEpisodes[idx];
      if (!oldEp) {
        return {
          name: ep.name,
          serie_name: ep.serieName,
          season_name: ep.seasonName,
          index: ep.index,
          streaming_links: Object.entries(ep.languages.players).map(([langId, players]) => ({
            language: langId,
            players: (Array.isArray(players.availables) ? players.availables : []).filter(isValidPlayerUrl)
          })).filter(link => link.players.length > 0)
        };
      }
      const oldLinks = oldEp.streaming_links || [];
      const newLinks = Object.entries(ep.languages.players).map(([langId, players]) => ({
        language: langId,
        players: (Array.isArray(players.availables) ? players.availables : []).filter(isValidPlayerUrl)
      }));
      const mergedLinks = deps.mergeStreamingLinks(oldLinks, newLinks);
      return {
        name: ep.name,
        serie_name: ep.serieName,
        season_name: ep.seasonName,
        index: ep.index,
        streaming_links: mergedLinks.filter(link => link.players && link.players.length > 0)
      };
    });
  }
}

class Catalogue {
  constructor(url, name = "", client = null, additionalData = null) {
    if (url.startsWith('/')) {
      this.url = deps.ANIME_SAMA_URL + url.substring(1);
    } else if (url.startsWith('http')) {
      try {
        const urlObj = new URL(url);
        let urlPath = urlObj.pathname;
        if (urlPath.startsWith('/')) urlPath = urlPath.substring(1);
        this.url = deps.ANIME_SAMA_URL + urlPath + urlObj.search;
      } catch (e) {
        console.error("Error parsing URL in Catalogue constructor:", url);
        this.url = url;
      }
    } else {
      this.url = url.endsWith('/') ? url : url + '/';
    }
    this.name = name || url.split('/').slice(-2)[0];
    this.siteUrl = url.split('/').slice(0, 3).join('/') + '/';
    this.client = client || deps.axiosAnimeSama;

    if (additionalData) {
      this.image = additionalData.image || '';
      this.alternative_names = additionalData.alternative_names || [];
      this.alternative_names_string = additionalData.alternative_names_string || '';
    } else {
      this.image = '';
      this.alternative_names = [];
      this.alternative_names_string = '';
    }
  }

  async seasons() {
    try {
      const response = await deps.axiosAnimeSamaRequest({
        method: 'get',
        url: this.url
      });
      const responseData = response.data;

      const seasonsMatches = responseData.match(/panneauAnime\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\);/g) || [];

      const seasons = [];
      for (const match of seasonsMatches) {
        const parts = match.match(/panneauAnime\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\);/);
        if (!parts) continue;
        const name = parts[1];
        let link = parts[2];

        link = link.replace(/(?:vostfr|vf|vcn|vosteng|vj)\/?$/i, '');

        if (name && link) {
          const urlParts = this.url.split('/');
          const animeNameFromUrl = urlParts[urlParts.length - 2] || urlParts[urlParts.length - 1];

          let normalizedLink = link;
          if (animeNameFromUrl && normalizedLink.startsWith(animeNameFromUrl)) {
            normalizedLink = normalizedLink.substring(animeNameFromUrl.length);
          }

          if (!normalizedLink.startsWith('/')) {
            normalizedLink = '/' + normalizedLink;
          }

          const baseUrl = this.url.endsWith('/') ? this.url.slice(0, -1) : this.url;
          const seasonUrl = baseUrl + normalizedLink;

          seasons.push(
            new Season(
              seasonUrl,
              name,
              this.name,
              this.client
            )
          );
        }
      }

      return seasons;
    } catch (error) {
      console.error(`Error getting seasons for ${this.name}:`, error.message);
      return [];
    }
  }
}

class AnimeSama {
  constructor(siteUrl) {
    this.siteUrl = siteUrl;
    this.client = deps.axiosAnimeSama;
  }

  async search(query, forceNoCache = false) {
    try {
      const cacheKey = 'search_' + generateCacheKey(query);
      if (!forceNoCache) {
        let cachedResults = await deps.getFromCacheNoExpiration(ANIME_SAMA_CACHE_DIR, cacheKey);
        if (cachedResults && !Array.isArray(cachedResults)) cachedResults = null;
        if (Array.isArray(cachedResults) && cachedResults.length > 0) {
          return cachedResults.map(result =>
            new Catalogue(result.url, result.name, this.client, result)
          );
        }
      }

      const requestUrl = `${this.siteUrl}template-php/defaut/fetch.php`;
      const requestData = `query=${encodeURIComponent(query)}`;
      const response = await deps.axiosAnimeSamaRequest({
        method: 'post',
        url: requestUrl,
        data: requestData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (response.status !== 200) {
        return [];
      }

      const results = this.parseSearchResults(response.data);

      await deps.saveToCache(ANIME_SAMA_CACHE_DIR, cacheKey, results);

      return results.map(result =>
        new Catalogue(result.url, result.name, this.client, result)
      );
    } catch (error) {
      console.error(`[AnimeSama] Search error for "${query}": ${error.message}`);
      return [];
    }
  }

  parseSearchResults(htmlData) {
    const results = [];

    try {
      if (typeof htmlData !== 'string') {
        return [];
      }

      const anchorRegex = /<a\b([^>]*\bclass="asn-search-result"[^>]*)>([\s\S]*?)<\/a>/gi;
      let match;
      let iterations = 0;

      while ((match = anchorRegex.exec(htmlData)) !== null) {
        iterations++;
        const attrs = match[1];
        const inner = match[2];

        const hrefMatch = attrs.match(/href="([^"]+)"/i);
        if (!hrefMatch) continue;
        const href = hrefMatch[1];

        if (!href.includes('/catalogue/')) continue;
        if (!/\/catalogue\/[a-zA-Z0-9][a-zA-Z0-9\-_.]+/.test(href)) continue;

        const imgMatch = inner.match(/<img\b[^>]*\bsrc="([^"]+)"/i);
        const imageUrl = imgMatch ? imgMatch[1] : '';

        const titleMatch = inner.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
        const mainTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        const subtitleMatch = inner.match(/<p\b[^>]*class="asn-search-result-subtitle"[^>]*>([\s\S]*?)<\/p>/i);
        const alternativeNames = subtitleMatch ? subtitleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        const altNamesArray = alternativeNames
          ? alternativeNames.split(',').map(name => name.trim()).filter(name => name.length > 0)
          : [];

        if (mainTitle) {
          results.push({
            url: href,
            name: mainTitle,
            image: imageUrl,
            alternative_names: altNamesArray,
            alternative_names_string: alternativeNames
          });
        }
      }

      return results;
    } catch (error) {
      console.error('[AnimeSama Parse] Error:', error.message);
      return [];
    }
  }
}

class EpisodeCache {
  constructor(cacheDir = ANIME_SAMA_CACHE_DIR, ttl = 3600) {
    this.cacheDir = cacheDir;
    this.ttl = ttl * 1000;
  }

  _getCachePath(serieName) {
    const safeSerie = safeFilename(serieName);
    return path.join(this.cacheDir, `${safeSerie}.json`);
  }

  async getAnimeData(serieName) {
    const cachePath = this._getCachePath(serieName);

    try {
      const fileContent = await fsp.readFile(cachePath, 'utf-8');
      const data = deps.normalizeAnimeSamaUrls(JSON.parse(fileContent));

      if (Date.now() - data.timestamp > this.ttl) {
        return null;
      }

      return data.seasons || {};
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading cache:', error);
      }
      return null;
    }
  }

  async getEpisodes(serieName, seasonName) {
    const animeData = await this.getAnimeData(serieName);
    if (!animeData) return null;

    const seasonData = animeData[seasonName];
    return seasonData ? seasonData.episodes : null;
  }

  async saveAnimeData(serieName, seasonsData) {
    const cachePath = this._getCachePath(serieName);

    const data = {
      timestamp: Date.now(),
      seasons: seasonsData
    };

    try {
      await writeFileAtomic(cachePath, JSON.stringify(data), 'utf-8');
      await memoryCache.set(`anime:${serieName}`, data);
    } catch (error) {
      console.error('Error saving cache:', error);
    }
  }

  async saveEpisodes(serieName, seasonName, episodesData) {
    let animeData = await this.getAnimeData(serieName) || {};

    animeData[seasonName] = {
      timestamp: Date.now(),
      episodes: episodesData
    };

    await this.saveAnimeData(serieName, animeData);
  }
}

router.get('/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const cacheKey = 'search_' + generateCacheKey(query);
    const animeCacheDir = ANIME_SAMA_CACHE_DIR;
    let cachedResults = await deps.getFromCacheNoExpiration(animeCacheDir, cacheKey);
    if (cachedResults && !Array.isArray(cachedResults)) cachedResults = null;
    let dataReturned = false;

    if (!cachedResults || !Array.isArray(cachedResults) || cachedResults.length === 0) {
      try {
        const client = new AnimeSama(deps.ANIME_SAMA_URL);
        const searchResults = await client.search(query, false);
        let serializedResults = searchResults.map(cat => ({
          url: cat.url,
          name: cat.name,
          image: cat.image,
          alternative_names: cat.alternative_names,
          alternative_names_string: cat.alternative_names_string
        }));

        if (serializedResults.length === 0) {
          try {
            const voirAnimeScraper = require('./voirAnimeScraper');
            const fallbackResults = await voirAnimeScraper.search(query);
            if (Array.isArray(fallbackResults) && fallbackResults.length > 0) {
              serializedResults = fallbackResults.map(cat => ({
                url: cat.url,
                name: cat.name,
                image: cat.image || '',
                alternative_names: [],
                alternative_names_string: ''
              }));
            }
          } catch (_) {}
        }

        if (serializedResults.length === 0) {
          const fallbackResults = await franimeScraper.search(query);
          serializedResults = fallbackResults.map(cat => ({
            url: cat.url,
            name: cat.name,
            image: cat.image || '',
            alternative_names: cat.alternative_names || [],
            alternative_names_string: cat.alternative_names_string || '',
            raw: cat.raw 
          }));
        }

        if (serializedResults.length > 0) {
          await deps.saveToCache(animeCacheDir, cacheKey, serializedResults);
        }
        cachedResults = serializedResults;
      } catch (err) {
        console.error('Erreur scraping Anime Sama:', err);
        return res.status(500).json({ error: 'Erreur lors de la recherche Anime Sama' });
      }
    }

    const allCacheFiles = await fsp.readdir(animeCacheDir).catch(() => []);

    const animesWithSeasons = await Promise.all(cachedResults.map(async (anime) => {
      const safeAnimeName = anime.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const animeFile = `${safeAnimeName}.json`;

      let saisons = [];

      if (allCacheFiles.includes(animeFile)) {
        try {
          const animeContent = await fsp.readFile(path.join(animeCacheDir, animeFile), 'utf-8');
          const animeCache = deps.normalizeAnimeSamaUrls(JSON.parse(animeContent));

          if (animeCache.seasons) {
            saisons = Object.entries(animeCache.seasons).map(([seasonName, seasonData]) => ({
              name: seasonName,
              episodes: seasonData.episodes || [],
              episodeCount: (seasonData.episodes || []).length,
              cacheFile: animeFile,
              timestamp: seasonData.timestamp || animeCache.timestamp || null
            }));
          }
        } catch (e) {
          console.error(`Error reading unified cache for ${anime.name}:`, e.message);
        }
      } else {
        const seasonFiles = allCacheFiles.filter(f => f.startsWith(safeAnimeName + '_') && f !== cacheKey + '.json');

        saisons = (await Promise.all(seasonFiles.map(async seasonFile => {
          try {
            const seasonContent = await fsp.readFile(path.join(animeCacheDir, seasonFile), 'utf-8');
            const seasonCache = deps.normalizeAnimeSamaUrls(JSON.parse(seasonContent));
            return {
              name: seasonFile.replace(safeAnimeName + '_', '').replace('.json', ''),
              episodes: seasonCache.episodes || [],
              episodeCount: (seasonCache.episodes || []).length,
              cacheFile: seasonFile,
              timestamp: seasonCache.timestamp || null
            };
          } catch (e) {
            return null;
          }
        }))).filter(Boolean);
      }

      const sortSeasons = (seasons) => {
        return seasons;
      };

      return {
        ...anime,
        seasons: sortSeasons(saisons)
      };
    }));

    const unwantedUrls = [
      'https://video.sibnet.ru/shell.php?videoid=',
      'https://vidmoly.biz/embed-.html',
      'https://sendvid.com/embed/',
      'https://vk.com/video_ext.php?oid=&hd=3'
    ];
    animesWithSeasons.forEach(anime => {
      if (anime.seasons && Array.isArray(anime.seasons)) {
        anime.seasons.forEach(season => {
          if (season.episodes && Array.isArray(season.episodes)) {
            season.episodes.forEach(ep => {
              if (ep.streaming_links && Array.isArray(ep.streaming_links)) {
                ep.streaming_links.forEach(linkObj => {
                  if (linkObj.players && Array.isArray(linkObj.players)) {
                    linkObj.players = linkObj.players.filter(url => !unwantedUrls.includes(url));
                  }
                });
              }
            });
            season.episodes = season.episodes.filter(ep =>
              Array.isArray(ep.streaming_links) &&
              ep.streaming_links.some(linkObj => Array.isArray(linkObj.players) && linkObj.players.length > 0)
            );
            season.episodeCount = season.episodes.length;
          }
        });

        anime.seasons = anime.seasons.filter(season =>
          Array.isArray(season.episodes) && season.episodes.length > 0
        );
      }
    });

    res.json(animesWithSeasons);
    dataReturned = true;

    (async () => {
      const client = new AnimeSama(deps.ANIME_SAMA_URL);

      for (const anime of animesWithSeasons) {
        if (!anime.url || !anime.name || (!anime.url.includes('/catalogue/') && !anime.url.includes('voir-anime.to/anime/') && !anime.url.includes('franime.fr/anime/') && !anime.url.includes('french-manga.net/'))) {
          continue;
        }

        const safeAnimeName = anime.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
        const animeCacheFile = `${safeAnimeName}.json`;
        const animeCachePath = path.join(animeCacheDir, animeCacheFile);

        if (anime.url.includes('voir-anime.to/anime/')) {
          try {
            
            let shouldSkip = false;
            try {
              const stats = await fsp.stat(animeCachePath);
              if (Date.now() - stats.mtime.getTime() < 1 * 60 * 60 * 1000) {
                shouldSkip = true;
              }
            } catch (e) {}
            if (shouldSkip) continue;

            
            const details = await voirAnimeScraper.getAnimeDetails(anime.url);
            if (!details) continue;

            const lang = anime.url.endsWith('-vf/') ? 'vf' : 'vostfr';

            const episodesData = [];
            for (const ep of details.episodes) {
              
              const players = await voirAnimeScraper.getEpisodePlayers(ep.url);
              episodesData.push({
                name: ep.name,
                serie_name: anime.name,
                season_name: 'Saison 1',
                index: ep.index,
                streaming_links: [
                  {
                    language: lang,
                    players: players.map(p => p.url)
                  }
                ]
              });
            }

            const unifiedCacheData = {
              timestamp: Date.now(),
              seasons: {
                'Saison 1': {
                  timestamp: Date.now(),
                  episodes: episodesData
                }
              }
            };
            await writeFileAtomic(animeCachePath, JSON.stringify(unifiedCacheData), 'utf-8');
            
          } catch (err) {
            console.error('[Scraper voir-anime.to] Error:', err.message);
          }
          continue; 
        }

        if (anime.url.includes('franime.fr/anime/')) {
          try {
            
            let shouldSkip = false;
            try {
              const stats = await fsp.stat(animeCachePath);
              if (Date.now() - stats.mtime.getTime() < 1 * 60 * 60 * 1000) {
                shouldSkip = true;
              }
            } catch (e) {}
            if (shouldSkip) continue;

            
            const animeId = anime.url.split('/').pop();
            const details = await franimeScraper.getAnimeDetails(animeId, anime.raw);
            if (!details) continue;

            const unifiedCacheData = {
              timestamp: Date.now(),
              seasons: details.seasons
            };
            await writeFileAtomic(animeCachePath, JSON.stringify(unifiedCacheData), 'utf-8');
            
          } catch (err) {
            console.error('[Scraper franime.fr] Error:', err.message);
          }
          continue; 
        }

        let catalogueObj = null;
        try {
          catalogueObj = new Catalogue(anime.url, anime.name, client.client, anime);
        } catch (e) {
          continue;
        }
        if (!catalogueObj) continue;

        let seasonsList = [];
        try {
          seasonsList = await catalogueObj.seasons();
        } catch (e) {
          continue;
        }

        let existingAnimeCache = {};
        try {
          const animeContent = await fsp.readFile(animeCachePath, 'utf-8');
          const animeData = JSON.parse(animeContent);
          existingAnimeCache = animeData.seasons || {};
        } catch (e) {
        }

        const RECENT_UPDATE_THRESHOLD = 1 * 60 * 60 * 1000;
        let shouldSkipAnime = false;
        try {
          const stats = await fsp.stat(animeCachePath);
          const timeSinceLastUpdate = Date.now() - stats.mtime.getTime();
          if (timeSinceLastUpdate < RECENT_UPDATE_THRESHOLD) {
            shouldSkipAnime = true;
          }
        } catch (e) {
        }

        if (shouldSkipAnime) continue;

        let animeDataUpdated = false;
        const updatedAnimeCache = { ...existingAnimeCache };

        for (const seasonObj of seasonsList) {
          const safeSeasonName = seasonObj.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
          let cachedEpisodes = null;
          let shouldUpdate = false;

          try {
            const seasonCache = existingAnimeCache[seasonObj.name];
            if (seasonCache && seasonCache.episodes) {
              cachedEpisodes = seasonCache.episodes;

              const scrapedEpisodes = await seasonObj.episodes(cachedEpisodes);

              const hasNewEpisodes = scrapedEpisodes.length > cachedEpisodes.length;
              const hasNewLang = scrapedEpisodes.some((ep, idx) => {
                const oldEp = cachedEpisodes[idx];
                if (!oldEp) return true;
                const oldLangs = (oldEp.streaming_links || []).map(l => l.language);
                const newLangs = (ep.streaming_links || []).map(l => l.language);
                return newLangs.some(l => !oldLangs.includes(l));
              });

              const hasNewPlayers = scrapedEpisodes.some((ep, idx) => {
                const oldEp = cachedEpisodes[idx];
                if (!oldEp) return false;

                return (ep.streaming_links || []).some(newLink => {
                  const oldLink = (oldEp.streaming_links || []).find(ol => ol.language === newLink.language);
                  if (!oldLink) return false;

                  const oldPlayers = Array.isArray(oldLink.players) ? oldLink.players : [];
                  const newPlayers = Array.isArray(newLink.players) ? newLink.players : [];
                  return newPlayers.length > oldPlayers.length ||
                    newPlayers.some(player => !oldPlayers.includes(player));
                });
              });

              if (hasNewEpisodes || hasNewLang || hasNewPlayers) {
                shouldUpdate = true;
                cachedEpisodes = scrapedEpisodes;
              }
            } else {
              shouldUpdate = true;
              cachedEpisodes = await seasonObj.episodes();
            }
          } catch (e) {
            shouldUpdate = true;
            cachedEpisodes = await seasonObj.episodes();
          }

          if (shouldUpdate) {
            try {
              const unwantedUrlsForCache = [
                'https://video.sibnet.ru/shell.php?videoid=',
                'https://vidmoly.biz/embed-.html',
                'https://sendvid.com/embed/',
                'https://vk.com/video_ext.php?oid=&hd=3'
              ];
              const episodesData = cachedEpisodes.map(episode => ({
                name: episode.name,
                serie_name: episode.serie_name || episode.serieName,
                season_name: episode.season_name || episode.seasonName,
                index: episode.index,
                streaming_links: (episode.streaming_links || []).map(linkObj => ({
                  language: linkObj.language,
                  players: Array.isArray(linkObj.players)
                    ? linkObj.players.filter(url => !unwantedUrlsForCache.includes(url))
                    : linkObj.players
                }))
              }));

              updatedAnimeCache[seasonObj.name] = {
                timestamp: Date.now(),
                episodes: episodesData
              };
              animeDataUpdated = true;

            } catch (e) {
              console.error(`Erreur lors du scraping de la saison ${seasonObj.name} (${anime.name}):`, e.message);
            }
          }
        }

        if (animeDataUpdated) {
          try {
            const unifiedCacheData = {
              timestamp: Date.now(),
              seasons: updatedAnimeCache
            };
            await writeFileAtomic(animeCachePath, JSON.stringify(unifiedCacheData), 'utf-8');

            await deps.cleanupOldCacheFiles(safeAnimeName, animeCacheDir);
          } catch (e) {
          }
        } else if (Object.keys(existingAnimeCache).length === 0) {
          await deps.migrateOldCacheFiles(safeAnimeName, animeCacheDir);
        }
      }
    })();

  } catch (error) {
    console.error('Erreur /anime/search/:query:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/scrape-now/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const animeCacheDir = ANIME_SAMA_CACHE_DIR;

    const client = new AnimeSama(deps.ANIME_SAMA_URL);
    let searchResults = await client.search(query, true);
    let isFallback = false;

    if (!searchResults || searchResults.length === 0) {
      
      const fallbackResults = await voirAnimeScraper.search(query);
      searchResults = fallbackResults.map(cat => ({
        url: cat.url,
        name: cat.name,
        image: cat.image || '',
        alternative_names: [],
        alternative_names_string: ''
      }));
      isFallback = true;
    }

    if (!searchResults || searchResults.length === 0) {
      
      const fallbackResults = await franimeScraper.search(query);
      searchResults = fallbackResults.map(cat => ({
        url: cat.url,
        name: cat.name,
        image: cat.image || '',
        alternative_names: cat.alternative_names || [],
        alternative_names_string: cat.alternative_names_string || '',
        raw: cat.raw
      }));
      isFallback = true;
    }

    if (!searchResults || searchResults.length === 0) {
      
      const fallbackResults = await frenchMangaScraper.search(query);
      searchResults = fallbackResults.map(cat => ({
        url: cat.url,
        name: cat.name,
        image: cat.image || '',
        alternative_names: [],
        alternative_names_string: ''
      }));
      isFallback = true;
    }

    if (!searchResults || searchResults.length === 0) return res.json([]);

    const anime = searchResults.find(r => r.name.toLowerCase() === query.toLowerCase()) || searchResults[0];

    if (anime.url.includes('voir-anime.to/anime/')) {
      
      const details = await voirAnimeScraper.getAnimeDetails(anime.url);
      if (!details) return res.json([]);

      const lang = anime.url.endsWith('-vf/') ? 'vf' : 'vostfr';
      const episodesData = [];
      for (const ep of details.episodes) {
        const players = await voirAnimeScraper.getEpisodePlayers(ep.url);
        episodesData.push({
          name: ep.name,
          serie_name: anime.name,
          season_name: 'Saison 1',
          index: ep.index,
          streaming_links: [
            {
              language: lang,
              players: players.map(p => p.url)
            }
          ]
        });
      }

      const safeAnimeName = anime.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const animeCachePath = path.join(animeCacheDir, `${safeAnimeName}.json`);
      const seasonsData = {
        'Saison 1': {
          timestamp: Date.now(),
          episodes: episodesData
        }
      };
      await writeFileAtomic(animeCachePath, JSON.stringify({ timestamp: Date.now(), seasons: seasonsData }), 'utf-8');

      const seasons = [
        {
          name: 'Saison 1',
          episodes: episodesData,
          episodeCount: episodesData.length
        }
      ];
      return res.json([{ url: anime.url, name: anime.name, image: details.image || anime.image, seasons }]);
    }

    if (anime.url.includes('franime.fr/anime/')) {
      
      const animeId = anime.url.split('/').pop();
      const details = await franimeScraper.getAnimeDetails(animeId, anime.raw);
      if (!details) return res.json([]);

      const safeAnimeName = anime.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const animeCachePath = path.join(animeCacheDir, `${safeAnimeName}.json`);
      await writeFileAtomic(animeCachePath, JSON.stringify({ timestamp: Date.now(), seasons: details.seasons }), 'utf-8');

      const seasons = Object.entries(details.seasons).map(([name, data]) => ({
        name,
        episodes: data.episodes || [],
        episodeCount: (data.episodes || []).length
      }));
      return res.json([{ url: anime.url, name: anime.name, image: details.image || anime.image, seasons }]);
    }

    const catalogueObj = new Catalogue(anime.url, anime.name, client.client, {
      image: anime.image,
      alternative_names: anime.alternative_names || [],
      alternative_names_string: anime.alternative_names_string || ''
    });

    const seasonsList = await catalogueObj.seasons();

    const seasonsData = {};
    await Promise.all(seasonsList.map(async (seasonObj) => {
      try {
        const episodes = await seasonObj.episodes();
        seasonsData[seasonObj.name] = { timestamp: Date.now(), episodes };
      } catch (e) {
        console.error(`[scrape-now] Erreur saison ${seasonObj.name}:`, e.message);
      }
    }));

    const safeAnimeName = anime.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
    const animeCachePath = path.join(animeCacheDir, `${safeAnimeName}.json`);
    await writeFileAtomic(animeCachePath, JSON.stringify({ timestamp: Date.now(), seasons: seasonsData }), 'utf-8');

    const saisons = Object.entries(seasonsData).map(([name, data]) => ({
      name,
      episodes: data.episodes || [],
      episodeCount: (data.episodes || []).length
    }));

    res.json([{ url: anime.url, name: anime.name, image: anime.image, seasons: saisons }]);
  } catch (err) {
    console.error('[scrape-now] Erreur:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/weekly', async (req, res) => {
  try {
    const response = await deps.axiosAnimeSamaRequest({
      method: 'get',
      url: deps.ANIME_SAMA_URL,
      timeout: 15000
    });

    if (response.status !== 200) return res.json({ animes: [], fetchedAt: Date.now() });

    const html = response.data;
    const animes = [];

    const DAY_NAMES = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const DAY_NUM   = {Dimanche:0,Lundi:1,Mardi:2,Mercredi:3,Jeudi:4,Vendredi:5,Samedi:6};
    const LANG_MAP  = { vostfr:'VOSTFR', vf:'VF', vcn:'VCN', vosteng:'VOSTEng', vj:'VJ' };

    const dayMarkers = [];
    const dayMarkerRe = new RegExp(
      `id="container(${DAY_NAMES.join('|')})"` +
      `|Sorties du (${DAY_NAMES.join('|')})`,
      'gi'
    );
    let dm;
    while ((dm = dayMarkerRe.exec(html)) !== null) {
      const dayName = dm[1] || dm[2];
      const norm    = dayName[0].toUpperCase() + dayName.slice(1).toLowerCase();
      const dayNum  = DAY_NUM[norm] ?? -1;
      if (dayNum >= 0) dayMarkers.push({ pos: dm.index, day: dayNum });
    }
    if (dayMarkers.length === 0) dayMarkers.push({ pos: 0, day: new Date().getDay() });

    const linkRegex = /href="([^"]*\/catalogue\/([^"\/]+)\/saison([^"\/]*)\/(vostfr|vf|vcn|vosteng|vj)[^"]*)"/gi;
    const seen = new Set();
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const slug    = match[2];
      const saison  = match[3];
      const langRaw = match[4];
      const key     = slug + '|' + langRaw;
      if (seen.has(key)) continue;
      seen.add(key);

      const marker = dayMarkers.filter(d => d.pos <= match.index).sort((a,b) => b.pos - a.pos)[0]
                  || dayMarkers[0];
      const day = marker.day;

      const closeTagPos = html.indexOf('>', match.index + match[0].length);
      const closeAPos   = html.indexOf('</a>', closeTagPos);
      const linkText = (closeTagPos >= 0)
        ? html.slice(closeTagPos + 1, closeAPos >= 0 ? closeAPos : closeTagPos + 400).trim()
        : '';

      const timeM = linkText.match(/(\d{1,2})h(\d{2})/i);
      const time  = timeM ? timeM[1].padStart(2,'0') + ':' + timeM[2] : null;

      const nameM = linkText.match(/(?:Anime|Film|Scan)\s+(?:VOSTFR|VF|VCN|VOSTEng|VJ)\s+(.+?)\s+(?:\d{1,2}h\d{2}|\?)/i);
      const name  = nameM
        ? nameM[1].trim().replace(/\s{2,}/g,' ')
        : slug.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());

      const epM     = linkText.match(/[Éé]pisode\s*(\d+)/i) || linkText.match(/\bEp\.?\s*(\d+)/i);
      const episode = epM ? parseInt(epM[1]) : null;

      const lang         = LANG_MAP[langRaw.toLowerCase()] || langRaw.toUpperCase();
      const seasonLabel  = saison ? `Saison ${saison}` : null;
      const image        = `https://raw.githubusercontent.com/Anime-Sama/IMG/img/catalogues/${slug}.jpg`;
      const url          = (deps.ANIME_SAMA_URL || '').replace(/\/$/, '') + '/catalogue/' + slug + '/';

      animes.push({ name, slug, image, url, day, time, episode, season: seasonLabel, lang });
    }

    animes.sort((a, b) => {
      if (a.day !== b.day) return a.day - b.day;
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });

    res.json({ animes: animes.slice(0, 100), fetchedAt: Date.now() });
  } catch (err) {
    console.error('[anime/weekly] Erreur:', err.message);
    res.json({ animes: [], fetchedAt: Date.now() });
  }
});

router.delete('/search/:query/cache', async (req, res) => {
  try {
    const { query } = req.params;
    const cacheKey = 'search_' + generateCacheKey(query);
    const animeCacheDir = ANIME_SAMA_CACHE_DIR;

    let deletedFiles = [];
    let errors = [];

    try {
      const searchCacheFile = path.join(animeCacheDir, `${cacheKey}.json`);
      await fsp.unlink(searchCacheFile);
      deletedFiles.push(`search cache: ${cacheKey}.json`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        errors.push(`Erreur suppression cache de recherche: ${err.message}`);
      }
    }

    try {
      const decodedQuery = decodeURIComponent(query);
      const safeAnimeName = decodedQuery.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim();
      const animeFile = path.join(animeCacheDir, `${safeAnimeName}.json`);

      try {
        await fsp.unlink(animeFile);
        deletedFiles.push(`unified cache: ${safeAnimeName}.json`);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          errors.push(`Erreur suppression cache unifie: ${err.message}`);
        }
      }

      const allCacheFiles = await fsp.readdir(animeCacheDir).catch(() => []);
      const oldSeasonFiles = allCacheFiles.filter(f =>
        f.startsWith(safeAnimeName + '_') && f.endsWith('.json')
      );

      for (const oldFile of oldSeasonFiles) {
        try {
          await fsp.unlink(path.join(animeCacheDir, oldFile));
          deletedFiles.push(`old season cache: ${oldFile}`);
        } catch (err) {
          errors.push(`Erreur suppression ancien cache ${oldFile}: ${err.message}`);
        }
      }
    } catch (err) {
      errors.push(`Erreur lors de la recherche des fichiers: ${err.message}`);
    }

    if (deletedFiles.length > 0) {
      return res.status(200).json({
        success: true,
        message: `Cache anime "${decodeURIComponent(query)}" supprime.`,
        deletedFiles,
        errors: errors.length > 0 ? errors : undefined
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'Aucun cache trouve pour cet anime.',
        errors: errors.length > 0 ? errors : undefined
      });
    }
  } catch (err) {
    console.error('Erreur suppression cache anime:', err);
    return res.status(500).json({ success: false, error: 'Erreur serveur.' });
  }
});

module.exports = router;
module.exports.configure = configure;