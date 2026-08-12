const axios = require('axios');
const fs = require('fs');
const path = require('path');

const STREAMFLIX_BASE = 'https://streamflix.mom';

const CACHE_DIR = path.join(__dirname, 'cache', 'streamflix');
const MOVIES_CACHE_FILE = path.join(CACHE_DIR, 'movies.json');
const SERIES_CACHE_FILE = path.join(CACHE_DIR, 'series.json');
const EPISODES_CACHE_FILE = path.join(CACHE_DIR, 'episodes.json');

let moviesCache = null;
let moviesCacheTime = 0;
let seriesCache = null;
let seriesCacheTime = 0;
const seriesEpisodesCache = new Map();
const movieVideoUrlCache = new Map();
const episodeVideoUrlCache = new Map();

const CACHE_DURATION = 12 * 60 * 60 * 1000;

if (!fs.existsSync(CACHE_DIR)) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (e) {}
}

try {
  if (fs.existsSync(MOVIES_CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(MOVIES_CACHE_FILE, 'utf8'));
    moviesCache = data.items || null;
    moviesCacheTime = data.timestamp || 0;
  }
} catch (e) {}

try {
  if (fs.existsSync(SERIES_CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(SERIES_CACHE_FILE, 'utf8'));
    seriesCache = data.items || null;
    seriesCacheTime = data.timestamp || 0;
  }
} catch (e) {}

try {
  if (fs.existsSync(EPISODES_CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(EPISODES_CACHE_FILE, 'utf8'));
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([k, v]) => {
        seriesEpisodesCache.set(parseInt(k), v);
      });
    }
  }
} catch (e) {}

function saveMoviesCache(items) {
  try {
    fs.writeFileSync(MOVIES_CACHE_FILE, JSON.stringify({ items, timestamp: Date.now() }), 'utf8');
  } catch (e) {}
}

function saveSeriesCache(items) {
  try {
    fs.writeFileSync(SERIES_CACHE_FILE, JSON.stringify({ items, timestamp: Date.now() }), 'utf8');
  } catch (e) {}
}

function saveEpisodesCache() {
  try {
    const obj = {};
    for (const [k, v] of seriesEpisodesCache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(EPISODES_CACHE_FILE, JSON.stringify(obj), 'utf8');
  } catch (e) {}
}

function getHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Origin': STREAMFLIX_BASE,
    'Referer': STREAMFLIX_BASE + '/',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'Sec-Ch-Ua': '"Not A(Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Connection': 'keep-alive'
  };
}

async function fetchAllPages(endpoint) {
  const headers = getHeaders();
  const allItems = [];
  try {
    const firstRes = await axios.get(`${STREAMFLIX_BASE}${endpoint}?page=1`, { headers, timeout: 12000 });
    if (!Array.isArray(firstRes.data)) return [];
    allItems.push(...firstRes.data);
    if (firstRes.data.length >= 48) {
      let page = 2;
      let hasMore = true;
      const batchSize = 5;
      while (hasMore && page <= 100) {
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
          const p = page + i;
          promises.push(
            axios.get(`${STREAMFLIX_BASE}${endpoint}?page=${p}`, { headers, timeout: 8000 })
              .then(res => ({ page: p, data: Array.isArray(res.data) ? res.data : [] }))
              .catch(() => ({ page: p, data: [] }))
          );
        }
        const results = await Promise.all(promises);
        results.sort((a, b) => a.page - b.page);
        let batchHasEmptyOrShortPage = false;
        for (const res of results) {
          if (res.data.length > 0) {
            allItems.push(...res.data);
          }
          if (res.data.length < 48) {
            batchHasEmptyOrShortPage = true;
          }
        }
        if (batchHasEmptyOrShortPage) {
          hasMore = false;
        } else {
          page += batchSize;
        }
      }
    }
  } catch (err) {}
  return allItems;
}

let isFetchingMovies = false;
let isFetchingSeries = false;

async function triggerMoviesFetch(force = false) {
  if (isFetchingMovies) return;
  const now = Date.now();
  if (!force && moviesCache && (now - moviesCacheTime < CACHE_DURATION)) {
    return;
  }
  isFetchingMovies = true;
  fetchAllPages('/api/movies').then(allMovies => {
    if (allMovies && allMovies.length > 0) {
      moviesCache = allMovies;
      moviesCacheTime = Date.now();
      saveMoviesCache(allMovies);
    }
    isFetchingMovies = false;
  }).catch(err => {
    isFetchingMovies = false;
  });
}

async function triggerSeriesFetch(force = false) {
  if (isFetchingSeries) return;
  const now = Date.now();
  if (!force && seriesCache && (now - seriesCacheTime < CACHE_DURATION)) {
    return;
  }
  isFetchingSeries = true;
  fetchAllPages('/api/series').then(allSeries => {
    if (allSeries && allSeries.length > 0) {
      seriesCache = allSeries;
      seriesCacheTime = Date.now();
      saveSeriesCache(allSeries);
    }
    isFetchingSeries = false;
  }).catch(err => {
    isFetchingSeries = false;
  });
}

const ongoingEpisodesFetch = new Set();
function triggerEpisodesFetch(dbId) {
  if (ongoingEpisodesFetch.has(dbId)) return;
  ongoingEpisodesFetch.add(dbId);
  const headers = getHeaders();
  axios.get(`${STREAMFLIX_BASE}/api/series/${dbId}/episode-videos`, { headers, timeout: 15000 })
    .then(res => {
      if (Array.isArray(res.data)) {
        seriesEpisodesCache.set(dbId, { data: res.data, time: Date.now() });
        saveEpisodesCache();
      }
      ongoingEpisodesFetch.delete(dbId);
    })
    .catch(err => {
      ongoingEpisodesFetch.delete(dbId);
    });
}

const failedEpisodesFetch = new Map();

async function fetchEpisodesSynchronous(dbId) {
  const lastFail = failedEpisodesFetch.get(dbId);
  if (lastFail && (Date.now() - lastFail < 5 * 60 * 1000)) {
    return [];
  }
  try {
    const headers = getHeaders();
    const res = await axios.get(`${STREAMFLIX_BASE}/api/series/${dbId}/episode-videos`, { headers, timeout: 4000 });
    if (Array.isArray(res.data)) {
      const entry = { data: res.data, time: Date.now() };
      seriesEpisodesCache.set(dbId, entry);
      saveEpisodesCache();
      return res.data;
    }
  } catch (err) {
    failedEpisodesFetch.set(dbId, Date.now());
  }
  return [];
}

function cleanTitleForMatch(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u200E\u200F\uFEFF]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function findBestItemMatch(items, id, title) {
  if (!Array.isArray(items)) return null;
  const numId = parseInt(id);
  if (!isNaN(numId) && numId > 0) {
    const foundByTmdb = items.find(m => parseInt(m.tmdb_id) === numId);
    if (foundByTmdb) return foundByTmdb;
  }
  if (!title) return null;
  const targetClean = cleanTitleForMatch(title);
  if (!targetClean) return null;
  const candidateItems = (!isNaN(numId) && numId > 0)
    ? items.filter(m => !m.tmdb_id || parseInt(m.tmdb_id) === numId)
    : items;
  let matched = candidateItems.find(m => {
    const t1 = cleanTitleForMatch(m.title || m.name);
    const t2 = cleanTitleForMatch(m.original_title || m.original_name);
    return (t1 && t1 === targetClean) || (t2 && t2 === targetClean);
  });
  if (matched) return matched;
  if (targetClean.length >= 4) {
    matched = candidateItems.find(m => {
      const t1 = cleanTitleForMatch(m.title || m.name);
      const t2 = cleanTitleForMatch(m.original_title || m.original_name);
      const isCloseLength1 = t1 && Math.abs(t1.length - targetClean.length) <= 3;
      const isCloseLength2 = t2 && Math.abs(t2.length - targetClean.length) <= 3;
      return (t1 && isCloseLength1 && (t1.includes(targetClean) || targetClean.includes(t1))) ||
             (t2 && isCloseLength2 && (t2.includes(targetClean) || targetClean.includes(t2)));
    });
    if (matched) return matched;
  }
  return null;
}

async function scrapeMovie(tmdbId, title = null, isBackground = false) {
  try {
    const id = parseInt(tmdbId);
    let moviesList = null;
    if (!moviesCache) {
      moviesCache = await fetchAllPages('/api/movies');
      moviesCacheTime = Date.now();
      if (moviesCache && moviesCache.length > 0) saveMoviesCache(moviesCache);
    } else {
      triggerMoviesFetch();
    }
    moviesList = moviesCache;
    if (!Array.isArray(moviesList)) return null;
    let movie = findBestItemMatch(moviesList, id, title);
    if (!movie || movie.is_active === false) {
      return null;
    }
    const cachedUrlObj = movieVideoUrlCache.get(movie.id);
    if (cachedUrlObj && cachedUrlObj.expiresAt > Date.now()) {
      return {
        url: cachedUrlObj.url,
        quality: movie.video_quality || 'HD',
        name: 'Lecteur Direct 🎬',
        type: 'direct',
        version: 'VF'
      };
    }
    try {
      const headers = getHeaders();
      const activeTimeout = isBackground ? 15000 : 12000;
      const urlRes = await axios.get(`${STREAMFLIX_BASE}/api/movies/${movie.id}/video-url`, { headers, timeout: activeTimeout });
      if (urlRes.data && urlRes.data.url) {
        const mp4Url = urlRes.data.url;
        const lower = mp4Url.toLowerCase();
        movieVideoUrlCache.set(movie.id, {
          url: mp4Url,
          expiresAt: Date.now() + 60 * 60 * 1000
        });
        return {
          url: mp4Url,
          quality: movie.video_quality || 'HD',
          name: 'Lecteur Direct 🎬',
          type: 'direct',
          version: 'VF'
        };
      }
    } catch (urlErr) {}
    return null;
  } catch (err) {
    return null;
  }
}

async function scrapeSeries(tmdbId, season, episode, title = null, isBackground = false) {
  try {
    const id = parseInt(tmdbId);
    let sNum = parseInt(season);
    if (isNaN(sNum) && typeof season === 'string') {
      const match = season.match(/(\d+)/);
      if (match) sNum = parseInt(match[1]);
    }
    const epNum = parseInt(episode);
    if (isNaN(sNum) || isNaN(epNum)) {
      return null;
    }
    const now = Date.now();
    let seriesList = null;
    if (!seriesCache) {
      seriesCache = await fetchAllPages('/api/series');
      seriesCacheTime = Date.now();
      if (seriesCache && seriesCache.length > 0) saveSeriesCache(seriesCache);
    } else {
      triggerSeriesFetch();
    }
    seriesList = seriesCache;
    if (!Array.isArray(seriesList)) return null;
    let serie = findBestItemMatch(seriesList, id, title);
    if (!serie || serie.is_active === false) {
      return null;
    }
    const dbId = serie.id;
    let episodesList = null;
    const cachedEpObj = seriesEpisodesCache.get(dbId);
    if (cachedEpObj) {
      episodesList = cachedEpObj.data;
      if (now - cachedEpObj.time >= CACHE_DURATION) {
        triggerEpisodesFetch(dbId);
      }
    } else {
      episodesList = await fetchEpisodesSynchronous(dbId);
    }
    if (!Array.isArray(episodesList)) return null;
    const epVideo = episodesList.find(v => {
      const vSeason = parseInt(v.season_number ?? v.season);
      const vEpisode = parseInt(v.episode_number ?? v.episode);
      const isActive = v.is_active !== false;
      return vSeason === sNum && vEpisode === epNum && isActive;
    });
    if (!epVideo) {
      return await fallbackDirectSeriesStream(serie, sNum, epNum, title);
    }
    const epKey = `${serie.id}_${sNum}_${epNum}`;
    const cachedEpUrlObj = episodeVideoUrlCache.get(epKey);
    if (cachedEpUrlObj && cachedEpUrlObj.expiresAt > Date.now()) {
      return {
        url: cachedEpUrlObj.url,
        quality: epVideo.video_quality || 'HD',
        name: 'Lecteur Direct 🎬',
        type: 'direct',
        version: cachedEpUrlObj.version,
        subtitle: epVideo.subtitle_url || null
      };
    }
    try {
      const headers = getHeaders();
      const activeTimeout = 8000;
      const urlRes = await axios.get(
        `${STREAMFLIX_BASE}/api/series/${serie.id}/season/${sNum}/episode/${epNum}/video-url`,
        { headers, timeout: activeTimeout }
      );
      if (urlRes.data && urlRes.data.url) {
        let audioLang = 'VF';
        if (urlRes.data.url.toUpperCase().includes('/VOSTFR/')) {
          audioLang = 'VOSTFR';
        } else if (urlRes.data.url.toUpperCase().includes('/VO/')) {
          audioLang = 'VO';
        }
        episodeVideoUrlCache.set(epKey, {
          url: urlRes.data.url,
          version: audioLang,
          expiresAt: Date.now() + 60 * 60 * 1000
        });
        return {
          url: urlRes.data.url,
          quality: epVideo.video_quality || 'HD',
          name: 'Lecteur Direct 🎬',
          type: 'direct',
          version: audioLang,
          subtitle: epVideo.subtitle_url || null
        };
      }
    } catch (urlErr) {}
    return await fallbackDirectSeriesStream(serie, sNum, epNum, title);
  } catch (err) {
    return null;
  }
}

async function fallbackDirectSeriesStream(serie, sNum, epNum, title) {
  try {
    const sPad = String(sNum).padStart(2, '0');
    const ePad = String(epNum).padStart(2, '0');
    const rawTitle = (serie && (serie.title || serie.name)) ? (serie.title || serie.name) : (title || 'Flash');
    const folderName = rawTitle.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const slugName = folderName.toLowerCase();

    const candidateUrls = [
      `https://french.deliciouss.lol/series/VF/${folderName}/S${sPad}/${slugName}-S${sPad}-E${ePad}.mp4`,
      `https://french.deliciouss.lol/series/VF/${folderName}/S${sPad}/${folderName}-S${sPad}-E${ePad}.mp4`,
      `https://french.deliciouss.lol/series/VF/${folderName}/S${sPad}/S${sPad}E${ePad}.mp4`
    ];

    const cleanHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };

    for (const cUrl of candidateUrls) {
      try {
        const checkRes = await axios.head(cUrl, { headers: cleanHeaders, timeout: 3500 });
        if (checkRes.status === 200) {
          return {
            url: cUrl,
            quality: 'HD',
            name: 'Lecteur Direct 🎬',
            type: 'direct',
            version: 'VF',
            subtitle: null
          };
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

setTimeout(() => {
  triggerMoviesFetch();
  triggerSeriesFetch();
}, 2000).unref();

module.exports = {
  scrapeMovie,
  scrapeSeries
};
