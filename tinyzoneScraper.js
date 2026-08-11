const axios = require('axios');
const cheerio = require('cheerio');

const TINYZONE_BASE = 'https://www.tinyzone.is';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Referer': TINYZONE_BASE,
  'X-Requested-With': 'XMLHttpRequest'
};

/**
 * TinyZone Scraper Integration for JapoPlay
 */
const tinyzoneScraper = {
  /**
   * Search for a movie or TV show on TinyZone
   */
  async search(query) {
    if (!query) return [];
    try {
      const searchUrl = `${TINYZONE_BASE}/search/${encodeURIComponent(query.toLowerCase().replace(/[^a-z0-9]/g, '-'))}`;
      const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 8000 });
      const $ = cheerio.load(res.data);
      const results = [];

      $('.flw-item').each((_, el) => {
        const title = $(el).find('.film-name a').text().trim();
        const href = $(el).find('.film-name a').attr('href') || '';
        const poster = $(el).find('.film-poster-img').attr('data-src') || $(el).find('.film-poster-img').attr('src') || '';
        const isTv = $(el).find('.fld-item .fd-infor .fld-item').text().toLowerCase().includes('tv') || href.includes('/tv/');

        const idMatch = href.match(/-(\d+)$/);
        if (idMatch && title) {
          results.push({
            id: idMatch[1],
            title,
            href,
            poster,
            type: isTv ? 'tv' : 'movie'
          });
        }
      });

      return results;
    } catch (err) {
      return [];
    }
  },

  /**
   * Scrape stream source URL for a movie or episode
   */
  async scrapeSource(title, type = 'movie', season = 1, episode = 1) {
    try {
      const searchResults = await this.search(title);
      if (!searchResults || searchResults.length === 0) return null;

      const target = searchResults.find(r => r.type === (type === 'movie' ? 'movie' : 'tv')) || searchResults[0];
      const pageUrl = `${TINYZONE_BASE}${target.href}`;
      const pageRes = await axios.get(pageUrl, { headers: HEADERS, timeout: 8000 });
      const $ = cheerio.load(pageRes.data);

      const movieOrTvId = target.id;
      let embedUrl = null;

      if (type === 'movie') {
        const serversRes = await axios.get(`${TINYZONE_BASE}/ajax/movie/episodes/${movieOrTvId}`, { headers: HEADERS, timeout: 6000 });
        const $s = cheerio.load(serversRes.data);
        const linkId = $s('.nav-item a').first().attr('data-linkid') || $s('.nav-item a').first().attr('data-id');

        if (linkId) {
          const sourcesRes = await axios.get(`${TINYZONE_BASE}/ajax/sources/${linkId}`, { headers: HEADERS, timeout: 6000 });
          if (sourcesRes.data && sourcesRes.data.link) {
            embedUrl = sourcesRes.data.link;
          }
        }
      } else {
        const seasonsRes = await axios.get(`${TINYZONE_BASE}/ajax/v2/tv/seasons/${movieOrTvId}`, { headers: HEADERS, timeout: 6000 });
        const $se = cheerio.load(seasonsRes.data);
        let seasonId = null;

        $se('.dropdown-item').each((_, el) => {
          const sText = $(el).text().trim();
          if (sText.includes(`Season ${season}`)) {
            seasonId = $(el).attr('data-id');
          }
        });

        if (!seasonId) seasonId = $se('.dropdown-item').first().attr('data-id');

        if (seasonId) {
          const episodesRes = await axios.get(`${TINYZONE_BASE}/ajax/v2/season/episodes/${seasonId}`, { headers: HEADERS, timeout: 6000 });
          const $ep = cheerio.load(episodesRes.data);
          let episodeId = null;

          $ep('.eps-item').each((_, el) => {
            const epNum = $(el).attr('data-number') || $(el).find('.film-name').text().trim();
            if (String(epNum).includes(String(episode))) {
              episodeId = $(el).attr('data-id');
            }
          });

          if (!episodeId) episodeId = $ep('.eps-item').first().attr('data-id');

          if (episodeId) {
            const serversRes = await axios.get(`${TINYZONE_BASE}/ajax/v2/episode/servers/${episodeId}`, { headers: HEADERS, timeout: 6000 });
            const $serv = cheerio.load(serversRes.data);
            const linkId = $serv('.nav-item a').first().attr('data-id') || $serv('.nav-item a').first().attr('data-linkid');

            if (linkId) {
              const sourcesRes = await axios.get(`${TINYZONE_BASE}/ajax/sources/${linkId}`, { headers: HEADERS, timeout: 6000 });
              if (sourcesRes.data && sourcesRes.data.link) {
                embedUrl = sourcesRes.data.link;
              }
            }
          }
        }
      }

      if (embedUrl) {
        return {
          name: 'TinyZone Stream (VOSTFR/ENG)',
          url: embedUrl,
          type: embedUrl.includes('.mp4') || embedUrl.includes('.m3u8') ? 'video' : 'iframe'
        };
      }

      return {
        name: 'TinyZone Player Direct',
        url: pageUrl,
        type: 'iframe'
      };
    } catch (err) {
      return null;
    }
  }
};

module.exports = tinyzoneScraper;
