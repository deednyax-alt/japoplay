const express = require('express');
const path = require('path');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const cors = require('cors');
const cheerio = require('cheerio');

const streamflixScraper = require('./streamflixScraper');
const franimeScraper = require('./franimeScraper');
const xonaflixTvScraper = require('./xonaflixTvScraper');

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = 'bb2e5245598612d09a7065d3b6d2e59a';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: 'japoplay_black_white_secret_key_2026',
  resave: false,
  saveUninitialized: true
}));
app.use(express.static(path.join(__dirname, 'public')));

// --- Real-time Active Visitors Counter ---
const activeVisitorsMap = new Map();

function trackVisitorMiddleware(req, res, next) {
  const p = req.path;
  const isStatic = p.startsWith('/css') || p.startsWith('/js') || p.startsWith('/images') || p === '/favicon.ico';

  let vid = req.cookies ? req.cookies.japoplay_visitor_id : null;
  if (!vid && !isStatic) {
    vid = 'v_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
    res.cookie('japoplay_visitor_id', vid, { maxAge: 30 * 86400 * 1000, httpOnly: false, path: '/' });
  }

  if (vid) {
    activeVisitorsMap.set(vid, Date.now());
  }
  next();
}

app.use(trackVisitorMiddleware);

function getActiveVisitorsCount() {
  const cutoff = Date.now() - 45000;
  for (const [vid, lastSeen] of activeVisitorsMap.entries()) {
    if (lastSeen < cutoff) {
      activeVisitorsMap.delete(vid);
    }
  }
  return Math.max(1, activeVisitorsMap.size);
}

app.get('/api/online-count', (req, res) => {
  res.json({ count: getActiveVisitorsCount() });
});

app.get('/api/online-count/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const sendCount = () => {
    const data = JSON.stringify({ count: getActiveVisitorsCount() });
    res.write(`data: ${data}\n\n`);
  };

  sendCount();
  const interval = setInterval(sendCount, 3000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

const appConfig = {
  maintenanceMode: false,
  maintenanceMessage: "JapoPlay est actuellement en maintenance programmée pour l'ajout de nouveaux contenus HD et l'amélioration des serveurs. Nous revenons très vite !",
  featuredHeroId: "969681",
  announcementText: "",
  adminPin: "1234"
};

function maintenanceMiddleware(req, res, next) {
  const p = req.path;

  // URL query parameter shortcut: ?maintenance=on or ?maintenance=off
  if (req.query && req.query.maintenance !== undefined) {
    const val = String(req.query.maintenance).toLowerCase();
    if (val === 'on' || val === 'true' || val === '1') {
      appConfig.maintenanceMode = true;
    } else if (val === 'off' || val === 'false' || val === '0') {
      appConfig.maintenanceMode = false;
    }
  }

  if (p.startsWith('/admin') || p.startsWith('/css') || p.startsWith('/js') || p.startsWith('/images') || p === '/favicon.ico' || p.startsWith('/api/online-count') || p === '/bot-check') {
    return next();
  }

  const isAdmin = (req.session && req.session.isAdmin) || (req.cookies && req.cookies.japoplay_admin_auth === 'true');
  if (appConfig.maintenanceMode && !isAdmin) {
    return res.status(530).render('maintenance', {
      message: appConfig.maintenanceMessage
    });
  }

  next();
}

app.use(maintenanceMiddleware);

const SEVEN_HOURS_MS = 7 * 3600 * 1000;
const rateLimitMap = new Map();

function botProtectionMiddleware(req, res, next) {
  const p = req.path;
  if (p.startsWith('/admin') || p === '/bot-check' || p.startsWith('/css') || p.startsWith('/js') || p.startsWith('/images') || p.startsWith('/api/online-count') || p === '/favicon.ico') {
    return next();
  }

  const token = req.cookies.japoplay_sec_token;
  const tokenTime = parseInt(req.cookies.japoplay_sec_token_time || '0');
  const now = Date.now();

  const isTokenValid = token && tokenTime && (now - tokenTime < SEVEN_HOURS_MS);

  if (!isTokenValid) {
    return res.redirect(`/bot-check?returnUrl=${encodeURIComponent(req.originalUrl)}`);
  }

  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const knownBots = ['python', 'curl', 'wget', 'scrapy', 'puppeteer', 'selenium', 'phantomjs', 'headlesschrome', 'gocurl', 'java/'];
  const isBotUserAgent = knownBots.some(bot => ua.includes(bot));

  if (isBotUserAgent) {
    return res.redirect(`/bot-check?returnUrl=${encodeURIComponent(req.originalUrl)}`);
  }

  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  let clientData = rateLimitMap.get(ip) || { count: 0, resetTime: now + 10000 };

  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + 10000;
  } else {
    clientData.count += 1;
  }

  rateLimitMap.set(ip, clientData);

  if (clientData.count > 60) {
    return res.redirect(`/bot-check?returnUrl=${encodeURIComponent(req.originalUrl)}`);
  }

  next();
}

app.use(botProtectionMiddleware);

async function tmdbFetch(endpoint, params = {}) {
  try {
    const res = await axios.get(`${TMDB_BASE_URL}${endpoint}`, {
      params: {
        api_key: TMDB_API_KEY,
        language: 'fr-FR',
        ...params
      },
      timeout: 8000
    });
    return res.data;
  } catch (err) {
    return null;
  }
}

function isAdultContent(item) {
  if (!item) return false;
  if (item.adult) return true;
  const name = (item.name || item.title || '').toLowerCase();
  const originalName = (item.original_name || item.original_title || '').toLowerCase();
  const overview = (item.overview || '').toLowerCase();

  const badWords = [
    'hentai', 'ecchi', 'erotic', 'pegi 18', 'adult', 'h-anime', 'h-series',
    'uncensored', 'non-censuré', 'sexe', 'porn', 'r-18', 'r18', 'téton', 'teton',
    'caresser les', 'secret mission', 'overflow', 'sazanami', 'souryo', 'majiwaru',
    'shikiyoku', 'sennyuu', 'shojo o sasagu', 'hibernant', 'sex', 'ero', 'succubus',
    'comicfesta', 'animefesta', 'joshiochi', 'omiai', 'yury', 'yaoi', 'kurogami',
    'sweet punishment', 'fireman', 'asore', 'onkyou'
  ];

  return badWords.some(w => name.includes(w) || originalName.includes(w) || overview.includes(w));
}

app.use('/api/proxy/api', async (req, res) => {
  let targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL manquante' });
  if (targetUrl.includes('%252F')) {
    targetUrl = targetUrl.replace(/%252F/g, '%2F');
  }

  try {
    const origin = new URL(targetUrl).origin;
    const isTvProxy = targetUrl.includes('tv_proxy.php');
    
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': isTvProxy ? 'https://northlive.lol/' : origin + '/',
      'Content-Type': req.headers['content-type'] || 'application/json'
    };

    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie;
    }
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    } else if (targetUrl.includes('api_key=')) {
      const match = targetUrl.match(/api_key=([^&]+)/);
      if (match) {
        headers['Authorization'] = 'Bearer ' + decodeURIComponent(match[1]);
      }
    }

    const axiosOpts = {
      method: req.method,
      url: targetUrl,
      headers: headers,
      data: req.body,
      timeout: 15000
    };

    if (isTvProxy || targetUrl.includes('.m3u8') || targetUrl.includes('.ts')) {
      axiosOpts.responseType = 'arraybuffer';
    }

    const response = await axios(axiosOpts);

    if (response.headers['set-cookie']) {
      res.set('set-cookie', response.headers['set-cookie']);
    }

    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');

    if (response.headers['content-type']) {
      res.set('Content-Type', response.headers['content-type']);
    }

    if (isTvProxy || targetUrl.includes('.m3u8') || targetUrl.includes('.ts')) {
      res.status(response.status).send(Buffer.from(response.data));
    } else if (typeof response.data === 'object') {
      res.status(response.status).json(response.data);
    } else {
      res.status(response.status).send(response.data);
    }
  } catch (err) {
    res.set('Access-Control-Allow-Origin', '*');
    res.status(200).json({ ok: true });
  }
});

const handleEmbedProxy = async (req, res) => {
  let targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL manquante');
  if (targetUrl.includes('%252F')) {
    targetUrl = targetUrl.replace(/%252F/g, '%2F');
  }

  try {
    let origin = new URL(targetUrl).origin;
    let reqReferer = origin + '/';
    if (targetUrl.includes('fsvid') || targetUrl.includes('french-stream') || targetUrl.includes('fs16') || targetUrl.includes('vidzy')) {
      reqReferer = 'https://fs16.lol/';
    }

    let response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': reqReferer
      },
      responseType: 'text',
      timeout: 10000
    });

    let html = response.data;
    const $ = cheerio.load(html);
    const innerIframeSrc = $('iframe').attr('src');

    if (innerIframeSrc && (innerIframeSrc.includes('northlive.lol') || innerIframeSrc.includes('player'))) {
      targetUrl = innerIframeSrc;
      if (targetUrl.includes('%252F')) {
        targetUrl = targetUrl.replace(/%252F/g, '%2F');
      }
      origin = new URL(targetUrl).origin;
      const innerRes = await axios.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Referer': 'https://northlive.lol/'
        },
        responseType: 'text',
        timeout: 10000
      });
      response = innerRes;
      html = innerRes.data;
    }

    if (response.headers['set-cookie']) {
      res.set('set-cookie', response.headers['set-cookie']);
    }

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.set('Content-Type', 'text/html');

    html = html.replace(/https:\/\/northlive\.lol\/api\/tv_referer_beacon\.php/g, '');
    html = html.replace(/https:\/\/fsvid\.lol\/blocked\.html/g, 'about:blank');
    html = html.replace(/window\.location\.href\s*=\s*['"][^'"]*blocked\.html['"]/g, 'console.log("blocked_prevented")');
    html = html.replace(/indexOf\(['"]\/proxy\/['"]\)/g, 'indexOf("___never_match___")');
    html = html.replace(/indexOf\(['"]proxy\.movix\.site['"]\)/g, 'indexOf("___never_match___")');
    html = html.replace(/throw new Error\(['"]Proxy détecté['"]\)/g, '');
    html = html.replace(/throw new Error\(['"]Ressource proxy détectée['"]\)/g, '');
    html = html.replace(/throw new Error\(['"]Script proxy détecté['"]\)/g, '');
    html = html.replace(/window\.parent\.location\.href/g, 'window.location.href');

    const metaNoReferrer = `<meta name="referrer" content="no-referrer">`;

    const adBlockScript = `
      <script>
        (function() {
          window.open = function() { return null; };
          window.STEP_URLS = [];
          window.smartlinkEnabled = false;
          window.prerollActive = false;
          if (navigator) {
            navigator.sendBeacon = function() { return true; };
          }
          
          const localProxyApi = window.location.origin + '/api/proxy/api?url=';

          function parseUrlString(input) {
            if (!input) return '';
            if (typeof input === 'string') return input;
            if (input.href) return input.href;
            if (input.url) return input.url;
            return String(input);
          }

          const origFetch = window.fetch;
          window.fetch = function(input, options) {
            let urlStr = parseUrlString(input);
            if (urlStr) {
              if (urlStr.includes('effectivecpmnetwork') || urlStr.includes('northseize') || urlStr.includes('beacon') || urlStr.includes('pop')) {
                return Promise.resolve(new Response(JSON.stringify({ ok: true })));
              }
              if (urlStr.includes('northlive.lol') || urlStr.includes('tv_proxy') || urlStr.includes('stream_auth') || urlStr.includes('route=')) {
                let fullUrl = urlStr;
                if (!urlStr.startsWith('http')) {
                  fullUrl = 'https://northlive.lol' + (urlStr.startsWith('/') ? urlStr : '/' + urlStr);
                }
                const proxied = localProxyApi + encodeURIComponent(fullUrl);
                return origFetch(proxied, options);
              }
            }
            return origFetch(input, options);
          };

          const origXHR = window.XMLHttpRequest.prototype.open;
          window.XMLHttpRequest.prototype.open = function(method, input, ...args) {
            let urlStr = parseUrlString(input);
            if (urlStr) {
              if (urlStr.includes('effectivecpmnetwork') || urlStr.includes('northseize') || urlStr.includes('beacon')) {
                input = 'about:blank';
              } else if (urlStr.includes('northlive.lol') || urlStr.includes('tv_proxy') || urlStr.includes('stream_auth') || urlStr.includes('route=')) {
                let fullUrl = urlStr;
                if (!urlStr.startsWith('http')) {
                  fullUrl = 'https://northlive.lol' + (urlStr.startsWith('/') ? urlStr : '/' + urlStr);
                }
                input = localProxyApi + encodeURIComponent(fullUrl);
              }
            }
            return origXHR.call(this, method, input, ...args);
          };
        })();
      </script>
    `;

    const baseHref = `<base href="${origin}/">`;
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${metaNoReferrer}${baseHref}${adBlockScript}`);
    } else {
      html = metaNoReferrer + baseHref + adBlockScript + html;
    }

    res.send(html);
  } catch (err) {
    res.status(500).send('Erreur lors du proxying de la vidéo');
  }
};

app.get('/api/proxy/embed', handleEmbedProxy);
app.get('/api/vstream/embed', handleEmbedProxy);

app.get('/api/proxy/stream', async (req, res) => {
  const streamUrl = req.query.url;
  if (!streamUrl) return res.status(400).send('Stream URL manquante');

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://streamflix.mom/'
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await axios.get(streamUrl, {
      headers,
      responseType: 'stream',
      timeout: 15000
    });

    if (response.headers['content-type']) res.set('Content-Type', response.headers['content-type']);
    if (response.headers['content-length']) res.set('Content-Length', response.headers['content-length']);
    if (response.headers['accept-ranges']) res.set('Accept-Ranges', response.headers['accept-ranges']);
    if (response.headers['content-range']) res.set('Content-Range', response.headers['content-range']);

    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    res.status(500).send('Erreur lors de la lecture du flux vidéo');
  }
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/bot-check', (req, res) => {
  res.render('bot-check');
});

app.get('/', (req, res) => {
  res.render('profiles');
});

app.get('/profiles', (req, res) => {
  res.render('profiles');
});

app.get('/admin', (req, res) => {
  const isAdmin = (req.session && req.session.isAdmin) || (req.cookies && req.cookies.japoplay_admin_auth === 'true');
  res.render('admin', {
    isAdmin,
    config: appConfig,
    activeVisitors: getActiveVisitorsCount(),
    error: req.query.error || null,
    success: req.query.success || null
  });
});

app.post('/admin/login', (req, res) => {
  const { pin } = req.body;
  if (pin === appConfig.adminPin) {
    req.session.isAdmin = true;
    res.cookie('japoplay_admin_auth', 'true', { maxAge: 7 * 86400 * 1000, httpOnly: false });
    return res.redirect('/admin?success=Connexion+reussie');
  }
  return res.redirect('/admin?error=Code+PIN+incorrect');
});

app.post('/admin/logout', (req, res) => {
  if (req.session) req.session.isAdmin = false;
  res.clearCookie('japoplay_admin_auth');
  res.redirect('/home');
});

app.post('/admin/toggle-maintenance', (req, res) => {
  const isAdmin = (req.session && req.session.isAdmin) || (req.cookies && req.cookies.japoplay_admin_auth === 'true');
  if (!isAdmin) return res.status(403).send('Accès refusé');

  appConfig.maintenanceMode = (req.body.maintenanceMode === 'true' || req.body.maintenanceMode === 'on');
  if (req.body.maintenanceMessage) {
    appConfig.maintenanceMessage = req.body.maintenanceMessage.trim();
  }
  res.redirect('/admin?success=Mode+maintenance+mis+a+jour');
});

app.post('/admin/update-config', (req, res) => {
  const isAdmin = (req.session && req.session.isAdmin) || (req.cookies && req.cookies.japoplay_admin_auth === 'true');
  if (!isAdmin) return res.status(403).send('Accès refusé');

  if (req.body.featuredHeroId) {
    appConfig.featuredHeroId = req.body.featuredHeroId.trim();
  }
  if (req.body.announcementText !== undefined) {
    appConfig.announcementText = req.body.announcementText.trim();
  }
  if (req.body.newPin && req.body.newPin.trim().length >= 4) {
    appConfig.adminPin = req.body.newPin.trim();
  }

  res.redirect('/admin?success=Configuration+mise+a+jour');
});

app.get('/home', async (req, res) => {
  const targetHeroId = req.query.hero || appConfig.featuredHeroId || '969681';
  const [trendingMovies, popularSeries, topRated, upcoming, featuredMovie, defaultBrandNewDay] = await Promise.all([
    tmdbFetch('/trending/movie/week'),
    tmdbFetch('/discover/tv', { without_genres: '16', sort_by: 'popularity.desc' }),
    tmdbFetch('/movie/top_rated'),
    tmdbFetch('/movie/upcoming'),
    tmdbFetch('/movie/' + targetHeroId),
    tmdbFetch('/movie/969681')
  ]);

  if (defaultBrandNewDay) {
    if (!defaultBrandNewDay.poster_path || defaultBrandNewDay.poster_path === '/jjCCZcCtggGjKik2gXjyux1VEdZ.jpg') {
      defaultBrandNewDay.poster_path = '/3BVng0lmJyYIUqm5dxLS2eZ2625.jpg';
    }
  }

  const heroItem = (featuredMovie && featuredMovie.title)
    ? featuredMovie
    : (defaultBrandNewDay || (trendingMovies && trendingMovies.results ? trendingMovies.results[0] : null));

  let movieResults = trendingMovies ? trendingMovies.results.filter(m => !isAdultContent(m)) : [];
  if (defaultBrandNewDay && defaultBrandNewDay.id) {
    movieResults = movieResults.filter(m => m.id !== defaultBrandNewDay.id);
    movieResults.unshift(defaultBrandNewDay);
  }

  res.render('index', {
    hero: heroItem,
    announcement: appConfig.announcementText,
    trendingMovies: movieResults.slice(0, 14),
    popularSeries: popularSeries ? popularSeries.results.filter(s => !isAdultContent(s)).slice(0, 14) : [],
    topRated: topRated ? topRated.results.filter(m => !isAdultContent(m)).slice(0, 14) : [],
    upcoming: upcoming ? upcoming.results.filter(m => !isAdultContent(m)).slice(0, 14) : []
  });
});

app.get('/movies', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const [data, brandNewDay] = await Promise.all([
    tmdbFetch('/discover/movie', { page, sort_by: 'popularity.desc', include_adult: false }),
    page === 1 ? tmdbFetch('/movie/969681') : null
  ]);

  if (brandNewDay) {
    if (!brandNewDay.poster_path || brandNewDay.poster_path === '/jjCCZcCtggGjKik2gXjyux1VEdZ.jpg') {
      brandNewDay.poster_path = '/3BVng0lmJyYIUqm5dxLS2eZ2625.jpg';
    }
  }

  let movies = data && data.results ? data.results.filter(m => !isAdultContent(m)) : [];
  if (brandNewDay && brandNewDay.id && page === 1) {
    movies = movies.filter(m => m.id !== brandNewDay.id);
    movies.unshift(brandNewDay);
  }
  const totalPages = data && data.total_pages ? Math.min(data.total_pages, 500) : 1;

  res.render('movies', { movies, page, totalPages });
});

app.get('/series', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const data = await tmdbFetch('/discover/tv', { page, sort_by: 'popularity.desc', without_genres: '16', include_adult: false });
  const series = data && data.results ? data.results.filter(s => !isAdultContent(s)) : [];
  const totalPages = data && data.total_pages ? Math.min(data.total_pages, 500) : 1;

  res.render('series', { series, page, totalPages });
});

app.get('/movie/:id', async (req, res) => {
  const movieId = req.params.id;
  const [movie, credits, similar, videos] = await Promise.all([
    tmdbFetch(`/movie/${movieId}`),
    tmdbFetch(`/movie/${movieId}/credits`),
    tmdbFetch(`/movie/${movieId}/similar`),
    tmdbFetch(`/movie/${movieId}/videos`)
  ]);

  if (!movie) return res.redirect('/home');

  const trailer = videos && videos.results ? videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube') : null;

  res.render('details', {
    type: 'movie',
    item: movie,
    cast: credits ? credits.cast.slice(0, 10) : [],
    similar: similar ? similar.results.slice(0, 10) : [],
    trailer: trailer ? trailer.key : null
  });
});

app.get('/series/:id', async (req, res) => {
  const seriesId = req.params.id;
  const [series, credits, similar, videos] = await Promise.all([
    tmdbFetch(`/tv/${seriesId}`),
    tmdbFetch(`/tv/${seriesId}/credits`),
    tmdbFetch(`/tv/${seriesId}/similar`),
    tmdbFetch(`/tv/${seriesId}/videos`)
  ]);

  if (!series) return res.redirect('/home');

  const trailer = videos && videos.results ? videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube') : null;

  res.render('details', {
    type: 'series',
    item: series,
    cast: credits ? credits.cast.slice(0, 10) : [],
    similar: similar ? similar.results.slice(0, 10) : [],
    trailer: trailer ? trailer.key : null
  });
});

app.get('/api/series/:id/season/:seasonNum', async (req, res) => {
  const sNum = parseInt(req.params.seasonNum) || 1;
  const seriesId = req.params.id;
  const seasonData = await tmdbFetch(`/tv/${seriesId}/season/${sNum}`);
  let episodes = seasonData && seasonData.episodes ? [...seasonData.episodes] : [];

  // Guarantee Episode 24 is listed for Flash Season 1
  if ((seriesId === '60735' || seriesId === 60735) && sNum === 1) {
    if (!episodes.some(e => e.episode_number === 24)) {
      episodes.push({
        episode_number: 24,
        name: "Épisode 24 (Spécial / VF)",
        overview: "Épisode 24 de Flash."
      });
    }
  }

  res.json({ episodes });
});

app.get('/anime', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const query = req.query.q || '';
  let results = [];
  let totalPages = 1;

  if (query.trim()) {
    const searchData = await tmdbFetch('/search/tv', { query, page, include_adult: false });
    if (searchData && searchData.results) {
      results = searchData.results.filter(item => !isAdultContent(item));
      totalPages = Math.min(searchData.total_pages || 1, 500);
    }
  } else {
    const data = await tmdbFetch('/discover/tv', {
      page,
      with_genres: '16',
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      include_adult: false
    });
    if (data && data.results) {
      results = data.results.filter(item => !isAdultContent(item));
      totalPages = Math.min(data.total_pages || 1, 500);
    }
  }

  res.render('anime', { query, results, page, totalPages });
});

app.get('/iptv', async (req, res) => {
  const channels = await xonaflixTvScraper.getChannels();
  res.render('iptv', { channels: channels || [] });
});

app.get('/watch', async (req, res) => {
  const { type, id, season, episode, title, playerUrl } = req.query;
  let sources = [];
  let titleDisplay = title || 'JapoPlay Player';
  let posterUrl = '';

  if (playerUrl) {
    sources.push({
      name: 'Lecteur Direct / Embed',
      url: playerUrl,
      type: playerUrl.includes('.mp4') || playerUrl.includes('.m3u8') ? 'video' : 'iframe'
    });
  } else if (type === 'movie') {
    const movieData = await tmdbFetch(`/movie/${id}`);
    if (movieData) {
      titleDisplay = movieData.title;
      if (movieData.poster_path) posterUrl = 'https://image.tmdb.org/t/p/w500' + movieData.poster_path;
      const [streamFr, streamOrig] = await Promise.all([
        streamflixScraper.scrapeMovie(id, movieData.title),
        movieData.original_title ? streamflixScraper.scrapeMovie(id, movieData.original_title) : null
      ]);
      if (streamFr) sources.push(streamFr);
      if (streamOrig) sources.push(streamOrig);
    }
  } else if (type === 'series' || type === 'anime') {
    const sNum = parseInt(season) || 1;
    const epNum = parseInt(episode) || 1;
    const seriesData = await tmdbFetch(`/tv/${id}`);
    if (seriesData) {
      titleDisplay = `${seriesData.name} - S${sNum} E${epNum}`;
      if (seriesData.poster_path) posterUrl = 'https://image.tmdb.org/t/p/w500' + seriesData.poster_path;
      const [sfStream, frMatches] = await Promise.all([
        streamflixScraper.scrapeSeries(id, sNum, epNum, seriesData.name),
        franimeScraper.search(seriesData.name)
      ]);
      if (sfStream) sources.push(sfStream);

      if (sources.length === 0) {
        try {
          const sPad = String(sNum).padStart(2, '0');
          const ePad = String(epNum).padStart(2, '0');
          const rawTitle = seriesData.name || 'Flash';
          const folderName = rawTitle.replace(/[^a-zA-Z0-9\s]/g, '').trim();
          const slugName = folderName.toLowerCase();

          const candidates = [
            `https://french.deliciouss.lol/series/VF/${folderName}/S${sPad}/${slugName}-S${sPad}-E${ePad}.mp4`,
            `https://french.deliciouss.lol/series/VF/${folderName}/S${sPad}/${folderName}-S${sPad}-E${ePad}.mp4`,
            `https://french.deliciouss.lol/series/VF/${folderName}/S${sPad}/S${sPad}E${ePad}.mp4`
          ];

          for (const cUrl of candidates) {
            try {
              const checkRes = await axios.head(cUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 3000
              });
              if (checkRes.status === 200) {
                sources.push({
                  name: 'Lecteur Direct (CDN Backup)',
                  url: cUrl,
                  type: 'video'
                });
                break;
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
      if (frMatches && frMatches.length > 0) {
        const frDet = await franimeScraper.getAnimeDetails(frMatches[0].id);
        if (frDet && frDet.seasons) {
          const sKeys = Object.keys(frDet.seasons);
          const targetSKey = sKeys[sNum - 1] || sKeys[0];
          const sObj = frDet.seasons[targetSKey];
          if (sObj && sObj.episodes && sObj.episodes[epNum - 1]) {
            const epObj = sObj.episodes[epNum - 1];
            if (epObj.streaming_links && epObj.streaming_links.length > 0) {
              const pUrl = epObj.streaming_links[0].players[0];
              const resolvedFr = await franimeScraper.resolvePlayerUrl(pUrl);
              if (resolvedFr) {
                sources.push({
                  name: 'Franime Stream (' + epObj.streaming_links[0].language.toUpperCase() + ')',
                  url: resolvedFr,
                  type: resolvedFr.includes('.mp4') || resolvedFr.includes('.m3u8') ? 'video' : 'iframe'
                });
              }
            }
          }
        }
      }
    }
  }

  res.render('watch', {
    titleDisplay,
    type,
    id,
    season: season || 1,
    episode: episode || 1,
    sources,
    posterUrl
  });
});

app.get('/search', async (req, res) => {
  const query = req.query.q || '';
  let movies = [];
  let series = [];
  let animes = [];
  let iptv = [];

  if (query.trim()) {
    const isSpiderman = query.toLowerCase().replace(/[^a-z0-9]/g, '').includes('spiderman');
    const searchQuery = isSpiderman ? 'Spider-Man' : query;

    const [tmdbMovies, tmdbSeries, tmdbAnime, tvList] = await Promise.all([
      tmdbFetch('/search/movie', { query: searchQuery, include_adult: false }),
      tmdbFetch('/search/tv', { query: searchQuery, without_genres: '16', include_adult: false }),
      tmdbFetch('/search/tv', { query: searchQuery, with_genres: '16', include_adult: false }),
      xonaflixTvScraper.getChannels()
    ]);

    if (tmdbMovies && tmdbMovies.results) {
      movies = tmdbMovies.results.filter(m => !isAdultContent(m)).map(item => {
        if (item.id === 969681 || item.id === '969681' || (item.title && item.title.includes('Brand New Day'))) {
          if (!item.poster_path || item.poster_path === '/jjCCZcCtggGjKik2gXjyux1VEdZ.jpg') {
            item.poster_path = '/3BVng0lmJyYIUqm5dxLS2eZ2625.jpg';
          }
        }
        return item;
      });
    }

    if (tmdbSeries) series = tmdbSeries.results ? tmdbSeries.results.filter(s => !isAdultContent(s)) : [];
    if (tmdbAnime) animes = tmdbAnime.results ? tmdbAnime.results.filter(a => !isAdultContent(a)) : [];
    if (tvList) {
      iptv = tvList.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
    }
  }

  res.render('search', {
    query,
    movies,
    series,
    animes,
    iptv
  });
});

app.get('/my-list', (req, res) => {
  res.render('my-list');
});

app.listen(PORT, () => {
  console.log(`JapoPlay Server running on http://localhost:${PORT}`);
});
