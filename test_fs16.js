const axios = require('axios');
const cheerio = require('cheerio');

async function testCleanHeadersDdl(fileCode) {
  console.log('--- TESTING DDL WITH CLEAN HEADERS FOR CODE:', fileCode, '---');
  const cleanHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Referer': 'https://fs16.lol/'
  };

  for (const domain of ['https://vidzy.org', 'https://fsvid.lol']) {
    try {
      const ddlPageUrl = `${domain}/d/${fileCode}_n`;
      const pageRes = await axios.get(ddlPageUrl, { headers: cleanHeaders, timeout: 6000 });
      const $ = cheerio.load(pageRes.data);
      const hash = $('input[name="hash"]').val();

      console.log(`[${domain}] Hash:`, hash ? hash.substring(0, 15) + '...' : 'NULL');

      if (hash) {
        const op = $('input[name="op"]').val() || 'download_orig';
        const id = $('input[name="id"]').val() || fileCode;
        const mode = $('input[name="mode"]').val() || 'n';

        const params = new URLSearchParams();
        params.append('op', op);
        params.append('id', id);
        params.append('mode', mode);
        params.append('hash', hash);

        const postRes = await axios.post(ddlPageUrl, params.toString(), {
          headers: {
            ...cleanHeaders,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': ddlPageUrl
          },
          timeout: 6000
        });

        const $post = cheerio.load(postRes.data);
        $post('a').each((i, el) => {
          const href = $post(el).attr('href') || '';
          if (href.includes('/v/') || href.includes('.mp4')) {
            console.log(`SUCCESS! Found MP4 URL for ${fileCode}:`, href);
          }
        });
      }
    } catch (err) {
      console.log('ERR:', err.message);
    }
  }
}

testCleanHeadersDdl('coytfqq86ksa');
