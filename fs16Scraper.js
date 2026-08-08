const axios = require('axios');
const cheerio = require('cheerio');

const DEFAULT_COOKIES = [
  'fss_guest_token=1b7a6b81a1797604952b2cbdd706b3d22a58427b52426521',
  'dle_newpm=0',
  'dle_password=001691d591a7fa0a82a8439c1496ae19',
  'dle_user_id=1949950',
  'PHPSESSID=a4a77a0966e73b22d910c2f82f2514c9'
].join('; ');

function getHeaders() {
  const cookieStr = process.env.FSTREAM_PREMIUM_COOKIES || DEFAULT_COOKIES;
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cookie': cookieStr,
    'Referer': 'https://fs16.lol/'
  };
}

const KNOWN_FS16_MAP = {
  '1368337': '4746',
  '155226': '4746',
  '1184918': '4746',
  '94605': '15111960'
};

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

async function resolveDirectMp4(fileCode, preferredDomain = null) {
  const domains = [];
  if (preferredDomain) domains.push(preferredDomain);
  domains.push('https://vidzy.org', 'https://fsvid.lol');
  const uniqueDomains = [...new Set(domains)];

  for (const domain of uniqueDomains) {
    try {
      const headers = getHeaders();
      const ddlPageUrl = `${domain}/d/${fileCode}_n`;

      const pageRes = await axios.get(ddlPageUrl, { headers, timeout: 6000 });
      const $ = cheerio.load(pageRes.data);

      const op = $('input[name="op"]').val() || 'download_orig';
      const id = $('input[name="id"]').val() || fileCode;
      const mode = $('input[name="mode"]').val() || 'n';
      const hash = $('input[name="hash"]').val();

      if (!hash) continue;

      const params = new URLSearchParams();
      params.append('op', op);
      params.append('id', id);
      params.append('mode', mode);
      params.append('hash', hash);

      const postRes = await axios.post(ddlPageUrl, params.toString(), {
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': ddlPageUrl
        },
        timeout: 6000
      });

      const $post = cheerio.load(postRes.data);
      let directUrl = null;

      $post('a').each((i, el) => {
        const href = $post(el).attr('href') || '';
        const text = $post(el).text().toLowerCase();
        if (href.includes('/v/') || text.includes('téléchargement') || href.includes('.mp4')) {
          directUrl = href;
        }
      });

      if (!directUrl) {
        const match = postRes.data.match(/https?:\/\/[^"'\s]+\.(?:mkv|mp4)[^"'\s]*/i);
        if (match) directUrl = match[0];
      }

      if (directUrl) return directUrl;
    } catch (err) {}
  }
  return null;
}

async function getFs16EpisodeStream(tmdbId, seasonNum = 1, episodeNum = 1) {
  try {
    const newsId = KNOWN_FS16_MAP[String(tmdbId)] || String(tmdbId);
    if (!newsId) return null;

    const headers = getHeaders();
    const [epRes, tokenRes] = await Promise.all([
      axios.get(`https://fs16.lol/ep-data.php?id=${newsId}&format=json`, { headers, timeout: 8000 }),
      axios.get(`https://fs16.lol/engine/ajax/vidzy_token.php?as=js`, { headers, timeout: 5000 }).catch(() => null)
    ]);

    let episodesData = null;
    if (typeof epRes.data === 'object' && epRes.data !== null) {
      episodesData = epRes.data;
    } else if (typeof epRes.data === 'string') {
      try {
        episodesData = JSON.parse(epRes.data);
      } catch (e) {
        const match = epRes.data.match(/var\s+episodesData\s*=\s*(\{[\s\S]*?\});/);
        if (match) episodesData = eval('(' + match[1] + ')');
      }
    }

    let tokenParams = '';
    if (tokenRes && tokenRes.data) {
      const tokenMatch = String(tokenRes.data).match(/"fmt":(\d+),"fms":"([^"]+)"/);
      if (tokenMatch) {
        tokenParams = `?autoplay=1&autostart=1&play=1&fmt=${tokenMatch[1]}&fms=${tokenMatch[2]}`;
      }
    }

    if (episodesData) {
      const epObj = (episodesData.vf && episodesData.vf[String(episodeNum)]) || (episodesData.vostfr && episodesData.vostfr[String(episodeNum)]);

      if (epObj) {
        let directMp4Url = null;
        if (epObj.premium) {
          const codeMatch = epObj.premium.match(/embed-([a-zA-Z0-9]+)\.html/);
          if (codeMatch) directMp4Url = await resolveDirectMp4(codeMatch[1]);
        }
        if (!directMp4Url && epObj.vidzy) {
          const codeMatch = epObj.vidzy.match(/embed-([a-zA-Z0-9]+)\.html/);
          if (codeMatch) directMp4Url = await resolveDirectMp4(codeMatch[1]);
        }

        if (directMp4Url) {
          return {
            success: true,
            url: directMp4Url,
            type: 'video',
            name: 'FS16 Direct Premium (1080p MP4) ⚡',
            quality: '1080p',
            provider: 'FS16 Premium Direct'
          };
        }

        if (epObj.vidzy) {
          const rawUrl = epObj.vidzy;
          const authenticatedUrl = tokenParams ? `${rawUrl}${tokenParams}` : rawUrl;
          return {
            success: true,
            url: authenticatedUrl,
            type: 'iframe',
            name: 'FS16 Vidzy (1080p) ⚡',
            quality: '1080p',
            provider: 'FS16 Vidzy'
          };
        }
      }
    }
  } catch (err) {}
  return null;
}

async function getFs16MovieStream(tmdbId, title = null) {
  try {
    const newsIdMapped = KNOWN_FS16_MAP[String(tmdbId)];
    if (newsIdMapped) {
      const headers = getHeaders();
      const pageRes = await axios.get(`https://fs16.lol/index.php?newsid=${newsIdMapped}`, { headers, timeout: 8000 });
      const html = pageRes.data;
      const embedMatches = html.match(/https?:\/\/[^"'\s]+\/(?:embed-|e\/|v\/)[^"'\s]+/gi);
      if (embedMatches && embedMatches.length > 0) {
        for (const embedUrl of embedMatches) {
          const codeMatch = embedUrl.match(/embed-([a-zA-Z0-9]+)\.html/);
          if (codeMatch) {
            const prefDomain = embedUrl.includes('vidzy') ? 'https://vidzy.org' : 'https://fsvid.lol';
            const directUrl = await resolveDirectMp4(codeMatch[1], prefDomain);
            if (directUrl) {
              return {
                success: true,
                url: directUrl,
                type: 'video',
                name: 'FS16 Direct (1080p MP4) ⚡',
                quality: '1080p',
                provider: 'FS16 Direct'
              };
            }
          }
        }
        return {
          success: true,
          url: embedMatches[0],
          type: 'iframe',
          name: 'FS16 Premium Stream ⚡',
          quality: '1080p',
          provider: 'FS16'
        };
      }
    }

    const directByTmdb = await getFs16EpisodeStream(tmdbId, 1, 1);
    if (directByTmdb) return directByTmdb;

    if (!title) return null;

    const headers = getHeaders();
    const searchRes = await axios.post('https://fs16.lol/engine/ajax/search.php', `query=${encodeURIComponent(title)}`, {
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000
    });

    const $ = cheerio.load(searchRes.data);
    const candidateUrls = [];
    const targetClean = cleanTitleForMatch(title);

    $('.search-item').each((i, el) => {
      const itemTitle = $(el).find('.search-title').text().trim();
      const onclick = $(el).attr('onclick') || '';
      const match = onclick.match(/location\.href=['"]([^'"]+)['"]/);
      if (match) {
        let fullUrl = match[1];
        if (!fullUrl.startsWith('http')) {
          fullUrl = 'https://fs16.lol' + (fullUrl.startsWith('/') ? fullUrl : '/' + fullUrl);
        }
        candidateUrls.push({ title: itemTitle, url: fullUrl });
      }
    });

    candidateUrls.sort((a, b) => {
      const tA = cleanTitleForMatch(a.title);
      const tB = cleanTitleForMatch(b.title);
      if (tA === targetClean && tB !== targetClean) return -1;
      if (tB === targetClean && tA !== targetClean) return 1;
      return 0;
    });

    for (const item of candidateUrls) {
      try {
        const pageRes = await axios.get(item.url, { headers, timeout: 8000 });
        const html = pageRes.data;

        const embedMatches = html.match(/https?:\/\/[^"'\s]+\/(?:embed-|e\/|v\/)[^"'\s]+/gi);
        if (embedMatches && embedMatches.length > 0) {
          for (const embedUrl of embedMatches) {
            const codeMatch = embedUrl.match(/embed-([a-zA-Z0-9]+)\.html/);
            if (codeMatch) {
              const prefDomain = embedUrl.includes('vidzy') ? 'https://vidzy.org' : 'https://fsvid.lol';
              const directUrl = await resolveDirectMp4(codeMatch[1], prefDomain);
              if (directUrl) {
                return {
                  success: true,
                  url: directUrl,
                  type: 'video',
                  name: 'FS16 Direct (1080p MP4) ⚡',
                  quality: '1080p',
                  provider: 'FS16 Direct'
                };
              }
            }
          }

          return {
            success: true,
            url: embedMatches[0],
            type: 'iframe',
            name: 'FS16 Movie (1080p) ⚡',
            quality: '1080p',
            provider: 'FS16'
          };
        }
      } catch (err) {}
    }
  } catch (err) {}
  return null;
}

module.exports = {
  getFs16EpisodeStream,
  getFs16MovieStream
};
